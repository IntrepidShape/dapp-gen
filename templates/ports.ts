/**
 * Web3 port bridge — pure pass-through.
 *
 * Translates Elm `web3Cmd` payloads to `window.ethereum` RPC calls and pipes
 * results back through `web3Sub`. This file is the *entirety* of the JS
 * surface area for a dapp built with `intrepidshape/elm-web3` 1.2+ — all
 * calldata encoding happens in Elm. **No npm runtime dependencies.** No
 * keccak. No ABI encoder. The Elm side ships the wire-ready hex; we forward
 * it.
 *
 * This file is your code — fork it. Re-running `dapp-gen` does not overwrite
 * it unless you pass `--force`.
 */

export {};

// ─── Types shared with the Elm side (wire contract) ─────────────────────────

type HexString = `0x${string}`;

/**
 * Messages sent FROM Elm TO this bridge. The shape mirrors
 * `Web3.Contract.Call.encode` / `Web3.Contract.Send.encode` /
 * `Web3.Wallet.encode` on the Elm side.
 */
type Outgoing =
    | { readonly tag: "call"; readonly id: string; readonly contract: HexString; readonly data: HexString; readonly block?: unknown; readonly from?: HexString }
    | { readonly tag: "send"; readonly id?: string; readonly contract: HexString; readonly data: HexString; readonly value?: string; readonly gasLimit?: number }
    | { readonly tag: "walletConnect" }
    | { readonly tag: "walletDisconnect" }
    | { readonly tag: "walletSwitchChain"; readonly chainId: number };

/**
 * Messages sent FROM this bridge TO Elm. The shape matches what
 * `Web3.Contract.Call.responseDecoder` / `Web3.Wallet.decoder` /
 * `Web3.Transaction.decoder` consume.
 */
type Incoming =
    | { readonly tag: "callResult"; readonly id: string; readonly result: HexString }
    | { readonly tag: "txSubmitted"; readonly id?: string; readonly hash: HexString }
    | { readonly tag: "txConfirmed"; readonly id?: string; readonly receipt: unknown }
    | { readonly tag: "txReceiptNotFound"; readonly id?: string }
    | { readonly tag: "txRejected"; readonly id?: string }
    | { readonly tag: "walletConnected"; readonly address: HexString; readonly chainId: number }
    | { readonly tag: "walletDisconnected" }
    | { readonly tag: "switchChainOk"; readonly chainId: number }
    | { readonly tag: "error"; readonly id?: string | undefined; readonly error: string };

// ─── window.Elm + window.ethereum typings ───────────────────────────────────

interface EthereumProvider {
    readonly isMetaMask?: boolean;
    request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
    on(event: string, handler: (payload: unknown) => void): void;
}

interface ElmApp {
    readonly ports: {
        readonly web3Cmd: { subscribe(handler: (value: unknown) => void): void };
        readonly web3Sub: { send(value: Incoming): void };
    };
}

declare global {
    interface Window {
        readonly Elm: {
            readonly Main: { init(opts: { node: HTMLElement }): ElmApp };
        };
        readonly ethereum?: EthereumProvider;
    }
}

// ─── Boot ───────────────────────────────────────────────────────────────────

const node = document.getElementById("app");
if (!node) throw new Error("[dapp] missing #app element in index.html");

const app = window.Elm.Main.init({ node });

app.ports.web3Cmd.subscribe((raw: unknown) => {
    void handleOutgoing(raw as Outgoing);
});

// Wallet account/chain changes — re-emit so the Elm wallet state machine
// stays consistent without polling.
window.ethereum?.on("accountsChanged", (accounts: unknown) => {
    const list = accounts as readonly HexString[];
    if (list.length === 0) {
        app.ports.web3Sub.send({ tag: "walletDisconnected" });
    }
});
window.ethereum?.on("chainChanged", (chainHex: unknown) => {
    const chainId = parseInt(chainHex as string, 16);
    app.ports.web3Sub.send({ tag: "switchChainOk", chainId });
});

