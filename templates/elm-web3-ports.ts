/**
 * elm-web3-ports.ts — vendored wallet bridge.
 *
 * The entire JS surface area for a dapp built with `intrepidshape/elm-web3`.
 * All calldata encoding happens in Elm; this file is a typed pass-through
 * for JSON-RPC + EIP-1193 events + EIP-6963 multi-wallet discovery.
 *
 * Re-running `dapp-gen` overwrites this file. Don't hand-edit — open a PR
 * against `intrepidshape/elm-web3` instead. The `.ts` is the source; the
 * bundled `.js` is built output via `bun build ports.ts → ports.js`.
 *
 * Usage:
 *   import { setupPorts, watchWallets } from "./elm-web3-ports.ts";
 *   const app = window.Elm.Main.init({ node });
 *   setupPorts(app, { rpcUrl });
 *   watchWallets(app);
 */

// ─── Types — Elm bridge contract ──────────────────────────────────────────

type HexString = `0x${string}`;

interface ElmPort<T> {
    subscribe(handler: (msg: T) => void): void;
    send(msg: unknown): void;
}

interface ElmApp {
    readonly ports: {
        readonly web3Cmd: ElmPort<Outgoing>;
        readonly web3Sub: ElmPort<Incoming>;
    };
}

interface Eip1193Provider {
    request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
    on(event: string, handler: (...args: readonly unknown[]) => void): void;
    removeListener?(event: string, handler: (...args: readonly unknown[]) => void): void;
}

interface Eip6963ProviderInfo {
    readonly uuid: string;
    readonly name: string;
    readonly icon: string;
    readonly rdns: string;
}

interface Eip6963AnnounceEvent extends CustomEvent {
    readonly detail: {
        readonly info: Eip6963ProviderInfo;
        readonly provider: Eip1193Provider;
    };
}


// ─── Wire-format messages ─────────────────────────────────────────────────

type Outgoing =
    | { readonly tag: "connect" }
    | { readonly tag: "disconnect" }
    | { readonly tag: "switchChain"; readonly chainId: number }
    | { readonly tag: "selectWallet"; readonly rdns: string }
    | { readonly tag: "addChain"; readonly chainId: number; readonly chainName: string;
        readonly rpcUrls: readonly string[]; readonly nativeCurrency: NativeCurrency;
        readonly blockExplorerUrls?: readonly string[] }
    | { readonly tag: "call"; readonly id: string; readonly contract: HexString;
        readonly method?: string; readonly args?: readonly unknown[];
        readonly data?: HexString; readonly block?: string | number;
        readonly from?: HexString }
    | { readonly tag: "send"; readonly id?: string; readonly contract: HexString;
        readonly method?: string; readonly args?: readonly unknown[];
        readonly data?: HexString; readonly value?: string; readonly gasLimit?: number }
    | { readonly tag: "estimateGas"; readonly contract: HexString;
        readonly method?: string; readonly args?: readonly unknown[];
        readonly data?: HexString; readonly value?: string }
    | { readonly tag: "multicall"; readonly id: string;
        readonly calls: readonly { readonly contract: HexString; readonly method: string;
            readonly args: readonly unknown[] }[] }
    | { readonly tag: "watchEvent"; readonly contract: HexString;
        readonly topics?: readonly (string | readonly string[] | null)[] }
    | { readonly tag: "getBalance"; readonly id: string; readonly address: HexString;
        readonly block?: string }
    | { readonly tag: "personalSign"; readonly id: string; readonly message: string;
        readonly from: HexString }
    | { readonly tag: "signTypedData"; readonly id: string;
        readonly from: HexString; readonly data: unknown }
    | { readonly tag: "getBlockNumber"; readonly id: string }
    | { readonly tag: "getBlock"; readonly id: string; readonly block: number | string }
    | { readonly tag: "watchBlockNumber"; readonly id: string }
    | { readonly tag: "getTransactionCount"; readonly id: string; readonly address: HexString }
    | { readonly tag: "getStorageAt"; readonly id: string; readonly contract: HexString;
        readonly slot: HexString; readonly block?: string }
    | { readonly tag: "getCode"; readonly id: string; readonly contract: HexString;
        readonly block?: string }
    | { readonly tag: "getGasPrice"; readonly id: string }
    | { readonly tag: "getFeeHistory"; readonly id: string; readonly blockCount: number }
    | { readonly tag: "getTransactionReceipt"; readonly id: string; readonly hash: HexString }
    | { readonly tag: "getLogs"; readonly contract: HexString;
        readonly fromBlock: number | string; readonly toBlock: number | string;
        readonly topics?: readonly (string | null)[] }
    | { readonly tag: "getTransaction"; readonly id: string; readonly hash: HexString }
    | { readonly tag: "deploy"; readonly bytecode: HexString;
        readonly args?: readonly string[]; readonly value?: string;
        readonly gasLimit?: number }
    | { readonly tag: "sendRawTransaction"; readonly rawTx: HexString }
    | { readonly tag: "watchAsset"; readonly address: HexString;
        readonly symbol: string; readonly decimals: number; readonly image?: string }
    | { readonly tag: "requestPermissions" }
    | { readonly tag: "getPermissions" }
    | { readonly tag: "getBlockTransactionCount"; readonly id: string;
        readonly block: number | string }
    | { readonly tag: "keccak256"; readonly id: string; readonly message: string };

interface NativeCurrency {
    readonly name: string;
    readonly symbol: string;
    readonly decimals: number;
}

