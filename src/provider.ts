import { serializeQuantumEnvelope } from './envelope';
import { SNAP_ID } from './constants';
import type { QuantumEnvelopeFields } from './types';

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
    const ecdsaFields = {
      nonce: ecdsaSigned.nonce || txParams.nonce,
      gasPrice: ecdsaSigned.gasPrice || txParams.gasPrice,
      gas: ecdsaSigned.gas || txParams.gas,
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

    // 4. Assemble the 0x04 Quantum Envelope
    const quantumFields: QuantumEnvelopeFields = {
      ...ecdsaFields,
      pkPqc,
      sigma
    };

    const serializedTx = serializeQuantumEnvelope(quantumFields);

    // 5. Broadcast to network
    return this.ethereum.request({
      method: 'eth_sendRawTransaction',
      params: [serializedTx]
    });
  }
}
