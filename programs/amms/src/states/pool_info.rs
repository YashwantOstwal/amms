use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PoolInfo{
    pub mint_a:Pubkey,
    pub mint_b:Pubkey,
    pub fees_in_basis_points:u16,
    pub bump:u8,
} 