type Incoming =
    | { readonly tag: "connected"; readonly address: HexString; readonly chainId: number }
    | { readonly tag: "disconnected" }
    | { readonly tag: "readOnly" }
    | { readonly tag: "chainChanged"; readonly chainId: number }
    | { readonly tag: "accountChanged"; readonly address: HexString }
    | { readonly tag: "switchChainOk"; readonly chainId: number }
    | { readonly tag: "chainAdded" }
    | { readonly tag: "callResult"; readonly id: string; readonly data: HexString }
    | { readonly tag: "submitted"; readonly hash: HexString }
    | { readonly tag: "confirmation"; readonly hash: HexString; readonly count: number }
    | { readonly tag: "confirmed"; readonly hash: HexString;
        readonly blockNumber: number; readonly gasUsed: string;
        readonly status: boolean; readonly logs: readonly EventLog[] }
    | { readonly tag: "rejected" }
    | { readonly tag: "failed"; readonly error: string; readonly revertData?: HexString }
    | { readonly tag: "receiptNotFound"; readonly id: string }
    | { readonly tag: "receiptResult"; readonly id: string; readonly hash: HexString;
        readonly blockNumber: number; readonly gasUsed: string; readonly status: boolean;
        readonly logs: readonly EventLog[] }
    | { readonly tag: "gasEstimate"; readonly gas: string }
    | { readonly tag: "multicallResult"; readonly id: string;
        readonly results: readonly { readonly success: boolean; readonly data: HexString }[] }
    | { readonly tag: "eventLog"; readonly contract: HexString; readonly data: HexString;
        readonly topics: readonly string[]; readonly blockNumber: number;
        readonly txHash: HexString; readonly logIndex: number }
    | { readonly tag: "logs"; readonly logs: readonly EventLog[] }
    | { readonly tag: "balance"; readonly id: string; readonly wei: string }
    | { readonly tag: "signed"; readonly id: string; readonly signature: HexString }
    | { readonly tag: "walletsDiscovered"; readonly wallets: readonly DiscoveredWallet[] }
    | { readonly tag: "blockNumber"; readonly id: string; readonly number: number }
    | { readonly tag: "block"; readonly id: string; readonly number: number;
        readonly hash: HexString; readonly timestamp: number; readonly gasLimit: string;
        readonly gasUsed: string; readonly baseFeePerGas: string | null;
        readonly parentHash: HexString }
    | { readonly tag: "txCount"; readonly id: string; readonly count: number }
    | { readonly tag: "storageAt"; readonly id: string; readonly data: HexString }
    | { readonly tag: "code"; readonly id: string; readonly data: HexString }
    | { readonly tag: "gasPrice"; readonly id: string; readonly wei: string }
    | { readonly tag: "feeHistory"; readonly id: string;
        readonly baseFeePerGas: readonly string[]; readonly gasUsedRatio: readonly number[];
        readonly oldestBlock: number }
    | { readonly tag: "transaction"; readonly id: string; readonly hash: HexString;
        readonly from: HexString; readonly to: HexString | null; readonly value: string;
        readonly nonce: number; readonly data: HexString; readonly gas: number;
        readonly blockNumber: number | null; readonly blockHash: HexString | null }
    | { readonly tag: "transactionNotFound"; readonly id: string }
    | { readonly tag: "assetWatched" }
    | { readonly tag: "permissions"; readonly permissions: readonly string[] }
    | { readonly tag: "blockTxCount"; readonly id: string; readonly count: number }
    | { readonly tag: "keccak256Result"; readonly id: string; readonly hash: HexString }
    | { readonly tag: "unknownCmd"; readonly cmd: string };

interface EventLog {
    readonly address: HexString;
    readonly topics: readonly string[];
    readonly data: HexString;
    readonly blockNumber: number;
    readonly logIndex: number;
}

interface DiscoveredWallet {
    readonly name: string;
    readonly icon: string;
    readonly rdns: string;
}

declare global {
    interface Window {
        ethereum?: Eip1193Provider;
    }
}


// ─── EIP-6963 provider registry ───────────────────────────────────────────

const eip6963Providers = new Map<
    string,
    { readonly info: Eip6963ProviderInfo; readonly provider: Eip1193Provider }
>();


// ─── setupPorts: main entry point ─────────────────────────────────────────

export interface SetupOptions {
    readonly rpcUrl?: string;
}

export function setupPorts(app: ElmApp, options: SetupOptions = {}): void {
    const rpcUrl = options.rpcUrl;
    let rpcId = 0;

    async function rpcRequest(
        method: string,
        params: readonly unknown[] = [],
    ): Promise<unknown> {
        if (rpcUrl !== undefined) {
            const res = await fetch(rpcUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
            });
            const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
            if (json.error) {
                throw new Error(json.error.message ?? JSON.stringify(json.error));
            }
            return json.result;
        }
        if (!window.ethereum) throw new Error("No wallet found");
        return window.ethereum.request({ method, params });
    }

    if (rpcUrl !== undefined) {
        // Defer one tick so the Elm app has subscribed before we push.
        setTimeout(() => {
            if (!window.ethereum) app.ports.web3Sub.send({ tag: "readOnly" });
        }, 0);
    }

    app.ports.web3Cmd.subscribe(async (cmd) => {
        try {
            await handle(cmd, app, rpcRequest);
        } catch (e) {
            sendError(app, e);
        }
    });

    // Wallet events on the currently-active provider.
    if (window.ethereum) {
        attachWalletListeners(window.ethereum, app);
    }
}


