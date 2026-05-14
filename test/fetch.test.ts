/**
 * Smoke test for the fetcher. Hits a real Sourcify endpoint — skip when offline.
 */
import { test, expect } from "bun:test";
import { fetchVerified } from "../src/fetch.ts";
import { resolveChain } from "../src/chains.ts";

const ONLINE = process.env.DAPP_GEN_ONLINE !== "0";

test.skipIf(!ONLINE)(
    "fetches DAI ABI from Sourcify (mainnet, non-proxy ERC-20)",
    async () => {
        const chain = resolveChain("ethereum");
        const bundle = await fetchVerified(
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 20000 },
        );
        expect(bundle.chainId).toBe(1);
        expect(bundle.abi.length).toBeGreaterThan(5);
        expect(bundle.abi.some((i) => i.type === "function" && i.name === "balanceOf")).toBe(true);
        expect(bundle.compilerVersion.length).toBeGreaterThan(0);
    },
    30000,
);

test("rejects non-hex address", async () => {
    const chain = resolveChain("ethereum");
    await expect(
        fetchVerified("not-an-address", chain, { timeoutMs: 5000 }),
    ).rejects.toThrow(/malformed/);
});

test("unknown chain slug is rejected", () => {
    expect(() => resolveChain("nonsense")).toThrow(/Unknown chain/);
});


// ─── Blockscout v2 path (PulseChain) ─────────────────────────────────────

test.skipIf(!ONLINE)(
    "fetches ProveX from PulseChain — Sourcify → Blockscout v2 fallback",
    async () => {
        const chain = resolveChain("pulsechain");
        const bundle = await fetchVerified(
            "0xF6f8Db0aBa00007681F8fAF16A0FDa1c9B030b11",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache-blockscout", timeoutMs: 25000 },
        );
        expect(bundle.chainId).toBe(369);
        expect(bundle.contractName.toLowerCase()).toContain("prov");
        expect(bundle.abi.length).toBeGreaterThan(5);
        expect(Object.keys(bundle.sources).length).toBeGreaterThan(0);
        // Verification quality is reported correctly
        expect(["full", "partial", "etherscan"]).toContain(bundle.matchKind);
    },
    40000,
);
