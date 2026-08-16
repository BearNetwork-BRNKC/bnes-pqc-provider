export type AccessListEntry = {
  address: string;
  storageKeys: string[];
};

export type QuantumEnvelopeFields = {
  chainId: string;
  nonce: string;
  gasPrice: string;
  gas: string;
  to?: string | null;
  value: string;
  data?: string;
  accessList?: AccessListEntry[];
  
  // ECDSA
  v: string;
  r: string;
  s: string;
  
  // PQC 附加欄位 (Hex format)
  pkPqc: string;
  sigma: string;
};