async function handle(
    cmd: Outgoing,
    app: ElmApp,
    rpc: (method: string, params?: readonly unknown[]) => Promise<unknown>,
): Promise<void> {
    switch (cmd.tag) {
        case "connect": {
            if (!window.ethereum) throw new Error("No wallet found");
            const accounts = (await window.ethereum.request({
                method: "eth_requestAccounts",
            })) as readonly HexString[];
            if (accounts.length === 0) throw new Error("Wallet returned no accounts");
            const chainHex = (await window.ethereum.request({ method: "eth_chainId" })) as HexString;
            app.ports.web3Sub.send({
                tag: "connected",
                address: accounts[0]!,
                chainId: Number.parseInt(chainHex, 16),
            });
            return;
        }

        case "disconnect": {
            app.ports.web3Sub.send({ tag: "disconnected" });
            return;
        }

        case "switchChain": {
            if (!window.ethereum) throw new Error("No wallet found");
            const hex = `0x${cmd.chainId.toString(16)}`;
            await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: hex }],
            });
            app.ports.web3Sub.send({ tag: "switchChainOk", chainId: cmd.chainId });
            return;
        }

        case "selectWallet": {
            const found = eip6963Providers.get(cmd.rdns);
            if (!found) throw new Error(`Wallet not found: ${cmd.rdns}`);
            const accounts = (await found.provider.request({
                method: "eth_requestAccounts",
            })) as readonly HexString[];
            if (accounts.length === 0) throw new Error("Wallet returned no accounts");
            const chainHex = (await found.provider.request({
                method: "eth_chainId",
            })) as HexString;
            // Swap the active provider so subsequent calls route to it.
            window.ethereum = found.provider;
            attachWalletListeners(found.provider, app);
            app.ports.web3Sub.send({
                tag: "connected",
                address: accounts[0]!,
                chainId: Number.parseInt(chainHex, 16),
            });
            return;
        }

        case "addChain": {
            if (!window.ethereum) throw new Error("No wallet found");
            await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [
                    {
                        chainId: `0x${cmd.chainId.toString(16)}`,
                        chainName: cmd.chainName,
                        rpcUrls: cmd.rpcUrls,
                        nativeCurrency: cmd.nativeCurrency,
                        blockExplorerUrls: cmd.blockExplorerUrls ?? [],
                    },
                ],
            });
            app.ports.web3Sub.send({ tag: "chainAdded" });
            return;
        }

        case "call": {
            const data = cmd.data ?? encodeCall(cmd.method ?? "", cmd.args ?? []);
            const callTx: { to: HexString; data: HexString; from?: HexString } = {
                to: cmd.contract,
                data,
            };
            if (cmd.from) callTx.from = cmd.from;
            const result = (await rpc("eth_call", [callTx, cmd.block ?? "latest"])) as HexString;
            app.ports.web3Sub.send({ tag: "callResult", id: cmd.id, data: result });
            return;
        }

        case "estimateGas": {
            if (!window.ethereum) throw new Error("No wallet found");
            const accounts = (await window.ethereum.request({
                method: "eth_accounts",
            })) as readonly HexString[];
            const data = cmd.data ?? encodeCall(cmd.method ?? "", cmd.args ?? []);
            const txParams: TxParams = {
                from: accounts[0]!,
                to: cmd.contract,
                data,
            };
            if (cmd.value) txParams.value = `0x${BigInt(cmd.value).toString(16)}`;
            const gasHex = (await window.ethereum.request({
                method: "eth_estimateGas",
                params: [txParams],
            })) as HexString;
            app.ports.web3Sub.send({
                tag: "gasEstimate",
                gas: Number.parseInt(gasHex, 16).toString(),
            });
            return;
        }

        case "send": {
            if (!window.ethereum) throw new Error("No wallet found");
            const accounts = (await window.ethereum.request({
                method: "eth_accounts",
            })) as readonly HexString[];
            const data = cmd.data ?? encodeCall(cmd.method ?? "", cmd.args ?? []);
            const txParams: TxParams = {
                from: accounts[0]!,
                to: cmd.contract,
                data,
            };
            if (cmd.value) txParams.value = `0x${BigInt(cmd.value).toString(16)}`;
            if (cmd.gasLimit) txParams.gas = `0x${cmd.gasLimit.toString(16)}`;
            const hash = (await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [txParams],
            })) as HexString;
            app.ports.web3Sub.send({ tag: "submitted", hash });
            pollReceipt(hash, app, rpc);
            return;
        }

        case "multicall": {
            const callDatas = cmd.calls.map((c) => encodeCall(c.method, c.args));
            const data = encodeAggregate3(cmd.calls, callDatas);
            const raw = (await rpc("eth_call", [
                { to: MULTICALL3, data },
                "latest",
            ])) as HexString;
            const results = decodeAggregate3Result(raw);
            app.ports.web3Sub.send({ tag: "multicallResult", id: cmd.id, results });
            return;
        }

        case "watchEvent": {
            const startHex = (await rpc("eth_blockNumber", [])) as HexString;
            let fromBlock = Number.parseInt(startHex, 16);
            setInterval(async () => {
                try {
                    const toHex = (await rpc("eth_blockNumber", [])) as HexString;
                    const toBlock = Number.parseInt(toHex, 16);
                    if (toBlock < fromBlock) return;
                    const filter: LogFilter = {
                        address: cmd.contract,
                        fromBlock: `0x${fromBlock.toString(16)}`,
                        toBlock: toHex,
                    };
                    if (cmd.topics && cmd.topics.length > 0) {
                        filter.topics = cmd.topics;
                    }
                    const logs = (await rpc("eth_getLogs", [filter])) as readonly RawLog[];
                    for (const log of logs) {
                        app.ports.web3Sub.send({
                            tag: "eventLog",
                            contract: cmd.contract,
                            data: log.data,
                            topics: log.topics ?? [],
                            blockNumber: Number.parseInt(log.blockNumber, 16),
                            txHash: log.transactionHash,
                            logIndex: Number.parseInt(log.logIndex, 16),
                        });
                    }
                    fromBlock = toBlock + 1;
                } catch {
                    // Soft-fail: keep polling on transient RPC errors.
                }
            }, 4_000);
            return;
        }

        case "getBalance": {
            const hex = (await rpc("eth_getBalance", [
                cmd.address,
                cmd.block ?? "latest",
            ])) as HexString;
            app.ports.web3Sub.send({
                tag: "balance",
                id: cmd.id,
                wei: BigInt(hex).toString(),
            });
            return;
        }

        case "personalSign": {
            if (!window.ethereum) throw new Error("No wallet found");
            const sig = (await window.ethereum.request({
                method: "personal_sign",
                params: [cmd.message, cmd.from],
            })) as HexString;
            app.ports.web3Sub.send({ tag: "signed", id: cmd.id, signature: sig });
            return;
        }

        case "signTypedData": {
            if (!window.ethereum) throw new Error("No wallet found");
            const sig = (await window.ethereum.request({
                method: "eth_signTypedData_v4",
                params: [cmd.from, JSON.stringify(cmd.data)],
            })) as HexString;
            app.ports.web3Sub.send({ tag: "signed", id: cmd.id, signature: sig });
            return;
        }

        case "getBlockNumber": {
            const hex = (await rpc("eth_blockNumber", [])) as HexString;
            app.ports.web3Sub.send({
                tag: "blockNumber",
                id: cmd.id,
                number: Number.parseInt(hex, 16),
            });
            return;
        }

        case "getBlock": {
            const block = (await rpc("eth_getBlockByNumber", [
                blockNumberToHex(cmd.block),
                false,
            ])) as RawBlock;
            app.ports.web3Sub.send({
                tag: "block",
                id: cmd.id,
                number: Number.parseInt(block.number, 16),
                hash: block.hash,
                timestamp: Number.parseInt(block.timestamp, 16),
                gasLimit: BigInt(block.gasLimit).toString(),
                gasUsed: BigInt(block.gasUsed).toString(),
                baseFeePerGas: block.baseFeePerGas ? BigInt(block.baseFeePerGas).toString() : null,
                parentHash: block.parentHash,
            });
            return;
        }

        case "watchBlockNumber": {
            const poll = async (): Promise<void> => {
                try {
                    const hex = (await rpc("eth_blockNumber", [])) as HexString;
                    app.ports.web3Sub.send({
                        tag: "blockNumber",
                        id: cmd.id,
                        number: Number.parseInt(hex, 16),
                    });
                } catch {
                    // soft-fail
                }
            };
            void poll();
            setInterval(poll, 4_000);
            return;
        }

        case "getTransactionCount": {
            const hex = (await rpc("eth_getTransactionCount", [
                cmd.address,
                "latest",
            ])) as HexString;
            app.ports.web3Sub.send({
                tag: "txCount",
                id: cmd.id,
                count: Number.parseInt(hex, 16),
            });
            return;
        }

        case "getStorageAt": {
            const val = (await rpc("eth_getStorageAt", [
                cmd.contract,
                cmd.slot,
                cmd.block ?? "latest",
            ])) as HexString;
            app.ports.web3Sub.send({ tag: "storageAt", id: cmd.id, data: val });
            return;
        }

        case "getCode": {
            const code = (await rpc("eth_getCode", [
                cmd.contract,
                cmd.block ?? "latest",
            ])) as HexString;
            app.ports.web3Sub.send({ tag: "code", id: cmd.id, data: code });
            return;
        }

        case "getGasPrice": {
            const hex = (await rpc("eth_gasPrice", [])) as HexString;
            app.ports.web3Sub.send({
                tag: "gasPrice",
                id: cmd.id,
                wei: BigInt(hex).toString(),
            });
            return;
        }

        case "getFeeHistory": {
            const result = (await rpc("eth_feeHistory", [cmd.blockCount, "latest", []])) as {
                baseFeePerGas: readonly HexString[];
                gasUsedRatio: readonly number[];
                oldestBlock: HexString;
            };
            app.ports.web3Sub.send({
                tag: "feeHistory",
                id: cmd.id,
                baseFeePerGas: result.baseFeePerGas.map((h) => BigInt(h).toString()),
                gasUsedRatio: result.gasUsedRatio,
                oldestBlock: Number.parseInt(result.oldestBlock, 16),
            });
            return;
        }

        case "getTransactionReceipt": {
            const receipt = (await rpc("eth_getTransactionReceipt", [cmd.hash])) as RawReceipt | null;
            if (!receipt) {
                app.ports.web3Sub.send({ tag: "receiptNotFound", id: cmd.id });
            } else {
                app.ports.web3Sub.send({
                    tag: "receiptResult",
                    id: cmd.id,
                    hash: receipt.transactionHash,
                    blockNumber: Number.parseInt(receipt.blockNumber, 16),
                    gasUsed: Number.parseInt(receipt.gasUsed, 16).toString(),
                    status: receipt.status === "0x1",
                    logs: (receipt.logs ?? []).map(toEventLog),
                });
            }
            return;
        }

        case "getLogs": {
            const filter: LogFilter = {
                address: cmd.contract,
                fromBlock: blockNumberToHex(cmd.fromBlock),
                toBlock: blockNumberToHex(cmd.toBlock),
            };
            if (cmd.topics && cmd.topics.length > 0) {
                filter.topics = cmd.topics;
            }
            const logs = (await rpc("eth_getLogs", [filter])) as readonly RawLog[];
            app.ports.web3Sub.send({
                tag: "logs",
                logs: logs.map((log) => ({
                    address: log.address,
                    data: log.data,
                    topics: log.topics ?? [],
                    blockNumber: Number.parseInt(log.blockNumber, 16),
                    logIndex: Number.parseInt(log.logIndex, 16),
                })),
            });
            return;
        }

        case "getTransaction": {
            const tx = (await rpc("eth_getTransactionByHash", [cmd.hash])) as RawTransaction | null;
            if (!tx) {
                app.ports.web3Sub.send({ tag: "transactionNotFound", id: cmd.id });
            } else {
                app.ports.web3Sub.send({
                    tag: "transaction",
                    id: cmd.id,
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to ?? null,
                    value: BigInt(tx.value).toString(),
                    nonce: Number.parseInt(tx.nonce, 16),
                    data: tx.input,
                    gas: Number.parseInt(tx.gas, 16),
                    blockNumber: tx.blockNumber ? Number.parseInt(tx.blockNumber, 16) : null,
                    blockHash: tx.blockHash ?? null,
                });
            }
            return;
        }

        case "deploy": {
            if (!window.ethereum) throw new Error("No wallet found");
            const accounts = (await window.ethereum.request({
                method: "eth_accounts",
            })) as readonly HexString[];
            const argsEncoded = (cmd.args ?? []).join("");
            const txParams: TxParams = {
                from: accounts[0]!,
                data: `${cmd.bytecode}${argsEncoded}` as HexString,
            };
            if (cmd.value) txParams.value = `0x${BigInt(cmd.value).toString(16)}`;
            if (cmd.gasLimit) txParams.gas = `0x${cmd.gasLimit.toString(16)}`;
            const hash = (await window.ethereum.request({
                method: "eth_sendTransaction",
                params: [txParams],
            })) as HexString;
            app.ports.web3Sub.send({ tag: "submitted", hash });
            pollReceipt(hash, app, rpc);
            return;
        }

        case "sendRawTransaction": {
            const hash = (await rpc("eth_sendRawTransaction", [cmd.rawTx])) as HexString;
            app.ports.web3Sub.send({ tag: "submitted", hash });
            pollReceipt(hash, app, rpc);
            return;
        }

        case "watchAsset": {
            if (!window.ethereum) throw new Error("No wallet found");
            await window.ethereum.request({
                method: "wallet_watchAsset",
                params: [
                    {
                        type: "ERC20",
                        options: {
                            address: cmd.address,
                            symbol: cmd.symbol,
                            decimals: cmd.decimals,
                            image: cmd.image ?? "",
                        },
                    },
                ] as unknown as readonly unknown[],
            });
            app.ports.web3Sub.send({ tag: "assetWatched" });
            return;
        }

        case "requestPermissions": {
            if (!window.ethereum) throw new Error("No wallet found");
            const perms = (await window.ethereum.request({
                method: "wallet_requestPermissions",
                params: [{ eth_accounts: {} }],
            })) as readonly { parentCapability: string }[];
            app.ports.web3Sub.send({
                tag: "permissions",
                permissions: perms.map((p) => p.parentCapability),
            });
            return;
        }

        case "getPermissions": {
            if (!window.ethereum) throw new Error("No wallet found");
            const perms = (await window.ethereum.request({
                method: "wallet_getPermissions",
            })) as readonly { parentCapability: string }[];
            app.ports.web3Sub.send({
                tag: "permissions",
                permissions: perms.map((p) => p.parentCapability),
            });
            return;
        }

        case "getBlockTransactionCount": {
            const blockHex =
                typeof cmd.block === "number" ? `0x${cmd.block.toString(16)}` : cmd.block;
            const hex = (await rpc("eth_getBlockTransactionCountByNumber", [
                blockHex,
            ])) as HexString;
            app.ports.web3Sub.send({
                tag: "blockTxCount",
                id: cmd.id,
                count: Number.parseInt(hex, 16),
            });
            return;
        }

        case "keccak256": {
            const hash = keccak256OfUtf8(cmd.message) as HexString;
            app.ports.web3Sub.send({ tag: "keccak256Result", id: cmd.id, hash });
            return;
        }

        default: {
            const exhaustive: never = cmd;
            const tag = (exhaustive as { tag: string }).tag ?? "unknown";
            app.ports.web3Sub.send({ tag: "unknownCmd", cmd: tag });
        }
    }
}


