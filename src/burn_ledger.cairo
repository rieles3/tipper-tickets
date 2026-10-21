/// Versioned immutable application contract. No upgrades, external calls or funds.
#[starknet::contract]
pub mod BurnLedger {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use crate::interfaces::IBurnLedger;
    use crate::types::{Campaign, CampaignKind, CampaignStatus, Coupon, Series};

    const MAX_BATCH: u32 = 100;

    #[storage]
    struct Storage {
        campaign_count: u64,
        coupon_count: u64,
        campaigns: Map<u64, Campaign>,
        series: Map<(u64, u64), Series>,
        coupons: Map<u64, Coupon>,
        code_index: Map<(u64, felt252), u64>,
        commitment_index: Map<(u64, felt252), u64>,
        operators: Map<(u64, ContractAddress), bool>,
        conversions: Map<(u64, felt252), u64>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        CampaignCreated: CampaignCreated,
        SeriesCreated: SeriesCreated,
        CouponIssued: CouponIssued,
        InventoryFrozen: InventoryFrozen,
        OperatorChanged: OperatorChanged,
        PauseChanged: PauseChanged,
        CampaignClosed: CampaignClosed,
        CouponRedeemed: CouponRedeemed,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CampaignCreated {
        #[key]
        pub campaign_id: u64,
        #[key]
        pub owner: ContractAddress,
        pub kind: CampaignKind,
        pub supply_cap: u64,
        pub expires_at: u64,
        pub metadata_hash: felt252,
    }
    #[derive(Drop, starknet::Event)]
    pub struct SeriesCreated {
        #[key]
        pub campaign_id: u64,
        #[key]
        pub series_id: u64,
        pub source_id: felt252,
        pub public_code: felt252,
        pub supply_cap: u64,
    }
    #[derive(Drop, starknet::Event)]
    pub struct CouponIssued {
        #[key]
        pub campaign_id: u64,
        #[key]
        pub series_id: u64,
        pub coupon_id: u64,
        pub commitment: felt252,
    }
    #[derive(Drop, starknet::Event)]
    pub struct InventoryFrozen {
        #[key]
        pub campaign_id: u64,
        pub issued: u64,
        pub allocated_supply: u64,
    }
    #[derive(Drop, starknet::Event)]
    pub struct OperatorChanged {
        #[key]
        pub campaign_id: u64,
        pub operator: ContractAddress,
        pub enabled: bool,
    }
    #[derive(Drop, starknet::Event)]
    pub struct PauseChanged {
        #[key]
        pub campaign_id: u64,
        pub paused: bool,
    }
    #[derive(Drop, starknet::Event)]
    pub struct CampaignClosed {
        #[key]
        pub campaign_id: u64,
        pub issued: u64,
        pub redeemed: u64,
    }
    #[derive(Drop, starknet::Event)]
    pub struct CouponRedeemed {
        #[key]
        pub campaign_id: u64,
        #[key]
        pub series_id: u64,
        pub coupon_id: u64,
        pub source_id: felt252,
        pub operator: ContractAddress,
        pub conversion_ref: felt252,
        pub timestamp: u64,
    }

    #[abi(embed_v0)]
    impl Ledger of IBurnLedger<ContractState> {
        fn create_campaign(
            ref self: ContractState,
            kind: CampaignKind,
            supply_cap: u64,
            expires_at: u64,
            metadata_hash: felt252,
        ) -> u64 {
            let owner = get_caller_address();
            assert(!owner.is_zero(), 'ZERO_CALLER');
            assert(supply_cap > 0, 'ZERO_SUPPLY');
            assert(expires_at > get_block_timestamp(), 'EXPIRED');
            let id = self.campaign_count.read() + 1;
            self.campaign_count.write(id);
            self
                .campaigns
                .write(
                    id,
                    Campaign {
                        owner,
                        kind,
                        status: CampaignStatus::Draft,
                        supply_cap,
                        allocated_supply: 0,
                        issued: 0,
                        redeemed: 0,
                        series_count: 0,
                        expires_at,
                        metadata_hash,
                        paused: false,
                    },
                );
            self
                .emit(
                    CampaignCreated {
                        campaign_id: id, owner, kind, supply_cap, expires_at, metadata_hash,
                    },
                );
            id
        }

