use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_2022::{transfer_checked,TransferChecked,burn,Burn}, token_interface::{Mint, Token2022, TokenAccount}};

use crate::{CpammsError, MINIMUM_LIQUIDITY, PoolInfo, pool_info};
pub fn process_withdraw_liquidity(ctx:Context<WithdrawLiquidity>,fees_in_basis_points:u16,amount:u64)->Result<()>{
    let depositor = &mut ctx.accounts.depositor;
    let pool_info = &mut ctx.accounts.pool_info;

    let token_account_lp = &mut ctx.accounts.token_account_lp;
    let lp_mint = &mut ctx.accounts.lp_mint;

    let mint_a = &mut ctx.accounts.mint_a;
    let mint_b = &mut ctx.accounts.mint_b;

    let reserve_a = &mut ctx.accounts.reserve_a;
    let reserve_b = &mut ctx.accounts.reserve_b;

    let token_account_a = &mut ctx.accounts.token_account_a;
    let token_account_b = &mut ctx.accounts.token_account_b;

    let pool_authority = &mut ctx.accounts.pool_authority;

    let withdraw_amount_a = (amount as u128).checked_mul(reserve_a.amount as u128).unwrap().checked_div_euclid((lp_mint.supply + MINIMUM_LIQUIDITY) as u128).unwrap() as u64;
    let withdraw_amount_b = (amount as u128).checked_mul(reserve_b.amount as u128).unwrap().checked_div_euclid((lp_mint.supply + MINIMUM_LIQUIDITY) as u128).unwrap() as u64;

    let fees_in_basis_points = pool_info.fees_in_basis_points.to_le_bytes();
    let pool_authority_seeds:&[&[u8]] = &[b"pool_authority",fees_in_basis_points.as_ref() ,pool_info.mint_a.as_ref(),pool_info.mint_b.as_ref(),&[ctx.bumps.pool_authority]];
    let signer_seeds = [&pool_authority_seeds[..]];

    transfer_checked(CpiContext::new(ctx.accounts.token_program.key(),TransferChecked{from:reserve_a.to_account_info(),to:token_account_a.to_account_info(),mint:mint_a.to_account_info(),authority:pool_authority.to_account_info()}).with_signer(&signer_seeds),withdraw_amount_a,mint_a.decimals)?;

    transfer_checked(CpiContext::new(ctx.accounts.token_program.key(),TransferChecked{from:reserve_b.to_account_info(),to:token_account_b.to_account_info(),mint:mint_b.to_account_info(),authority:pool_authority.to_account_info()}).with_signer(&signer_seeds),withdraw_amount_b,mint_b.decimals)?;

    burn(CpiContext::new(ctx.accounts.token_program.key(),Burn{mint:lp_mint.to_account_info(),from:token_account_lp.to_account_info(),authority:depositor.to_account_info()}),amount)
}

#[derive(Accounts)]
#[instruction(fees_in_basis_points:u16)]
pub struct WithdrawLiquidity<'info>{

    pub depositor:Signer<'info>,

    pub mint_a:Box<InterfaceAccount<'info,Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_a,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub token_account_a:Box<InterfaceAccount<'info,TokenAccount>>,

    pub mint_b:Box<InterfaceAccount<'info,Mint>>,

    #[account(
        mut,
        associated_token::mint = mint_b,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub token_account_b:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        mut,
        mint::authority = pool_authority,
        mint::decimals = 0,
        mint::token_program = token_program,
        seeds = [b"lp_mint",fees_in_basis_points.to_le_bytes().as_ref() ,mint_a.key().as_ref(),mint_b.key().as_ref()],
        bump,
    )]
    pub lp_mint:Box<InterfaceAccount<'info,Mint>>,

    #[account(
        mut,
        associated_token::mint = lp_mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,
    )]
    pub token_account_lp:Box<InterfaceAccount<'info,TokenAccount>>,

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
    pub reserve_b:Box<InterfaceAccount<'info,TokenAccount>>,

    pub token_program:Program<'info,Token2022>,
    pub associated_token_program:Program<'info,AssociatedToken>
}