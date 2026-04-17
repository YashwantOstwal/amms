use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken,token_interface::{TokenAccount,Mint,Token2022}};

use crate::{ CpammsError, PoolInfo};
pub fn process_create_cpam_pool(ctx:Context<CreateCpammPool>,fees_in_basis_points:u16)->Result<()>{
    // pool config is created so that we can get all the pools with .getProgramAccounts() filtered by PoolConfig::Discriminator and also filterable by mints and fees
    let pool_info = &mut ctx.accounts.pool_info;
    pool_info.mint_a = ctx.accounts.mint_a.key();
    pool_info.mint_b = ctx.accounts.mint_b.key();
    pool_info.fees_in_basis_points = fees_in_basis_points;
    
    pool_info.set_inner(
        PoolInfo{
            mint_a: ctx.accounts.mint_a.key(),
            mint_b: ctx.accounts.mint_b.key(),
            fees_in_basis_points,
            bump: ctx.bumps.pool_info
        });
    Ok(())

}

#[derive(Accounts)]
#[instruction(fees_in_basis_points:u16)]
pub struct CreateCpammPool<'info>{
    #[account(mut)]
    pub payer:Signer<'info>,

    pub mint_a:Box<InterfaceAccount<'info,Mint>>,

    pub mint_b:Box<InterfaceAccount<'info,Mint>>,

    #[account(
        init,
        payer = payer,
        space = 8 + PoolInfo::INIT_SPACE,
        seeds = [b"pool_info",fees_in_basis_points.to_le_bytes().as_ref() ,mint_a.key().as_ref(),mint_b.key().as_ref()],
        bump,
        constraint = mint_a.key() < mint_b.key() @ CpammsError::MintANotLexicographicallyLessThanMintB
    )]
    pub pool_info:Box<Account<'info,PoolInfo>>,

    #[account(
        seeds = [b"pool_authority",fees_in_basis_points.to_le_bytes().as_ref() ,mint_a.key().as_ref(),mint_b.key().as_ref()],
        bump
    )]
    pub pool_authority:SystemAccount<'info>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = mint_a,
        associated_token::authority = pool_authority,
        associated_token::token_program = token_program
    )]
    pub reserve_a:Box<InterfaceAccount<'info,TokenAccount>>,

     #[account(
        init,
        payer = payer,
        associated_token::mint = mint_b,
        associated_token::authority = pool_authority,
        associated_token::token_program = token_program
    )]
    pub reserve_b:Box<InterfaceAccount<'info,TokenAccount>>,

    #[account(
        init,
        payer = payer,
        mint::authority = pool_authority,
        mint::decimals = 0,
        mint::token_program = token_program,
        seeds = [b"lp_mint",fees_in_basis_points.to_le_bytes().as_ref() ,mint_a.key().as_ref(),mint_b.key().as_ref()],
        bump,
    )]
    pub lp_mint:Box<InterfaceAccount<'info,Mint>>,

    pub token_program:Program<'info,Token2022>,
    pub associated_token_program:Program<'info,AssociatedToken>,
    pub system_program:Program<'info,System>

}