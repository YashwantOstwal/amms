import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Amms } from "../target/types/amms";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createMint,
  TOKEN_2022_PROGRAM_ID,
  getMint,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import assert from "assert";
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const { connection } = provider;
const { payer } = provider.wallet;
const program = anchor.workspace.amms as Program<Amms>;

const mints: Record<string, PublicKey> = {};

interface Pool {
  mintA: PublicKey;
  mintB: PublicKey;
  poolConfig: PublicKey;
  poolAuthority: PublicKey;
  reserveA: PublicKey;
  reserveB: PublicKey;
  feesInBasisPoints: number;
}
const pools: Record<string, Pool> = {};
const pdaStaticSeeds: Record<string, string> = {
  poolConfig: "pool_config",
  poolAuthority: "pool_authority",
};
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

    if (mintAPubkey < mintBPubkey) {
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

    const poolAccountData = await program.account.poolConfig.fetch(
      poolConfigAddress,
    );

    assert.equal(poolAccountData.feesInBasisPoints, feesInBasisPoints, "1");
    assert(poolAccountData.mintA.equals(mints.mintA), "2");
    assert(poolAccountData.mintB.equals(mints.mintB), "3");
    assert(
      poolAccountData.mintA.toString() < poolAccountData.mintB.toString(),
      "4",
    );

    assert.equal(poolAccountData.bump, poolConfigBump, "5");

    const reserveAAccountData = await getAccount(
      connection,
      reserveAAddress,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    assert.equal(reserveAAccountData.amount, 0, "6");
    assert(reserveAAccountData.owner.equals(poolAuthorityAddress), "7");

    const reserveBAccountData = await getAccount(
      connection,
      reserveBAddress,
      undefined,
      TOKEN_2022_PROGRAM_ID,
    );
    assert.equal(reserveBAccountData.amount, 0, "8");
    assert(reserveBAccountData.owner.equals(poolAuthorityAddress), "9");

    pools.ab = {
      mintA: mints.mintA,
      mintB: mints.mintB,
      poolConfig: poolConfigAddress,
      poolAuthority: poolAuthorityAddress,
      reserveA: reserveAAddress,
      reserveB: reserveBAddress,
      feesInBasisPoints,
    };
  });
});
