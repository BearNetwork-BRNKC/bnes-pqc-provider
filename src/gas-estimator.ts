/**
 * BNES PQC Gas 估算覆寫模組
 *
 * 風險背景：ML-DSA-87 雙簽章 0x04 交易體積遠大於標準 ECDSA：
 *   - ML-DSA-87 公鑰（pkPqc）：2592 bytes
 *   - ML-DSA-87 簽章（sigma）：4627 bytes
 *   - 合計 PQC payload 額外 body：~7219 bytes
 *
 * EVM 對交易資料的 Gas 收費規則（EIP-2028）：
 *   - 非零位元組：每 byte 收 16 gas
 *   - 零位元組：每 byte 收 4 gas
 *
 * 若不覆寫 eth_estimateGas，DApp 端發送的原始估算僅計算標準欄位，
 * 導致 0x04 交易因 Out of Gas 失敗。
 *
 * 此模組提供：
 *   1. estimatePqcPayloadGasOverhead()  靜態計算 PQC payload 額外 Gas 上限
 *   2. createPqcGasEstimateMiddleware()  EIP-1193 provider 中介層，
 *      自動攔截 eth_estimateGas 並補貼 PQC Gas 溢價
 */

import { PQC_PUBLIC_KEY_LENGTH, PQC_SIGNATURE_LENGTH, BNES_MAINNET_CHAIN_ID_HEX } from './constants';

// EIP-2028 Gas 收費常數
const GAS_PER_NONZERO_BYTE = 16;
const GAS_PER_ZERO_BYTE = 4;

/**
 * 計算指定位元組陣列的 calldata Gas 成本
 * 基於 EIP-2028 規則：零位元組 4 gas、非零位元組 16 gas
 */
function calldataGasCost(bytes: Uint8Array): bigint {
  let cost = 0n;
  for (const byte of bytes) {
    cost += byte === 0 ? BigInt(GAS_PER_ZERO_BYTE) : BigInt(GAS_PER_NONZERO_BYTE);
  }
  return cost;
}

/**
 * 計算 PQC payload（pkPqc + sigma + RLP 頭部開銷）的最大 Gas 溢價。
 *
 * 使用最壞情況（全非零位元組）以保守估算，確保交易不因 OOG 失敗。
 * 實際溢價通常低於此值，節省量依 pkPqc / sigma 的零位元組比例而定。
 *
 * RLP 框架開銷估算：
 *   - pkPqc 的 RLP 長度前綴（3 bytes）
 *   - sigma 的 RLP 長度前綴（3 bytes）
 *   - QuantumWitness 空欄位（1 byte）
 *   - 頂層 list 長度前綴（3 bytes）
 *   合計約 10 bytes
 */
export function estimatePqcPayloadGasOverhead(): bigint {
  const RLP_OVERHEAD_BYTES = 10;
  const totalPayloadBytes = PQC_PUBLIC_KEY_LENGTH + PQC_SIGNATURE_LENGTH + RLP_OVERHEAD_BYTES;

  // 最壞情況：全非零位元組
  const worstCaseGas = BigInt(totalPayloadBytes) * BigInt(GAS_PER_NONZERO_BYTE);

  // 加上 10% 緩衝，對齊 MetaMask 標準的 Gas Limit 緩衝策略
  const bufferMultiplier = 110n;
  return (worstCaseGas * bufferMultiplier) / 100n;
}

/**
 * 根據實際 pkPqc 與 sigma hex 字串計算精確的 Gas 溢價。
 * 在取得 Snap PQC 公鑰後、廣播前呼叫，可獲得更精確的 Gas Limit。
 */
export function estimatePqcPayloadGasExact(
  pkPqcHex: string,
  sigmaHex: string,
): bigint {
  const hexToBytes = (hex: string): Uint8Array => {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  };

  const pkBytes = hexToBytes(pkPqcHex);
  const sigmaBytes = hexToBytes(sigmaHex);

  const RLP_OVERHEAD_BYTES = 10;
  const rlpOverheadCost = BigInt(RLP_OVERHEAD_BYTES) * BigInt(GAS_PER_NONZERO_BYTE);

  return calldataGasCost(pkBytes) + calldataGasCost(sigmaBytes) + rlpOverheadCost;
}

/**
 * EIP-1193 相容的 Gas 估算中介層工廠函數
 *
 * 使用方式：
 *   const patchedProvider = createPqcGasEstimateMiddleware(window.ethereum);
 *   const gas = await patchedProvider.request({ method: 'eth_estimateGas', params: [txParams] });
 *   // 回傳值已自動包含 PQC payload Gas 溢價
 *
 * @param upstreamProvider  原始的 EIP-1193 provider（例如 window.ethereum）
 * @param options.onlyForBnes  若為 true（預設），僅在 BNES 主網（0x9c8ce）時套用溢價
 *                             設為 false 可強制對所有網路套用（測試用）
 */
export function createPqcGasEstimateMiddleware(
  upstreamProvider: {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  },
  options: { onlyForBnes?: boolean } = {},
) {
  const { onlyForBnes = true } = options;

  return {
    async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
      // 僅攔截 eth_estimateGas
      if (args.method !== 'eth_estimateGas') {
        return upstreamProvider.request(args);
      }

      // 若設定僅限 BNES 主網，先查詢當前 chainId
      if (onlyForBnes) {
        const currentChainId = await upstreamProvider.request({
          method: 'eth_chainId',
        }) as string;

        if (currentChainId.toLowerCase() !== BNES_MAINNET_CHAIN_ID_HEX.toLowerCase()) {
          // 非 BNES 主網，透傳不修改
          return upstreamProvider.request(args);
        }
      }

      // 取得上游估算結果
      const upstreamEstimate = await upstreamProvider.request(args) as string;
      const baseGas = BigInt(upstreamEstimate);

      // 補貼 PQC payload Gas 溢價（保守估算）
      const overhead = estimatePqcPayloadGasOverhead();
      const adjustedGas = baseGas + overhead;

      // 回傳 hex 字串，對齊 EIP-1193 回傳格式
      return '0x' + adjustedGas.toString(16);
    },
  };
}

/**
 * 取得易讀的 PQC Gas 溢價摘要（用於 UI 顯示或除錯日誌）
 */
export function getPqcGasOverheadSummary(): {
  pkPqcBytes: number;
  sigmaBytes: number;
  totalExtraBytes: number;
  worstCaseGasOverhead: string;
} {
  const overhead = estimatePqcPayloadGasOverhead();
  return {
    pkPqcBytes: PQC_PUBLIC_KEY_LENGTH,
    sigmaBytes: PQC_SIGNATURE_LENGTH,
    totalExtraBytes: PQC_PUBLIC_KEY_LENGTH + PQC_SIGNATURE_LENGTH + 10,
    worstCaseGasOverhead: overhead.toString(),
  };
}
