# dapp-gen

Pull a verified smart contract from any EVM chain. Get back a working, type-safe Elm dapp you own and can fork.

```sh
bunx @intrepidshape/dapp-gen \
    --chain ethereum \
    --address 0x6B175474E89094C44Da98b954EedeAC495271d0F \
    --out ./dai-dapp

cd ./dai-dapp
elm make src/Main.elm --output=elm.js
bun --hot index.html
```

The output is a complete, runnable dapp: wallet-connected, one read/write form per contract function, zero runtime exceptions. Your code, your tree, no black box.

## Why

React-based dapp scaffolds (wagmi-codegen, scaffold-eth, create-web3-dapp) lose ABI typing at the wallet-result decoder — somewhere there's always an `any` or an `as`. Elm doesn't have that escape hatch, so the generated code is *actually* type-safe end-to-end. The Elm compiler refuses to let you mix up an `Address` with a `bytes32`, or forget a `Tx.Status` branch in the UI.

What you get:

- **Type-safe contract calls** from `intrepidshape/elm-web3` — typed wrappers generated from the ABI.
- **Type-safe rendering** from `intrepidshape/elm-web3-ui` — every function rendered through `ContractRead`/`ContractWrite`/`AbiInput` primitives that enforce the lifecycle at compile time.
- **No JS framework**. No React, no Next.js, no Vite, no Webpack. The runtime is ~20 KB of compiled Elm.
- **Forkable**. The output is plain readable Elm. You edit it. Re-running `dapp-gen` overwrites `src/Generated/**` but never touches your `Main.elm` (unless you pass `--force`).

## What gets generated

```
my-dapp/
├── elm.json                                 # pins elm-web3 + elm-web3-ui
├── index.html
├── ports.ts                                 # Web3 port bridge — replace stub keccak before shipping
├── style.css                                # baseline; replace freely
├── README.md
└── src/
    ├── Main.elm                             # your code — wallet + composition
    └── Generated/
        ├── Contracts/<Name>.elm             # typed encoders/decoders/wrappers (from elm-web3 codegen)
        └── Views/<Name>.elm                 # auto-generated UI (read/write/event forms)
```

## Status (0.2.0)

| Capability | Status |
|---|---|
| Sourcify fetch (every chain Sourcify supports) | ✅ |
| Etherscan-family fallback (mainnet, Sepolia, Base, Arbitrum, Optimism, Polygon, PulseChain Blockscout) | ✅ |
| Solidity types: `address` `uint*` `int*` `bool` `string` `bytes` `bytesN` | ✅ |
| Solidity types: `T[]` `T[N]` `tuple` (recursive) | ✅ typed inputs; honest slot-aware decoders for scalar returns; dynamic returns fall back to raw hex (replace by fork) |
| `view` / `pure` reads with typed result panel + slot-aware decoder | ✅ |
| `nonpayable` / `payable` writes through `Tx.Status` state machine | ✅ |
| Multi-contract output (e.g. factory + child) — repeat `--address` | ✅ |
| Standard detection (ERC-20 / 721 / 1155 / 4626) — visible in CLI output | ✅ classifier; polished-view swap is a follow-up |
| Pure-Elm calldata encoding — zero JS runtime deps | ✅ (uses `Web3.Abi.Calldata` 1.2.0+) |
| Events / log subscriptions | ⏳ follow-up — generic auto-view does not yet ship event renderers |
| Polished-view swap when standard is detected (uses `Web3.Ui.Wallet` / `Balance` / etc.) | ⏳ follow-up — generic auto-views ship today |

## Supported chains

`pulsechain`, `pulsechain-testnet`, `ethereum`, `sepolia`. Adding more is one line in `src/chains.ts` plus the matching `Chain` value in [`intrepidshape/elm-web3`](https://github.com/IntrepidShape/elm-web3).

## Flags

| Flag | Required | Notes |
|---|---|---|
| `--chain <slug>` | yes | One of the supported chains above |
| `--address <0x…>` | yes | The verified contract address |
| `--out <dir>` | yes | Output directory (created if missing) |
| `--force` |  | Overwrite `Main.elm` / `ports.ts` / `style.css` (default: keep) |
| `--no-contracts-module` |  | Skip the typed wrappers; emit only the UI module |
| `-h` / `--help` |  |  |

## Caching

Each fetch is persisted under `<out>/.dapp-gen/cache/<chainId>/<addr>.json`. Re-runs against the same address are offline-fast and skip the network. Delete the file to force a refresh.

## Made by

[Intrepid Development](https://intrepiddev.com.au) — Solidity team. Dapps, contracts, audits.

We write the contracts and the frontends that talk to them. They deserve the same rigour. This tool is what we use to spin up the dapp side of an engagement.

If you want it wired into a production dapp, or the dapp side hardened alongside a contract engagement: [Jake@intrepiddev.com.au](mailto:Jake@intrepiddev.com.au).

## License

MIT.
