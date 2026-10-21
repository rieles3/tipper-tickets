use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_block_timestamp, start_cheat_caller_address,
};
use starknet::ContractAddress;
use tipper_tickets::interfaces::{
    IBurnLedgerDispatcher, IBurnLedgerDispatcherTrait, IBurnLedgerSafeDispatcher,
    IBurnLedgerSafeDispatcherTrait,
};
use tipper_tickets::types::{CampaignKind, CampaignStatus};

const OWNER: ContractAddress = 0xA11CE.try_into().unwrap();
const OTHER: ContractAddress = 0xBAD.try_into().unwrap();
const STAFF: ContractAddress = 0xCAFE.try_into().unwrap();

fn setup() -> IBurnLedgerDispatcher {
    let class = declare("BurnLedger").unwrap().contract_class();
    let (address, _) = class.deploy(@array![]).unwrap();
    start_cheat_caller_address(address, OWNER);
    start_cheat_block_timestamp(address, 100);
    IBurnLedgerDispatcher { contract_address: address }
}

fn draft(d: IBurnLedgerDispatcher, kind: CampaignKind) -> (u64, u64) {
    let campaign = d.create_campaign(kind, 100, 1000, 'terms-v1');
    let series = d.create_series(campaign, 'maria', 'MARIA10', 100);
    (campaign, series)
}

fn active(d: IBurnLedgerDispatcher) -> (u64, u64, u64) {
    let (campaign, series) = draft(d, CampaignKind::CreatorCoupon);
    let ids = d.issue_coupons(campaign, series, array![111, 222, 333].span());
    d.activate_campaign(campaign);
    (campaign, series, *ids.at(0))
}

#[test]
fn maria_100_authorized_50_issued_20_redeemed() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    let mut commitments = array![];
    for i in 1_u64..51_u64 {
        commitments.append(i.into());
    }
    let ids = d.issue_coupons(c, s, commitments.span());
    assert_eq!(ids.len(), 50);
    d.activate_campaign(c);
    for i in 0_u32..20_u32 {
        d.redeem_coupon(*ids.at(i), (1000_u32 + i).into());
    }
    let campaign = d.get_campaign(c);
    let series = d.get_series(c, s);
    assert_eq!(campaign.supply_cap, 100);
    assert_eq!(campaign.issued, 50);
    assert_eq!(campaign.redeemed, 20);
    assert_eq!(campaign.status, CampaignStatus::Active);
    assert_eq!(series.issued - series.redeemed, 30);
    assert_eq!(series.source_id, 'maria');
    assert_eq!(d.total_issued(), 50);
    assert!(!d.is_redeemable(*ids.at(0)));
    assert!(d.is_redeemable(*ids.at(49)));
    let coupon = d.get_coupon(*ids.at(0));
    assert_eq!(coupon.redeemed_by, OWNER);
    assert_eq!(coupon.redeemed_at, 100);
    assert_eq!(coupon.conversion_ref, 1000);
}

#[test]
fn referral_uses_preissued_inventory() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::Referral);
    let ids = d.issue_coupons(c, s, array![777, 888].span());
    d.activate_campaign(c);
    d.redeem_coupon(*ids.at(0), 'verified-user-opaque');
    assert_eq!(d.get_campaign(c).kind, CampaignKind::Referral);
    assert_eq!(d.conversion_coupon(c, 'verified-user-opaque'), *ids.at(0));
    assert_eq!(d.total_issued(), 2);
}

#[test]
fn batches_are_additive_before_activation() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    let first = d.issue_coupons(c, s, array![1, 2].span());
    let second = d.issue_coupons(c, s, array![3, 4].span());
    assert_eq!(*second.at(0), *first.at(1) + 1);
    assert_eq!(d.get_campaign(c).issued, 4);
    assert_eq!(d.find_coupon(c, 3), *second.at(0));
    assert_eq!(d.find_series(c, 'MARIA10'), s);
}

#[test]
fn full_batch_of_100_is_supported() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    let mut commitments = array![];
    for i in 1_u64..101_u64 {
        commitments.append(i.into());
    }
    d.issue_coupons(c, s, commitments.span());
    assert_eq!(d.get_campaign(c).issued, 100);
}

#[test]
fn staff_can_redeem_after_delegation() {
    let d = setup();
    let (c, _, id) = active(d);
    d.set_operator(c, STAFF, true);
    assert!(d.is_operator(c, STAFF));
    start_cheat_caller_address(d.contract_address, STAFF);
    d.redeem_coupon(id, 123);
    assert_eq!(d.get_coupon(id).redeemed_by, STAFF);
}

