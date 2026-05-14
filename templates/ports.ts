/**
 * Web3 port bridge — thin shim over the upstream library.
 *
 * The full bridge (JSON-RPC routing, EIP-6963 multi-wallet discovery,
 * EIP-1193 events, Multicall3 encoder, receipt polling, calldata
 * encoder, etc.) lives in the upstream `intrepidshape/elm-web3`
 * package and is vendored alongside this file as
 * `elm-web3-ports.js`. This wrapper just initialises the bridge,
 * wires up the wallet picker, and starts the Elm app.
 *
 * Why thin: every generated dapp gets the same battle-tested wire
 * contract for free. Anything you'd want to override (custom RPC
 * routing, alternate provider injection, additional ports) belongs
 * upstream in `elm-web3` — open a PR there, not here.
 *
 * Fork this file. Re-running `dapp-gen` does not overwrite it unless
 * you pass `--force`.
 */

import { setupPorts, watchWallets } from "./elm-web3-ports";

// The compiled Elm runtime is loaded by `<script src="./elm.js">` in
// index.html. It exposes `window.Elm` for the boot code below.
declare global {
    interface Window {
        readonly Elm: {
            readonly Main: {
                init(config: { node: HTMLElement | null }): unknown;
            };
        };
    }
}

// Optional: a fallback RPC URL for read-only mode (no wallet present).
// Leave undefined to require a wallet; supply a URL to let visitors
// browse the dapp before connecting.
const READ_ONLY_RPC: string | undefined = undefined;

const root = document.getElementById("app") ?? document.body;
// The Elm app's `ports` shape matches what setupPorts expects — we cast
// at the boundary because `Elm.Main.init` returns a runtime-typed object.
const app = window.Elm.Main.init({ node: root }) as Parameters<typeof setupPorts>[0];

setupPorts(app, READ_ONLY_RPC ? { rpcUrl: READ_ONLY_RPC } : {});
watchWallets(app);
