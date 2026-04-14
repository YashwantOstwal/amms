use anchor_lang::prelude::*;

#[error_code]
pub enum CpammsError{
    #[msg("error")]
    MintANotLexicographicallyLessThanMintB,

    #[msg("error")]
    NoSuchPoolExist,

    #[msg("error")]
    DepositDoesnotExemptTheMinThreshold,

    #[msg("error")]
    InvalidInputAmount,

    #[msg("error")]
    InvariantViolation,

    #[msg("error")]
    OutputFailsThreshold
}