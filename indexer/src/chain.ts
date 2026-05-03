import { createPublicClient, http } from "viem";
import { base, gnosis, mainnet, optimism, sepolia } from "viem/chains";

const RPC: Record<number, string> = {
  100: "https://rpc.gnosischain.com",
  1: "https://eth.llamarpc.com",
  10: "https://mainnet.optimism.io",
  8453: "https://mainnet.base.org",
  11155111: "https://rpc.sepolia.org",
};

const clients = new Map<number, unknown>();

/** viem Client; typed loosely to avoid duplicate viem installs vs envio's bundled viem. */
export function getPublicClient(chainId: number): any {
  const hit = clients.get(chainId);
  if (hit) return hit;
  const chain =
    chainId === 100
      ? gnosis
      : chainId === 1
        ? mainnet
        : chainId === 10
          ? optimism
          : chainId === 8453
            ? base
            : chainId === 11155111
              ? sepolia
              : undefined;
  const url = RPC[chainId];
  if (!chain || !url) {
    throw new Error(`Unsupported chainId ${chainId} for RPC reads`);
  }
  const client = createPublicClient({ chain, transport: http(url) });
  clients.set(chainId, client);
  return client;
}
