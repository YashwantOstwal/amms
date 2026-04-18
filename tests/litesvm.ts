import { createClient } from "@solana/kit-client-litesvm";
import {
  Mint,
  TOKEN_PROGRAM_ADDRESS,
  tokenProgram,
} from "@solana-program/token";

import { ammsProgram, AMMS_PROGRAM_ADDRESS } from "../client/src/generated";
import assert from "assert";
import * as fs from "node:fs";
import {
  Account,
  Address,
  generateKeyPairSigner,
  KeyPairSigner,
  lamports,
} from "@solana/kit";
import IDL from "../target/idl/amms.json";
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
  reserveA: Address;
  reserveB: Address;
  poolAuthority: Address;
  poolInfo: Address;
  lpMint: Address;
}

async function setupTestClient() {
  return createClient().use(tokenProgram()).use(ammsProgram());
}

const MINIMUM_LIQUIDITY = parseInt(
  IDL.constants.find(({ name }) => name == "MINIMUM_LIQUIDITY").value,
);
describe("Amms testing", () => {
  let client: Awaited<ReturnType<typeof setupTestClient>>;
  let [liquidityProvider, inrcMint, jupMint]: KeyPairSigner<string>[] = [];
  let [lpInrcTokenAddress, lpJupTokenAddress, lplpTokenAddress]: Address[] = [];
  const pools: Pool[] = [];

  before(async () => {
    client = await setupTestClient();
    client.svm.addProgramFromFile(AMMS_PROGRAM_ADDRESS, pathToProgram);

    const ammsProgramAccount = client.svm.getAccount(AMMS_PROGRAM_ADDRESS);
    assert(ammsProgramAccount.exists, "1");

    [liquidityProvider, inrcMint, jupMint] = await Promise.all([
      generateKeyPairSigner(),
      generateKeyPairSigner(),
      generateKeyPairSigner(),
    ]);

    if (inrcMint.address > jupMint.address) {
      const temp = inrcMint;
      inrcMint = jupMint;
      jupMint = temp;
    }

    const airdrop = BigInt(1e9);
    client.svm.airdrop(liquidityProvider.address, lamports(airdrop));

    const liquidityProviderBalance = client.svm.getBalance(
      liquidityProvider.address,
    );
    assert.equal(liquidityProviderBalance, airdrop, "2");

    // Create INRc and JUP mints to provide swap service using CPMMs.
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
    assert(inrcMintAccount.programAddress === TOKEN_2022_PROGRAM_ADDRESS, "3");

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

    const amount = 1000;
    await client.token.instructions
      .mintToATA(
        {
          owner: liquidityProvider.address,
          mint: inrcMint.address,
          mintAuthority: inrcMint,
          amount: BigInt(amount * Math.pow(10, inrcMintAccount.data.decimals)), // 1000rs
          decimals: inrcMintAccount.data.decimals,
        },
        { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
      )
      .sendTransaction();

    [lpInrcTokenAddress] = await findAssociatedTokenPda({
      mint: inrcMint.address,
      owner: liquidityProvider.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    [lpJupTokenAddress] = await findAssociatedTokenPda({
      mint: jupMint.address,
      owner: liquidityProvider.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    const inrcTokenAccount = await client.token.accounts.token.fetch(
      lpInrcTokenAddress,
    );

    assert.equal(
      inrcTokenAccount.data.amount,
      BigInt(amount * Math.pow(10, inrcMintAccount.data.decimals)),
    );

    await client.token.instructions
      .mintToATA(
        {
          owner: liquidityProvider.address,
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
      owner: liquidityProvider.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    const jupTokenAccount = await client.token.accounts.token.fetch(
      jupTokenAddress,
    );

    assert.equal(
      jupTokenAccount.data.amount,
      BigInt(amount * Math.pow(10, jupMintAccount.data.decimals)),
    );
  });

  it("Creating a pool", async () => {
    const newPool = {
      mintA: inrcMint.address,
      mintB: jupMint.address,
      feesInBasisPoints: 300,
    };

    await client.amms.instructions
      .createCpammPool({
        payer: liquidityProvider,
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
    const reserveAAccount = await client.token.accounts.token.fetch(
      reserveAAddress,
    );

    assert.equal(reserveAAccount.data.owner, poolAuthorityAddress);

    const [reserveBAddress] = await findAssociatedTokenPda({
      owner: poolAuthorityAddress,
      mint: newPool.mintB,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    const reserveBAccount = await client.token.accounts.token.fetch(
      reserveBAddress,
    );

    assert.equal(reserveBAccount.data.owner, poolAuthorityAddress);

    [lplpTokenAddress] = await findAssociatedTokenPda({
      owner: liquidityProvider.address,
      mint: lpMintAddress,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    pools.push({
      ...newPool,
      reserveA: reserveAAddress,
      reserveB: reserveBAddress,
      poolInfo: poolInfoAddress,
      poolAuthority: poolAuthorityAddress,
      lpMint: lpMintAddress,
    });
  });

  it("First deposition and loss of assets", async () => {
    // First deposit: defines the initial spot price, share to asset ratio and the initial k.

    const inrcMintAccount = await client.token.accounts.mint.fetch(
      inrcMint.address,
    );
    const jupMintAccount = await client.token.accounts.mint.fetch(
      jupMint.address,
    );
    const inrcDeposit = BigInt(
      160 * Math.pow(10, inrcMintAccount.data.decimals),
    );
    const jupDeposit = BigInt(10 * Math.pow(10, jupMintAccount.data.decimals));

    const expectedSpotPriceInrcToJup = Number(inrcDeposit) / Number(jupDeposit);
    const expectedInitialK = inrcDeposit * jupDeposit;

    const expectedLpTokensSupposedToBeMinted =
      Math.sqrt(Number(inrcDeposit * jupDeposit)) - MINIMUM_LIQUIDITY;

    const expectedLpTokensMinted = Math.floor(
      expectedLpTokensSupposedToBeMinted,
    );

    const inrcTokenAccountBeforeFirstDeposit =
      await client.token.accounts.token.fetch(lpInrcTokenAddress);
    const jupTokenAccountBeforeFirstDeposit =
      await client.token.accounts.token.fetch(lpJupTokenAddress);

    await client.amms.instructions
      .depositLiquidity({
        ...pools[0],
        depositor: liquidityProvider,
        // Amount A is inrc, B is jup
        amounts: {
          __kind: "AmountAMinMaxAmountB",
          fields: [inrcDeposit, jupDeposit, jupDeposit],
        },
      })
      .sendTransaction();

    const [reserveAAccountAfterFirstDeposit, reserveBAccountAfterFirstDeposit] =
      await getReserveAccounts(client, pools[0]);

    assert.equal(reserveAAccountAfterFirstDeposit.data.amount, inrcDeposit);
    assert.equal(reserveBAccountAfterFirstDeposit.data.amount, jupDeposit);
    assert.equal(
      Number(reserveAAccountAfterFirstDeposit.data.amount) /
        Number(reserveBAccountAfterFirstDeposit.data.amount),
      expectedSpotPriceInrcToJup,
    );
    assert.equal(
      reserveAAccountAfterFirstDeposit.data.amount *
        reserveBAccountAfterFirstDeposit.data.amount,
      expectedInitialK,
    );

    // get the lpTokenAccount and verify the minting, net loss of shares.
    const lpTokenAccount = await client.token.accounts.token.fetch(
      lplpTokenAddress,
    );
    assert.equal(lpTokenAccount.data.amount, expectedLpTokensMinted);

    const lpMintAccountAfterFirstDeposit: Account<Mint> =
      await client.token.accounts.mint.fetch(pools[0].lpMint);

    const inrcPerShare =
      Number(reserveAAccountAfterFirstDeposit.data.amount) /
      (Number(lpMintAccountAfterFirstDeposit.data.supply) + MINIMUM_LIQUIDITY);
    const jupPerShare =
      Number(reserveBAccountAfterFirstDeposit.data.amount) /
      (Number(lpMintAccountAfterFirstDeposit.data.supply) + MINIMUM_LIQUIDITY);

    //First depositor loss of assets.
    const expectedLossOfInrc = Math.ceil(
      inrcPerShare *
        (MINIMUM_LIQUIDITY +
          expectedLpTokensSupposedToBeMinted -
          expectedLpTokensMinted),
    );
    const expectedLossOfJup = Math.ceil(
      jupPerShare *
        (MINIMUM_LIQUIDITY +
          expectedLpTokensSupposedToBeMinted -
          expectedLpTokensMinted),
    );

    await client.amms.instructions
      .withdrawLiquidity({
        ...pools[0],
        amount: lpTokenAccount.data.amount,
        depositor: liquidityProvider,
      })
      .sendTransaction();

    const inrcTokenAccountAfterWithdrawal =
      await client.token.accounts.token.fetch(lpInrcTokenAddress);
    const jupTokenAccountAfterWithdrawal =
      await client.token.accounts.token.fetch(lpJupTokenAddress);

    // loss of assets by first depositor due to locking of shares to prevent first depositor attack and rounding down the token to be minted.
    assert.equal(
      Number(inrcTokenAccountBeforeFirstDeposit.data.amount) -
        Number(inrcTokenAccountAfterWithdrawal.data.amount),
      expectedLossOfInrc,
    );

    assert.equal(
      Number(jupTokenAccountBeforeFirstDeposit.data.amount) -
        Number(jupTokenAccountAfterWithdrawal.data.amount),
      expectedLossOfJup,
    );

    const [reserveAAccountAfterWithdrawal, reserveBAccountAfterWithdrawal] =
      await getReserveAccounts(client, pools[0]);

    assert.equal(
      reserveAAccountAfterWithdrawal.data.amount,
      expectedLossOfInrc,
    );
    assert.equal(reserveBAccountAfterWithdrawal.data.amount, expectedLossOfJup);

    // spot price is preserved.
    assert.equal(
      Number(reserveAAccountAfterWithdrawal.data.amount) /
        Number(reserveBAccountAfterWithdrawal.data.amount),
      expectedSpotPriceInrcToJup,
    );
  });
  // it("Deposit and withdraw ix", async () => {
  //   const lpMintAccountAfter: Account<Mint> =
  //     await client.token.accounts.mint.fetch(lpMintAddress);
  //   const inrcPerShare =
  //     Number(reserveAAccountAfter.data.amount) /
  //     (Number(lpMintAccountAfter.data.supply) + MINIMUM_LIQUIDITY);
  //   const jupPerShare =
  //     Number(reserveBAccountAfter.data.amount) /
  //     (Number(lpMintAccountAfter.data.supply) + MINIMUM_LIQUIDITY);

  //   //First depositor loss of assets.
  //   const expectedLossOfInrc =
  //     inrcPerShare *
  //     (MINIMUM_LIQUIDITY +
  //       expectedLpTokensSupposedToBeMinted -
  //       expectedLpTokensMinted);
  //   const expectedLossOfJup =
  //     jupPerShare *
  //     (MINIMUM_LIQUIDITY +
  //       expectedLpTokensSupposedToBeMinted -
  //       expectedLpTokensMinted);

  //   await client.amms.instructions
  //     .withdrawLiquidity({
  //       ...pools[0],
  //       amount: lpTokenAccount.data.amount,
  //       depositor: liquidityProvider,
  //     })
  //     .sendTransaction();

  //   const inrcTokenAccountAfterWithdrawal =
  //     await client.token.accounts.token.fetch(inrcTokenAddress);
  //   const jupTokenAccountAfterWithdrawal =
  //     await client.token.accounts.token.fetch(jupTokenAddress);

  //   // loss of assets by first depositor due to locking of shares to prevent first depositor attack and rounding down the token to be minted.
  //   assert.equal(
  //     inrcTokenAccount.data.amount -
  //       inrcTokenAccountAfterWithdrawal.data.amount,
  //     expectedLossOfInrc,
  //   );

  //   assert.equal(
  //     jupTokenAccount.data.amount - jupTokenAccountAfterWithdrawal.data.amount,
  //     expectedLossOfJup,
  //   );

  //   const [reserveAAccountAfterWithdrawal, reserveBAccountAfterWithdrawal] =
  //     await getReserveAccounts(client, pools[0]);

  //   assert.equal(
  //     reserveAAccountAfterWithdrawal.data.amount,
  //     expectedLossOfInrc,
  //   );
  //   assert.equal(reserveBAccountAfterWithdrawal.data.amount, expectedLossOfJup);

  //   // spot price is preserved.
  //   assert.equal(
  //     Number(reserveAAccountAfterWithdrawal.data.amount) /
  //       Number(reserveBAccountAfterWithdrawal.data.amount),
  //     expectedSpotPriceInrcToJup,
  //   );
  //   // Later depositors can lose upto 1^- share.

  //   const lpMintAccountAfterWithdrawal: Account<Mint> =
  //     await client.token.accounts.mint.fetch(lpMintAddress);
  //   const expectedLpTokensSupposedToBeMintedForSecondDeposition =
  //     (Number(inrcDeposit) /
  //       Number(reserveAAccountAfterWithdrawal.data.amount)) *
  //     (Number(lpMintAccountAfterWithdrawal.data.supply) + MINIMUM_LIQUIDITY);

  //   const expectedLpTokensMintedForSecondDeposition = Math.floor(
  //     expectedLpTokensSupposedToBeMintedForSecondDeposition,
  //   );
  //   // as the deposition is in multiple of pool reserves
  //   assert.equal(
  //     expectedLpTokensSupposedToBeMintedForSecondDeposition,
  //     expectedLpTokensMintedForSecondDeposition,
  //     "3",
  //   );
  //   const lpTokenAccountBeforeRedeposit =
  //     await client.token.accounts.token.fetch(lpTokenAddress);

  //   client.svm.expireBlockhash();
  //   await client.amms.instructions
  //     .depositLiquidity({
  //       ...pools[0],
  //       depositor: liquidityProvider,
  //       // Amount A is inrc, B is jup
  //       amounts: {
  //         __kind: "AmountAMinMaxAmountB",
  //         fields: [inrcDeposit, jupDeposit, jupDeposit],
  //       },
  //     })
  //     .sendTransaction();

  //   const lpTokenAccountAfterRedeposit =
  //     await client.token.accounts.token.fetch(lpTokenAddress);

  //   assert.equal(
  //     lpTokenAccountAfterRedeposit.data.amount -
  //       lpTokenAccountBeforeRedeposit.data.amount,
  //     expectedLpTokensMintedForSecondDeposition,
  //   );

  //   const [reserveAAccountAfterRedeposit, reserveBAccountAfterRedeposit] =
  //     await getReserveAccounts(client, pools[0]);

  //   assert.equal(
  //     reserveAAccountAfterRedeposit.data.amount,
  //     reserveAAccountAfterWithdrawal.data.amount + inrcDeposit,
  //   );
  //   assert.equal(
  //     reserveBAccountAfterRedeposit.data.amount,
  //     reserveBAccountAfterWithdrawal.data.amount + jupDeposit,
  //   );
  //   //Deposition is at the spot price.
  //   assert.equal(
  //     Number(reserveAAccountAfterRedeposit.data.amount) /
  //       Number(reserveBAccountAfterRedeposit.data.amount),
  //     Number(reserveAAccountAfterWithdrawal.data.amount) /
  //       Number(reserveBAccountAfterWithdrawal.data.amount),
  //   );

  //   const inrcTokenAccountBeforeRewithdrawal =
  //     await client.token.accounts.token.fetch(inrcTokenAddress);
  //   const jupTokenAccountBeforeRewithdrawal =
  //     await client.token.accounts.token.fetch(jupTokenAddress);

  //   await client.amms.instructions
  //     .withdrawLiquidity({
  //       ...pools[0],
  //       amount: lpTokenAccountAfterRedeposit.data.amount,
  //       depositor: liquidityProvider,
  //     })
  //     .sendTransaction();

  //   const inrcTokenAccountAfterRewithdrawal =
  //     await client.token.accounts.token.fetch(inrcTokenAddress);
  //   const jupTokenAccountAfterRewithdrawal =
  //     await client.token.accounts.token.fetch(jupTokenAddress);

  //   // 0 loss of assets because the deposit was in the multiple of reserves. Any non first depositor can suffer 1^-1 share worth of asset A and asset B which is fine because it is ensured that share to asset ratio tends to 0 so lp wont face significant loss.
  //   assert.equal(
  //     inrcTokenAccountAfterRewithdrawal.data.amount,
  //     inrcTokenAccountBeforeRewithdrawal.data.amount + inrcDeposit,
  //   );
  //   assert.equal(
  //     jupTokenAccountAfterRewithdrawal.data.amount,
  //     jupTokenAccountBeforeRewithdrawal.data.amount + jupDeposit,
  //   );

  //   // swap ix setup.

  //   // providing liquidity
  //   client.svm.expireBlockhash();
  //   await client.amms.instructions
  //     .depositLiquidity({
  //       ...pools[0],
  //       depositor: liquidityProvider,
  //       amounts: {
  //         __kind: "AmountBMinMaxAmountA",
  //         fields: [jupDeposit, inrcDeposit, inrcDeposit],
  //       },
  //     })
  //     .sendTransaction();

  //   const [reserveAAccountBeforeSwap, reserveBAccountBeforeSwap] =
  //     await getReserveAccounts(client, pools[0]);
  //   const reserveAAmountBeforeSwap = Number(
  //     reserveAAccountBeforeSwap.data.amount,
  //   );
  //   const reserveBAmountBeforeSwap = Number(
  //     reserveBAccountBeforeSwap.data.amount,
  //   );
  //   const swapInrc = true;
  //   const swapAmount = Math.floor(Number(reserveAAmountBeforeSwap) * 0.01); // increasing the inrc reserve by 1%.

  //   const fees = Math.floor((swapAmount * pools[0].feesInBasisPoints) / 10000);

  //   const swapAmountPostFees = swapAmount - fees;

  //   const kBeforeSwap = reserveAAmountBeforeSwap * reserveBAmountBeforeSwap;

  //   const expectedJup = Math.floor(
  //     reserveBAmountBeforeSwap -
  //       kBeforeSwap / (reserveAAmountBeforeSwap + swapAmountPostFees),
  //   );

  //   const inrcTokenAccountBeforeSwap = await client.token.accounts.token.fetch(
  //     inrcTokenAddress,
  //   );
  //   const jupTokenAccountBeforeSwap = await client.token.accounts.token.fetch(
  //     jupTokenAddress,
  //   );

  //   await client.amms.instructions
  //     .swapTokens({
  //       ...pools[0],
  //       trader: liquidityProvider,
  //       swapA: swapInrc,
  //       inputAmount: swapAmount,
  //       minOutputAmount: expectedJup,
  //     })
  //     .sendTransaction();
  //   const [reserveAAccountAfterSwap, reserveBAccountAfterSwap] =
  //     await getReserveAccounts(client, pools[0]);

  //   const reserveAAmountAfterSwap = Number(
  //     reserveAAccountAfterSwap.data.amount,
  //   );
  //   const reserveBAmountAfterSwap = Number(
  //     reserveBAccountAfterSwap.data.amount,
  //   );
  //   const inrcTokenAccountAfterSwap = await client.token.accounts.token.fetch(
  //     inrcTokenAddress,
  //   );
  //   const jupTokenAccountAfterSwap = await client.token.accounts.token.fetch(
  //     jupTokenAddress,
  //   );

  //   assert.equal(
  //     inrcTokenAccountAfterSwap.data.amount,
  //     inrcTokenAccountBeforeSwap.data.amount - BigInt(swapAmount),
  //   );

  //   assert.equal(
  //     reserveAAmountAfterSwap,
  //     reserveAAmountBeforeSwap + swapAmount,
  //   );

  //   assert.equal(
  //     reserveBAmountAfterSwap,
  //     reserveBAmountBeforeSwap - expectedJup,
  //   );
  //   // got the expected jup.
  //   assert.equal(
  //     jupTokenAccountAfterSwap.data.amount,
  //     jupTokenAccountBeforeSwap.data.amount + BigInt(expectedJup),
  //   );

  //   const swapJupAmount = Math.floor(Number(reserveBAmountAfterSwap) * 0.01); // increasing the jup reserve by 1%.

  //   const feesInJup = Math.floor(
  //     (swapJupAmount * pools[0].feesInBasisPoints) / 10000,
  //   );

  //   const swapJupAmountPostFees = swapJupAmount - feesInJup;

  //   const kAfterSwap = reserveAAmountAfterSwap * reserveBAmountAfterSwap;

  //   const expectedInrc = Math.floor(
  //     reserveAAmountAfterSwap -
  //       kAfterSwap / (reserveBAmountAfterSwap + swapJupAmountPostFees),
  //   );

  //   const [reserveAAccountBeforeJupSwap, reserveBAccountBeforeJupSwap] =
  //     await getReserveAccounts(client, pools[0]);

  //   const reserveAAmountBeforeJupSwap = Number(
  //     reserveAAccountBeforeJupSwap.data.amount,
  //   );
  //   const reserveBAmountBeforeJupSwap = Number(
  //     reserveBAccountBeforeJupSwap.data.amount,
  //   );
  //   const inrcTokenAccountBeforeJupSwap =
  //     await client.token.accounts.token.fetch(inrcTokenAddress);
  //   const jupTokenAccountBeforeJupSwap =
  //     await client.token.accounts.token.fetch(jupTokenAddress);

  //   client.svm.expireBlockhash();

  //   await client.amms.instructions
  //     .swapTokens({
  //       ...pools[0],
  //       trader: liquidityProvider,
  //       swapA: false,
  //       inputAmount: swapJupAmount,
  //       minOutputAmount: expectedInrc,
  //     })
  //     .sendTransaction();
  //   const [reserveAAccountAfterJupSwap, reserveBAccountAfterJupSwap] =
  //     await getReserveAccounts(client, pools[0]);

  //   const reserveAAmountAfterJupSwap = Number(
  //     reserveAAccountAfterJupSwap.data.amount,
  //   );
  //   const reserveBAmountAfterJupSwap = Number(
  //     reserveBAccountAfterJupSwap.data.amount,
  //   );
  //   const inrcTokenAccountAfterJupSwap =
  //     await client.token.accounts.token.fetch(inrcTokenAddress);
  //   const jupTokenAccountAfterJupSwap = await client.token.accounts.token.fetch(
  //     jupTokenAddress,
  //   );

  //   assert.equal(
  //     jupTokenAccountAfterJupSwap.data.amount,
  //     jupTokenAccountBeforeJupSwap.data.amount - BigInt(swapJupAmount),
  //     "10",
  //   );

  //   assert.equal(
  //     reserveBAmountAfterJupSwap,
  //     reserveBAmountBeforeJupSwap + swapJupAmount,
  //     "11",
  //   );

  //   // transfered to the trader.
  //   assert.equal(
  //     reserveAAmountAfterJupSwap,
  //     reserveAAmountBeforeJupSwap - expectedInrc,
  //     "12",
  //   );

  //   // got the expected jup.
  //   assert.equal(
  //     inrcTokenAccountAfterJupSwap.data.amount,
  //     inrcTokenAccountBeforeJupSwap.data.amount + BigInt(expectedInrc),
  //     "lorem",
  //   );
  // });
});

async function getReserveAccounts(
  client: Awaited<ReturnType<typeof setupTestClient>>,
  pool: Pool,
) {
  const [poolAuthorityAddress] = await client.amms.pdas.poolAuthority(pool);
  const [reserveAAddress] = await findAssociatedTokenPda({
    owner: poolAuthorityAddress,
    mint: pool.mintA,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  const reserveAAccount = await client.token.accounts.token.fetch(
    reserveAAddress,
  );

  const [reserveBAddress] = await findAssociatedTokenPda({
    owner: poolAuthorityAddress,
    mint: pool.mintB,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  const reserveBAccount = await client.token.accounts.token.fetch(
    reserveBAddress,
  );
  return [reserveAAccount, reserveBAccount];
}