function sendError(app: ElmApp, err: unknown): void {
    // EIP-1193 user-rejected = code 4001.
    const e = err as { code?: number; message?: string; data?: unknown; error?: { data?: unknown } };
    if (e.code === 4001) {
        app.ports.web3Sub.send({ tag: "rejected" });
        return;
    }
    const message = e.message ?? String(err);
    const revertCandidate = e.data ?? e.error?.data;
    const revertData =
        typeof revertCandidate === "string" && revertCandidate.startsWith("0x")
            ? (revertCandidate as HexString)
            : undefined;
    app.ports.web3Sub.send({
        tag: "failed",
        error: message,
        ...(revertData ? { revertData } : {}),
    });
}


function attachWalletListeners(provider: Eip1193Provider, app: ElmApp): void {
    provider.on("chainChanged", (chainHex: unknown) => {
        try {
            if (typeof chainHex !== "string") return;
            app.ports.web3Sub.send({
                tag: "chainChanged",
                chainId: Number.parseInt(chainHex, 16),
            });
        } catch {
            // ignore: provider event handlers must not throw
        }
    });
    provider.on("accountsChanged", (accounts: unknown) => {
        try {
            if (!Array.isArray(accounts) || accounts.length === 0) {
                app.ports.web3Sub.send({ tag: "disconnected" });
            } else {
                app.ports.web3Sub.send({
                    tag: "accountChanged",
                    address: accounts[0] as HexString,
                });
            }
        } catch {
            // ignore
        }
    });
}


