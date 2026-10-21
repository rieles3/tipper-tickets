# Starknet Sepolia

[README](../README.md) · [Contract reference](CONTRACT.md)

## Reference deployment

The initial `BurnLedger` deployment was exercised on Sepolia on October 9, 2026.

| Field | Value |
| --- | --- |
| Contract | `0x02bc9f6f8e524f8944293e361cf7bf6321f63558f209bf25f3c3653e50edf65e` |
| Class hash | `0x06d1252a338cf3b1f6d25c09f58758af693f844580350ba20f89f7cc4650c494` |
| Network | Starknet Sepolia |

[View the contract on Voyager](https://sepolia.voyager.online/contract/0x02bc9f6f8e524f8944293e361cf7bf6321f63558f209bf25f3c3653e50edf65e). Public transaction hashes are in [`deployments/sepolia.json`](../deployments/sepolia.json), with its ABI alongside it. Publishing source in this repository is separate from explorer source verification; this release does not claim explorer verification or an external audit.

The recorded smoke run checked creator inventory (50 issued, 20 redeemed), referral attribution and rejection of duplicate redemption, post-activation issuance and duplicate conversion references. Its 20 creator redemptions used one multicall transaction. Raw receipts, account records and runtime logs are excluded from this repository.

## Configure your account

The `scripts/sepolia` wrapper uses the `tipper-sepolia` account in an ignored `.secrets/accounts.json` file and fixes the network to Sepolia. It does not ship a shared signing key.

```sh
mkdir -p .secrets
chmod 700 .secrets
./scripts/tool sncast --accounts-file .secrets/accounts.json account create   --name tipper-sepolia --network sepolia
chmod 600 .secrets/accounts.json
```

Fund the resulting account address with testnet STRK, then deploy the account:

```sh
./scripts/sepolia account deploy --name tipper-sepolia --silent
```

Use the installed `sncast ... --help` for account import or keystore alternatives. The wrapper rejects network and account overrides intentionally.

## Declare and deploy

```sh
./scripts/check
./scripts/sepolia declare --contract-name BurnLedger --dry-run --detailed
./scripts/sepolia declare --contract-name BurnLedger
```

Use the returned class hash to deploy. The contract has no constructor arguments:

```sh
TIPPER_CLASS_HASH='<class_hash returned by declare>'
./scripts/sepolia deploy --class-hash "$TIPPER_CLASS_HASH" --unique
```

Record the resulting address and transaction hashes. Preserve the reference deployment metadata separately if testing your own instance. To read it:

```sh
TIPPER_CONTRACT='<contract_address returned by deploy>'
./scripts/sepolia call --contract-address "$TIPPER_CONTRACT" --function total_campaigns
./scripts/sepolia call --contract-address "$TIPPER_CONTRACT" --function total_issued
```

Wait for confirmed receipts. An ambiguous timeout requires checking the original transaction before repeating a write.

## Optional network smoke test

```sh
python3 scripts/sepolia-smoke.py
```

This uses the address in `deployments/sepolia.json` and creates new campaigns with your configured account. It sends real Sepolia transactions and spends testnet STRK. Output is written to an ignored `deployments/smoke-.../` directory. A fresh execution creates fresh campaigns; it does not erase previous history.

`--resume-before-burn smoke-RUN` supports the narrow recovery point immediately after creator-campaign activation and before its first redemption. It verifies the expected campaign state before continuing. There are no automatic retries of ambiguous writes.

## Raw calldata examples

| Entrypoint | Arguments |
| --- | --- |
| `create_campaign` | `0 100 FUTURE_EXPIRY 0` for creator coupons; kind `1` for referrals |
| `create_series` | `CAMPAIGN_ID SOURCE_ID PUBLIC_CODE 100` |
| `issue_coupons` | `CAMPAIGN_ID SERIES_ID COUNT COMMITMENT_1 ... COMMITMENT_N` |
| `activate_campaign` | `CAMPAIGN_ID` |
| `redeem_coupon` | `COUPON_ID CONVERSION_REF` |
| `get_campaign` | `CAMPAIGN_ID` |
| `get_coupon` | `COUPON_ID` |

Uppercase values are examples to replace, not literal calldata. Expiry is a Unix timestamp in seconds. Obtain IDs from transaction events rather than assuming their values in a shared contract. Use `invoke` for writes and `call` for reads.