        fn create_series(
            ref self: ContractState,
            campaign_id: u64,
            source_id: felt252,
            public_code: felt252,
            supply_cap: u64,
        ) -> u64 {
            let mut campaign = self.read_campaign(campaign_id);
            self.assert_owner(@campaign);
            self.assert_draft(@campaign);
            assert(source_id != 0, 'ZERO_SOURCE');
            assert(public_code != 0, 'ZERO_CODE');
            assert(supply_cap > 0, 'ZERO_SUPPLY');
            assert(supply_cap <= campaign.supply_cap - campaign.allocated_supply, 'CAMPAIGN_CAP');
            assert(self.code_index.read((campaign_id, public_code)) == 0, 'DUPLICATE_CODE');
            let id = campaign.series_count + 1;
            campaign.series_count = id;
            campaign.allocated_supply += supply_cap;
            self.campaigns.write(campaign_id, campaign);
            self
                .series
                .write(
                    (campaign_id, id),
                    Series { source_id, public_code, supply_cap, issued: 0, redeemed: 0 },
                );
            self.code_index.write((campaign_id, public_code), id);
            self
                .emit(
                    SeriesCreated {
                        campaign_id, series_id: id, source_id, public_code, supply_cap,
                    },
                );
            id
        }

        fn issue_coupons(
            ref self: ContractState, campaign_id: u64, series_id: u64, commitments: Span<felt252>,
        ) -> Array<u64> {
            let mut campaign = self.read_campaign(campaign_id);
            self.assert_owner(@campaign);
            self.assert_draft(@campaign);
            let mut series = self.read_series(campaign_id, series_id);
            let count: u64 = commitments.len().into();
            assert(count > 0 && commitments.len() <= MAX_BATCH, 'INVALID_BATCH');
            assert(count <= series.supply_cap - series.issued, 'SERIES_CAP');
            assert(count <= campaign.supply_cap - campaign.issued, 'CAMPAIGN_CAP');
            let mut ids = array![];
            for commitment in commitments {
                let commitment = *commitment;
                assert(commitment != 0, 'ZERO_COMMITMENT');
                assert(
                    self.commitment_index.read((campaign_id, commitment)) == 0, 'DUPLICATE_COUPON',
                );
                let id = self.coupon_count.read() + 1;
                self.coupon_count.write(id);
                self
                    .coupons
                    .write(
                        id,
                        Coupon {
                            campaign_id,
                            series_id,
                            commitment,
                            redeemed: false,
                            redeemed_by: 0.try_into().unwrap(),
                            redeemed_at: 0,
                            conversion_ref: 0,
                        },
                    );
                self.commitment_index.write((campaign_id, commitment), id);
                self.emit(CouponIssued { campaign_id, series_id, coupon_id: id, commitment });
                ids.append(id);
            }
            campaign.issued += count;
            series.issued += count;
            self.campaigns.write(campaign_id, campaign);
            self.series.write((campaign_id, series_id), series);
            ids
        }

        fn activate_campaign(ref self: ContractState, campaign_id: u64) {
            let mut campaign = self.read_campaign(campaign_id);
            self.assert_owner(@campaign);
            self.assert_draft(@campaign);
            assert(campaign.issued > 0, 'EMPTY_INVENTORY');
            campaign.status = CampaignStatus::Active;
            self.campaigns.write(campaign_id, campaign);
            self
                .emit(
                    InventoryFrozen {
                        campaign_id,
                        issued: campaign.issued,
                        allocated_supply: campaign.allocated_supply,
                    },
                );
        }

        fn set_operator(
            ref self: ContractState, campaign_id: u64, operator: ContractAddress, enabled: bool,
        ) {
            let campaign = self.read_campaign(campaign_id);
            self.assert_owner(@campaign);
            assert(campaign.status != CampaignStatus::Closed, 'CLOSED');
            assert(!operator.is_zero(), 'ZERO_OPERATOR');
            self.operators.write((campaign_id, operator), enabled);
            self.emit(OperatorChanged { campaign_id, operator, enabled });
        }

        fn set_paused(ref self: ContractState, campaign_id: u64, paused: bool) {
            let mut campaign = self.read_campaign(campaign_id);
            self.assert_owner(@campaign);
            assert(campaign.status == CampaignStatus::Active, 'NOT_ACTIVE');
            campaign.paused = paused;
            self.campaigns.write(campaign_id, campaign);
            self.emit(PauseChanged { campaign_id, paused });
        }

        fn close_campaign(ref self: ContractState, campaign_id: u64) {
            let mut campaign = self.read_campaign(campaign_id);
            self.assert_owner(@campaign);
            assert(campaign.status != CampaignStatus::Closed, 'CLOSED');
            campaign.status = CampaignStatus::Closed;
            self.campaigns.write(campaign_id, campaign);
            self
                .emit(
                    CampaignClosed {
                        campaign_id, issued: campaign.issued, redeemed: campaign.redeemed,
                    },
                );
        }

