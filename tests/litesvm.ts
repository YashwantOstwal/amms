import { createClient } from "@solana/kit-client-litesvm";
import {
  Mint,
  TOKEN_PROGRAM_ADDRESS,
  tokenProgram,
} from "@solana-program/token";

import { ammsProgram, AMMS_PROGRAM_ADDRESS } from "../client/src/generated";
import assert from "assert";
import * as fs from "node:fs";
import { Account, Address, generateKeyPairSigner, lamports } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  Token,
  findAssociatedTokenPda,
} from "@solana-program/token-2022";

const pathToProgram =
  "/home/yashwant/Desktop/web3/dex/amms/target/deploy/amms.so";

interface Pool {
  mintA: Address;
  mintB: Address;
  feesInBasisPoints: number;
}
describe("Amms testing", () => {
  it("Deposit and withdraw ix", async () => {
    const client = await createClient().use(tokenProgram()).use(ammsProgram());

    async function getReserveAccounts(pool: Pool) {
      const [poolAuthorityAddress] = await client.amms.pdas.poolAuthority(pool);
      const [reserveAAddress] = await findAssociatedTokenPda({
        owner: poolAuthorityAddress,
        mint: pool.mintA,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      const reserveAAccount: Account<Token> =
        await client.token.accounts.token.fetch(reserveAAddress);

      const [reserveBAddress] = await findAssociatedTokenPda({
        owner: poolAuthorityAddress,
        mint: pool.mintB,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      const reserveBAccount: Account<Token> =
        await client.token.accounts.token.fetch(reserveBAddress);
      return [reserveAAccount, reserveBAccount];
    }
    if (fs.existsSync(pathToProgram)) {
      client.svm.addProgramFromFile(AMMS_PROGRAM_ADDRESS, pathToProgram);

      // Create INRc and JUP mints to provide swap service using CPMMs.
      // before.
      let [inrcMint, jupMint] = await Promise.all([
        generateKeyPairSigner(),
        generateKeyPairSigner(),
      ]);

      if (inrcMint.address > jupMint.address) {
        const temp = inrcMint;
        inrcMint = jupMint;
        jupMint = temp;
      }
      await client.token.instructions
        .createMint(
          {
            payer: client.payer,
            newMint: inrcMint,
            decimals: 6,
            mintAuthority: inrcMint.address,
          },
          { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
        )
        .sendTransaction();

      const inrcMintAccount: Account<Mint> =
        await client.token.accounts.mint.fetch(inrcMint.address);
      assert(
        inrcMintAccount.programAddress === TOKEN_2022_PROGRAM_ADDRESS,
        "4",
      );

      await client.token.instructions
        .createMint(
          {
            payer: client.payer,
            newMint: jupMint,
            decimals: 9,
            mintAuthority: jupMint.address,
          },
          { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
        )
        .sendTransaction();

      const jupMintAccount: Account<Mint> =
        await client.token.accounts.mint.fetch(jupMint.address);
      assert(jupMintAccount.programAddress === TOKEN_2022_PROGRAM_ADDRESS, "4");

      const alice = await generateKeyPairSigner();

      const airdrop = BigInt(1e9);
      client.svm.airdrop(alice.address, lamports(airdrop));
      const aliceBalance = client.svm.getBalance(alice.address);
      assert.equal(aliceBalance, airdrop, "3");

      const newPool: Pool = {
        mintA: inrcMint.address,
        mintB: jupMint.address,
        feesInBasisPoints: 300,
      };

      await client.amms.instructions
        .createCpammPool({
          payer: alice,
          ...newPool,
        })
        .sendTransaction();

      const [poolInfoAddress, poolInfoBump] = await client.amms.pdas.poolInfo(
        newPool,
      );
      const poolInfoAccount = await client.amms.accounts.poolInfo.fetch(
        poolInfoAddress,
      );

      assert.equal(
        poolInfoAccount.data.feesInBasisPoints,
        newPool.feesInBasisPoints,
      );
      assert.equal(poolInfoAccount.data.mintA, newPool.mintA);
      assert.equal(poolInfoAccount.data.mintB, newPool.mintB);
      assert.equal(poolInfoAccount.data.bump, poolInfoBump);

      const [poolAuthorityAddress] = await client.amms.pdas.poolAuthority(
        newPool,
      );

      const [lpMintAddress] = await client.amms.pdas.lpMint(newPool);
      const lpMint: Account<Mint> = await client.token.accounts.mint.fetch(
        lpMintAddress,
      );
      assert.equal(
        lpMint.data.mintAuthority.__option === "Some" &&
          lpMint.data.mintAuthority.value,
        poolAuthorityAddress,
      );
      assert.equal(lpMint.data.decimals, 0);
      assert.equal(lpMint.programAddress, TOKEN_2022_PROGRAM_ADDRESS);

      const [reserveAAddress] = await findAssociatedTokenPda({
        owner: poolAuthorityAddress,
        mint: newPool.mintA,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      const reserveAAccount: Account<Token> =
        await client.token.accounts.token.fetch(reserveAAddress);

      assert.equal(reserveAAccount.data.owner, poolAuthorityAddress);

      const [reserveBAddress] = await findAssociatedTokenPda({
        owner: poolAuthorityAddress,
        mint: newPool.mintB,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      const reserveBAccount: Account<Token> =
        await client.token.accounts.token.fetch(reserveBAddress);

      assert.equal(reserveBAccount.data.owner, poolAuthorityAddress);

      // First deposit: defines the initial spot price, share to asset ratio and the initial k.

      // Setting up liquidity provider's token accounts.
      const amount = 1000;
      await client.token.instructions
        .mintToATA(
          {
            owner: alice.address,
            mint: inrcMint.address,
            mintAuthority: inrcMint,
            amount: BigInt(
              amount * Math.pow(10, inrcMintAccount.data.decimals),
            ), // 1000rs
            decimals: inrcMintAccount.data.decimals,
          },
          { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
        )
        .sendTransaction();

      const [inrcTokenAddress] = await findAssociatedTokenPda({
        mint: inrcMint.address,
        owner: alice.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      const inrcTokenAccount: Account<Token> =
        await client.token.accounts.token.fetch(inrcTokenAddress);

      assert.equal(
        inrcTokenAccount.data.amount,
        BigInt(amount * Math.pow(10, inrcMintAccount.data.decimals)),
      );

      await client.token.instructions
        .mintToATA(
          {
            owner: alice.address,
            mint: jupMint.address,
            mintAuthority: jupMint,
            amount: BigInt(amount * Math.pow(10, jupMintAccount.data.decimals)), // 1000 JUP
            decimals: jupMintAccount.data.decimals,
          },
          { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
        )
        .sendTransaction();

      const [jupTokenAddress] = await findAssociatedTokenPda({
        mint: jupMint.address,
        owner: alice.address,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });
      const jupTokenAccount: Account<Token> =
        await client.token.accounts.token.fetch(jupTokenAddress);

      assert.equal(
        jupTokenAccount.data.amount,
        BigInt(amount * Math.pow(10, jupMintAccount.data.decimals)),
      );

      const inrcDeposit = BigInt(
        160 * Math.pow(10, inrcMintAccount.data.decimals),
      );
      const jupDeposit = BigInt(
        10 * Math.pow(10, inrcMintAccount.data.decimals),
      );
      const expectedSpotPriceInrcToJup = inrcDeposit / jupDeposit;
      const expectedInitialK = inrcDeposit * jupDeposit;

      const MINIMUM_LIQUIDITY = 1000;
      const expectedLpTokensSupposedToBeMinted =
        Math.sqrt(Number(inrcDeposit * jupDeposit)) - MINIMUM_LIQUIDITY;

      const expectedLpTokensMinted = Math.floor(
        expectedLpTokensSupposedToBeMinted,
      );
      await client.amms.instructions
        .depositLiquidity({
          ...newPool,
          depositor: alice,
          // Amount A is inrc, B is jup
          amounts: {
            __kind: "AmountAMinMaxAmountB",
            fields: [inrcDeposit, jupDeposit, jupDeposit],
          },
        })
        .sendTransaction();

      const [reserveAAccountAfter, reserveBAccountAfter] =
        await getReserveAccounts(newPool);

      assert.equal(reserveAAccountAfter.data.amount, inrcDeposit);
      assert.equal(reserveBAccountAfter.data.amount, jupDeposit);
      assert.equal(
        reserveAAccountAfter.data.amount / reserveBAccountAfter.data.amount,
        expectedSpotPriceInrcToJup,
      );
      assert.equal(
        reserveAAccountAfter.data.amount * reserveBAccountAfter.data.amount,
        expectedInitialK,
      );

      // get the lpTokenAccount and verify the minting, net loss of shares.
      const [lpTokenAddress] = await findAssociatedTokenPda({
        owner: alice.address,
        mint: lpMintAddress,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      const lpTokenAccount: Account<Token> =
        await client.token.accounts.token.fetch(lpTokenAddress);
      assert.equal(lpTokenAccount.data.amount, expectedLpTokensMinted);

      const lpMintAccountAfter: Account<Mint> =
        await client.token.accounts.mint.fetch(lpMintAddress);
      const inrcPerShare =
        Number(reserveAAccountAfter.data.amount) /
        (Number(lpMintAccountAfter.data.supply) + MINIMUM_LIQUIDITY);
      const jupPerShare =
        Number(reserveBAccountAfter.data.amount) /
        (Number(lpMintAccountAfter.data.supply) + MINIMUM_LIQUIDITY);

      //First depositor loss of assets.
      const expectedLossOfInrc =
        inrcPerShare *
        (MINIMUM_LIQUIDITY +
          expectedLpTokensSupposedToBeMinted -
          expectedLpTokensMinted);
      const expectedLossOfJup =
        jupPerShare *
        (MINIMUM_LIQUIDITY +
          expectedLpTokensSupposedToBeMinted -
          expectedLpTokensMinted);

      await client.amms.instructions
        .withdrawLiquidity({
          ...newPool,
          amount: lpTokenAccount.data.amount,
          depositor: alice,
        })
        .sendTransaction();

      const inrcTokenAccountAfterWithdrawal: Account<Token> =
        await client.token.accounts.token.fetch(inrcTokenAddress);
      const jupTokenAccountAfterWithdrawal: Account<Token> =
        await client.token.accounts.token.fetch(jupTokenAddress);

      // loss of assets by first depositor due to locking of shares to prevent first depositor attack and rounding down the token to be minted.
      assert.equal(
        inrcTokenAccount.data.amount -
          inrcTokenAccountAfterWithdrawal.data.amount,
        expectedLossOfInrc,
      );

      assert.equal(
        jupTokenAccount.data.amount -
          jupTokenAccountAfterWithdrawal.data.amount,
        expectedLossOfJup,
      );

      const [reserveAAccountAfterWithdrawal, reserveBAccountAfterWithdrawal] =
        await getReserveAccounts(newPool);

      assert.equal(
        reserveAAccountAfterWithdrawal.data.amount,
        expectedLossOfInrc,
      );
      assert.equal(
        reserveBAccountAfterWithdrawal.data.amount,
        expectedLossOfJup,
      );
    } else {
      console.log(".so file missing.");
    }
  });
});
