use starknet::ContractAddress;
use crate::types::{Campaign, CampaignKind, Coupon, Series};

#[starknet::interface]
pub trait IBurnLedger<TContractState> {
    fn create_campaign(
        ref self: TContractState,
        kind: CampaignKind,
        supply_cap: u64,
        expires_at: u64,
        metadata_hash: felt252,
    ) -> u64;
    fn create_series(
        ref self: TContractState,
        campaign_id: u64,
        source_id: felt252,
        public_code: felt252,
        supply_cap: u64,
    ) -> u64;
    fn issue_coupons(
        ref self: TContractState, campaign_id: u64, series_id: u64, commitments: Span<felt252>,
    ) -> Array<u64>;
    fn activate_campaign(ref self: TContractState, campaign_id: u64);
    fn set_operator(
        ref self: TContractState, campaign_id: u64, operator: ContractAddress, enabled: bool,
    );
    fn set_paused(ref self: TContractState, campaign_id: u64, paused: bool);
    fn close_campaign(ref self: TContractState, campaign_id: u64);
    fn redeem_coupon(ref self: TContractState, coupon_id: u64, conversion_ref: felt252);
    fn get_campaign(self: @TContractState, campaign_id: u64) -> Campaign;
    fn get_series(self: @TContractState, campaign_id: u64, series_id: u64) -> Series;
    fn get_coupon(self: @TContractState, coupon_id: u64) -> Coupon;
    fn find_series(self: @TContractState, campaign_id: u64, public_code: felt252) -> u64;
    fn find_coupon(self: @TContractState, campaign_id: u64, commitment: felt252) -> u64;
    fn conversion_coupon(self: @TContractState, campaign_id: u64, conversion_ref: felt252) -> u64;
    fn is_operator(self: @TContractState, campaign_id: u64, operator: ContractAddress) -> bool;
    fn is_redeemable(self: @TContractState, coupon_id: u64) -> bool;
    fn total_campaigns(self: @TContractState) -> u64;
    fn total_issued(self: @TContractState) -> u64;
}
