use anchor_lang::prelude::*;

#[error_code]
pub enum CpammsError{
    #[msg("error")]
    MintANotLexicographicallyLessThanMintB,

    #[msg("error")]
    NoSuchPoolExist
}