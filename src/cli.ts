#!/usr/bin/env bun
/**
 * dapp-gen — verified contract → forkable type-safe Elm dapp.
 *
 * Usage:
 *   bunx @intrepidshape/dapp-gen \
 *     --chain pulsechain \
 *     --address 0xABC... \
 *     --out ./my-dapp
 *
 * What this does (Phase 1):
 *
 *   1. Resolve --chain slug → chainId.
 *   2. For each --address:
 *      a. Fetch verified ABI from Sourcify (Etherscan fallback).
 *      b. Run elm-web3's existing codegen for typed wrappers
 *         → src/Generated/Contracts/<Name>.elm
 *      c. Run our UI codegen for the rendered form
 *         → src/Generated/Views/<Name>.elm
 *   3. Render the app-shell templates with placeholder substitution
 *      → src/Main.elm, index.html, ports.ts, style.css.
 *   4. Emit elm.json pinning the right libs.
 *   5. Print next steps.
 *
 * Phase 1 limit: --address may appear only once. Multi-contract is Phase 2.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChain } from "./chains.ts";
import { fetchVerified, type VerifiedBundle } from "./fetch.ts";
import { generateUiModule } from "./generate-ui.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = resolve(HERE, "..", "templates");
const ELM_WEB3_CODEGEN =
    process.env.ELM_WEB3_CODEGEN ??
    resolve(HERE, "..", "..", "elm-web3", "codegen", "generate.ts");

interface Args {
    readonly chain: string;
    readonly addresses: string[];
    readonly out: string;
    readonly force: boolean;
    readonly noContractsModule: boolean;
}

function parseArgs(argv: string[]): Args {
    const out: { -readonly [K in keyof Args]: Args[K] } = {
        chain: "",
        addresses: [],
        out: "",
        force: false,
        noContractsModule: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        switch (a) {
            case "--chain":
                out.chain = argv[++i] ?? "";
                break;
            case "--address":
                if (argv[i + 1]) out.addresses.push(argv[++i]!);
                break;
            case "--out":
                out.out = argv[++i] ?? "";
                break;
            case "--force":
                out.force = true;
                break;
            case "--no-contracts-module":
                out.noContractsModule = true;
                break;
            case "--help":
            case "-h":
                printHelp();
                process.exit(0);
            default:
                console.error(`Unknown flag: ${a}`);
                printHelp();
                process.exit(64);
        }
    }
    if (!out.chain) die("missing --chain");
    if (out.addresses.length === 0) die("missing --address");
    if (out.addresses.length > 1) die("Phase 1 supports a single --address; --address multi is Phase 2");
    if (!out.out) die("missing --out");
    return out;
}

function printHelp(): void {
    console.log(`dapp-gen — verified contract → Elm dapp scaffold

Usage:
  dapp-gen --chain <slug> --address <0x...> --out <dir>

Flags:
  --chain <slug>         pulsechain | pulsechain-testnet | ethereum | sepolia
  --address <0x...>      Contract address (Phase 1: one only)
  --out <dir>            Output directory (created if missing)
  --force                Overwrite existing src/Main.elm + ports.ts (default: skip)
  --no-contracts-module  Skip the typed-wrapper codegen (UI codegen still runs)
  -h, --help             Show this help

Examples:
  # DAI on Ethereum mainnet
  dapp-gen --chain ethereum \\
           --address 0x6B175474E89094C44Da98b954EedeAC495271d0F \\
           --out ./dai-dapp

  # WPLS on PulseChain
  dapp-gen --chain pulsechain \\
           --address 0xA1077a294dDE1B09bB078844df40758a5D0f9a27 \\
           --out ./wpls-dapp
`);
}

function die(msg: string): never {
    console.error(`Error: ${msg}`);
    console.error(`Run with --help for usage.`);
    process.exit(64);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const chain = resolveChain(args.chain);
    const outDir = resolve(args.out);

    console.log(`▸ chain     ${chain.name} (id ${chain.chainId})`);
    console.log(`▸ out       ${outDir}`);

    mkdirSync(join(outDir, "src/Generated/Contracts"), { recursive: true });
    mkdirSync(join(outDir, "src/Generated/Views"), { recursive: true });

    const cacheDir = join(outDir, ".dapp-gen/cache");
    const apiKey = process.env.ETHERSCAN_API_KEY;

    // --- Fetch ----------------------------------------------------------
    const address = args.addresses[0]!;
    console.log(`▸ fetching  ${address} …`);
    const fetchOpts = {
        cacheDir,
        timeoutMs: 25_000,
        ...(apiKey ? { etherscanApiKey: apiKey } : {}),
    };
    const bundle = await fetchVerified(address, chain, fetchOpts);
    console.log(
        `  ↳ ${bundle.contractName}, ${bundle.abi.length} ABI items, match=${bundle.matchKind}, compiler=${bundle.compilerVersion}`,
    );

    const moduleSafeName = sanitiseModuleName(bundle.contractName);

    // --- Typed wrappers (existing elm-web3 codegen) ---------------------
    if (!args.noContractsModule) {
        await runContractsCodegen(bundle, moduleSafeName, outDir);
    }

    // --- UI codegen (our new codegen) -----------------------------------
    const uiElm = generateUiModule(bundle, {
        moduleName: `Generated.Views.${moduleSafeName}`,
        contractsModule: `Generated.Contracts.${moduleSafeName}`,
    });
    const uiPath = join(outDir, "src/Generated/Views", `${moduleSafeName}.elm`);
    writeFileSync(uiPath, uiElm);
    console.log(`▸ wrote     ${rel(uiPath, outDir)}`);

    // --- App-shell templates --------------------------------------------
    renderTemplates(bundle, chain, moduleSafeName, outDir, args.force);

    // --- elm.json --------------------------------------------------------
    writeElmJson(outDir);

    // --- README ---------------------------------------------------------
    writeReadme(bundle, chain, moduleSafeName, outDir);

    console.log(`\n✓ Done.\n`);
    console.log(`Next:`);
    console.log(`  cd ${outDir}`);
    console.log(`  elm make src/Main.elm --output=elm.js`);
    console.log(`  bun --hot index.html\n`);
    console.log(
        `Note: the bundled ports.ts ships a stub keccak4 — drop in a real keccak256`,
    );
    console.log(
        `      implementation (e.g. via @noble/hashes) before write calls work.`,
    );
}

async function runContractsCodegen(
    bundle: VerifiedBundle,
    moduleSafeName: string,
    outDir: string,
): Promise<void> {
    // The existing elm-web3 codegen consumes a Foundry-shaped artifact:
    // { abi, ... }. Sourcify gives us the ABI directly; wrap it.
    const tempAbi = join(outDir, ".dapp-gen", `${moduleSafeName}.abi.json`);
    mkdirSync(dirname(tempAbi), { recursive: true });
    writeFileSync(tempAbi, JSON.stringify({ abi: bundle.abi }, null, 2));

    const outFile = join(outDir, "src/Generated/Contracts", `${moduleSafeName}.elm`);
    const proc = Bun.spawnSync({
        cmd: [
            "bun",
            ELM_WEB3_CODEGEN,
            tempAbi,
            `Generated.Contracts.${moduleSafeName}`,
            outFile,
        ],
        stdout: "pipe",
        stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
        console.warn(
            `  ↳ contracts codegen failed (continuing with UI only):\n    ${proc.stderr.toString().trim()}`,
        );
        return;
    }
    console.log(`▸ wrote     ${rel(outFile, outDir)}`);
}

function renderTemplates(
    bundle: VerifiedBundle,
    chain: ReturnType<typeof resolveChain>,
    moduleSafeName: string,
    outDir: string,
    force: boolean,
): void {
    const subs: Record<string, string> = {
        CONTRACT_NAME: bundle.contractName,
        CONTRACT_MODULE: moduleSafeName,
        CONTRACT_ADDRESS: bundle.address,
        CHAIN_ID: String(chain.chainId),
        CHAIN_SLUG: chain.elmName,
        EXPLORER_URL: chain.explorer,
        RPC_URL: chain.rpcUrl,
    };

    const apply = (src: string): string =>
        Object.entries(subs).reduce(
            (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
            src,
        );

    const copies: Array<{ template: string; out: string }> = [
        { template: "Main.elm", out: "src/Main.elm" },
        { template: "index.html", out: "index.html" },
        { template: "ports.ts", out: "ports.ts" },
        { template: "style.css", out: "style.css" },
    ];

    for (const { template, out } of copies) {
        const target = join(outDir, out);
        if (existsSync(target) && !force) {
            console.log(`▸ keep      ${out} (already exists; pass --force to overwrite)`);
            continue;
        }
        const src = readFileSync(join(TEMPLATES, template), "utf8");
        writeFileSync(target, apply(src));
        console.log(`▸ wrote     ${out}`);
    }
}

function writeElmJson(outDir: string): void {
    const file = join(outDir, "elm.json");
    if (existsSync(file)) {
        console.log(`▸ keep      elm.json (existing)`);
        return;
    }
    writeFileSync(
        file,
        JSON.stringify(
            {
                type: "application",
                "source-directories": ["src"],
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
                        "intrepidshape/elm-web3": "1.1.0",
                        "intrepidshape/elm-web3-ui": "1.8.0",
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
    console.log(`▸ wrote     elm.json`);
}

function writeReadme(
    bundle: VerifiedBundle,
    chain: ReturnType<typeof resolveChain>,
    moduleSafeName: string,
    outDir: string,
): void {
    const file = join(outDir, "README.md");
    if (existsSync(file)) return;
    const content = `# ${bundle.contractName} dapp

Auto-generated by [\`@intrepidshape/dapp-gen\`](https://github.com/IntrepidShape/dapp-gen)
against the verified [\`${bundle.address}\`](${chain.explorer}/address/${bundle.address})
on ${chain.name} (chain ${chain.chainId}).

## Run

\`\`\`sh
elm make src/Main.elm --output=elm.js
bun --hot index.html
\`\`\`

## What's here

- \`src/Main.elm\` — your code. Wallet wiring + composition. Edit freely.
- \`src/Generated/Contracts/${moduleSafeName}.elm\` — typed contract wrappers from
  the ABI (encoders, decoders, type aliases). Regenerated by \`dapp-gen\`.
- \`src/Generated/Views/${moduleSafeName}.elm\` — the auto-generated UI
  (one read/write form per function). Regenerated by \`dapp-gen\`.
- \`ports.ts\` — minimal Web3 port bridge. **Stub keccak4 — replace before shipping.**
- \`style.css\` — opinionated baseline. Replace freely; class names follow
  [\`intrepidshape/elm-web3-ui\`](https://github.com/IntrepidShape/elm-web3-ui).

## Regenerate

\`\`\`sh
bunx @intrepidshape/dapp-gen \\
    --chain ${chain.slug} \\
    --address ${bundle.address} \\
    --out .
\`\`\`

This overwrites \`src/Generated/**\` but leaves \`Main.elm\` / \`ports.ts\`
/ \`style.css\` alone (pass \`--force\` to overwrite them too).
`;
    writeFileSync(file, content);
    console.log(`▸ wrote     README.md`);
}

function sanitiseModuleName(name: string): string {
    const clean = name.replace(/[^A-Za-z0-9]/g, "");
    return clean.length === 0
        ? "Contract"
        : clean[0]!.toUpperCase() + clean.slice(1);
}

function rel(p: string, base: string): string {
    return p.startsWith(base) ? p.slice(base.length + 1) : p;
}

main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
});