#[test]
fn pause_and_resume_preserve_inventory() {
    let d = setup();
    let (c, _, id) = active(d);
    d.set_paused(c, true);
    assert!(!d.is_redeemable(id));
    d.set_paused(c, false);
    assert!(d.is_redeemable(id));
    d.redeem_coupon(id, 123);
    assert_eq!(d.get_campaign(c).issued, 3);
}

#[test]
fn close_preserves_audit_records() {
    let d = setup();
    let (c, s, id) = active(d);
    d.redeem_coupon(id, 123);
    d.close_campaign(c);
    assert_eq!(d.get_campaign(c).status, CampaignStatus::Closed);
    assert_eq!(d.get_series(c, s).issued, 3);
    assert_eq!(d.get_series(c, s).redeemed, 1);
    assert_eq!(d.get_coupon(id).commitment, 111);
    assert!(!d.is_redeemable(id + 1));
}

#[test]
fn expiry_keeps_inventory_readable() {
    let d = setup();
    let (c, _, id) = active(d);
    start_cheat_block_timestamp(d.contract_address, 1000);
    assert!(!d.is_redeemable(id));
    assert_eq!(d.get_campaign(c).issued, 3);
    assert!(!d.get_coupon(id).redeemed);
}

#[test]
fn same_code_commitment_and_conversion_can_exist_in_different_campaigns() {
    let d = setup();
    let (a, sa, first) = active(d);
    start_cheat_caller_address(d.contract_address, OTHER);
    let (b, sb) = draft(d, CampaignKind::Referral);
    let ids = d.issue_coupons(b, sb, array![111].span());
    d.activate_campaign(b);
    d.redeem_coupon(*ids.at(0), 999);
    start_cheat_caller_address(d.contract_address, OWNER);
    d.redeem_coupon(first, 999);
    assert_eq!(d.find_series(a, 'MARIA10'), sa);
    assert_eq!(d.find_series(b, 'MARIA10'), sb);
    assert_ne!(d.find_coupon(a, 111), d.find_coupon(b, 111));
    assert_eq!(d.total_campaigns(), 2);
}

#[test]
fn unknown_lookup_returns_zero_or_false() {
    let d = setup();
    assert_eq!(d.find_coupon(900, 999), 0);
    assert_eq!(d.find_series(900, 999), 0);
    assert_eq!(d.conversion_coupon(900, 999), 0);
    assert!(!d.is_redeemable(999));
}

#[test]
#[feature("safe_dispatcher")]
fn duplicate_batch_reverts_all_ids_and_inventory() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    let safe = IBurnLedgerSafeDispatcher { contract_address: d.contract_address };
    assert_eq!(
        safe.issue_coupons(c, s, array![111, 111].span()).unwrap_err(),
        array!['DUPLICATE_COUPON', 'ENTRYPOINT_FAILED'],
    );
    assert_eq!(d.get_campaign(c).issued, 0);
    assert_eq!(d.get_series(c, s).issued, 0);
    assert_eq!(d.total_issued(), 0);
    assert_eq!(d.find_coupon(c, 111), 0);
    assert_eq!(*d.issue_coupons(c, s, array![111].span()).at(0), 1);
}

#[test]
#[feature("safe_dispatcher")]
fn a_conversion_cannot_be_reattributed_to_another_creator() {
    let d = setup();
    let c = d.create_campaign(CampaignKind::Referral, 2, 1000, 0);
    let maria = d.create_series(c, 'maria', 'MARIA10', 1);
    let pedro = d.create_series(c, 'pedro', 'PEDRO10', 1);
    let a = d.issue_coupons(c, maria, array![111].span());
    let b = d.issue_coupons(c, pedro, array![222].span());
    d.activate_campaign(c);
    d.redeem_coupon(*a.at(0), 'same-user-commitment');
    let safe = IBurnLedgerSafeDispatcher { contract_address: d.contract_address };
    assert_eq!(
        safe.redeem_coupon(*b.at(0), 'same-user-commitment').unwrap_err(),
        array!['DUPLICATE_CONVERSION', 'ENTRYPOINT_FAILED'],
    );
    assert!(!d.get_coupon(*b.at(0)).redeemed);
    assert_eq!(d.get_series(c, maria).redeemed, 1);
    assert_eq!(d.get_series(c, pedro).redeemed, 0);
    assert_eq!(d.get_campaign(c).redeemed, 1);
}

