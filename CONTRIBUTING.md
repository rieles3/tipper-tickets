# Contributing

Issues and pull requests are welcome. Describe the business case and expected behavior before proposing changes to the campaign lifecycle or inventory rules.

## Contract development

1. Install the pinned toolchain with `python3 scripts/install-tools.py`.
2. Create a branch for the change.
3. Update contract tests when behavior changes.
4. Run `./scripts/check` before opening a pull request.

The check script runs formatting, compilation, linting with warnings denied, and Starknet Foundry tests. It does not send transactions or require credentials.

Keep these invariants intact:

- `0 <= redeemed <= issued <= supply_cap` for every campaign and series.
- Activation permanently closes issuance and series creation.
- Redemption consumes an existing coupon and retains its original attribution.
- A conversion reference can be used once per campaign, including across series.
- Unauthorized or rejected operations leave state unchanged.

Changes to these rules require an explicit design discussion. The current contract has no upgrade entrypoint; deploying a new version must preserve the identity and history of existing campaigns.

## Demo development

Follow [demo/README.md](demo/README.md), then run:

```sh
cd demo
npm run typecheck
npm run build
```

Keep the two guided flows focused on explaining issuance, freezing and single-use redemption. A successful submission is not a confirmed redemption: wait for the transaction receipt before presenting success.

## Pull requests

Explain the problem, the resulting behavior and the checks you ran. Document ABI or integration changes alongside the code. Keep generated build output, accounts, credentials, raw deployment logs and local databases out of commits. Never include real customer identifiers in test fixtures or on-chain examples.