/**
 * Swap in any EIP-1193 provider (e.g. WalletConnect adapter) before calling
 * `connect`. elm-web3 carries no WalletConnect dependency — you bring your own.
 */
export function setupExternalProvider(provider: Eip1193Provider): void {
    window.ethereum = provider;
}


/**
 * EIP-6963 multi-wallet discovery. Listens for provider announcements and
 * pushes the running set into Elm as a `walletsDiscovered` event.
 *
 * Call after `setupPorts` so the Elm app is subscribed.
 */
export function watchWallets(app: ElmApp): void {
    function onAnnounce(event: Event): void {
        const e = event as Eip6963AnnounceEvent;
        const detail = e.detail;
        if (!detail || !detail.info || !detail.info.rdns) return;
        eip6963Providers.set(detail.info.rdns, {
            info: detail.info,
            provider: detail.provider,
        });
        const wallets: readonly DiscoveredWallet[] = Array.from(
            eip6963Providers.values(),
        ).map(({ info }) => ({
            name: info.name,
            icon: info.icon,
            rdns: info.rdns,
        }));
        app.ports.web3Sub.send({ tag: "walletsDiscovered", wallets });
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
}


// ─── Helpers — RPC shapes + tx params ─────────────────────────────────────

interface TxParams {
    from: HexString;
    to?: HexString;
    data: HexString;
    value?: HexString;
    gas?: HexString;
}

interface LogFilter {
    address: HexString;
    fromBlock: HexString | string;
    toBlock: HexString | string;
    topics?: readonly (string | readonly string[] | null)[];
}

interface RawLog {
    readonly address: HexString;
    readonly topics: readonly string[];
    readonly data: HexString;
    readonly blockNumber: HexString;
    readonly logIndex: HexString;
    readonly transactionHash: HexString;
}

interface RawBlock {
    readonly number: HexString;
    readonly hash: HexString;
    readonly timestamp: HexString;
    readonly gasLimit: HexString;
    readonly gasUsed: HexString;
    readonly baseFeePerGas?: HexString;
    readonly parentHash: HexString;
}

interface RawReceipt {
    readonly transactionHash: HexString;
    readonly blockNumber: HexString;
    readonly gasUsed: HexString;
    readonly status: HexString;
    readonly logs?: readonly RawLog[];
}

interface RawTransaction {
    readonly hash: HexString;
    readonly from: HexString;
    readonly to: HexString | null;
    readonly value: HexString;
    readonly nonce: HexString;
    readonly input: HexString;
    readonly gas: HexString;
    readonly blockNumber: HexString | null;
    readonly blockHash: HexString | null;
}

function toEventLog(log: RawLog): EventLog {
    return {
        address: log.address,
        topics: log.topics ?? [],
        data: log.data,
        blockNumber: Number.parseInt(log.blockNumber, 16),
        logIndex: Number.parseInt(log.logIndex, 16),
    };
}

function blockNumberToHex(blockNum: number | string): string {
    if (typeof blockNum === "string") return blockNum;
    return `0x${blockNum.toString(16)}`;
}

async function pollReceipt(
    hash: HexString,
    app: ElmApp,
    rpc: (method: string, params?: readonly unknown[]) => Promise<unknown>,
): Promise<void> {
    for (let i = 0; i < 120; i++) {
        await new Promise<void>((r) => setTimeout(r, 2_000));
        try {
            const receipt = (await rpc("eth_getTransactionReceipt", [hash])) as RawReceipt | null;
            if (receipt) {
                app.ports.web3Sub.send({
                    tag: "confirmed",
                    hash: receipt.transactionHash,
                    blockNumber: Number.parseInt(receipt.blockNumber, 16),
                    gasUsed: Number.parseInt(receipt.gasUsed, 16).toString(),
                    status: receipt.status === "0x1",
                    logs: (receipt.logs ?? []).map(toEventLog),
                });
                return;
            }
            await rpc("eth_blockNumber", []);
            app.ports.web3Sub.send({ tag: "confirmation", hash, count: i + 1 });
        } catch {
            // keep polling
        }
    }
    app.ports.web3Sub.send({
        tag: "failed",
        error: "Transaction not confirmed after 4 minutes",
    });
}


// ─── Calldata helpers ─────────────────────────────────────────────────────

const MULTICALL3: HexString = "0xcA11bde05977b3631167028862bE2a173976CA11";

function isDyn(type: string): boolean {
    const t = type.trim();
    if (t === "string" || t === "bytes") return true;
    if (t.endsWith("[]")) return true;
    const fixedMatch = t.match(/^(.*)\[(\d+)\]$/);
    if (fixedMatch) return isDyn(fixedMatch[1]!);
    if (t.startsWith("(")) {
        const inner = t.slice(1, t.lastIndexOf(")"));
        return splitTopLevelTypes(inner).some(isDyn);
    }
    return false;
}

function headSize(type: string): number {
    const t = type.trim();
    if (isDyn(t)) return 1;
    const fixedMatch = t.match(/^(.*)\[(\d+)\]$/);
    if (fixedMatch) return Number.parseInt(fixedMatch[2]!, 10) * headSize(fixedMatch[1]!);
    if (t.startsWith("(")) {
        const inner = t.slice(1, t.lastIndexOf(")"));
        return splitTopLevelTypes(inner).reduce((s, m) => s + headSize(m), 0);
    }
    return 1;
}

function encStatic(type: string, val: unknown): string {
    const t = type.trim();
    const fixedMatch = t.match(/^(.*)\[(\d+)\]$/);
    if (fixedMatch) {
        const elemType = fixedMatch[1]!;
        const arr = Array.isArray(val) ? (val as readonly unknown[]) : [];
        return arr.map((v) => encStatic(elemType, v)).join("");
    }
    if (t.startsWith("(")) {
        const inner = t.slice(1, t.lastIndexOf(")"));
        const innerTypes = splitTopLevelTypes(inner);
        const arr = Array.isArray(val) ? (val as readonly unknown[]) : [];
        return innerTypes.map((et, i) => encStatic(et, arr[i])).join("");
    }
    if (t === "address") {
        const addr = String(val).replace(/^0x/i, "").toLowerCase().padStart(40, "0");
        return `000000000000000000000000${addr}`;
    }
    if (t === "bool") {
        return `000000000000000000000000000000000000000000000000000000000000000${val ? "1" : "0"}`;
    }
    if (/^bytes\d+$/.test(t)) {
        const hex = String(val).replace(/^0x/i, "").toLowerCase();
        return hex.padEnd(64, "0").slice(0, 64);
    }
    let n = BigInt(String(val));
    if (n < 0n) n = n & ((1n << 256n) - 1n);
    return n.toString(16).padStart(64, "0");
}

function encDyn(type: string, val: unknown): string {
    const t = type.trim();
    if (t === "string") {
        const byteArr = Array.from(new TextEncoder().encode(String(val)));
        const lenHex = BigInt(byteArr.length).toString(16).padStart(64, "0");
        const dataHex = byteArr.map((b) => b.toString(16).padStart(2, "0")).join("");
        const pad = (32 - (byteArr.length % 32)) % 32;
        return lenHex + dataHex + "00".repeat(pad);
    }
    if (t === "bytes") {
        const hex = String(val).replace(/^0x/i, "").toLowerCase();
        const byteLen = hex.length / 2;
        const lenHex = BigInt(byteLen).toString(16).padStart(64, "0");
        const pad = (32 - (byteLen % 32)) % 32;
        return lenHex + hex + "00".repeat(pad);
    }
    if (t.endsWith("[]")) {
        const elemType = t.slice(0, -2);
        const arr = Array.isArray(val) ? (val as readonly unknown[]) : [];
        const lenHex = BigInt(arr.length).toString(16).padStart(64, "0");
        return lenHex + abiEncode(arr.map(() => elemType), arr);
    }
    if (t.startsWith("(")) {
        const closeParen = t.lastIndexOf(")");
        const inner = t.slice(1, closeParen);
        const suffix = t.slice(closeParen + 1);
        const tupleType = t.slice(0, closeParen + 1);
        if (suffix === "") {
            const innerTypes = splitTopLevelTypes(inner);
            const arr = Array.isArray(val) ? (val as readonly unknown[]) : [];
            return abiEncode(innerTypes, arr);
        }
        if (suffix === "[]") {
            const arr = Array.isArray(val) ? (val as readonly unknown[]) : [];
            const lenHex = BigInt(arr.length).toString(16).padStart(64, "0");
            return lenHex + abiEncode(arr.map(() => tupleType), arr);
        }
        const kMatch = suffix.match(/^\[(\d+)\]$/);
        if (kMatch) {
            const arr = Array.isArray(val) ? (val as readonly unknown[]) : [];
            return abiEncode(arr.map(() => tupleType), arr);
        }
    }
    throw new Error(`encodeCall: unsupported dynamic type ${type}`);
}

function abiEncode(types: readonly string[], args: readonly unknown[]): string {
    const headParts: string[] = [];
    const tailParts: string[] = [];
    let tailOffset = types.reduce((s, t) => s + headSize(t) * 32, 0);
    for (let i = 0; i < types.length; i++) {
        const t = types[i]!.trim();
        if (isDyn(t)) {
            headParts.push(BigInt(tailOffset).toString(16).padStart(64, "0"));
            const enc = encDyn(t, args[i]);
            tailParts.push(enc);
            tailOffset += enc.length / 2;
        } else {
            headParts.push(encStatic(t, args[i]));
        }
    }
    return [...headParts, ...tailParts].join("");
}

function encodeAggregate3(
    calls: readonly { readonly contract: HexString }[],
    callDatas: readonly HexString[],
): HexString {
    const sel = selector("aggregate3((address,bool,bytes)[])");
    const n = calls.length;
    const tupleEncs = callDatas.map((cd, i) => {
        const addr = calls[i]!.contract.replace(/^0x/i, "").toLowerCase().padStart(40, "0");
        const addrSlot = `000000000000000000000000${addr}`;
        const boolSlot = "0000000000000000000000000000000000000000000000000000000000000001";
        const bOff = BigInt(3 * 32).toString(16).padStart(64, "0");
        const cdHex = cd.replace(/^0x/i, "");
        const cdLen = cdHex.length / 2;
        const lenSlot = BigInt(cdLen).toString(16).padStart(64, "0");
        const pad = (32 - (cdLen % 32)) % 32;
        return addrSlot + boolSlot + bOff + lenSlot + cdHex + "00".repeat(pad);
    });
    const offsets: string[] = [];
    let off = n * 32;
    for (let i = 0; i < n; i++) {
        offsets.push(BigInt(off).toString(16).padStart(64, "0"));
        off += tupleEncs[i]!.length / 2;
    }
    const lenSlot = BigInt(n).toString(16).padStart(64, "0");
    const arrBody = lenSlot + offsets.join("") + tupleEncs.join("");
    const argOffset = BigInt(32).toString(16).padStart(64, "0");
    return `0x${sel}${argOffset}${arrBody}` as HexString;
}

function decodeAggregate3Result(
    hexData: HexString,
): readonly { readonly success: boolean; readonly data: HexString }[] {
    const h = hexData.replace(/^0x/i, "");
    function word(byteOff: number): number {
        return Number.parseInt(h.slice(byteOff * 2, byteOff * 2 + 64), 16);
    }
    const arrByteOff = word(0);
    const n = word(arrByteOff);
    const contentOff = arrByteOff + 32;
    const results: { readonly success: boolean; readonly data: HexString }[] = [];
    for (let i = 0; i < n; i++) {
        const tupleRelOff = word(contentOff + i * 32);
        const tupleOff = contentOff + tupleRelOff;
        const success = word(tupleOff) !== 0;
        const bytesRelOff = word(tupleOff + 32);
        const bytesOff = tupleOff + bytesRelOff;
        const bytesLen = word(bytesOff);
        const dataStart = (bytesOff + 32) * 2;
        const data = `0x${h.slice(dataStart, dataStart + bytesLen * 2)}` as HexString;
        results.push({ success, data });
    }
    return results;
}

function splitTopLevelTypes(typesStr: string): string[] {
    const result: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < typesStr.length; i++) {
        const ch = typesStr[i]!;
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "," && depth === 0) {
            result.push(typesStr.slice(start, i));
            start = i + 1;
        }
    }
    if (start < typesStr.length) result.push(typesStr.slice(start));
    return result;
}

