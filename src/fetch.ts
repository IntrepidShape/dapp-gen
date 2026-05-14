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
    readonly natspec: NatSpec;
}

/**
 * Solidity NatSpec, lifted from the verified `metadata.json`. The compiler
 * emits two parallel documents:
 *   - `userdoc` carries `@notice` per method + contract-level `@notice`.
 *   - `devdoc` carries `@dev` (`details`), `@param`, `@return`, `@title`,
 *     `@author` per method + contract-level.
 *
 * Method keys are canonical signatures (e.g. `balanceOf(address)`).
 */
export interface NatSpec {
    readonly contractNotice?: string | undefined;
    readonly contractDetails?: string | undefined;
    readonly contractTitle?: string | undefined;
    readonly contractAuthor?: string | undefined;
    readonly methods: Record<string, MethodDoc>;
}

export interface MethodDoc {
    readonly notice?: string | undefined;
    readonly details?: string | undefined;
    readonly params?: Record<string, string> | undefined;
    readonly returns?: string | Record<string, string> | undefined;
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

/**
 * Blockscout v2 API endpoints. Returns far richer data than the
 * Etherscan-compat shim — ABI as native JSON, structured source files,
 * verification quality flags (full vs partial vs via-sourcify),
 * compiler settings, decoded constructor args.
 *
 * Used as the SECOND-tier source after Sourcify, BEFORE Etherscan-compat.
 * Only populated for chains where the explorer is a Blockscout fork.
 */
const BLOCKSCOUT_V2_ENDPOINTS: Record<number, string> = {
    369: "https://api.scan.pulsechain.com/api/v2",
    943: "https://api.scan.v4.testnet.pulsechain.com/api/v2",
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
    const errors: Error[] = [];

    // Try Sourcify (canonical, vendor-neutral).
    try {
        bundle = await fetchFromSourcify(addr, chain.chainId, options.timeoutMs);
    } catch (e) {
        errors.push(e as Error);

        // Try Blockscout v2 if the chain has one (much richer than
        // Etherscan-compat — native ABI, structured sources).
        if (BLOCKSCOUT_V2_ENDPOINTS[chain.chainId]) {
            try {
                bundle = await fetchFromBlockscoutV2(
                    addr,
                    chain.chainId,
                    options.timeoutMs,
                );
            } catch (b) {
                errors.push(b as Error);
                bundle = undefined as unknown as VerifiedBundle;
            }
        }

        // If still not resolved, try Etherscan-compat as last fallback.
        if (!bundle!) {
            try {
                bundle = await fetchFromEtherscan(
                    addr,
                    chain.chainId,
                    options.etherscanApiKey,
                    options.timeoutMs,
                );
            } catch (e2) {
                errors.push(e2 as Error);
                if (errors.every(isNotVerified)) {
                    throw new Error(
                        `not-verified: ${addr} on chain ${chain.chainId} has no verified source on Sourcify, Blockscout, or Etherscan`,
                    );
                }
                // Surface the most informative error
                throw errors[0]!;
            }
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
        output?: {
            abi?: AbiItem[];
            userdoc?: {
                notice?: string;
                methods?: Record<string, { notice?: string }>;
            };
            devdoc?: {
                title?: string;
                author?: string;
                details?: string;
                methods?: Record<string, {
                    details?: string;
                    params?: Record<string, string>;
                    return?: string;
                    returns?: Record<string, string>;
                }>;
            };
        };
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
        natspec: extractNatSpec(metadata.output ?? {}),
    };
}

function extractNatSpec(output: {
    userdoc?: {
        notice?: string;
        methods?: Record<string, { notice?: string }>;
    };
    devdoc?: {
        title?: string;
        author?: string;
        details?: string;
        methods?: Record<string, {
            details?: string;
            params?: Record<string, string>;
            return?: string;
            returns?: Record<string, string>;
        }>;
    };
}): NatSpec {
    const userMethods = output.userdoc?.methods ?? {};
    const devMethods = output.devdoc?.methods ?? {};
    const allKeys = new Set([
        ...Object.keys(userMethods),
        ...Object.keys(devMethods),
    ]);

    const methods: Record<string, MethodDoc> = {};
    for (const sig of allKeys) {
        const u = userMethods[sig] ?? {};
        const d = devMethods[sig] ?? {};
        const m: MethodDoc = {};
        if (u.notice) (m as { notice: string }).notice = u.notice;
        if (d.details) (m as { details: string }).details = d.details;
        if (d.params && Object.keys(d.params).length > 0) {
            (m as { params: Record<string, string> }).params = d.params;
        }
        if (d.returns && Object.keys(d.returns).length > 0) {
            (m as { returns: Record<string, string> }).returns = d.returns;
        } else if (d.return) {
            (m as { returns: string }).returns = d.return;
        }
        methods[sig] = m;
    }
    const out: NatSpec = { methods };
    if (output.userdoc?.notice) {
        (out as { contractNotice: string }).contractNotice = output.userdoc.notice;
    }
    if (output.devdoc?.details) {
        (out as { contractDetails: string }).contractDetails = output.devdoc.details;
    }
    if (output.devdoc?.title) {
        (out as { contractTitle: string }).contractTitle = output.devdoc.title;
    }
    if (output.devdoc?.author) {
        (out as { contractAuthor: string }).contractAuthor = output.devdoc.author;
    }
    return out;
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
        // Etherscan's getsourcecode payload doesn't carry NatSpec — only the
        // raw source. Future enhancement: parse @notice/@dev out of the
        // sources via a tiny Solidity comment scanner. For now: empty.
        natspec: { methods: {} },
    };
}

// ---------------------------------------------------------------------------
// Blockscout v2
// ---------------------------------------------------------------------------

interface BlockscoutV2SmartContract {
    name?: string;
    compiler_version?: string;
    abi?: AbiItem[];
    source_code?: string;
    file_path?: string;
    additional_sources?: Array<{ file_path: string; source_code: string }>;
    is_verified?: boolean;
    is_fully_verified?: boolean;
    is_partially_verified?: boolean;
    is_verified_via_sourcify?: boolean;
    sourcify_repo_url?: string;
}

async function fetchFromBlockscoutV2(
    addr: string,
    chainId: number,
    timeoutMs = 15000,
): Promise<VerifiedBundle> {
    const endpoint = BLOCKSCOUT_V2_ENDPOINTS[chainId];
    if (!endpoint) {
        throw new Error(
            `unsupported-chain: no Blockscout v2 endpoint for chain ${chainId}`,
        );
    }

    const url = `${endpoint}/smart-contracts/${addr}`;
    const res = await fetchWithTimeout(url, timeoutMs);

    if (res.status === 404) {
        throw new Error(
            `not-verified: blockscout v2 has no record for ${addr} on chain ${chainId}`,
        );
    }
    if (!res.ok) {
        throw new Error(`network: blockscout v2 returned ${res.status} for ${addr}`);
    }

    const body = (await res.json()) as BlockscoutV2SmartContract;

    if (!body.is_verified) {
        throw new Error(
            `not-verified: blockscout v2 reports ${addr} as unverified`,
        );
    }
    if (!body.abi || !Array.isArray(body.abi)) {
        throw new Error(
            `malformed: blockscout v2 response for ${addr} has no ABI`,
        );
    }

    // Source files: `source_code` is the main file (or a flattened blob).
    // `additional_sources` carries the rest of a multi-file contract.
    const sources: Record<string, string> = {};
    const mainPath = body.file_path || `${body.name || "main"}.sol`;
    if (body.source_code) {
        sources[mainPath] = body.source_code;
    }
    for (const extra of body.additional_sources ?? []) {
        sources[extra.file_path] = extra.source_code;
    }

    const matchKind: VerifiedBundle["matchKind"] = body.is_fully_verified
        ? "full"
        : "partial";

    return {
        address: addr,
        chainId,
        contractName: body.name ?? guessContractName([], addr),
        abi: body.abi,
        compilerVersion: body.compiler_version ?? "unknown",
        sources,
        matchKind,
        // Blockscout v2 doesn't expose solc's userdoc/devdoc directly.
        // If `is_verified_via_sourcify` is true we could *re-fetch* from
        // Sourcify just to grab the NatSpec, but that defeats the point
        // of the fallback. Leave empty; NatSpec degrades gracefully.
        natspec: { methods: {} },
    };
}

// ---------------------------------------------------------------------------
// Etherscan-compat fallback
// ---------------------------------------------------------------------------

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
