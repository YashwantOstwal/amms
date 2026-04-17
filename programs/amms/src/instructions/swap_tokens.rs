use anchor_lang::prelude::*;
use anchor_spl::{
   associated_token::{AssociatedToken},
    token_2022::{transfer_checked, TransferChecked},
    token_interface::{Mint, TokenAccount,Token2022},
};

use crate::{CpammsError, PoolInfo};

pub fn process_swap_tokens(
    ctx: Context<SwapTokens>,
    fees_in_basis_points: u16,
    swap_a: bool,
    input_amount: u64,
    min_output_amount: u64,
) -> Result<()> {
    require!(input_amount > 0, CpammsError::InvalidInputAmount);

    let fees = (input_amount)
        .checked_mul(fees_in_basis_points as u64)
        .unwrap()
        .checked_div(10000)
        .unwrap();
    let input_amount_post_fees = input_amount.checked_sub(fees).unwrap();

    let (mint_in, mint_out, reserve_in, reserve_out, trader_account_in, trader_account_out) =
        if swap_a {
            (
                &mut ctx.accounts.mint_a,
                &mut ctx.accounts.mint_b,
                &mut ctx.accounts.reserve_a,
                &mut ctx.accounts.reserve_b,
                &mut ctx.accounts.trader_account_b,
                &mut ctx.accounts.trader_account_a,
            )
        } else {
            (
                &mut ctx.accounts.mint_b,
                &mut ctx.accounts.mint_a,
                &mut ctx.accounts.reserve_b,
                &mut ctx.accounts.reserve_a,
                &mut ctx.accounts.trader_account_a,
                &mut ctx.accounts.trader_account_b,
            )
        };

    let k = (reserve_in.amount as u128)
        .checked_mul(reserve_out.amount as u128)
        .unwrap();

    let denominator = (reserve_in.amount as u128)
        .checked_add(input_amount_post_fees as u128)
        .unwrap();

    let reserve_out_after_swap = checked_ceil_div(k, denominator).unwrap();

    let output_amount = reserve_out
        .amount
        .checked_sub(reserve_out_after_swap as u64)
        .unwrap();

    require!(
        output_amount >= min_output_amount,
        CpammsError::OutputFailsThreshold
    );

    let deposit_cpi_context = CpiContext::new(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: trader_account_out.to_account_info(),
            to: reserve_in.to_account_info(),
            mint: mint_in.to_account_info(),
            authority: ctx.accounts.trader.to_account_info(),
        },
    );

    transfer_checked(deposit_cpi_context, input_amount, mint_in.decimals)?;

    let (mint_a_pubkey, mint_b_pubkey) = if swap_a {
        (mint_in.key(), mint_out.key())
    } else {
        (mint_out.key(), mint_in.key())
    };
    let fees_in_bytes = fees_in_basis_points.to_le_bytes();

    let pool_authority_seeds: &[&[u8]] = &[
        b"pool_authority",
        fees_in_bytes.as_ref(),
        mint_a_pubkey.as_ref(),
        mint_b_pubkey.as_ref(),
        &[ctx.bumps.pool_authority],
    ];
    let signer_seeds = [&pool_authority_seeds[..]];

    let withdraw_cpi_context = CpiContext::new(
        ctx.accounts.token_program.key(),
        TransferChecked {
            from: reserve_out.to_account_info(),
            to: trader_account_in.to_account_info(),
            mint: mint_out.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        },
    )
    .with_signer(&signer_seeds);

    transfer_checked(withdraw_cpi_context, output_amount, mint_out.decimals)?;

    reserve_in.reload()?;
    reserve_out.reload()?;

    let new_k = (reserve_in.amount as u128)
        .checked_mul(reserve_out.amount as u128)
        .unwrap();

    require!(new_k >= k, CpammsError::InvariantViolation);

    Ok(())
}

#[derive(Accounts)]
#[instruction(fees_in_basis_points: u16)]
pub struct SwapTokens<'info> {

    pub trader: Signer<'info>,

    pub mint_a: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = trader,
        associated_token::token_program = token_program,
    )]
    pub trader_account_a: Box<InterfaceAccount<'info, TokenAccount>>,

    pub mint_b: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = trader,
        associated_token::token_program = token_program,
    )]
    pub trader_account_b: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        seeds = [b"pool_info",fees_in_basis_points.to_le_bytes().as_ref() ,mint_a.key().as_ref(),mint_b.key().as_ref()],
        bump = pool_info.bump,
        constraint = mint_a.key() < mint_b.key() @ CpammsError::MintANotLexicographicallyLessThanMintB,
        constraint = pool_info.fees_in_basis_points == fees_in_basis_points @ CpammsError::NoSuchPoolExist,
        has_one = mint_a  @ CpammsError::NoSuchPoolExist,
        has_one = mint_b  @ CpammsError::NoSuchPoolExist
    )]
    pub pool_info:Box<Account<'info,PoolInfo>>,
    
    #[account(
        seeds = [b"pool_authority",fees_in_basis_points.to_le_bytes().as_ref() ,mint_a.key().as_ref(),mint_b.key().as_ref()],
        bump
    )]
    pub pool_authority:SystemAccount<'info>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = pool_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_a:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = pool_authority,
        associated_token::token_program = token_program,
    )]
    pub reserve_b: Box<InterfaceAccount<'info, TokenAccount>>,

    pub associated_token_program:Program<'info,AssociatedToken>,
    pub token_program: Program<'info, Token2022>,
}

pub fn checked_ceil_div(numerator: u128, denominator: u128) -> Option<u128> {
    if denominator == 0 {
        return None;
    }
    numerator
        .checked_add(denominator)?
        .checked_sub(1)?
        .checked_div(denominator)
}