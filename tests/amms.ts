import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Amms } from "../target/types/amms";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAccount,
  mintTo,
  createAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import assert from "assert";
import {
  getLpAssociatedTokenAccount,
  getLpAssociatedTokenAddressAsync,
  getLpMintAddressSync,
  getReserveAccounts,
  getReserveAddresses,
} from "./helpers";

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const { connection } = provider;
const { payer } = provider.wallet;
export const program = anchor.workspace.amms as Program<Amms>;

const mints: Record<string, PublicKey> = {};

export interface Pool {
  mintA: PublicKey;
  mintB: PublicKey;
  poolConfig: PublicKey;
  poolAuthority: PublicKey;
  reserveA: PublicKey;
  reserveB: PublicKey;
  feesInBasisPoints: number;
}
const pools: Record<string, Pool> = {};

describe("amms", () => {
  // Configure the client to use the local cluster.

  const alice = new Keypair();
  before(async () => {
    const airdrop = 1e9;
    const signature = await connection.requestAirdrop(alice.publicKey, airdrop);
    await connection.confirmTransaction(signature, "confirmed");

    const aliceBalance = await connection.getBalance(alice.publicKey);
    assert.equal(aliceBalance, airdrop, "1");

    //creating mints
    const mintAPubkey = await createMint(
      connection,
      alice,
      alice.publicKey,
      null,
      9,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    const mintBPubkey = await createMint(
      connection,
      alice,
      alice.publicKey,
      null,
      9,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );

    const mintAAccountInfo = await connection.getAccountInfo(mintAPubkey);
    assert(mintAAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID), "2");

    const mintBAccountInfo = await connection.getAccountInfo(mintBPubkey);
    assert(mintBAccountInfo.owner.equals(TOKEN_2022_PROGRAM_ID), "3");

    const mintAAccountData = await getMint(
      connection,
      mintAPubkey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    assert(mintAAccountData.mintAuthority.equals(alice.publicKey), "4");
    assert.equal(mintAAccountData.decimals, 9, "5");

    const mintBAccountData = await getMint(
      connection,
      mintAPubkey,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    assert(mintBAccountData.mintAuthority.equals(alice.publicKey), "6");
    assert.equal(mintBAccountData.decimals, 9, "7");

    if (mintAPubkey.toBase58() < mintBPubkey.toBase58()) {
      mints.mintA = mintAPubkey;
      mints.mintB = mintBPubkey;
    } else {
      mints.mintA = mintBPubkey;
      mints.mintB = mintAPubkey;
    }
  });

  it("creating a pool !", async () => {
    const feesInBasisPoints = 300;
    const [poolConfigAddress, poolConfigBump] =
      PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode("pool_config"),
          new anchor.BN(feesInBasisPoints).toArrayLike(Buffer, "le"),
          mints.mintA.toBuffer(),
          mints.mintB.toBuffer(),
        ],
        program.programId,
      );
    const [poolAuthorityAddress] = PublicKey.findProgramAddressSync(
      [
        new TextEncoder().encode("pool_authority"),
        new anchor.BN(feesInBasisPoints).toArrayLike(Buffer, "le"),
        mints.mintA.toBuffer(),
        mints.mintB.toBuffer(),
      ],
      program.programId,
    );

    const reserveAAddress = getAssociatedTokenAddressSync(
      mints.mintA,
      poolAuthorityAddress,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    const reserveBAddress = getAssociatedTokenAddressSync(
      mints.mintB,
      poolAuthorityAddress,
      true,
      TOKEN_2022_PROGRAM_ID,
    );

    await program.methods
      .createCpammPool(300)
      .accountsPartial({
        payer: alice.publicKey,
        mintA: mints.mintA,
        mintB: mints.mintB,
        poolConfig: poolConfigAddress,
        poolAuthority: poolAuthorityAddress,
        reserveA: reserveAAddress,
        reserveB: reserveBAddress,
      })
      .signers([alice])
      .rpc();

    pools.ab = {
      mintA: mints.mintA,
      mintB: mints.mintB,
      poolConfig: poolConfigAddress,
      poolAuthority: poolAuthorityAddress,
      reserveA: reserveAAddress,
      reserveB: reserveBAddress,
      feesInBasisPoints,
    };

    const poolConfigAccount = await program.account.poolConfig.fetch(
      poolConfigAddress,
    );

    assert.equal(poolConfigAccount.feesInBasisPoints, feesInBasisPoints, "1");
    assert(poolConfigAccount.mintA.equals(mints.mintA), "2");
    assert(poolConfigAccount.mintB.equals(mints.mintB), "3");
    assert(
      poolConfigAccount.mintA.toString() < poolConfigAccount.mintB.toString(),
      "4",
    );

    assert.equal(poolConfigAccount.bump, poolConfigBump, "5");

    const [reserveAAccount, reserveBAccount] = await getReserveAccounts(
      pools.ab,
    );
    assert.equal(reserveAAccount.amount, 0, "6");
    assert(reserveAAccount.owner.equals(poolAuthorityAddress), "7");

    assert.equal(reserveBAccount.amount, 0, "8");
    assert(reserveBAccount.owner.equals(poolAuthorityAddress), "9");
  });

  it("First deposit to the pool created previously", async () => {
    const mintAmount = 1000000000;
    const tokenAAddress = await createAssociatedTokenAccount(
      connection,
      alice,
      mints.mintA,
      alice.publicKey,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
      undefined,
      true,
    );
    await mintTo(
      connection,
      alice,
      mints.mintA,
      tokenAAddress,
      alice,
      mintAmount,
      undefined,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );

    const {
      value: { amount: accountABalance },
    } = await connection.getTokenAccountBalance(tokenAAddress);
    assert.equal(accountABalance, mintAmount.toString());

    const tokenBAddress = await createAssociatedTokenAccount(
      connection,
      alice,
      mints.mintB,
      alice.publicKey,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
      undefined,
      true,
    );
    await mintTo(
      connection,
      alice,
      mints.mintB,
      tokenBAddress,
      alice,
      mintAmount,
      undefined,
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID,
    );

    const {
      value: { amount: accountBBalance },
    } = await connection.getTokenAccountBalance(tokenBAddress);
    assert.equal(accountBBalance, mintAmount.toString());

    const lpTokensSupposedToBeMinted = Math.sqrt(10000000 * 1000000000);
    const lpTokensMinted = Math.floor(lpTokensSupposedToBeMinted - 1000); // 1000 tokens not minted to inflate the share price to asset ratio 1000x expensive.
    const tokenAPerShare = (10000000 * Math.pow(10, -9)) / lpTokensMinted;
    const tokenBPerShare = (1000000000 * Math.pow(10, -9)) / lpTokensMinted;

    const lossOfAssetA =
      (lpTokensSupposedToBeMinted - lpTokensMinted) * tokenAPerShare;
    const lossOfAssetB =
      (lpTokensSupposedToBeMinted - lpTokensMinted) * tokenBPerShare;

    // console.log(lossOfAssetA, lossOfAssetB); 0 as tokenA * tokenB is a perfect square.
    await program.methods
      .depositLiquidity(pools.ab.feesInBasisPoints, {
        amountAMinMaxAmountB: [
          new anchor.BN(10000000),
          new anchor.BN(1000000000 - 0.05 * 1000000000),
          new anchor.BN(1000000000 + 0.05 * 1000000000),
          // first deposit will be median of the above 2 which turns out to be 1000000000
        ],
      })
      .accountsPartial({ depositor: alice.publicKey, ...pools.ab })
      .signers([alice])
      .rpc();

    const lpTokenAddress = await getLpAssociatedTokenAddressAsync(
      alice.publicKey,
      pools.ab,
    );
    const {
      value: { amount: lpTokenBalance },
    } = await connection.getTokenAccountBalance(lpTokenAddress);
    assert.equal(lpTokenBalance, lpTokensMinted.toString());

    const [reserveAAddress, reserveBAddress] = getReserveAddresses(pools.ab);
    const [reserveABalance, reserveBBalance] = await Promise.all([
      connection.getTokenAccountBalance(reserveAAddress),
      connection.getTokenAccountBalance(reserveBAddress),
    ]);

    assert.equal(reserveABalance.value.amount, (10000000).toString());
    assert.equal(reserveBBalance.value.amount, (1000000000).toString());
  });

  it("Swap token a for token b");
  it("add liquidity");
});
