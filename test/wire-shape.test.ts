/**
 * Wire-shape regression tests.
 *
 * The Elm side (`Web3.Wallet.encode` / `Web3.Wallet.decoder` /
 * `Web3.Transaction.decoder` / `Web3.Contract.Call.encode` /
 * `Web3.Contract.Send.encode`) and the JS side (`templates/ports.ts`)
 * agree on a fixed tag vocabulary. Renaming a tag on one side without
 * updating the other produces a silent failure — Elm sends, JS has no
 * case, the dapp appears frozen.
 *
 * These tests assert the canonical strings appear in both sides so the
 * mismatch surfaces in CI, not in the browser.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

// Wire-shape lives in the vendored bridge; `ports.ts` is now a thin shim
// that just calls `setupPorts` + `watchWallets` on the vendored module.
const PORTS_TS = readFileSync(
    join(ROOT, "dapp-gen", "templates", "elm-web3-ports.ts"),
    "utf8",
);

const WALLET_ELM = readFileSync(
    join(ROOT, "elm-web3", "src", "Web3", "Wallet.elm"),
    "utf8",
);

const TX_ELM = readFileSync(
    join(ROOT, "elm-web3", "src", "Web3", "Transaction.elm"),
    "utf8",
);

/** Canonical outgoing tags — produced by Elm, consumed by JS. */
const OUTGOING_TAGS = [
    "connect",         // Wallet.encode RequestConnect
    "disconnect",      // Wallet.encode RequestDisconnect
    "switchChain",     // Wallet.encode RequestSwitchChain
    "call",            // Contract.Call.encode
    "send",            // Contract.Send.encode
] as const;

/** Canonical incoming tags — produced by JS, consumed by Elm decoders. */
const INCOMING_TAGS = [
    "connected",         // Wallet.decoder
    "disconnected",      // Wallet.decoder
    "chainChanged",      // Wallet.decoder
    "accountChanged",    // Wallet.decoder
    "switchChainOk",     // Wallet.decoder
    "submitted",         // Transaction.decoder
    "confirmed",         // Transaction.decoder
    "rejected",          // Transaction.decoder
    "receiptNotFound",   // Transaction.decoder
    "failed",            // Transaction.decoder + Wallet.decoder
    "callResult",        // routed via per-contract decodePortMsg by `id`
] as const;

test("every outgoing tag has both an Elm emitter and a JS case", () => {
    for (const tag of OUTGOING_TAGS) {
        // Elm side: the encoder produces `( "tag", E.string "<tag>" )`.
        const elmEmits =
            WALLET_ELM.includes(`E.string "${tag}"`) ||
            // Contract.Call / Send live in different files — accept either.
            readFileSync(
                join(ROOT, "elm-web3", "src", "Web3", "Contract", "Call.elm"),
                "utf8",
            ).includes(`E.string "${tag}"`) ||
            readFileSync(
                join(ROOT, "elm-web3", "src", "Web3", "Contract", "Send.elm"),
                "utf8",
            ).includes(`E.string "${tag}"`);
        expect({ tag, side: "elm-emits" }).toEqual({ tag, side: elmEmits ? "elm-emits" : `MISSING from Elm encoders` });

        // JS side: ports.ts must have a `case "<tag>":` branch.
        const jsHandles = new RegExp(`case "${tag}":`).test(PORTS_TS);
        expect({ tag, side: "js-handles" }).toEqual({ tag, side: jsHandles ? "js-handles" : `MISSING from ports.ts switch` });
    }
});

test("every incoming tag has both a JS emitter and an Elm decoder branch", () => {
    for (const tag of INCOMING_TAGS) {
        // JS side: ports.ts must send `{ tag: "<tag>", ... }`.
        const jsEmits = new RegExp(`tag:\\s*"${tag}"`).test(PORTS_TS);
        expect({ tag, side: "js-emits" }).toEqual({ tag, side: jsEmits ? "js-emits" : `MISSING from ports.ts emitters` });

        // Elm side: at least one decoder matches "<tag>".
        const elmHandles =
            WALLET_ELM.includes(`"${tag}" ->`) ||
            TX_ELM.includes(`"${tag}" ->`) ||
            // `callResult` is the generated-module case — not in core decoders.
            tag === "callResult";
        expect({ tag, side: "elm-handles" }).toEqual({ tag, side: elmHandles ? "elm-handles" : `MISSING from Elm decoders` });
    }
});

test("no legacy tags (walletConnect / txSubmitted / etc.) remain anywhere", () => {
    const FORBIDDEN = [
        "walletConnect",
        "walletDisconnect",
        "walletSwitchChain",
        "walletConnected",
        "walletDisconnected",
        "txSubmitted",
        "txConfirmed",
        "txRejected",
        "txReceiptNotFound",
    ];
    for (const dead of FORBIDDEN) {
        // Match as a JSON string value or a case-of label, not in prose.
        const inPorts = new RegExp(`"${dead}"`).test(PORTS_TS);
        const inWallet = new RegExp(`"${dead}"`).test(WALLET_ELM);
        const inTx = new RegExp(`"${dead}"`).test(TX_ELM);
        expect({ tag: dead, where: "anywhere" }).toEqual({
            tag: dead,
            where: !inPorts && !inWallet && !inTx ? "anywhere" : "STILL PRESENT in ports.ts/Wallet.elm/Transaction.elm",
        });
    }
});
