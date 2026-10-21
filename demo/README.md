# Tipper Tickets — guided demo

A step-by-step web integration of the two initial BurnLedger products: creator coupons and web referrals. Both flows submit real transactions to **Starknet Sepolia**.

## Experience

1. Prepare a campaign and choose its initial coupon inventory.
2. Issue unique coupon IDs for a creator or referral sources.
3. Activate the campaign and freeze issuance.
4. Confirm a sample redemption or registration and try reusing it.
5. Inspect inventory, attribution and transaction receipts.

Visitors do not need a wallet or registration. A dedicated application account pays testnet fees. Sample names and visits are illustrative, not verified people or integrations with Instagram or Substack. A new journey creates a new campaign without deleting on-chain history; demo campaigns expire after seven days.

## Requirements

- Node.js 22.13 or newer and npm.
- A dedicated, deployed Starknet Sepolia account funded with testnet STRK.
- Access to a Sepolia RPC endpoint.

The source includes a reference contract address in [`lib/demo-types.ts`](lib/demo-types.ts). To use your own BurnLedger deployment, update `CONTRACT` there and keep the network on Sepolia.

## Local setup

From this directory:

```sh
npm run install:ci
cp .dev.vars.example .dev.vars
```

Fill in `DEMO_ACCOUNT_ADDRESS` and `DEMO_PRIVATE_KEY` in `.dev.vars`. The example contains no credentials; `.dev.vars` is ignored. `STARKNET_RPC_URL` defaults to the public Sepolia endpoint provided in the template. Keep signing credentials on the server, and use only a dedicated testnet account.

Build and initialize the local D1 database:

```sh
npm run typecheck
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_aromatic_dreaming_celestial.sql
npm run start
```

Open the localhost URL printed by Wrangler. For hot reload during development, use `npm run dev` and the URL it prints. The commands use local Cloudflare emulation; they do not deploy a public website.

## Architecture

- React and TypeScript for the guided interface.
- Vinext/Vite and Cloudflare Workers for the application runtime.
- D1 and Drizzle for journeys, pending transactions and the shared signer nonce queue.
- starknet.js for contract calls and account-signed transactions.

Only successful, accepted transaction receipts advance confirmed on-chain state in the UI. Invalid operations can be rejected during RPC estimation without sending a transaction.

The `.openai/hosting.json` file declares local service bindings used by the build plugin. It contains no account, deployment ID or credentials. Vendored build and styling files retain their license notices.

## Scope

This is a development demo with an intentionally open interaction flow. It is not an audited production service or the planned public SDK. WhatsApp and the Go SDK are separate next phases.
