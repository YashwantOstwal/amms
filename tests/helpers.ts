import { PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { Pool, program, provider } from "./amms";
import {
  getAccount,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
export const pdaStaticSeeds: Record<string, string> = {
  poolConfig: "pool_config",
  poolAuthority: "pool_authority",
  lpMint: "lp_mint",
};

const textEncoder = new TextEncoder();
export function getLpMintAddressSync(pool: Pool) {
  return PublicKey.findProgramAddressSync(
    [
      textEncoder.encode(pdaStaticSeeds.lpMint),
      new anchor.BN(pool.feesInBasisPoints).toArrayLike(Buffer, "le"),
      pool.mintA.toBuffer(),
      pool.mintB.toBuffer(),
    ],
    program.programId,
  );
}

export async function getLpMint(pool: Pool) {
  const [lpMintAddress] = getLpMintAddressSync(pool);
  return await getMint(
    provider.connection,
    lpMintAddress,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
}

export function getReserveAddresses(pool: Pool) {
  return [
    getAssociatedTokenAddressSync(
      pool.mintA,
      pool.poolAuthority,
      true,
      TOKEN_2022_PROGRAM_ID,
    ),
    getAssociatedTokenAddressSync(
      pool.mintB,
      pool.poolAuthority,
      true,
      TOKEN_2022_PROGRAM_ID,
    ),
  ];
}
export async function getReserveAccounts(pool: Pool) {
  const [reserveAAddress, reserveBAddress] = getReserveAddresses(pool);
  return await Promise.all([
    getAccount(
      provider.connection,
      reserveAAddress,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    ),
    getAccount(
      provider.connection,
      reserveBAddress,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    ),
  ]);
}

export async function getLpAssociatedTokenAddressAsync(
  owner: anchor.web3.PublicKey,
  pool: Pool,
) {
  const [lpMintAddress] = getLpMintAddressSync(pool);
  return await getAssociatedTokenAddress(
    lpMintAddress,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
}
export async function getLpAssociatedTokenAccount(
  owner: anchor.web3.PublicKey,
  pool: Pool,
) {
  const tokenAddress = await getLpAssociatedTokenAddressAsync(owner, pool);
  return await getAccount(
    provider.connection,
    tokenAddress,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
}
