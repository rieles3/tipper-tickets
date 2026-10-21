# BurnLedger contract reference

[README](../README.md) · [Referencia en español](CONTRACT.es.md) · [ABI](../src/interfaces.cairo)

## Lifecycle and inventory

`Draft → Active → Closed`, with `Draft → Closed` also allowed. States never move backwards. An active campaign can be paused and resumed without changing inventory.

Campaign and series supply caps are immutable. The sum of series caps cannot exceed the campaign cap. Issuance can be smaller than the cap; activation freezes the **actual issued total** and prevents new series or issuance forever.

```text
0 <= redeemed <= issued <= supply_cap
unconsumed = issued - redeemed
```

Unconsumed does not mean redeemable: pause, closure or expiry can prevent redemption. `is_redeemable(coupon_id)` checks coupon and campaign state, not caller permissions. `is_operator` checks authorization, not campaign state.

At `block_timestamp >= expires_at`, issuance, series creation, activation and redemption are rejected. Expiry preserves history and does not automatically change the stored campaign status.

Campaign IDs and coupon IDs are global to the contract. Series IDs are local to a campaign. IDs start at 1; 0 represents absence. Full identity includes the network and contract address.

## Permissions

| Operation | Campaign owner | Authorized operator | Public |
| --- | --- | --- | --- |
| Create a new campaign | Yes | Yes, as its new owner | Yes, through a Starknet account |
| Create series, issue and activate | Yes, while Draft | No | No |
| Grant or revoke operators | Yes, until closed | No | No |
| Pause, resume and close | Yes, subject to lifecycle rules | No | No |
| Redeem a coupon | Yes | Yes, for that campaign | No |
| Read state and events | Yes | Yes | Yes |

The campaign creator remains its owner. Permissions are implemented directly in Cairo. This version has no ownership transfer, global administrator, external contract calls or upgrade mechanism.

## Identifiers

| Field | Meaning |
| --- | --- |
| `source_id` | Immutable creator or referrer identifier; may be reused across series |
| `public_code` | Alias unique within a campaign, such as `MARIA10`; knowing it does not authorize redemption |
| `commitment` | Non-zero opaque coupon identifier, unique within a campaign and fixed at issuance |
| `conversion_ref` | Non-zero stable reference for a validated business event, usable once across the entire campaign |
| `metadata_hash` | Optional immutable commitment to external terms; zero means not supplied |

The contract enforces commitment uniqueness, not knowledge of a preimage or a specific hash algorithm. Public codes must be resolved with their campaign context.

The application must generate a stable conversion reference. A different reference for the same real-world event bypasses semantic deduplication. Use random identifiers or appropriately protected, domain-separated hashes; do not put phone numbers, emails, raw customer IDs or predictable hashes of personal data on-chain. Test fixture integers are not a production encoding scheme.

A `felt252` must be smaller than `2^251 + 17*2^192 + 1`. Short ASCII strings can contain up to 31 bytes. Do not blindly truncate UUIDs or 256-bit hashes. Preserve the external document and hash algorithm when using `metadata_hash`.

## Issuance and redemption

`issue_coupons(campaign_id, series_id, commitments)` issues up to 100 coupons per call in Draft. Any invalid or duplicate commitment reverts the entire batch, including allocated IDs and counters.

`activate_campaign(campaign_id)` requires non-empty inventory, freezes issuance, and emits `InventoryFrozen`.

`redeem_coupon(coupon_id, conversion_ref)` checks authorization, Active status, pause, expiry, unused coupon and unused conversion reference. It preserves the coupon's original campaign and series, records the operator and timestamp, updates redeemed counters and emits `CouponRedeemed`.

Redemption never issues a new coupon, deletes its history or frees capacity. Two competing redemptions of the same coupon cannot both succeed. Applications should reserve coupons to reduce contention and wait for a successful transaction receipt before delivering a benefit.

After an ambiguous timeout, query `get_coupon` or `conversion_coupon` and inspect the original transaction. Do not retry with a new conversion reference.

## Events and queries

`CampaignCreated`, `SeriesCreated`, `CouponIssued`, `InventoryFrozen` and `CouponRedeemed` support inventory and attribution reconstruction. Operator changes, pauses and closure also emit events. Redeemed coupons remain readable through `get_coupon`.

Individual records and counters are available directly. Historical lists can be reconstructed from paginated RPC events; this release does not include an indexer or a method to adjust counters arbitrarily.

See [`src/interfaces.cairo`](../src/interfaces.cairo) for all entrypoints and [`src/types.cairo`](../src/types.cairo) for record layouts.

## ABI and SDK integration

The compiled ABI is under `abi` in `target/dev/tipper_tickets_BurnLedger.contract_class.json`.

For raw calldata:

- `CampaignKind`: `CreatorCoupon=0`, `Referral=1`.
- `CampaignStatus`: `Draft=0`, `Active=1`, `Closed=2`.
- Spans start with their length, followed by elements.
- Each `u64`, boolean and `felt252` occupies one felt.
- Returned structs follow their declared field order.

The planned Go SDK integrates into Tipper's existing backend. WhatsApp will call that backend through the SDK. A hosted public API portal is not required by this design.

## Integration boundaries

The chain records actions submitted by authorized operators. It does not prove that a visit, purchase or human identity is genuine; those checks belong to the application. An authorized operator can consume inventory using fresh references.

This release holds no funds, transfers no tokens and implements no ERC-721 interface. It is unaudited and intended for development and testnet validation.

The deployed class cannot be replaced through this contract. Integration features can evolve in the SDK and backend. New on-chain rules require a new contract version for new campaigns; preserve the original version, address and history of existing campaigns.