function encodeCall(method: string, args: readonly unknown[]): HexString {
    const sel = selector(method);
    if (!args || args.length === 0) return `0x${sel}` as HexString;
    const parenStart = method.indexOf("(");
    const typesStr = parenStart >= 0 ? method.slice(parenStart + 1, method.lastIndexOf(")")) : "";
    const types = typesStr ? splitTopLevelTypes(typesStr) : [];
    if (types.length === 0) return `0x${sel}` as HexString;
    return `0x${sel}${abiEncode(types, args)}` as HexString;
}


// ─── Keccak-256 (inlined) ────────────────────────────────────────────────

const KC_RC: readonly (readonly [number, number])[] = [
    [0x00000001, 0x00000000], [0x00008082, 0x00000000], [0x0000808a, 0x80000000],
    [0x80008000, 0x80000000], [0x0000808b, 0x00000000], [0x80000001, 0x00000000],
    [0x80008081, 0x80000000], [0x00008009, 0x80000000], [0x0000008a, 0x00000000],
    [0x00000088, 0x00000000], [0x80008009, 0x00000000], [0x8000000a, 0x00000000],
    [0x8000808b, 0x00000000], [0x0000008b, 0x80000000], [0x00008089, 0x80000000],
    [0x00008003, 0x80000000], [0x00008002, 0x80000000], [0x00000080, 0x80000000],
    [0x0000800a, 0x00000000], [0x8000000a, 0x80000000], [0x80008081, 0x80000000],
    [0x00008080, 0x80000000], [0x80000001, 0x00000000], [0x80008008, 0x80000000],
];

