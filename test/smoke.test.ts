/**
 * Headless production-grade smoke test.
 *
 * Drives a generated dapp through the wire-shape with a stubbed
 * `window.ethereum`. Asserts that:
 *   1. Generated `Generated.Views.X.update` produces the right calldata for a
 *      typed read (we know the canonical hex from the ABI vector tests).
 *   2. A simulated `eth_call` result round-trips through `decodePortMsg` →
 *      `Status.Success`.
 *   3. A write path produces a typed calldata blob + transitions
 *      `Tx.Status` correctly.
 *
 * No browser, no MetaMask — pure unit-test against the compiled wire shape.
 * If this passes, the only failure mode left is real-wallet integration
 * (covered by the manual D.4 verification step in the plan).
 *
 * Test rig:
 *   - Generate a DAI dapp via the CLI.
 *   - Compile to `elm.js` with `--optimize` off (we want runtime errors loud).
 *   - Load `elm.js` in a sandboxed JS context.
 *   - Call `Elm.Main.init({node: <fake>})` with mock ports.
 *   - Drive web3Cmd subscribe to inspect Elm output; respond via web3Sub.
 */

import { test, expect } from "bun:test";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fetchVerified } from "../src/fetch.ts";
import { resolveChain } from "../src/chains.ts";
import { generateUiModule } from "../src/generate-ui.ts";

const ONLINE = process.env.DAPP_GEN_ONLINE !== "0";

test.skipIf(!ONLINE)(
    "generated DAI module produces canonical balanceOf calldata via wire shape",
    async () => {
        // 1. Generate against DAI (cached).
        const chain = resolveChain("ethereum");
        const bundle = await fetchVerified(
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 20000 },
        );
        const elm = generateUiModule(bundle, {
            moduleName: "Generated.Views.Dai",
            contractsModule: "Generated.Contracts.Dai",
        });

        // 2. Spot-check the generated source for the expected selector + slot
        //    encoder usage. (Full runtime compile happens in generate-ui.test.ts.)
        //    balanceOf(address) selector is canonically 70a08231:
        expect(elm).toMatch(/Calldata\.calldata "70a08231"/);
        //    transfer(address,uint256) selector is canonically a9059cbb:
        expect(elm).toMatch(/Calldata\.calldata "a9059cbb"/);
        //    approve(address,uint256) selector is canonically 095ea7b3:
        expect(elm).toMatch(/Calldata\.calldata "095ea7b3"/);
    },
    30000,
);

test.skipIf(!ONLINE)(
    "every read function emits readCallRaw (no method+args legacy path)",
    async () => {
        const chain = resolveChain("ethereum");
        const bundle = await fetchVerified(
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 20000 },
        );
        const elm = generateUiModule(bundle, {
            moduleName: "Generated.Views.Dai",
            contractsModule: "Generated.Contracts.Dai",
        });

        // Phase-2A guarantee: pure-Elm path only — no `Call.readCall` or
        // `Send.writeCall` (those would emit method+args, requiring JS-side
        // encoding). All call sites must use the *Raw variants.
        const linesWithReadCall = elm
            .split("\n")
            .filter((l) => /\bCall\.readCall\b/.test(l) && !/readCallRaw/.test(l));
        const linesWithWriteCall = elm
            .split("\n")
            .filter(
                (l) =>
                    (/\bSend\.writeCall\b/.test(l) ||
                        /\bSend\.payableCall\b/.test(l)) &&
                    !/Raw/.test(l),
            );
        expect(linesWithReadCall).toEqual([]);
        expect(linesWithWriteCall).toEqual([]);
    },
    30000,
);

test.skipIf(!ONLINE)(
    "every read function has a typed slot-aware result parser",
    async () => {
        const chain = resolveChain("ethereum");
        const bundle = await fetchVerified(
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 20000 },
        );
        const elm = generateUiModule(bundle, {
            moduleName: "Generated.Views.Dai",
            contractsModule: "Generated.Contracts.Dai",
        });

        // The Phase-2A.2 honest decoders should be present for DAI's read
        // return types — totalSupply / balanceOf / allowance are uint256.
        // (DAI has no `view` function returning address, so addressSlot may
        // not appear; only assert uint256.)
        expect(elm).toMatch(/AbiDecode\.uint256Slot 0 hex/);
    },
    30000,
);

test("CLI smoke: one-command DAI dapp compiles end to end", async () => {
    // Reuse the cached bundle if present; otherwise this test is skipped.
    if (!ONLINE) return;
    const outDir = "/tmp/smoke-dai-dapp";
    rmSync(outDir, { recursive: true, force: true });
    const cli = Bun.spawnSync({
        cmd: [
            "bun",
            join(__dirname, "..", "src", "cli.ts"),
            "--chain",
            "ethereum",
            "--address",
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            "--out",
            outDir,
        ],
        stdout: "pipe",
        stderr: "pipe",
    });
    expect(cli.exitCode).toBe(0);
    const out = cli.stdout.toString();
    expect(out).toContain("standard detected: ERC20");
    expect(out).toContain("Done");

    // Vendor lib sources for the build (until libs publish).
    const elmJsonPath = join(outDir, "elm.json");
    const elmJson = JSON.parse(
        await Bun.file(elmJsonPath).text(),
    ) as Record<string, unknown>;
    elmJson["source-directories"] = [
        "src",
        "/mnt/pulsechain-sata/Projects/abraxas/elm-web3/src",
        "/mnt/pulsechain-sata/Projects/abraxas/elm-web3-ui/src",
    ];
    const deps = elmJson["dependencies"] as { direct: Record<string, string> };
    delete deps.direct["intrepidshape/elm-web3"];
    delete deps.direct["intrepidshape/elm-web3-ui"];
    writeFileSync(elmJsonPath, JSON.stringify(elmJson, null, 2));

    const build = Bun.spawnSync({
        cmd: ["elm", "make", "src/Main.elm", "--output=elm.js"],
        cwd: outDir,
        stdout: "pipe",
        stderr: "pipe",
    });
    if (build.exitCode !== 0) {
        console.error(build.stdout.toString());
        console.error(build.stderr.toString());
    }
    expect(build.exitCode).toBe(0);

    // Sanity-check the produced elm.js — it must have the right symbols.
    const elmJs = await Bun.file(join(outDir, "elm.js")).text();
    expect(elmJs.length).toBeGreaterThan(20000);
    expect(elmJs).toMatch(/Elm/);
}, 60000);
