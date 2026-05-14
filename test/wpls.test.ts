import { test } from "bun:test";
import { fetchVerified } from "../src/fetch.ts";
import { resolveChain } from "../src/chains.ts";
import { generateUiModule } from "../src/generate-ui.ts";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

test("WPLS PulseChain compile", async () => { const chain = resolveChain("pulsechain");
const bundle = await fetchVerified(
    "0xA1077a294dDE1B09bB078844df40758a5D0f9a27",
    chain,
    { cacheDir: "/tmp/dapp-gen-test-cache", timeoutMs: 25000 },
);
console.log(`fetched ${bundle.contractName}, ${bundle.abi.length} ABI items, match=${bundle.matchKind}`);

const elm = generateUiModule(bundle, {
    moduleName: "Generated.Views.Wpls",
    contractsModule: "Generated.Contracts.Wpls",
});
console.log(`generated ${elm.length} bytes`);

const projectDir = "/tmp/dapp-gen-smoke-wpls";
rmSync(projectDir, { recursive: true, force: true });
mkdirSync(`${projectDir}/src/Generated/Views`, { recursive: true });
writeFileSync(`${projectDir}/src/Generated/Views/Wpls.elm`, elm);
writeFileSync(`${projectDir}/elm.json`, JSON.stringify({
    type: "application",
    "source-directories": ["src",
        "/mnt/pulsechain-sata/Projects/abraxas/elm-web3/src",
        "/mnt/pulsechain-sata/Projects/abraxas/elm-web3-ui/src"],
    "elm-version": "0.19.1",
    dependencies: {
        direct: {
            "cmditch/elm-bigint": "2.1.2", "elm/browser": "1.0.2", "elm/core": "1.0.5",
            "elm/html": "1.0.0", "elm/http": "2.0.0", "elm/json": "1.1.3",
            "elm/svg": "1.0.1", "elm/time": "1.0.0", "elm/url": "1.0.0",
        },
        indirect: {
            "elm/bytes": "1.0.8", "elm/file": "1.0.5", "elm/virtual-dom": "1.0.3",
            "elm-community/list-extra": "8.7.0", "elm-community/maybe-extra": "5.3.0",
            "rtfeldman/elm-hex": "1.0.0",
        },
    },
    "test-dependencies": { direct: {}, indirect: {} },
}, null, 2));

const proc = Bun.spawnSync({
    cmd: ["elm", "make", "src/Generated/Views/Wpls.elm", "--output=/dev/null"],
    cwd: projectDir, stdout: "pipe", stderr: "pipe",
});
console.log("exit:", proc.exitCode);
if (proc.exitCode !== 0) console.log(proc.stderr.toString() || proc.stdout.toString());
else console.log("WPLS compiles clean");
});