#[test]
#[feature("safe_dispatcher")]
fn first_successful_redemption_wins_and_retry_changes_nothing() {
    let d = setup();
    let (c, _, id) = active(d);
    d.set_operator(c, STAFF, true);
    d.redeem_coupon(id, 123);
    start_cheat_caller_address(d.contract_address, STAFF);
    let safe = IBurnLedgerSafeDispatcher { contract_address: d.contract_address };
    assert_eq!(
        safe.redeem_coupon(id, 456).unwrap_err(), array!['ALREADY_REDEEMED', 'ENTRYPOINT_FAILED'],
    );
    assert_eq!(d.get_campaign(c).redeemed, 1);
    assert_eq!(d.get_coupon(id).redeemed_by, OWNER);
    assert_eq!(d.get_coupon(id).conversion_ref, 123);
    assert_eq!(d.conversion_coupon(c, 456), 0);
}

#[test]
#[fuzzer(runs: 128)]
fn inventory_conservation_fuzz(size: u8, used: u8) {
    let d = setup();
    let count: u64 = 1 + (size.into() % 64_u64);
    let burns: u64 = used.into() % (count + 1);
    let c = d.create_campaign(CampaignKind::CreatorCoupon, count + 10, 1000, 0);
    let s = d.create_series(c, 'maria', 'MARIA10', count + 10);
    let mut commitments = array![];
    for i in 1_u64..(count + 1) {
        commitments.append(i.into());
    }
    let ids = d.issue_coupons(c, s, commitments.span());
    d.activate_campaign(c);
    for i in 0_u64..burns {
        d.redeem_coupon(*ids.at(i.try_into().unwrap()), (i + 1000).into());
    }
    let campaign = d.get_campaign(c);
    let series = d.get_series(c, s);
    assert_eq!(campaign.issued, count);
    assert_eq!(campaign.redeemed, burns);
    assert_eq!(series.issued, count);
    assert_eq!(series.redeemed, burns);
    assert_eq!(series.issued - series.redeemed, count - burns);
    assert_eq!(d.total_issued(), count);
}

#[test]
#[should_panic(expected: ('ZERO_SUPPLY',))]
fn rejects_zero_campaign_supply() {
    let d = setup();
    d.create_campaign(CampaignKind::CreatorCoupon, 0, 1000, 0);
}

#[test]
#[should_panic(expected: ('EXPIRED',))]
fn rejects_campaign_expiring_now() {
    let d = setup();
    d.create_campaign(CampaignKind::CreatorCoupon, 1, 100, 0);
}

#[test]
#[should_panic(expected: ('ZERO_CALLER',))]
fn rejects_zero_caller() {
    let d = setup();
    start_cheat_caller_address(d.contract_address, 0.try_into().unwrap());
    d.create_campaign(CampaignKind::Referral, 1, 1000, 0);
}

#[test]
#[should_panic(expected: ('CAMPAIGN_NOT_FOUND',))]
fn rejects_unknown_campaign() {
    let d = setup();
    d.get_campaign(99);
}

#[test]
#[should_panic(expected: ('SERIES_NOT_FOUND',))]
fn rejects_unknown_series() {
    let d = setup();
    d.get_series(99, 1);
}

#[test]
#[should_panic(expected: ('COUPON_NOT_FOUND',))]
fn rejects_unknown_coupon() {
    let d = setup();
    d.get_coupon(99);
}

#[test]
#[should_panic(expected: ('CAMPAIGN_CAP',))]
fn rejects_allocation_exceeds_campaign() {
    let d = setup();
    let (c, _) = draft(d, CampaignKind::CreatorCoupon);
    d.create_series(c, 'pedro', 'PEDRO10', 1);
}

#[test]
#[should_panic(expected: ('DUPLICATE_CODE',))]
fn rejects_duplicate_public_code() {
    let d = setup();
    let c = d.create_campaign(CampaignKind::Referral, 10, 1000, 0);
    d.create_series(c, 'maria', 'MARIA10', 1);
    d.create_series(c, 'pedro', 'MARIA10', 1);
}

#[test]
#[should_panic(expected: ('ZERO_SOURCE',))]
fn rejects_zero_source() {
    let d = setup();
    let c = d.create_campaign(CampaignKind::Referral, 10, 1000, 0);
    d.create_series(c, 0, 'CODE', 1);
}

