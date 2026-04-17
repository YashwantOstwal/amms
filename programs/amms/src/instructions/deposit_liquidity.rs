use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::{mint_to_checked, transfer_checked, MintToChecked, TransferChecked},
    token_interface::{Mint, Token2022, TokenAccount},
};
use fixed::types::I64F64;
use std::cmp;

use crate::{CpammsError, PoolInfo, MINIMUM_LIQUIDITY};

pub fn process_deposit_liquidity(
    ctx: Context<DepositLiquidity>,
    amounts: AmountMinMaxAmount,
) -> Result<()> {
    let pool_info = &ctx.accounts.pool_info;
    let reserve_a = &mut ctx.accounts.reserve_a;
    let reserve_b = &mut ctx.accounts.reserve_b;
    let lp_mint = &mut ctx.accounts.lp_mint;

    let is_first_deposit = reserve_a.amount == 0 && reserve_b.amount == 0;

    let (deposit_a, deposit_b) = if is_first_deposit {
        match amounts {
            AmountMinMaxAmount::AmountAMinMaxAmountB(amount_a, min_amount_b, max_amount_b) => {
                let deposit_b = min_amount_b.midpoint(max_amount_b);
                (amount_a, deposit_b)
            }
            AmountMinMaxAmount::AmountBMinMaxAmountA(amount_b, min_amount_a, max_amount_a) => {
                let deposit_a = min_amount_a.midpoint(max_amount_a);
                (deposit_a, amount_b)
            }
        }
    } else {
        match amounts {
            AmountMinMaxAmount::AmountAMinMaxAmountB(amount_a, min_amount_b, max_amount_b) => {
                let amount_b: u64 = I64F64::from_num(reserve_b.amount)
                    .checked_div(I64F64::from_num(reserve_a.amount))
                    .unwrap()
                    .checked_mul(I64F64::from_num(amount_a))
                    .unwrap()
                    .to_num();

                require!(
                    amount_b <= max_amount_b && amount_b >= min_amount_b,
                    CpammsError::DepositFailedAtThisSpotRange
                );
                (amount_a, amount_b)
            }
            AmountMinMaxAmount::AmountBMinMaxAmountA(amount_b, min_amount_a, max_amount_a) => {
                let amount_a: u64 = I64F64::from_num(reserve_a.amount)
                    .checked_div(I64F64::from_num(reserve_b.amount))
                    .unwrap()
                    .checked_mul(I64F64::from_num(amount_b))
                    .unwrap()
                    .to_num();

                require!(
                    amount_a <= max_amount_a && amount_a >= min_amount_a,
                    CpammsError::DepositFailedAtThisSpotRange
                );
                (amount_a, amount_b)
            }
        }
    };

    let lp_tokens = if is_first_deposit {
        let lp_tokens_minted = deposit_a.checked_mul(deposit_b).unwrap().isqrt();
        require!(
            lp_tokens_minted >= MINIMUM_LIQUIDITY,
            CpammsError::DepositDoesnotExemptTheMinThreshold
        );
        lp_tokens_minted - MINIMUM_LIQUIDITY
    } else {
        let lp_tokens_minted = cmp::min(
            I64F64::from_num(deposit_a)
                .checked_div(I64F64::from_num(reserve_a.amount))
                .unwrap()
                .checked_mul(I64F64::from_num(lp_mint.supply + MINIMUM_LIQUIDITY))
                .unwrap()
                .to_num::<u64>(),
            I64F64::from_num(deposit_b)
                .checked_div(I64F64::from_num(reserve_b.amount))
                .unwrap()
                .checked_mul(I64F64::from_num(lp_mint.supply + MINIMUM_LIQUIDITY))
                .unwrap()
                .to_num::<u64>(),
        );
        lp_tokens_minted
    };

    let fees_in_basis_points = pool_info.fees_in_basis_points.to_le_bytes();
    let pool_authority_seeds: &[&[u8]] = &[
        b"pool_authority",
        fees_in_basis_points.as_ref(),
        pool_info.mint_a.as_ref(),
        pool_info.mint_b.as_ref(),
        &[ctx.bumps.pool_authority],
    ];
    let signer_seeds = [&pool_authority_seeds[..]];

    let mint_lp_tokens_cpi_context = CpiContext::new(
        ctx.accounts.token_program.key(),
        MintToChecked {
            mint: lp_mint.to_account_info(),
            to: ctx.accounts.token_account_lp.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        },
    )
    .with_signer(&signer_seeds);

    mint_to_checked(mint_lp_tokens_cpi_context, lp_tokens, lp_mint.decimals)?;

    let transfer_token_a_cpi_context = CpiContext::new(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: ctx.accounts.token_account_a.to_account_info(),
            to: ctx.accounts.reserve_a.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        },
    );

    transfer_checked(
        transfer_token_a_cpi_context,
        deposit_a,
        ctx.accounts.mint_a.decimals,
    )?;

    let transfer_token_b_cpi_context = CpiContext::new(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: ctx.accounts.token_account_b.to_account_info(),
            to: ctx.accounts.reserve_b.to_account_info(),
            mint: ctx.accounts.mint_b.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        },
    );

    transfer_checked(
        transfer_token_b_cpi_context,
        deposit_b,
        ctx.accounts.mint_b.decimals,
    )
}

#[derive(Accounts)]
#[instruction(fees_in_basis_points: u16)]
pub struct DepositLiquidity<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    pub mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub token_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub token_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        mint::authority = pool_authority,
        mint::decimals = 0,
        mint::token_program = token_program,
        seeds = [
            b"lp_mint", 
            fees_in_basis_points.to_le_bytes().as_ref(), 
            mint_a.key().as_ref(), 
            mint_b.key().as_ref()
        ],
        bump,
    )]
    pub lp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = lp_mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub token_account_lp: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [
            b"pool_info", 
            fees_in_basis_points.to_le_bytes().as_ref(), 
            mint_a.key().as_ref(), 
            mint_b.key().as_ref()
        ],
        bump = pool_info.bump,
        constraint = mint_a.key() < mint_b.key() @ CpammsError::MintANotLexicographicallyLessThanMintB,
        constraint = pool_info.fees_in_basis_points == fees_in_basis_points @ CpammsError::NoSuchPoolExist,
        has_one = mint_a @ CpammsError::NoSuchPoolExist,
        has_one = mint_b @ CpammsError::NoSuchPoolExist
    )]
    pub pool_info: Box<Account<'info, PoolInfo>>,

    #[account(
        seeds = [
            b"pool_authority", 
            fees_in_basis_points.to_le_bytes().as_ref(), 
            mint_a.key().as_ref(), 
            mint_b.key().as_ref()
        ],
        bump
    )]
    pub pool_authority: SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = pool_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_a: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = pool_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_b: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(AnchorDeserialize, AnchorSerialize, Clone, PartialEq, Eq)]
pub enum AmountMinMaxAmount {
    AmountAMinMaxAmountB(u64, u64, u64),
    AmountBMinMaxAmountA(u64, u64, u64),
}