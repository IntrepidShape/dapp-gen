import { test, expect } from "bun:test";
import { detectStandard } from "../src/detect-standards.ts";
import { fetchVerified } from "../src/fetch.ts";
import { resolveChain } from "../src/chains.ts";

const ONLINE = process.env.DAPP_GEN_ONLINE !== "0";

test("detectStandard rejects empty ABI", () => {
    expect(detectStandard([])).toBe(null);
});

test("detectStandard returns null on a non-token ABI shape", () => {
    expect(
        detectStandard([
            {
                type: "function",
                name: "doSomething",
                inputs: [],
                outputs: [],
                stateMutability: "nonpayable",
            },
        ]),
    ).toBe(null);
});

test.skipIf(!ONLINE)(
    "detectStandard recognises DAI as ERC-20",
    async () => {
        const chain = resolveChain("ethereum");
        const bundle = await fetchVerified(
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 20000 },
        );
        const match = detectStandard(bundle.abi);
        expect(match?.standard).toBe("erc20");
    },
    30000,
);

test.skipIf(!ONLINE)(
    "detectStandard recognises WETH as ERC-20",
    async () => {
        const chain = resolveChain("ethereum");
        const bundle = await fetchVerified(
            "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 20000 },
        );
        const match = detectStandard(bundle.abi);
        expect(match?.standard).toBe("erc20");
    },
    30000,
);