#[test]
#[should_panic(expected: ('ZERO_CODE',))]
fn rejects_zero_public_code() {
    let d = setup();
    let c = d.create_campaign(CampaignKind::Referral, 10, 1000, 0);
    d.create_series(c, 1, 0, 1);
}

#[test]
#[should_panic(expected: ('ZERO_SUPPLY',))]
fn rejects_zero_series_supply() {
    let d = setup();
    let c = d.create_campaign(CampaignKind::Referral, 10, 1000, 0);
    d.create_series(c, 1, 'CODE', 0);
}

#[test]
#[should_panic(expected: ('INVALID_BATCH',))]
fn rejects_empty_batch() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    d.issue_coupons(c, s, array![].span());
}

#[test]
#[should_panic(expected: ('INVALID_BATCH',))]
fn rejects_oversized_batch() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    let mut a = array![];
    for i in 1_u64..102_u64 {
        a.append(i.into());
    }
    d.issue_coupons(c, s, a.span());
}

#[test]
#[should_panic(expected: ('SERIES_CAP',))]
fn rejects_series_cap() {
    let d = setup();
    let c = d.create_campaign(CampaignKind::Referral, 10, 1000, 0);
    let s = d.create_series(c, 1, 'CODE', 1);
    d.issue_coupons(c, s, array![1, 2].span());
}

#[test]
#[should_panic(expected: ('ZERO_COMMITMENT',))]
fn rejects_zero_commitment() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    d.issue_coupons(c, s, array![0].span());
}

#[test]
#[should_panic(expected: ('DUPLICATE_COUPON',))]
fn rejects_duplicate_between_batches() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    d.issue_coupons(c, s, array![1].span());
    d.issue_coupons(c, s, array![1].span());
}

#[test]
#[should_panic(expected: ('EMPTY_INVENTORY',))]
fn rejects_empty_activation() {
    let d = setup();
    let (c, _) = draft(d, CampaignKind::CreatorCoupon);
    d.activate_campaign(c);
}

#[test]
#[should_panic(expected: ('INVENTORY_FROZEN',))]
fn rejects_mint_after_activation() {
    let d = setup();
    let (c, s, _) = active(d);
    d.issue_coupons(c, s, array![444].span());
}

#[test]
#[should_panic(expected: ('INVENTORY_FROZEN',))]
fn rejects_mint_after_burn_does_not_refill() {
    let d = setup();
    let (c, s, id) = active(d);
    d.redeem_coupon(id, 1);
    d.issue_coupons(c, s, array![444].span());
}

#[test]
#[should_panic(expected: ('INVENTORY_FROZEN',))]
fn rejects_new_creator_after_activation() {
    let d = setup();
    let (c, _, _) = active(d);
    d.create_series(c, 'pedro', 'PEDRO10', 1);
}

#[test]
#[should_panic(expected: ('INVENTORY_FROZEN',))]
fn rejects_reactivation() {
    let d = setup();
    let (c, _, _) = active(d);
    d.activate_campaign(c);
}

#[test]
#[should_panic(expected: ('INVENTORY_FROZEN',))]
fn rejects_reopen_closed() {
    let d = setup();
    let (c, _, _) = active(d);
    d.close_campaign(c);
    d.activate_campaign(c);
}

#[test]
#[should_panic(expected: ('NOT_ACTIVE',))]
fn rejects_redeem_in_draft() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    let ids = d.issue_coupons(c, s, array![1].span());
    d.redeem_coupon(*ids.at(0), 1);
}

#[test]
#[should_panic(expected: ('PAUSED',))]
fn rejects_redeem_paused() {
    let d = setup();
    let (c, _, id) = active(d);
    d.set_paused(c, true);
    d.redeem_coupon(id, 1);
}

#[test]
#[should_panic(expected: ('NOT_ACTIVE',))]
fn rejects_redeem_closed() {
    let d = setup();
    let (c, _, id) = active(d);
    d.close_campaign(c);
    d.redeem_coupon(id, 1);
}

#[test]
#[should_panic(expected: ('EXPIRED',))]
fn rejects_redeem_at_expiry() {
    let d = setup();
    let (_, _, id) = active(d);
    start_cheat_block_timestamp(d.contract_address, 1000);
    d.redeem_coupon(id, 1);
}

#[test]
#[should_panic(expected: ('EXPIRED',))]
fn rejects_issue_at_expiry() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    start_cheat_block_timestamp(d.contract_address, 1000);
    d.issue_coupons(c, s, array![1].span());
}

