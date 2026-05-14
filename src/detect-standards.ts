/**
 * ABI shape detectors for well-known token / vault / position standards.
 *
 * Each detector inspects the function set and (where it matters) argument
 * shapes to confidently classify an ABI. The CLI uses this to decide
 * whether to append a "polished view" tab built from `intrepidshape/elm-web3-ui`'s
 * curated module set (`Web3.Ui.Wallet`, `Web3.Ui.Balance`, etc.) in
 * addition to the generic auto-view.
 *
 * Detection is intentionally strict — false positives produce broken
 * polished views, so we require every signature in a standard's "core"
 * before classifying. False negatives just mean the user gets the generic
 * auto-view, which always works.
 */

import type { AbiItem, AbiParam } from "./fetch.ts";

export type Standard =
    | "erc20"
    | "erc721"
    | "erc1155"
    | "erc4626"
    | null;

export interface StandardMatch {
    readonly standard: Exclude<Standard, null>;
    readonly evidence: readonly string[];
}

export function detectStandard(abi: readonly AbiItem[]): StandardMatch | null {
    const fns = functionsByName(abi);

    // Order matters: ERC-4626 extends ERC-20, so we check 4626 first.
    if (isErc4626(fns)) {
        return { standard: "erc4626", evidence: ERC4626_CORE };
    }
    if (isErc721(fns)) {
        return { standard: "erc721", evidence: ERC721_CORE };
    }
    if (isErc1155(fns)) {
        return { standard: "erc1155", evidence: ERC1155_CORE };
    }
    if (isErc20(fns)) {
        return { standard: "erc20", evidence: ERC20_CORE };
    }

    return null;
}

// ---------------------------------------------------------------------------
// Core function-set signatures (canonical Solidity)
// ---------------------------------------------------------------------------

const ERC20_CORE = [
    "totalSupply()",
    "balanceOf(address)",
    "transfer(address,uint256)",
    "approve(address,uint256)",
    "allowance(address,address)",
    "transferFrom(address,address,uint256)",
] as const;

const ERC721_CORE = [
    "balanceOf(address)",
    "ownerOf(uint256)",
    "safeTransferFrom(address,address,uint256)",
    "approve(address,uint256)",
    "setApprovalForAll(address,bool)",
] as const;

const ERC1155_CORE = [
    "balanceOf(address,uint256)",
    "balanceOfBatch(address[],uint256[])",
    "setApprovalForAll(address,bool)",
    "safeTransferFrom(address,address,uint256,uint256,bytes)",
    "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
] as const;

const ERC4626_CORE = [
    "asset()",
    "totalAssets()",
    "convertToShares(uint256)",
    "convertToAssets(uint256)",
    "deposit(uint256,address)",
    "redeem(uint256,address,address)",
] as const;


// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

function isErc20(fns: ReadonlyMap<string, AbiItem>): boolean {
    return hasAll(fns, ERC20_CORE);
}

function isErc721(fns: ReadonlyMap<string, AbiItem>): boolean {
    if (!hasAll(fns, ERC721_CORE)) return false;
    // `transfer(address,uint256)` exists on both ERC-20 and ERC-721, but ERC-721
    // also has `ownerOf` and `safeTransferFrom` with the 3-arg shape — the core
    // list above already requires those. Disambiguate from ERC-20:
    // ERC-721's `balanceOf` returns the NFT count (no decimals method).
    if (fns.has("decimals()")) return false;
    return true;
}

function isErc1155(fns: ReadonlyMap<string, AbiItem>): boolean {
    return hasAll(fns, ERC1155_CORE);
}

function isErc4626(fns: ReadonlyMap<string, AbiItem>): boolean {
    return hasAll(fns, ERC4626_CORE) && hasAll(fns, ERC20_CORE);
}

function hasAll(fns: ReadonlyMap<string, AbiItem>, sigs: readonly string[]): boolean {
    return sigs.every((s) => fns.has(s));
}


// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

function functionsByName(abi: readonly AbiItem[]): ReadonlyMap<string, AbiItem> {
    const out = new Map<string, AbiItem>();
    for (const item of abi) {
        if (item.type !== "function" || !item.name) continue;
        const sig = `${item.name}(${(item.inputs ?? []).map(canonicalType).join(",")})`;
        out.set(sig, item);
    }
    return out;
}

function canonicalType(p: AbiParam): string {
    if (p.type.startsWith("tuple")) {
        const inner = (p.components ?? []).map(canonicalType).join(",");
        const suffix = p.type.slice("tuple".length);
        return `(${inner})${suffix}`;
    }
    return p.type;
}