const KC_RO: readonly number[] = [
    0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
];

function keccakF(s: number[]): void {
    for (let rnd = 0; rnd < 24; rnd++) {
        const c: number[] = new Array(10);
        for (let x = 0; x < 5; x++) {
            c[2 * x] = s[2 * x]! ^ s[2 * x + 10]! ^ s[2 * x + 20]! ^ s[2 * x + 30]! ^ s[2 * x + 40]!;
            c[2 * x + 1] = s[2 * x + 1]! ^ s[2 * x + 11]! ^ s[2 * x + 21]! ^ s[2 * x + 31]! ^ s[2 * x + 41]!;
        }
        for (let x = 0; x < 5; x++) {
            const x1 = (x + 1) % 5;
            const x4 = (x + 4) % 5;
            const dlo = c[2 * x4]! ^ ((c[2 * x1]! << 1) | (c[2 * x1 + 1]! >>> 31));
            const dhi = c[2 * x4 + 1]! ^ ((c[2 * x1 + 1]! << 1) | (c[2 * x1]! >>> 31));
            for (let y = 0; y < 5; y++) {
                s[2 * (x + 5 * y)] ^= dlo;
                s[2 * (x + 5 * y) + 1] ^= dhi;
            }
        }
        const tmp: number[] = new Array(50);
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                const idx = x + 5 * y;
                const lo = s[2 * idx]!;
                const hi = s[2 * idx + 1]!;
                let r = KC_RO[idx]!;
                let rlo: number;
                let rhi: number;
                if (r === 0) {
                    rlo = lo;
                    rhi = hi;
                } else if (r === 32) {
                    rlo = hi;
                    rhi = lo;
                } else if (r < 32) {
                    rlo = (lo << r) | (hi >>> (32 - r));
                    rhi = (hi << r) | (lo >>> (32 - r));
                } else {
                    r -= 32;
                    rlo = (hi << r) | (lo >>> (32 - r));
                    rhi = (lo << r) | (hi >>> (32 - r));
                }
                const nx = y;
                const ny = (2 * x + 3 * y) % 5;
                tmp[2 * (nx + 5 * ny)] = rlo;
                tmp[2 * (nx + 5 * ny) + 1] = rhi;
            }
        }
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 5; x++) {
                const x1 = (x + 1) % 5;
                const x2 = (x + 2) % 5;
                s[2 * (x + 5 * y)] = tmp[2 * (x + 5 * y)]! ^ (~tmp[2 * (x1 + 5 * y)]! & tmp[2 * (x2 + 5 * y)]!);
                s[2 * (x + 5 * y) + 1] = tmp[2 * (x + 5 * y) + 1]! ^ (~tmp[2 * (x1 + 5 * y) + 1]! & tmp[2 * (x2 + 5 * y) + 1]!);
            }
        }
        s[0] ^= KC_RC[rnd]![0];
        s[1] ^= KC_RC[rnd]![1];
    }
}

