# @bearnetwork/pqc-provider

**BNES PQC Provider** is a JavaScript/TypeScript SDK for interacting with the BearNetworkChain (BNC) using ML-DSA-87 Post-Quantum Cryptography (PQC) signatures via the EIP-2718 `0x04` Quantum Envelope transaction format.

This provider wraps the standard Ethereum provider (like MetaMask) to automatically request ECDSA signatures, request PQC signatures from the BearNetwork PQC Snap, and construct the final Quantum Shielded Transaction.

## Installation

```bash
npm install @bearnetwork/pqc-provider
# or
yarn add @bearnetwork/pqc-provider
```

## Features

- 🛡️ **Quantum Security**: Secures your dApp transactions with ML-DSA-87 signatures.
- 🔌 **Seamless Integration**: Hooks directly into existing standard Web3 wallets (e.g., MetaMask).
- 📦 **Automated Flow**: Automatically handles the multi-signature (ECDSA + ML-DSA-87) gathering process.
- 🔐 **Snap Powered**: Leverages `@bearnetwork/bnes-pqc-snap` for secure, in-wallet deterministic PQC key derivation.

## Usage

To send a Quantum Shielded Transaction, wrap your existing Ethereum provider (e.g., `window.ethereum`) with the `PQCProvider`:

```typescript
import { PQCProvider } from '@bearnetwork/pqc-provider';

async function sendQuantumTx() {
  // 1. Ensure the user has MetaMask or a compatible injected provider
  if (typeof window.ethereum === 'undefined') {
    throw new Error('Please install MetaMask!');
  }

  // 2. Initialize the PQC Provider
  const pqcProvider = new PQCProvider(window.ethereum);

  // 3. Request accounts (if not already connected)
  const accounts = await pqcProvider.requestAccounts();
  const from = accounts[0];

  // 4. Define your standard transaction parameters
  const txParams = {
    to: '0xRecipientAddressHere...', // Replace with actual address
    value: '0x100000000000000',     // Amount in Wei (hex)
    gas: '0x5208',                  // Gas limit (hex)
    gasPrice: '0x4A817C800',        // Gas price (hex)
    chainId: '0x9c8ce',             // BNC Mainnet Chain ID (641230)
    data: '0x'                      // Optional contract data
  };

  try {
    // 5. Send the transaction!
    // The provider will automatically request ECDSA signature, invoke the PQC Snap,
    // assemble the 0x04 Quantum Envelope, and broadcast it to the network.
    const txHash = await pqcProvider.sendTransaction(txParams);
    console.log('Quantum Transaction Sent! Hash:', txHash);
  } catch (error) {
    console.error('Failed to send Quantum Transaction:', error);
  }
}
```

## License

MIT
