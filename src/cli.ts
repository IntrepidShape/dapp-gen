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
import { detectStandard } from "./detect-standards.ts";

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
    if (!out.out) die("missing --out");
    return out;
}

function printHelp(): void {
    console.log(`dapp-gen — verified contract → Elm dapp scaffold

Usage:
  dapp-gen --chain <slug> --address <0x...> --out <dir>

Flags:
  --chain <slug>         pulsechain | pulsechain-testnet | ethereum | sepolia
  --address <0x...>      Contract address (repeat for multi-contract systems)
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

    // --- Fetch every contract ------------------------------------------
    const bundles: ScaffoldBundle[] = [];
    for (const address of args.addresses) {
        console.log(`▸ fetching  ${address} …`);
        const fetchOpts = {
            cacheDir,
            timeoutMs: 25_000,
            ...(apiKey ? { etherscanApiKey: apiKey } : {}),
        };
        const bundle = await fetchVerified(address, chain, fetchOpts);
        const standard = detectStandard(bundle.abi);
        console.log(
            `  ↳ ${bundle.contractName}, ${bundle.abi.length} ABI items, match=${bundle.matchKind}, compiler=${bundle.compilerVersion}`,
        );
        if (standard) {
            console.log(`  ↳ standard detected: ${standard.standard.toUpperCase()}`);
        }
        bundles.push({
            bundle,
            moduleName: sanitiseModuleName(bundle.contractName),
            standard: standard,
        });
    }

    // De-collide module names if two contracts share a contractName.
    deduplicateModuleNames(bundles);

    // --- Codegen each contract -----------------------------------------
    for (const { bundle, moduleName } of bundles) {
        if (!args.noContractsModule) {
            await runContractsCodegen(bundle, moduleName, outDir);
        }
        const uiElm = generateUiModule(bundle, {
            moduleName: `Generated.Views.${moduleName}`,
            contractsModule: `Generated.Contracts.${moduleName}`,
        });
        const uiPath = join(outDir, "src/Generated/Views", `${moduleName}.elm`);
        writeFileSync(uiPath, uiElm);
        console.log(`▸ wrote     ${rel(uiPath, outDir)}`);
    }

    // --- App-shell templates --------------------------------------------
    renderTemplates(bundles, chain, outDir, args.force);

    // --- elm.json --------------------------------------------------------
    writeElmJson(outDir);

    // --- README ---------------------------------------------------------
    writeReadme(bundles, chain, outDir);

    console.log(`\n✓ Done.\n`);
    console.log(`Next:`);
    console.log(`  cd ${outDir}`);
    console.log(`  elm make src/Main.elm --output=elm.js`);
    console.log(`  bun serve.ts        # builds ports.ts + serves on :5174`);
    console.log(`\nThen open the URL in a browser with an EIP-1193 wallet.\n`);
    console.log(
        `All calldata encoding happens in Elm — the generated ports.ts is a`,
    );
    console.log(
        `pure pass-through with zero runtime npm dependencies.`,
    );
}

interface ScaffoldBundle {
    readonly bundle: VerifiedBundle;
    moduleName: string;
    readonly standard: ReturnType<typeof detectStandard>;
}

function deduplicateModuleNames(bundles: ScaffoldBundle[]): void {
    const seen = new Map<string, number>();
    for (const b of bundles) {
        const count = seen.get(b.moduleName) ?? 0;
        if (count > 0) {
            b.moduleName = `${b.moduleName}${count + 1}`;
        }
        seen.set(b.moduleName, count + 1);
    }
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
    bundles: { bundle: VerifiedBundle; moduleName: string }[],
    chain: ReturnType<typeof resolveChain>,
    outDir: string,
    force: boolean,
): void {
    // First bundle drives header text + index title; multi-contract shells
    // compose every bundle into tabs.
    const first = bundles[0]!;
    const baseSubs: Record<string, string> = {
        CONTRACT_NAME:
            bundles.length === 1
                ? first.bundle.contractName
                : `${first.bundle.contractName} +${bundles.length - 1}`,
        CONTRACT_ADDRESS: first.bundle.address,
        CHAIN_ID: String(chain.chainId),
        CHAIN_SLUG: chain.elmName,
        EXPLORER_URL: chain.explorer,
        RPC_URL: chain.rpcUrl,
    };

    const apply = (src: string, subs: Record<string, string>): string =>
        Object.entries(subs).reduce(
            (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v),
            src,
        );

    // Main.elm is special — fully rendered from the bundle list, not from a
    // template file. Templates are only used for the unchanging files.
    const mainElm = renderMainShell(bundles, chain);
    writeIfAllowed(
        join(outDir, "src/Main.elm"),
        mainElm,
        force,
        "src/Main.elm",
    );

    const copies: Array<{ template: string; out: string }> = [
        { template: "index.html", out: "index.html" },
        { template: "ports.ts", out: "ports.ts" },
        { template: "elm-web3-ports.ts", out: "elm-web3-ports.ts" },
        { template: "serve.ts", out: "serve.ts" },
        { template: "style.css", out: "style.css" },
    ];

    for (const { template, out } of copies) {
        const target = join(outDir, out);
        const src = readFileSync(join(TEMPLATES, template), "utf8");
        writeIfAllowed(target, apply(src, baseSubs), force, out);
    }
}

function writeIfAllowed(
    target: string,
    content: string,
    force: boolean,
    label: string,
): void {
    if (existsSync(target) && !force) {
        console.log(
            `▸ keep      ${label} (already exists; pass --force to overwrite)`,
        );
        return;
    }
    writeFileSync(target, content);
    console.log(`▸ wrote     ${label}`);
}

/**
 * Render a Main.elm that wires N contracts into a tabbed app shell. For
 * `bundles.length === 1` this collapses to a single-tab dapp (no tabs UI),
 * matching the Phase-1 single-contract shape.
 */
function renderMainShell(
    bundles: { bundle: VerifiedBundle; moduleName: string }[],
    chain: ReturnType<typeof resolveChain>,
): string {
    const fields = bundles
        .map((b) => `    , ${camelLower(b.moduleName)} : ${moduleAlias(b.moduleName)}.Model`)
        .join("\n");
    const inits = bundles
        .map((b) => `    , ${camelLower(b.moduleName)} = ${moduleAlias(b.moduleName)}.init`)
        .join("\n");
    const addresses = bundles
        .map((b) => {
            const id = camelLower(b.moduleName);
            return `${id}Address : T.Address
${id}Address =
    case T.address "${b.bundle.address}" of
        Just a -> a
        Nothing -> Debug.todo "invalid ${b.moduleName} address"`;
        })
        .join("\n\n\n");
    const msgVariants = bundles
        .map((b) => `    | ${b.moduleName}Msg ${moduleAlias(b.moduleName)}.Msg`)
        .join("\n");
    const updateBranches = bundles
        .map((b) => {
            const id = camelLower(b.moduleName);
            const ctor = `${b.moduleName}Msg`;
            const alias = moduleAlias(b.moduleName);
            return `        ${ctor} sub ->
            let
                ( newModel, intent ) =
                    ${alias}.update ${id}Address sub model.${id}
            in
            ( { model | ${id} = newModel }
            , case intent of
                ${alias}.NoIntent ->
                    Cmd.none

                ${alias}.DoCall payload ->
                    web3Cmd payload

                ${alias}.DoSend payload ->
                    web3Cmd payload
            )`;
        })
        .join("\n\n");
    // Build a nested case-of chain: each contract's decodePortMsg is tried
    // in order; if every one returns Nothing, fall through to the wallet
    // decoder. Indentation deepens by 4 spaces per level.
    const portRouting = renderPortRouting(bundles);
    const tabs = bundles.length === 1
        ? `Html.map ${bundles[0]!.moduleName}Msg (${moduleAlias(bundles[0]!.moduleName)}.view ${camelLower(bundles[0]!.moduleName)}Address explorerTxUrl model.${camelLower(bundles[0]!.moduleName)})`
        : renderTabsView(bundles);
    const tabModel = bundles.length === 1
        ? ""
        : `    , activeTab : String\n`;
    const tabInit = bundles.length === 1
        ? ""
        : `    , activeTab = "${bundles[0]!.moduleName}"\n`;
    const tabMsg = bundles.length === 1 ? "" : `    | SwitchTab String\n`;
    const tabUpdate = bundles.length === 1
        ? ""
        : `        SwitchTab name ->
            ( { model | activeTab = name }, Cmd.none )

`;
    return `port module Main exposing (main)

{-| Auto-generated shell for a dapp targeting ${bundles.length} contract(s)
on ${chain.name} (chain ${chain.chainId}).

Edit this file freely — re-running \`dapp-gen\` does not overwrite it unless
you pass \`--force\`.
-}

import Browser
${bundles.map((b) => `import Generated.Views.${b.moduleName} as ${moduleAlias(b.moduleName)}`).join("\n")}
import Html exposing (Html)
import Html.Attributes as Attr
import Html.Events as Events
import Json.Decode as D
import Json.Encode as E
import Web3.Chain as Chain
import Web3.Types as T
import Web3.Wallet as Wallet
import Web3.Ui.Wallet as WalletUi



-- PORTS ---------------------------------------------------------------------


port web3Cmd : E.Value -> Cmd msg


port web3Sub : (D.Value -> msg) -> Sub msg



-- ADDRESSES -----------------------------------------------------------------


${addresses}


chain : Chain.Chain
chain =
    Chain.${chain.elmName}


explorerTxUrl : Maybe String
explorerTxUrl =
    Just (Chain.blockExplorer chain ++ "/tx/")



-- MODEL ---------------------------------------------------------------------


type alias Model =
    { wallet : Wallet.State
${tabModel}${fields}
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { wallet = Wallet.Disconnected
${tabInit}${inits}
      }
    , Cmd.none
    )



-- UPDATE --------------------------------------------------------------------


type Msg
    = ConnectWallet
    | DisconnectWallet
    | SwitchChain
    | WalletMsg Wallet.Msg
    | IncomingPort D.Value
${tabMsg}${msgVariants}


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
${tabUpdate}        ConnectWallet ->
            ( { model | wallet = Wallet.startConnect model.wallet }
            , web3Cmd (Wallet.encode Wallet.connect)
            )

        DisconnectWallet ->
            ( model, web3Cmd (Wallet.encode Wallet.disconnect) )

        SwitchChain ->
            ( model
            , web3Cmd (Wallet.encode (Wallet.switchChain (Chain.chainId chain)))
            )

        WalletMsg wmsg ->
            ( { model | wallet = Wallet.update (Chain.chainId chain) wmsg model.wallet }
            , Cmd.none
            )

        IncomingPort value ->
${portRouting}

${updateBranches}



-- VIEW ----------------------------------------------------------------------


view : Model -> Html Msg
view model =
    Html.div [ Attr.class "app" ]
        [ Html.header [ Attr.class "app__header" ]
            [ Html.h1 [ Attr.class "app__title" ] [ Html.text "${escapeQuotes(bundles.length === 1 ? bundles[0]!.bundle.contractName : `${bundles[0]!.bundle.contractName} +${bundles.length - 1}`)}" ]
            , WalletUi.viewState []
                { onConnect = ConnectWallet
                , onSwitchChain = SwitchChain
                , onDisconnect = DisconnectWallet
                , knownChains = [ chain ]
                }
                model.wallet
            ]
        , Html.main_ [ Attr.class "app__main" ]
            [ ${tabs}
            ]
        ]



-- MAIN ----------------------------------------------------------------------


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = \\_ -> web3Sub IncomingPort
        }
`;
}

function renderTabsView(
    bundles: { bundle: VerifiedBundle; moduleName: string }[],
): string {
    const tabButtons = bundles
        .map((b) => {
            return `, Html.button
                    [ Attr.class "app__tab"
                    , Attr.classList [ ( "app__tab--active", model.activeTab == "${b.moduleName}" ) ]
                    , Events.onClick (SwitchTab "${b.moduleName}")
                    ]
                    [ Html.text "${escapeQuotes(b.bundle.contractName)}" ]`;
        })
        .join("\n                ");
    const tabPanels = bundles
        .map((b) => {
            const alias = moduleAlias(b.moduleName);
            const id = camelLower(b.moduleName);
            return `Html.div
                [ Attr.class "app__panel"
                , Attr.classList [ ( "app__panel--active", model.activeTab == "${b.moduleName}" ) ]
                ]
                [ Html.map ${b.moduleName}Msg
                    (${alias}.view ${id}Address explorerTxUrl model.${id})
                ]`;
        });
    return `Html.div [ Attr.class "app__multi" ]
            [ Html.nav [ Attr.class "app__tabs" ]
                [ ${tabButtons.replace(/^, /, "")}
                ]
            , Html.div [ Attr.class "app__panels" ]
                [ ${tabPanels.join("\n                , ")}
                ]
            ]`;
}

function camelLower(s: string): string {
    return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

function moduleAlias(moduleName: string): string {
    return moduleName;
}

function escapeQuotes(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function indent(spaces: number, s: string): string {
    const pad = " ".repeat(spaces);
    return s.split("\n").map((l) => (l.length === 0 ? l : pad + l)).join("\n");
}

/**
 * Render the nested decodePortMsg chain inside the IncomingPort branch:
 *   try contract 0 → on Nothing try contract 1 → … → on Nothing try wallet.
 *
 * Returns a block that begins at column 12 (i.e. already indented one level
 * inside the outer `case msg of` branch).
 */
function renderPortRouting(
    bundles: { bundle: VerifiedBundle; moduleName: string }[],
): string {
    const walletFallback =
        `case D.decodeValue Wallet.decoder value of
    Ok wmsg ->
        update (WalletMsg wmsg) model

    Err _ ->
        ( model, Cmd.none )`;

    let block: string = walletFallback;
    for (let i = bundles.length - 1; i >= 0; i--) {
        const b = bundles[i]!;
        const alias = moduleAlias(b.moduleName);
        block =
            `case ${alias}.decodePortMsg value of
    Just sub ->
        update (${b.moduleName}Msg sub) model

    Nothing ->
${indent(8, block)}`;
    }
    return indent(12, block);
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
                        "intrepidshape/elm-web3": "1.2.0",
                        "intrepidshape/elm-web3-ui": "1.9.0",
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
    bundles: { bundle: VerifiedBundle; moduleName: string }[],
    chain: ReturnType<typeof resolveChain>,
    outDir: string,
): void {
    const file = join(outDir, "README.md");
    if (existsSync(file)) return;
    const titleName =
        bundles.length === 1
            ? bundles[0]!.bundle.contractName
            : `${bundles[0]!.bundle.contractName} +${bundles.length - 1}`;
    const contractLines = bundles
        .map(
            (b) =>
                `- [\`${b.bundle.contractName}\`](${chain.explorer}/address/${b.bundle.address}) at \`${b.bundle.address}\``,
        )
        .join("\n");
    const moduleSafeName = bundles[0]!.moduleName;
    const content = `# ${titleName} dapp

Auto-generated by [\`@intrepidshape/dapp-gen\`](https://github.com/IntrepidShape/dapp-gen)
on ${chain.name} (chain ${chain.chainId}).

${contractLines}

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
${bundles.map((b) => `    --address ${b.bundle.address} \\`).join("\n")}
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
