/**
 * Verified-contract fetcher.
 *
 * Primary source: Sourcify (https://sourcify.dev). Open, no API key, returns
 * ABI + compiler metadata + Solidity source files.
 *
 * Fallback: Etherscan-family explorer API (etherscan.io, basescan.org,
 * arbiscan.io, polygonscan.com — all expose the same `getsourcecode` shape).
 * Read API key from `ETHERSCAN_API_KEY` if set; without a key, the explorer
 * still answers but throttles harder.
 *
 * Cache: each fetch persists to `./<out>/.dapp-gen/cache/<chainId>/<addr>.json`
 * so re-runs against the same input are offline-fast.
 *
 * Errors are thrown with a stable message prefix per kind:
 *   - "not-verified:"     contract has no verified source
 *   - "unsupported-chain:" no Sourcify + no known explorer
 *   - "network:"          fetch failed (timeout, DNS, 5xx)
 *   - "malformed:"        verified bundle didn't parse to a usable ABI
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import type { ChainInfo } from "./chains.ts";

export interface VerifiedBundle {
    readonly address: string;        // lowercase 0x…
    readonly chainId: number;
    readonly contractName: string;
    readonly abi: AbiItem[];
    readonly compilerVersion: string;
    readonly sources: Record<string, string>;  // path → solidity source
    readonly matchKind: "full" | "partial" | "etherscan";
}

export interface AbiItem {
    readonly type: "function" | "event" | "constructor" | "fallback" | "receive" | "error";
    readonly name?: string;
    readonly inputs?: AbiParam[];
    readonly outputs?: AbiParam[];
    readonly stateMutability?: "pure" | "view" | "nonpayable" | "payable";
    readonly anonymous?: boolean;
}

export interface AbiParam {
    readonly name: string;
    readonly type: string;
    readonly indexed?: boolean;
    readonly components?: AbiParam[];
    readonly internalType?: string;
}

const SOURCIFY = "https://sourcify.dev/server";

const ETHERSCAN_ENDPOINTS: Record<number, string> = {
    1: "https://api.etherscan.io/api",
    11155111: "https://api-sepolia.etherscan.io/api",
    8453: "https://api.basescan.org/api",
    42161: "https://api.arbiscan.io/api",
    10: "https://api-optimistic.etherscan.io/api",
    137: "https://api.polygonscan.com/api",
    // PulseChain Blockscout-flavoured explorer; same getsourcecode shape:
    369: "https://api.scan.pulsechain.com/api",
    943: "https://api.scan.v4.testnet.pulsechain.com/api",
};

export interface FetchOptions {
    readonly cacheDir?: string;
    readonly etherscanApiKey?: string;
    readonly timeoutMs?: number;
}

export async function fetchVerified(
    address: string,
    chain: ChainInfo,
    options: FetchOptions = {},
): Promise<VerifiedBundle> {
    const addr = normaliseAddress(address);
    const cacheFile = options.cacheDir
        ? join(options.cacheDir, String(chain.chainId), `${addr}.json`)
        : undefined;

    if (cacheFile && existsSync(cacheFile)) {
        try {
            return JSON.parse(readFileSync(cacheFile, "utf8")) as VerifiedBundle;
        } catch {
            // fall through to fresh fetch
        }
    }

    let bundle: VerifiedBundle;
    try {
        bundle = await fetchFromSourcify(addr, chain.chainId, options.timeoutMs);
    } catch (sourcifyErr) {
        try {
            bundle = await fetchFromEtherscan(
                addr,
                chain.chainId,
                options.etherscanApiKey,
                options.timeoutMs,
            );
        } catch (etherscanErr) {
            // Surface the more useful of the two errors.
            if (isNotVerified(sourcifyErr) && isNotVerified(etherscanErr)) {
                throw new Error(
                    `not-verified: ${addr} on chain ${chain.chainId} has no verified source on Sourcify or Etherscan`,
                );
            }
            throw sourcifyErr;
        }
    }

    if (cacheFile) {
        mkdirSync(dirname(cacheFile), { recursive: true });
        writeFileSync(cacheFile, JSON.stringify(bundle, null, 2));
    }

    return bundle;
}

// ---------------------------------------------------------------------------
// Sourcify
// ---------------------------------------------------------------------------

interface SourcifyFile {
    name: string;
    path: string;
    content: string;
}

async function fetchFromSourcify(
    addr: string,
    chainId: number,
    timeoutMs = 15000,
): Promise<VerifiedBundle> {
    const url = `${SOURCIFY}/files/any/${chainId}/${addr}`;
    const res = await fetchWithTimeout(url, timeoutMs);

    if (res.status === 404) {
        throw new Error(`not-verified: sourcify has no record for ${addr} on chain ${chainId}`);
    }
    if (!res.ok) {
        throw new Error(`network: sourcify returned ${res.status} for ${addr}`);
    }

    const body = (await res.json()) as {
        status: "full" | "partial";
        files: SourcifyFile[];
    };

    const metadataFile = body.files.find((f) => f.name === "metadata.json");
    if (!metadataFile) {
        throw new Error(`malformed: sourcify bundle for ${addr} has no metadata.json`);
    }

    const metadata = JSON.parse(metadataFile.content) as {
        compiler?: { version?: string };
        output?: { abi?: AbiItem[] };
        settings?: {
            compilationTarget?: Record<string, string>;
        };
    };

    const abi = metadata.output?.abi;
    if (!abi || !Array.isArray(abi)) {
        throw new Error(`malformed: sourcify metadata for ${addr} has no ABI`);
    }

    const compilationTarget = metadata.settings?.compilationTarget ?? {};
    const contractName =
        Object.values(compilationTarget)[0] ?? guessContractName(body.files, addr);

    const sources = Object.fromEntries(
        body.files
            .filter((f) => f.name.endsWith(".sol"))
            .map((f) => [f.path, f.content]),
    );

    return {
        address: addr,
        chainId,
        contractName,
        abi,
        compilerVersion: metadata.compiler?.version ?? "unknown",
        sources,
        matchKind: body.status === "full" ? "full" : "partial",
    };
}

function guessContractName(files: SourcifyFile[], addr: string): string {
    const solFile = files.find((f) => f.name.endsWith(".sol"));
    if (!solFile) return `Contract_${addr.slice(2, 10)}`;
    const m = solFile.content.match(/contract\s+(\w+)/);
    return m?.[1] ?? `Contract_${addr.slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Etherscan-family fallback
// ---------------------------------------------------------------------------

async function fetchFromEtherscan(
    addr: string,
    chainId: number,
    apiKey: string | undefined,
    timeoutMs = 15000,
): Promise<VerifiedBundle> {
    const endpoint = ETHERSCAN_ENDPOINTS[chainId];
    if (!endpoint) {
        throw new Error(`unsupported-chain: no Etherscan endpoint configured for chain ${chainId}`);
    }

    const url =
        `${endpoint}?module=contract&action=getsourcecode&address=${addr}` +
        (apiKey ? `&apikey=${apiKey}` : "");

    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) {
        throw new Error(`network: ${endpoint} returned ${res.status} for ${addr}`);
    }

    const body = (await res.json()) as {
        status: string;
        result?: Array<{
            ABI: string;
            SourceCode: string;
            ContractName: string;
            CompilerVersion: string;
        }>;
    };

    if (body.status !== "1" || !body.result?.[0]) {
        throw new Error(`not-verified: ${endpoint} returned no result for ${addr}`);
    }

    const r = body.result[0];
    if (r.ABI === "Contract source code not verified") {
        throw new Error(`not-verified: explorer reports no verified source for ${addr}`);
    }

    let abi: AbiItem[];
    try {
        abi = JSON.parse(r.ABI) as AbiItem[];
    } catch (e) {
        throw new Error(`malformed: explorer returned unparseable ABI for ${addr}`);
    }

    // Etherscan source can be a plain string, a JSON-encoded object, or
    // a double-wrapped JSON ({"sources":{path:{content}}}). Normalise:
    const sources = parseEtherscanSourceCode(r.SourceCode);

    return {
        address: addr,
        chainId,
        contractName: r.ContractName || guessContractName([], addr),
        abi,
        compilerVersion: r.CompilerVersion,
        sources,
        matchKind: "etherscan",
    };
}

function parseEtherscanSourceCode(raw: string): Record<string, string> {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("{")) {
        return { "main.sol": raw };
    }
    // Etherscan wraps the JSON in an extra set of {} sometimes:
    const inner = trimmed.startsWith("{{") ? trimmed.slice(1, -1) : trimmed;
    try {
        const parsed = JSON.parse(inner);
        if (parsed.sources && typeof parsed.sources === "object") {
            return Object.fromEntries(
                Object.entries(parsed.sources as Record<string, { content: string }>).map(
                    ([path, { content }]) => [path, content],
                ),
            );
        }
        if (typeof parsed === "object") {
            return Object.fromEntries(
                Object.entries(parsed as Record<string, { content?: string }>).map(
                    ([path, file]) => [path, file?.content ?? ""],
                ),
            );
        }
    } catch {
        // fall through
    }
    return { "main.sol": raw };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseAddress(addr: string): string {
    const s = addr.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(s)) {
        throw new Error(`malformed: '${addr}' is not a 20-byte hex address`);
    }
    return s;
}

function isNotVerified(e: unknown): boolean {
    return e instanceof Error && e.message.startsWith("not-verified:");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    } catch (e) {
        if ((e as { name?: string }).name === "AbortError") {
            throw new Error(`network: timeout after ${timeoutMs}ms fetching ${url}`);
        }
        throw new Error(`network: ${(e as Error).message ?? "unknown"} fetching ${url}`);
    } finally {
        clearTimeout(t);
    }
}