        fn redeem_coupon(ref self: ContractState, coupon_id: u64, conversion_ref: felt252) {
            let mut coupon = self.read_coupon(coupon_id);
            let mut campaign = self.read_campaign(coupon.campaign_id);
            let operator = get_caller_address();
            assert(
                operator == campaign.owner || self.operators.read((coupon.campaign_id, operator)),
                'UNAUTHORIZED',
            );
            assert(campaign.status == CampaignStatus::Active, 'NOT_ACTIVE');
            assert(!campaign.paused, 'PAUSED');
            let timestamp = get_block_timestamp();
            assert(timestamp < campaign.expires_at, 'EXPIRED');
            assert(!coupon.redeemed, 'ALREADY_REDEEMED');
            assert(conversion_ref != 0, 'ZERO_CONVERSION');
            // Campaign-scoped, deliberately NOT creator-scoped: no double attribution.
            assert(
                self.conversions.read((coupon.campaign_id, conversion_ref)) == 0,
                'DUPLICATE_CONVERSION',
            );
            let mut series = self.read_series(coupon.campaign_id, coupon.series_id);
            coupon.redeemed = true;
            coupon.redeemed_by = operator;
            coupon.redeemed_at = timestamp;
            coupon.conversion_ref = conversion_ref;
            campaign.redeemed += 1;
            series.redeemed += 1;
            self.coupons.write(coupon_id, coupon);
            self.campaigns.write(coupon.campaign_id, campaign);
            self.series.write((coupon.campaign_id, coupon.series_id), series);
            self.conversions.write((coupon.campaign_id, conversion_ref), coupon_id);
            self
                .emit(
                    CouponRedeemed {
                        campaign_id: coupon.campaign_id,
                        series_id: coupon.series_id,
                        coupon_id,
                        source_id: series.source_id,
                        operator,
                        conversion_ref,
                        timestamp,
                    },
                );
        }

        fn get_campaign(self: @ContractState, campaign_id: u64) -> Campaign {
            self.read_campaign(campaign_id)
        }
        fn get_series(self: @ContractState, campaign_id: u64, series_id: u64) -> Series {
            self.read_series(campaign_id, series_id)
        }
        fn get_coupon(self: @ContractState, coupon_id: u64) -> Coupon {
            self.read_coupon(coupon_id)
        }
        fn find_series(self: @ContractState, campaign_id: u64, public_code: felt252) -> u64 {
            self.code_index.read((campaign_id, public_code))
        }
        fn find_coupon(self: @ContractState, campaign_id: u64, commitment: felt252) -> u64 {
            self.commitment_index.read((campaign_id, commitment))
        }
        fn conversion_coupon(
            self: @ContractState, campaign_id: u64, conversion_ref: felt252,
        ) -> u64 {
            self.conversions.read((campaign_id, conversion_ref))
        }
        fn is_operator(self: @ContractState, campaign_id: u64, operator: ContractAddress) -> bool {
            let campaign = self.read_campaign(campaign_id);
            operator == campaign.owner || self.operators.read((campaign_id, operator))
        }
        fn is_redeemable(self: @ContractState, coupon_id: u64) -> bool {
            let coupon = self.coupons.read(coupon_id);
            if coupon.campaign_id == 0 || coupon.redeemed {
                return false;
            }
            let campaign = self.campaigns.read(coupon.campaign_id);
            campaign.status == CampaignStatus::Active
                && !campaign.paused
                && get_block_timestamp() < campaign.expires_at
        }
        fn total_campaigns(self: @ContractState) -> u64 {
            self.campaign_count.read()
        }
        fn total_issued(self: @ContractState) -> u64 {
            self.coupon_count.read()
        }
    }

    #[generate_trait]
    impl Internal of InternalTrait {
        fn read_campaign(self: @ContractState, campaign_id: u64) -> Campaign {
            let campaign = self.campaigns.read(campaign_id);
            assert(!campaign.owner.is_zero(), 'CAMPAIGN_NOT_FOUND');
            campaign
        }
        fn read_series(self: @ContractState, campaign_id: u64, series_id: u64) -> Series {
            let series = self.series.read((campaign_id, series_id));
            assert(series.source_id != 0, 'SERIES_NOT_FOUND');
            series
        }
        fn read_coupon(self: @ContractState, coupon_id: u64) -> Coupon {
            let coupon = self.coupons.read(coupon_id);
            assert(coupon.campaign_id != 0, 'COUPON_NOT_FOUND');
            coupon
        }
        fn assert_owner(self: @ContractState, campaign: @Campaign) {
            assert(get_caller_address() == *campaign.owner, 'NOT_OWNER');
        }
        fn assert_draft(self: @ContractState, campaign: @Campaign) {
            assert(*campaign.status == CampaignStatus::Draft, 'INVENTORY_FROZEN');
            assert(get_block_timestamp() < *campaign.expires_at, 'EXPIRED');
        }
    }
}
