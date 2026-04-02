use anchor_lang::prelude::*;

declare_id!("9M8STYBfUfycs9PLmiohhCx2Ppjm5Wria4AsHvR2sQRa");

#[program]
pub mod amms {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
