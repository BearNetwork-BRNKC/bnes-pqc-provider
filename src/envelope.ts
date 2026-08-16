import { RLP } from '@ethereumjs/rlp';
import { keccak256 } from 'ethereum-cryptography/keccak.js';
import type { QuantumEnvelopeFields } from './types';

function parseQuantity(value: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]+$/u.test(value)) {
    throw new Error('Must be a hexadecimal quantity');
  }
  let hex = value.slice(2);
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  // Strip leading zero bytes (minimal representation)
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start++;
  }
  if (bytes.length === 0 || (bytes.length === 1 && bytes[0] === 0)) {
    return new Uint8Array();
  }
  return bytes.slice(start);
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * 計算 PQC 簽章雜湊（對齊 Go 節點 PQCSigningHash()）
 * 欄位順序：ChainID, Nonce, GasPrice, Gas, To, Value, Data, AccessList
 */
export function computePqcSigningHash(fields: QuantumEnvelopeFields): Uint8Array {
  const encoded = RLP.encode([
    parseQuantity(fields.chainId),   // ChainID
    parseQuantity(fields.nonce),     // Nonce
    parseQuantity(fields.gasPrice),  // GasPrice
    parseQuantity(fields.gas),       // Gas
    fields.to ? hexToBytes(fields.to) : new Uint8Array(), // To (nil = contract creation)
    parseQuantity(fields.value),     // Value
    hexToBytes(fields.data ?? '0x'), // Data
    (fields.accessList ?? []).map(entry => [ // AccessList
      hexToBytes(entry.address),
      entry.storageKeys.map(hexToBytes)
    ])
  ]);
  return keccak256(encoded);
}

/**
 * 序列化完整的 0x04 Quantum Envelope 交易（EIP-2718 格式）
 * 欄位順序對齊 Go 節點 QuantumEnvelopeTx struct RLP 展開順序：
 *   LegacyTx: Nonce, GasPrice, Gas, To, Value, Data, V, R, S
 *   追加欄位: ChainID, AccessList, PkPQC, Sigma, QuantumWitness
 */
export function serializeQuantumEnvelope(fields: QuantumEnvelopeFields): string {
  const payload = [
    // LegacyTx 嵌入欄位
    parseQuantity(fields.nonce),
    parseQuantity(fields.gasPrice),
    parseQuantity(fields.gas),
    fields.to ? hexToBytes(fields.to) : new Uint8Array(),
    parseQuantity(fields.value),
    hexToBytes(fields.data ?? '0x'),
    parseQuantity(fields.v),   // ECDSA V
    parseQuantity(fields.r),   // ECDSA R
    parseQuantity(fields.s),   // ECDSA S
    // QuantumEnvelopeTx 追加欄位
    parseQuantity(fields.chainId),
    (fields.accessList ?? []).map(entry => [
      hexToBytes(entry.address),
      entry.storageKeys.map(hexToBytes)
    ]),
    hexToBytes(fields.pkPqc),  // ML-DSA-87 Public Key (2592 bytes)
    hexToBytes(fields.sigma),  // ML-DSA-87 Signature  (4627 bytes)
    new Uint8Array()            // QuantumWitness: 錢包端為空，節點端填入
  ];

  // EIP-2718: type_byte || RLP(payload)
  const encodedPayload = RLP.encode(payload);
  const out = new Uint8Array(1 + encodedPayload.length);
  out[0] = 0x04;
  out.set(encodedPayload, 1);

  let hex = '';
  for (let i = 0; i < out.length; i++) {
    hex += out[i].toString(16).padStart(2, '0');
  }
  return '0x' + hex;
}
