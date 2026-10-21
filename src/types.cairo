use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, Debug, PartialEq, starknet::Store)]
pub enum CampaignKind {
    #[default]
    CreatorCoupon,
    Referral,
}

#[derive(Copy, Drop, Serde, Debug, PartialEq, starknet::Store)]
pub enum CampaignStatus {
    #[default]
    Draft,
    Active,
    Closed,
}

#[derive(Copy, Drop, Serde, Debug, PartialEq, starknet::Store)]
pub struct Campaign {
    pub owner: ContractAddress,
    pub kind: CampaignKind,
    pub status: CampaignStatus,
    pub supply_cap: u64,
    pub allocated_supply: u64,
    pub issued: u64,
    pub redeemed: u64,
    pub series_count: u64,
    pub expires_at: u64,
    pub metadata_hash: felt252,
    pub paused: bool,
}

#[derive(Copy, Drop, Serde, Debug, PartialEq, starknet::Store)]
pub struct Series {
    pub source_id: felt252,
    pub public_code: felt252,
    pub supply_cap: u64,
    pub issued: u64,
    pub redeemed: u64,
}

#[derive(Copy, Drop, Serde, Debug, PartialEq, starknet::Store)]
pub struct Coupon {
    pub campaign_id: u64,
    pub series_id: u64,
    pub commitment: felt252,
    pub redeemed: bool,
    pub redeemed_by: ContractAddress,
    pub redeemed_at: u64,
    pub conversion_ref: felt252,
}