#[test]
#[should_panic(expected: ('EXPIRED',))]
fn rejects_activate_at_expiry() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    d.issue_coupons(c, s, array![1].span());
    start_cheat_block_timestamp(d.contract_address, 1000);
    d.activate_campaign(c);
}

#[test]
#[should_panic(expected: ('ZERO_CONVERSION',))]
fn rejects_zero_conversion() {
    let d = setup();
    let (_, _, id) = active(d);
    d.redeem_coupon(id, 0);
}

#[test]
#[should_panic(expected: ('ZERO_OPERATOR',))]
fn rejects_zero_operator() {
    let d = setup();
    let (c, _, _) = active(d);
    d.set_operator(c, 0.try_into().unwrap(), true);
}

#[test]
#[should_panic(expected: ('UNAUTHORIZED',))]
fn rejects_revoked_operator() {
    let d = setup();
    let (c, _, id) = active(d);
    d.set_operator(c, STAFF, true);
    d.set_operator(c, STAFF, false);
    start_cheat_caller_address(d.contract_address, STAFF);
    d.redeem_coupon(id, 1);
}

#[test]
#[should_panic(expected: ('UNAUTHORIZED',))]
fn rejects_operator_does_not_cross_campaigns() {
    let d = setup();
    let (a, _, _) = active(d);
    let (_, _, id) = active(d);
    d.set_operator(a, STAFF, true);
    start_cheat_caller_address(d.contract_address, STAFF);
    d.redeem_coupon(id, 1);
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn non_owner_cannot_create_series() {
    let d = setup();
    let (c, _s) = draft(d, CampaignKind::CreatorCoupon);
    start_cheat_caller_address(d.contract_address, OTHER);
    d.create_series(c, 'pedro', 'PEDRO10', 1);
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn non_owner_cannot_issue() {
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    start_cheat_caller_address(d.contract_address, OTHER);
    d.issue_coupons(c, s, array![1].span());
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn non_owner_cannot_activate() {
    let d = setup();
    let (c, _s) = draft(d, CampaignKind::CreatorCoupon);
    start_cheat_caller_address(d.contract_address, OTHER);
    d.activate_campaign(c);
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn non_owner_cannot_delegate() {
    let d = setup();
    let (c, _s) = draft(d, CampaignKind::CreatorCoupon);
    start_cheat_caller_address(d.contract_address, OTHER);
    d.set_operator(c, STAFF, true);
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn non_owner_cannot_pause() {
    let d = setup();
    let (c, _s) = draft(d, CampaignKind::CreatorCoupon);
    start_cheat_caller_address(d.contract_address, OTHER);
    d.set_paused(c, true);
}

#[test]
#[should_panic(expected: ('NOT_OWNER',))]
fn non_owner_cannot_close() {
    let d = setup();
    let (c, _s) = draft(d, CampaignKind::CreatorCoupon);
    start_cheat_caller_address(d.contract_address, OTHER);
    d.close_campaign(c);
}

#[test]
#[should_panic(expected: ('UNAUTHORIZED',))]
fn public_reader_cannot_redeem_known_coupon_id() {
    let d = setup();
    let (_, _, id) = active(d);
    start_cheat_caller_address(d.contract_address, OTHER);
    d.redeem_coupon(id, 1);
}

#[test]
fn audit_events_retain_issuance_and_fixed_attribution() {
    use tipper_tickets::burn_ledger::BurnLedger::{
        CouponIssued, CouponRedeemed, Event, InventoryFrozen,
    };
    let d = setup();
    let (c, s) = draft(d, CampaignKind::CreatorCoupon);
    let mut spy = spy_events();
    let id = *d.issue_coupons(c, s, array![777].span()).at(0);
    d.activate_campaign(c);
    d.redeem_coupon(id, 888);
    spy
        .assert_emitted(
            @array![
                (
                    d.contract_address,
                    Event::CouponIssued(
                        CouponIssued {
                            campaign_id: c, series_id: s, coupon_id: id, commitment: 777,
                        },
                    ),
                ),
                (
                    d.contract_address,
                    Event::InventoryFrozen(
                        InventoryFrozen { campaign_id: c, issued: 1, allocated_supply: 100 },
                    ),
                ),
                (
                    d.contract_address,
                    Event::CouponRedeemed(
                        CouponRedeemed {
                            campaign_id: c,
                            series_id: s,
                            coupon_id: id,
                            source_id: 'maria',
                            operator: OWNER,
                            conversion_ref: 888,
                            timestamp: 100,
                        },
                    ),
                ),
            ],
        );
}