function keccak256OfUtf8(input: string): string {
    const rate = 136;
    const msg: number[] = [];
    for (let i = 0; i < input.length; i++) {
        const c = input.charCodeAt(i);
        if (c < 0x80) {
            msg.push(c);
        } else if (c < 0x800) {
            msg.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
        } else {
            msg.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        }
    }
    msg.push(0x01);
    while (msg.length % rate !== 0) msg.push(0x00);
    msg[msg.length - 1]! |= 0x80;

    const s: number[] = new Array(50).fill(0);
    for (let blk = 0; blk < msg.length; blk += rate) {
        for (let i = 0; i < 17; i++) {
            const j = blk + i * 8;
            s[2 * i] ^= msg[j]! | (msg[j + 1]! << 8) | (msg[j + 2]! << 16) | (msg[j + 3]! << 24);
            s[2 * i + 1] ^= msg[j + 4]! | (msg[j + 5]! << 8) | (msg[j + 6]! << 16) | (msg[j + 7]! << 24);
        }
        keccakF(s);
    }

    let hex = "0x";
    for (let lane = 0; lane < 4; lane++) {
        const lo = s[2 * lane]! >>> 0;
        const hi = s[2 * lane + 1]! >>> 0;
        hex += (lo & 0xff).toString(16).padStart(2, "0");
        hex += ((lo >>> 8) & 0xff).toString(16).padStart(2, "0");
        hex += ((lo >>> 16) & 0xff).toString(16).padStart(2, "0");
        hex += (lo >>> 24).toString(16).padStart(2, "0");
        hex += (hi & 0xff).toString(16).padStart(2, "0");
        hex += ((hi >>> 8) & 0xff).toString(16).padStart(2, "0");
        hex += ((hi >>> 16) & 0xff).toString(16).padStart(2, "0");
        hex += (hi >>> 24).toString(16).padStart(2, "0");
    }
    return hex;
}

function selector(sig: string): string {
    const rate = 136;
    const msg: number[] = [];
    for (let i = 0; i < sig.length; i++) msg.push(sig.charCodeAt(i) & 0xff);
    msg.push(0x01);
    while (msg.length % rate !== 0) msg.push(0x00);
    msg[msg.length - 1]! |= 0x80;

    const s: number[] = new Array(50).fill(0);
    for (let blk = 0; blk < msg.length; blk += rate) {
        for (let i = 0; i < 17; i++) {
            const j = blk + i * 8;
            s[2 * i] ^= msg[j]! | (msg[j + 1]! << 8) | (msg[j + 2]! << 16) | (msg[j + 3]! << 24);
            s[2 * i + 1] ^= msg[j + 4]! | (msg[j + 5]! << 8) | (msg[j + 6]! << 16) | (msg[j + 7]! << 24);
        }
        keccakF(s);
    }

    const lo = s[0]! >>> 0;
    return [lo & 0xff, (lo >>> 8) & 0xff, (lo >>> 16) & 0xff, lo >>> 24]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
