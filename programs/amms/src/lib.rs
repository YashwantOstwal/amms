pub mod instructions;
pub mod states;
pub mod errors;

use anchor_lang::prelude::*;

pub use instructions::*;
pub use states::*;
pub use errors::*;

declare_id!("9M8STYBfUfycs9PLmiohhCx2Ppjm5Wria4AsHvR2sQRa");

#[program]
pub mod amms {
    use super::*;

    pub fn create_cpamm_pool(ctx: Context<CreateCpammPool>,fees_in_basis_points:u16) -> Result<()> {
        instructions::create_cpamm_pool::process_create_cpam_pool(ctx, fees_in_basis_points)
    }

    pub fn deposit_liquidity(ctx: Context<DepositLiquidity>,_fees_in_basis_points:u16,amounts:AmountMinMaxAmount) -> Result<()> {
        instructions::deposit_liquidity::process_deposit_liquidity(ctx,amounts)
    }

    pub fn swap_tokens(ctx: Context<SwapTokens>,_fees_in_basis_points:u16,swap_a:bool,input_amount:u64,min_output_amount:u64) -> Result<()> {
        instructions::swap_tokens::process_swap_tokens(ctx,_fees_in_basis_points,swap_a,input_amount,min_output_amount)
    }
}

