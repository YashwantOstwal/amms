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
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import assert from "assert";
import {
  getLpAssociatedTokenAccount,
  getLpAssociatedTokenAddressAsync,
  getLpMintAddressSync,
  getReserveAccounts,
  getReserveAddresses,
  pdaStaticSeeds,
} from "./helpers";
import { IDL } from "@coral-xyz/anchor/dist/cjs/native/system";

export const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const { connection } = provider;
const { payer } = provider.wallet;
export const program = anchor.workspace.amms as Program<Amms>;

export interface Pool {
  mintA: PublicKey;
  mintB: PublicKey;
  poolInfo: PublicKey;
  poolAuthority: PublicKey;
  reserveA: PublicKey;
  reserveB: PublicKey;
  feesInBasisPoints: number;
}

const DEFAULT_FEES_IN_BASIS_POINTS = 300;
describe("amms", () => {
  // Configure the client to use the local cluster.

  const mints: Record<string, PublicKey> = {};
  const pools: Record<string, Pool> = {};
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

    if (mintAPubkey < mintBPubkey) {
      mints.mintA = mintAPubkey;
      mints.mintB = mintBPubkey;
    } else {
      mints.mintA = mintBPubkey;
      mints.mintB = mintAPubkey;
    }
  });

  it("creating a pool !", async () => {
    const feesInBasisPoints = DEFAULT_FEES_IN_BASIS_POINTS; // 0.3% fees
    const [poolConfigAddress, poolConfigBump] =
      PublicKey.findProgramAddressSync(
        [
          new TextEncoder().encode(pdaStaticSeeds.poolInfo),
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
      .createCpammPool(DEFAULT_FEES_IN_BASIS_POINTS)
      .accountsPartial({
        payer: alice.publicKey,
        mintA: mints.mintA,
        mintB: mints.mintB,
        poolInfo: poolConfigAddress,
        poolAuthority: poolAuthorityAddress,
        reserveA: reserveAAddress,
        reserveB: reserveBAddress,
      })
      .signers([alice])
      .rpc();

    pools.ab = {
      mintA: mints.mintA,
      mintB: mints.mintB,
      poolInfo: poolConfigAddress,
      poolAuthority: poolAuthorityAddress,
      reserveA: reserveAAddress,
      reserveB: reserveBAddress,
      feesInBasisPoints,
    };

    const poolConfigAccount = await program.account.poolInfo.fetch(
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
    const mintAmount = 10000000000; // 10 token
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
          new anchor.BN(10000000), // 0.01 token.
          new anchor.BN(1000000000 - 0.05 * 1000000000), // 1 token +- 0.05 token
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

    // spot price defined is 100 token B/token A
    assert.equal(
      parseInt(reserveBBalance.value.amount) /
        parseInt(reserveABalance.value.amount),
      100,
    );
  });

  it("Successive deposition", async () => {
    const [reserveAAccount, reserveBAccount] = await getReserveAccounts(
      pools.ab,
    );
    const [depositA, depositB] = [
      reserveAAccount.amount,
      reserveBAccount.amount,
    ];

    const lpTokenAddress = await getLpAssociatedTokenAddressAsync(
      alice.publicKey,
      pools.ab,
    );
    const {
      value: { amount: lpTokenBalance },
    } = await connection.getTokenAccountBalance(lpTokenAddress);

    await program.methods
      .depositLiquidity(pools.ab.feesInBasisPoints, {
        amountAMinMaxAmountB: [
          new anchor.BN(depositA), //
          new anchor.BN(depositB), // 1 token +- 0.05 token
          new anchor.BN(depositB),
          // first deposit will be median of the above 2 which turns out to be 1000000000
        ],
      })
      .accountsPartial({ depositor: alice.publicKey, ...pools.ab })
      .signers([alice])
      .rpc();
  });
  it("Swap token a for token b", async () => {
    const tokenAddressA = await getAssociatedTokenAddress(
      pools.ab.mintA,
      alice.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const tokenAddressB = await getAssociatedTokenAddress(
      pools.ab.mintB,
      alice.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const {
      value: { amount: tokenBalanceABefore },
    } = await connection.getTokenAccountBalance(tokenAddressA);

    const {
      value: { amount: tokenBalanceBBefore },
    } = await connection.getTokenAccountBalance(tokenAddressB);

    const swapA = true;
    const swapAmount = BigInt(100000000);
    assert(swapAmount <= parseInt(tokenBalanceABefore));

    // Lets compute the expected tokenB amount after swap.
    const [reserveAAccountBefore, reserveBAccountBefore] =
      await getReserveAccounts(pools.ab);

    const fees = DEFAULT_FEES_IN_BASIS_POINTS;
    const reserveAAmountAfterSwap = reserveAAccountBefore.amount + swapAmount;
    const swapAmountPostFees =
      swapAmount - (swapAmount * BigInt(fees)) / BigInt(10000);
    const k = reserveAAccountBefore.amount * reserveBAccountBefore.amount;

    const numerator = BigInt(k);
    const denominator =
      BigInt(reserveAAccountBefore.amount) + BigInt(swapAmountPostFees);

    const reserveOutAfterSwap =
      (numerator + denominator - BigInt(1)) / denominator;

    const outputAmount =
      BigInt(reserveBAccountBefore.amount) - reserveOutAfterSwap;
    BigInt(
      Math.ceil(
        Number(k / (reserveAAccountBefore.amount + swapAmountPostFees)),
      ),
    );
    await program.methods
      .swapTokens(fees, swapA, new anchor.BN(swapAmount), new anchor.BN(0))
      .accountsPartial({
        trader: alice.publicKey,
        traderAccountA: tokenAddressA,
        traderAccountB: tokenAddressB,
        ...pools.ab,
      })
      .signers([alice])
      .rpc();
    const [reserveAAccountAfter, reserveBAccountAfter] =
      await getReserveAccounts(pools.ab);
    assert.equal(reserveAAccountAfter.amount, reserveAAmountAfterSwap);
    assert.equal(
      reserveBAccountAfter.amount,
      reserveBAccountBefore.amount - outputAmount,
    );

    const {
      value: { amount: tokenBalanceBAfter },
    } = await connection.getTokenAccountBalance(tokenAddressB);

    assert.equal(
      BigInt(tokenBalanceBBefore) + outputAmount,
      tokenBalanceBAfter,
    );

    // how much did the user get per it for?
    // new spot price.
  });
  it("withdraw liquidity testing", async () => {
    const lpTokenAccount = await getLpAssociatedTokenAccount(
      alice.publicKey,
      pools.ab,
    );
    await program.methods
      .withdrawLiquidity(
        DEFAULT_FEES_IN_BASIS_POINTS,
        new anchor.BN(lpTokenAccount.amount),
      )
      .accountsPartial({ depositor: alice.publicKey, ...pools.ab })
      .signers([alice])
      .rpc();
  });
});