// ─── Dispatch ───────────────────────────────────────────────────────────────

async function handleOutgoing(cmd: Outgoing): Promise<void> {
    const eth = window.ethereum;
    if (!eth) {
        app.ports.web3Sub.send({
            tag: "error",
            id: idOf(cmd),
            error: "no wallet detected — install MetaMask or another EIP-1193 wallet",
        });
        return;
    }
    try {
        switch (cmd.tag) {
            case "walletConnect":
                await handleConnect(eth);
                return;
            case "walletDisconnect":
                app.ports.web3Sub.send({ tag: "walletDisconnected" });
                return;
            case "walletSwitchChain":
                await handleSwitchChain(eth, cmd.chainId);
                return;
            case "call":
                await handleCall(eth, cmd);
                return;
            case "send":
                await handleSend(eth, cmd);
                return;
        }
    } catch (e) {
        const err = e as { code?: number; message?: string };
        if (err.code === 4001) {
            app.ports.web3Sub.send({ tag: "txRejected", id: idOf(cmd) });
            return;
        }
        app.ports.web3Sub.send({
            tag: "error",
            id: idOf(cmd),
            error: err.message ?? String(e),
        });
    }
}

function idOf(cmd: Outgoing): string | undefined {
    return "id" in cmd ? cmd.id : undefined;
}

// ─── Wallet ─────────────────────────────────────────────────────────────────

async function handleConnect(eth: EthereumProvider): Promise<void> {
    const accounts = (await eth.request({
        method: "eth_requestAccounts",
    })) as readonly HexString[];
    const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
    const address = accounts[0];
    if (!address) throw new Error("wallet returned no accounts");
    app.ports.web3Sub.send({
        tag: "walletConnected",
        address,
        chainId: parseInt(chainHex, 16),
    });
}

async function handleSwitchChain(eth: EthereumProvider, chainId: number): Promise<void> {
    const target = `0x${chainId.toString(16)}` as const;
    await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: target }],
    });
    app.ports.web3Sub.send({ tag: "switchChainOk", chainId });
}

// ─── Read / Write — pass-through ────────────────────────────────────────────

async function handleCall(
    eth: EthereumProvider,
    cmd: Extract<Outgoing, { tag: "call" }>,
): Promise<void> {
    const params: Record<string, unknown> = { to: cmd.contract, data: cmd.data };
    if (cmd.from) params["from"] = cmd.from;
    const result = (await eth.request({
        method: "eth_call",
        params: [params, "latest"],
    })) as HexString;
    app.ports.web3Sub.send({ tag: "callResult", id: cmd.id, result });
}

async function handleSend(
    eth: EthereumProvider,
    cmd: Extract<Outgoing, { tag: "send" }>,
): Promise<void> {
    const accounts = (await eth.request({
        method: "eth_accounts",
    })) as readonly HexString[];
    const from = accounts[0];
    if (!from) throw new Error("wallet not connected");

    const params: Record<string, unknown> = {
        from,
        to: cmd.contract,
        data: cmd.data,
    };
    if (cmd.value && cmd.value !== "0") {
        params["value"] = `0x${BigInt(cmd.value).toString(16)}`;
    }
    if (typeof cmd.gasLimit === "number") {
        params["gas"] = `0x${cmd.gasLimit.toString(16)}`;
    }

    const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [params],
    })) as HexString;

    app.ports.web3Sub.send({ tag: "txSubmitted", id: cmd.id, hash });
    void pollReceipt(eth, hash, cmd.id);
}

async function pollReceipt(
    eth: EthereumProvider,
    hash: HexString,
    id: string | undefined,
): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt++) {
        await sleep(2000);
        try {
            const r = await eth.request({
                method: "eth_getTransactionReceipt",
                params: [hash],
            });
            if (r) {
                app.ports.web3Sub.send({ tag: "txConfirmed", id, receipt: r });
                return;
            }
        } catch {
            // transient — keep polling
        }
    }
    app.ports.web3Sub.send({ tag: "txReceiptNotFound", id });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
