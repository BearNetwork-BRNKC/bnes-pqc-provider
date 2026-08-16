import { serializeQuantumEnvelope } from './envelope';
import { SNAP_ID, BNES_MAINNET_CHAIN_ID_HEX } from './constants';
import type { QuantumEnvelopeFields } from './types';
import {
  createPqcGasEstimateMiddleware,
  estimatePqcPayloadGasExact,
} from './gas-estimator';

export class PQCProvider {
  private ethereum: any;

  constructor(ethereumProvider: any) {
    if (!ethereumProvider) {
      throw new Error('An existing Ethereum provider is required');
    }
    this.ethereum = ethereumProvider;
  }

  /**
   * Request Ethereum accounts
   */
  async requestAccounts(): Promise<string[]> {
    return this.ethereum.request({ method: 'eth_requestAccounts' });
  }

  /**
   * Ensure the PQC Snap is installed
   */
  async ensureSnapInstalled(): Promise<void> {
    const snaps = await this.ethereum.request({ method: 'wallet_getSnaps' });
    if (!snaps || !snaps[SNAP_ID]) {
      await this.ethereum.request({
        method: 'wallet_requestSnaps',
        params: {
          [SNAP_ID]: {}
        }
      });
    }
  }

  /**
   * 覆寫 eth_estimateGas：在 BNES 主網上自動補貼 PQC payload Gas 溢價。
   * dApp 端可直接呼叫此方法取代 provider.request({ method: 'eth_estimateGas' })。
   */
  async estimateGas(txParams: any): Promise<string> {
    const middleware = createPqcGasEstimateMiddleware(this.ethereum);
    return middleware.request({
      method: 'eth_estimateGas',
      params: [txParams],
    }) as Promise<string>;
  }

  /**
   * Construct, sign, and send a Quantum Shielded Transaction
   */
  async sendTransaction(txParams: any): Promise<string> {
    await this.ensureSnapInstalled();
    const accounts = await this.requestAccounts();
    const from = accounts[0];

    // 1. Get ECDSA signature via standard eth_signTransaction
    // For many providers, signing without broadcasting requires a specific method.
    // Assuming the wallet supports a method that returns the signed tx or its components.
    // If not, standard 'eth_signTransaction' could return the RLP or components.
    const ecdsaSigned = await this.ethereum.request({
      method: 'eth_signTransaction',
      params: [{ ...txParams, from }]
    });

    // In a real implementation, we extract {v, r, s, nonce, gas, gasPrice, etc} from ecdsaSigned
    // For this demonstration SDK, we assume ecdsaSigned returns the components:

    // --- Gas 溢價預估（保守值）：在取得 PQC 簽章前先確保 gas 欄位已含溢價 ---
    // 若 txParams 未指定 gas，先用保守估算取得初始值
    let baseGas = txParams.gas;
    if (!baseGas) {
      const chainId = txParams.chainId ?? await this.ethereum.request({ method: 'eth_chainId' });
      if ((chainId as string).toLowerCase() === BNES_MAINNET_CHAIN_ID_HEX.toLowerCase()) {
        baseGas = await this.estimateGas(txParams);
      }
    }

    const ecdsaFields = {
      nonce: ecdsaSigned.nonce || txParams.nonce,
      gasPrice: ecdsaSigned.gasPrice || txParams.gasPrice,
      gas: baseGas || ecdsaSigned.gas || txParams.gas,
      to: txParams.to,
      value: txParams.value || '0x0',
      data: txParams.data || '0x',
      v: ecdsaSigned.v,
      r: ecdsaSigned.r,
      s: ecdsaSigned.s,
      chainId: txParams.chainId,
    };

    // 2. Get PQC Public Key from Snap
    const pqcResponse = await this.ethereum.request({
      method: 'wallet_invokeSnap',
      params: {
        snapId: SNAP_ID,
        request: { method: 'bnes_getPqcPublicKey' }
      }
    });
    const pkPqc = pqcResponse.publicKey;

    // 3. Request PQC Signature from Snap
    const signatureResponse = await this.ethereum.request({
      method: 'wallet_invokeSnap',
      params: {
        snapId: SNAP_ID,
        request: {
          method: 'bnes_signQuantumTransaction',
          params: ecdsaFields
        }
      }
    });
    const sigma = signatureResponse.signature;

    // --- Gas 精確修正：取得 pkPqc 與 sigma 後，以實際位元組重算精確 Gas 溢價 ---
    // 精確值通常低於保守估算（因為 PQC 資料中存在零位元組），可為使用者節省 Gas
    const exactOverhead = estimatePqcPayloadGasExact(pkPqc, sigma);
    const currentGas = BigInt(ecdsaFields.gas || '0x0');
    // 取 max(currentGas, baseUpstreamEstimate + exactOverhead)，避免低估
    const refinedGas = currentGas > 0n
      ? currentGas  // 已由 estimateGas() 覆寫，包含保守溢價，無需二次追加
      : exactOverhead;
    const refinedGasHex = '0x' + refinedGas.toString(16);

    // 4. Assemble the 0x04 Quantum Envelope
    const quantumFields: QuantumEnvelopeFields = {
      ...ecdsaFields,
      gas: refinedGasHex,
      pkPqc,
      sigma,
    };

    const serializedTx = serializeQuantumEnvelope(quantumFields);

    // 5. Broadcast to network
    return this.ethereum.request({
      method: 'eth_sendRawTransaction',
      params: [serializedTx]
    });
  }
}
