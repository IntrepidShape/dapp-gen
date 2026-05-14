/**
 * Minimal Web3 port bridge for the generated dapp.
 *
 * Maps Elm `web3Cmd` payloads to the right `window.ethereum` call (eth_call,
 * eth_sendTransaction, wallet_connect, etc.) and re-emits results into
 * `web3Sub` keyed by the call's `id` field. Generated UI modules expect this
 * exact shape.
 *
 * This is your code — fork freely. For a production-grade bridge (EIP-6963
 * wallet discovery, multi-wallet support, watchAsset, addChain, etc.) see
 * `intrepidshape/elm-web3/js/elm-web3-ports.js`.
 */

declare global {
    interface Window {
        Elm: {
            Main: {
                init: (opts: { node: HTMLElement }) => {
                    ports: {
                        web3Cmd: { subscribe: (handler: (v: unknown) => void) => void };
                        web3Sub: { send: (v: unknown) => void };
                    };
                };
            };
        };
        ethereum?: EthereumProvider;
    }
}

interface EthereumProvider {
    isMetaMask?: boolean;
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (event: string, handler: (...args: unknown[]) => void) => void;
}

const node = document.getElementById("app");
if (!node) throw new Error("missing #app node in index.html");

const app = window.Elm.Main.init({ node });

interface OutgoingCall {
    tag: "call" | "send" | "walletConnect" | "walletDisconnect" | "walletSwitchChain";
    id?: string;
    contract?: string;
    method?: string;
    args?: unknown[];
    value?: string;
    chainId?: number;
}

app.ports.web3Cmd.subscribe(async (raw) => {
    const cmd = raw as OutgoingCall;
    const eth = window.ethereum;
    if (!eth) {
        app.ports.web3Sub.send({ tag: "error", id: cmd.id, error: "no wallet detected" });
        return;
    }
    try {
        switch (cmd.tag) {
            case "walletConnect": {
                const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
                const chainHex = (await eth.request({ method: "eth_chainId" })) as string;
                app.ports.web3Sub.send({
                    tag: "walletConnected",
                    address: accounts[0],
                    chainId: parseInt(chainHex, 16),
                });
                break;
            }
            case "walletDisconnect":
                app.ports.web3Sub.send({ tag: "walletDisconnected" });
                break;
            case "walletSwitchChain": {
                const target = "0x" + (cmd.chainId ?? 0).toString(16);
                await eth.request({
                    method: "wallet_switchEthereumChain",
                    params: [{ chainId: target }],
                });
                app.ports.web3Sub.send({ tag: "switchChainOk", chainId: cmd.chainId });
                break;
            }
            case "call": {
                const result = await eth.request({
                    method: "eth_call",
                    params: [
                        {
                            to: cmd.contract,
                            data: encodeCallData(cmd.method ?? "", cmd.args ?? []),
                        },
                        "latest",
                    ],
                });
                app.ports.web3Sub.send({ tag: "callResult", id: cmd.id, result });
                break;
            }
            case "send": {
                const from = ((await eth.request({ method: "eth_accounts" })) as string[])[0];
                const hash = (await eth.request({
                    method: "eth_sendTransaction",
                    params: [
                        {
                            from,
                            to: cmd.contract,
                            data: encodeCallData(cmd.method ?? "", cmd.args ?? []),
                            value:
                                cmd.value && cmd.value !== "0"
                                    ? "0x" + BigInt(cmd.value).toString(16)
                                    : undefined,
                        },
                    ],
                })) as string;
                app.ports.web3Sub.send({ tag: "txSubmitted", id: cmd.id, hash });
                pollReceipt(eth, hash, cmd.id);
                break;
            }
            default:
                console.warn("unhandled port cmd", cmd);
        }
    } catch (e) {
        const err = e as { code?: number; message?: string };
        if (err.code === 4001) {
            app.ports.web3Sub.send({ tag: "txRejected", id: cmd.id });
        } else {
            app.ports.web3Sub.send({
                tag: "error",
                id: cmd.id,
                error: err.message ?? String(e),
            });
        }
    }
});

async function pollReceipt(
    eth: EthereumProvider,
    hash: string,
    id: string | undefined,
): Promise<void> {
    for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
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
            // ignore intermittent
        }
    }
    app.ports.web3Sub.send({ tag: "txReceiptNotFound", id });
}

/**
 * Minimal calldata encoder — Elm has already encoded args to hex via
 * `Web3.Abi.Encode` and shipped them in `cmd.args`. We just pack the
 * 4-byte selector + concatenated args. This handles the common ERC-20
 * shape; for tuples / arrays the Elm side emits already-padded slots.
 */
function encodeCallData(methodSig: string, args: unknown[]): string {
    const selector = methodSelector(methodSig);
    const tail = args
        .map((a) => (typeof a === "string" ? stripHex(a) : ""))
        .map(padSlot)
        .join("");
    return "0x" + selector + tail;
}

function methodSelector(sig: string): string {
    // keccak256 of the signature, first 4 bytes. We delegate to the wallet's
    // built-in by computing client-side via a tiny embedded keccak. For Phase 1
    // we ship a no-op stub — the generated dapp will rely on either the JS
    // bridge having a keccak helper, or on the Elm side providing pre-encoded
    // selectors. Replace this with a real keccak (e.g. via `@noble/hashes`)
    // when forking.
    return keccak4(sig);
}

function keccak4(_sig: string): string {
    // Placeholder. Drop in a keccak256 implementation here.
    return "00000000";
}

function stripHex(s: string): string {
    return s.startsWith("0x") ? s.slice(2) : s;
}

function padSlot(hex: string): string {
    return hex.length >= 64 ? hex : hex.padStart(64, "0");
}
