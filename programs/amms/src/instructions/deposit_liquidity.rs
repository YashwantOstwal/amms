use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_2022::{ MintToChecked, TransferChecked, mint_to_checked, transfer_checked}, token_interface::{Mint, Token2022, TokenAccount}};

use crate::{CpammsError, PoolConfig};
pub fn process_deposit_liquidity(ctx:Context<DepositLiquidity>,amounts:AmountMinMaxAmount)->Result<()>{
        let pool_config = &ctx.accounts.pool_config;
        let reserve_a = &mut ctx.accounts.reserve_a;
        let reserve_b = &mut ctx.accounts.reserve_b;

    let is_first_deposit = reserve_a.amount == 0 && reserve_b.amount == 0;
    let (deposit_a,deposit_b) =  if is_first_deposit {
        match amounts {
            AmountMinMaxAmount::AmountAMinMaxAmountB(amount_a,min_amount_b ,max_amount_b ) => {
                // let deposit_b = (min_amount_b.checked_add(max_amount_b).unwrap()).checked_div_euclid(2).unwrap();
                let deposit_b = min_amount_b.midpoint(max_amount_b);
                (amount_a,deposit_b)
            },
            AmountMinMaxAmount::AmountBMinMaxAmountA(amount_b,min_amount_a ,max_amount_a ) => {
                let deposit_a = min_amount_a.midpoint(max_amount_a);
                (deposit_a,amount_b)
            }
        }
    }else {
          (0,0)
        };

        let lp_tokens = if is_first_deposit {
            let lp_tokens_minted = deposit_a.checked_mul(deposit_b).unwrap().isqrt();
            require!(lp_tokens_minted >= 1000,CpammsError::DepositDoesnotExemptTheMinThreshold);
            lp_tokens_minted - 1000
        }else {
            0
        };
        let fees_in_basis_points = pool_config.fees_in_basis_points.to_le_bytes();
        let pool_authority_seeds:&[&[u8]] = &[b"pool_authority",fees_in_basis_points.as_ref() ,pool_config.mint_a.as_ref(),pool_config.mint_b.as_ref(),&[ctx.bumps.pool_authority]];
        let signer_seeds = [&pool_authority_seeds[..]];
        
        let mint_lp_tokens_cpi_context = CpiContext::new(ctx.accounts.token_program.key(),MintToChecked{
            mint:ctx.accounts.lp_mint.to_account_info(),
            to:ctx.accounts.token_account_lp.to_account_info(),
            authority:ctx.accounts.pool_authority.to_account_info()
        }).with_signer(&signer_seeds);

        mint_to_checked(mint_lp_tokens_cpi_context, lp_tokens,ctx.accounts.lp_mint.decimals)?;

        let transfer_token_a_cpi_context = CpiContext::new(ctx.accounts.token_program.key(),TransferChecked{
            from:ctx.accounts.token_account_a.to_account_info(),
            to:ctx.accounts.reserve_a.to_account_info(),
            mint:ctx.accounts.mint_a.to_account_info(),
            authority:ctx.accounts.depositor.to_account_info()
        });

        transfer_checked(transfer_token_a_cpi_context, deposit_a, ctx.accounts.mint_a.decimals)?;

        let transfer_token_b_cpi_context = CpiContext::new(ctx.accounts.token_program.key(),TransferChecked{
            from:ctx.accounts.token_account_b.to_account_info(),
            to:ctx.accounts.reserve_b.to_account_info(),
            mint:ctx.accounts.mint_b.to_account_info(),
            authority:ctx.accounts.depositor.to_account_info()
        });

        transfer_checked(transfer_token_b_cpi_context, deposit_b, ctx.accounts.mint_b.decimals)


}

#[derive(Accounts)]
#[instruction(fees_in_basis_points:u16)]

pub struct DepositLiquidity<'info>{

    #[account(mut)]
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
        init_if_needed,
        payer = depositor,
        associated_token::mint = lp_mint,
        associated_token::authority = depositor,
        associated_token::token_program = token_program,

    )]
    pub token_account_lp:Box<InterfaceAccount<'info,TokenAccount>>,

    // redundant if reserve_a and reserve_b exists then this must exist too. ? 
    #[account(
        seeds = [b"pool_config",fees_in_basis_points.to_le_bytes().as_ref() ,mint_a.key().as_ref(),mint_b.key().as_ref()],
        bump = pool_config.bump,
        constraint = pool_config.fees_in_basis_points == fees_in_basis_points @ CpammsError::NoSuchPoolExist,
        has_one = mint_a  @ CpammsError::NoSuchPoolExist,
        has_one = mint_b  @ CpammsError::NoSuchPoolExist
    )]
    pub pool_config:Box<Account<'info,PoolConfig>>,

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

    pub system_program:Program<'info,System>,
    pub token_program:Program<'info,Token2022>,
    pub associated_token_program:Program<'info,AssociatedToken>
}

#[derive(AnchorDeserialize,AnchorSerialize,Clone,PartialEq,Eq)]
pub enum AmountMinMaxAmount {
    AmountAMinMaxAmountB(u64,u64,u64),
    AmountBMinMaxAmountA(u64,u64,u64),

}