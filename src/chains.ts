/**
 * EVM chain registry.
 *
 * Maps user-facing chain slugs to chain IDs and explorer URLs. The set
 * mirrors `Web3.Chain` in `intrepidshape/elm-web3` plus a handful of common
 * networks. Add to this list to support more chains; nothing else in the
 * pipeline cares about a particular chain — Sourcify accepts any chain ID
 * its registry knows about.
 */

export interface ChainInfo {
    readonly slug: string;            // CLI-facing
    readonly elmName: string;         // identifier in Web3.Chain (e.g. "pulsechain")
    readonly chainId: number;
    readonly name: string;
    readonly explorer: string;
    readonly rpcUrl: string;
}

/**
 * Restricted to chains that `intrepidshape/elm-web3` currently exposes via
 * `Web3.Chain`. Adding a chain here requires also adding it upstream — the
 * generated `Main.elm` references `Chain.<elmName>` directly.
 */
export const CHAINS: readonly ChainInfo[] = [
    {
        slug: "pulsechain",
        elmName: "pulsechain",
        chainId: 369,
        name: "PulseChain",
        explorer: "https://scan.pulsechain.com",
        rpcUrl: "https://rpc.pulsechain.com",
    },
    {
        slug: "pulsechain-testnet",
        elmName: "pulsechainTestnet",
        chainId: 943,
        name: "PulseChain Testnet v4",
        explorer: "https://scan.v4.testnet.pulsechain.com",
        rpcUrl: "https://rpc.v4.testnet.pulsechain.com",
    },
    {
        slug: "ethereum",
        elmName: "ethereum",
        chainId: 1,
        name: "Ethereum Mainnet",
        explorer: "https://etherscan.io",
        rpcUrl: "https://eth.llamarpc.com",
    },
    {
        slug: "sepolia",
        elmName: "sepolia",
        chainId: 11155111,
        name: "Sepolia",
        explorer: "https://sepolia.etherscan.io",
        rpcUrl: "https://rpc.sepolia.org",
    },
] as const;

export function resolveChain(slugOrId: string): ChainInfo {
    const asInt = parseInt(slugOrId, 10);
    const byId = Number.isFinite(asInt)
        ? CHAINS.find((c) => c.chainId === asInt)
        : undefined;
    if (byId) return byId;
    const bySlug = CHAINS.find((c) => c.slug === slugOrId.toLowerCase());
    if (bySlug) return bySlug;
    throw new Error(
        `Unknown chain: ${slugOrId}. Known slugs: ${CHAINS.map((c) => c.slug).join(", ")}`,
    );
}
