/**
 * Generate the Elm UI for DAI (mainnet, classic non-proxy ERC-20) and run
 * the Elm compiler against it. Verifies the loop end-to-end:
 *   Sourcify ABI → generate-ui.ts → elm make → success.
 */
import { test, expect } from "bun:test";
import { fetchVerified } from "../src/fetch.ts";
import { resolveChain } from "../src/chains.ts";
import { generateUiModule } from "../src/generate-ui.ts";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ONLINE = process.env.DAPP_GEN_ONLINE !== "0";

test.skipIf(!ONLINE)(
    "generates DAI UI module that compiles against intrepidshape/elm-web3* libs",
    async () => {
        // 1. Fetch DAI verified bundle (cached)
        const chain = resolveChain("ethereum");
        const bundle = await fetchVerified(
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            chain,
            { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 20000 },
        );

        // 2. Generate the UI module
        const elm = generateUiModule(bundle, {
            moduleName: "Generated.Views.Dai",
            contractsModule: "Generated.Contracts.Dai",
        });

        // 3. Drop into a scratch Elm project that vendors the libs via
        //    source-directories (the same pattern pulsechain/app-elm uses
        //    while the libs are not yet published).
        const projectDir = "/tmp/dapp-gen-smoke";
        rmSync(projectDir, { recursive: true, force: true });
        mkdirSync(join(projectDir, "src/Generated/Views"), { recursive: true });
        writeFileSync(join(projectDir, "src/Generated/Views/Dai.elm"), elm);

        // 4. elm.json — application type, sources vendored. Reuse exactly
        //    the dep set from pulsechain/app-elm/elm.json (a known-good
        //    config that compiles against both libs locally).
        writeFileSync(
            join(projectDir, "elm.json"),
            JSON.stringify(
                {
                    type: "application",
                    "source-directories": [
                        "src",
                        "/mnt/pulsechain-sata/Projects/abraxas/elm-web3/src",
                        "/mnt/pulsechain-sata/Projects/abraxas/elm-web3-ui/src",
                    ],
                    "elm-version": "0.19.1",
                    dependencies: {
                        direct: {
                            "cmditch/elm-bigint": "2.1.2",
                            "elm/browser": "1.0.2",
                            "elm/core": "1.0.5",
                            "elm/html": "1.0.0",
                            "elm/http": "2.0.0",
                            "elm/json": "1.1.3",
                            "elm/svg": "1.0.1",
                            "elm/time": "1.0.0",
                            "elm/url": "1.0.0",
                        },
                        indirect: {
                            "elm/bytes": "1.0.8",
                            "elm/file": "1.0.5",
                            "elm/virtual-dom": "1.0.3",
                            "elm-community/list-extra": "8.7.0",
                            "elm-community/maybe-extra": "5.3.0",
                            "rtfeldman/elm-hex": "1.0.0",
                        },
                    },
                    "test-dependencies": { direct: {}, indirect: {} },
                },
                null,
                2,
            ),
        );

        // 5. Run elm make against the generated module using the user's
        //    real Elm package cache.
        const proc = Bun.spawnSync({
            cmd: ["elm", "make", "src/Generated/Views/Dai.elm", "--output=/dev/null"],
            cwd: projectDir,
            stdout: "pipe",
            stderr: "pipe",
        });

        const out = proc.stdout.toString();
        const err = proc.stderr.toString();
        if (proc.exitCode !== 0) {
            console.error("--- elm make stderr ---\n", err);
            console.error("--- elm make stdout ---\n", out);
            console.error("--- generated module head ---\n", elm.split("\n").slice(0, 60).join("\n"));
            // Dump for inspection
            writeFileSync("/tmp/dapp-gen-smoke-out.elm", elm);
        }
        expect(proc.exitCode).toBe(0);
        expect(existsSync(join(projectDir, "src/Generated/Views/Dai.elm"))).toBe(true);

        // Spot-checks on generated content
        expect(elm).toContain("module Generated.Views.Dai");
        expect(elm).toContain("balanceOf");
        expect(elm).toContain("Read.view");
        expect(elm).toContain("Write.view");
    },
    60000,
);
