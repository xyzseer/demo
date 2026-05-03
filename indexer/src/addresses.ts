import type { Address } from "viem";

export function getMarketViewAddress(chainId: number): Address {
  if (chainId === 11_155_111) {
    return "0x03d03464bf9eb20059ca6ef6391e9c5d79d5e012";
  }
  if (chainId === 1) {
    return "0xab797c4c6022a401c31543e316d3cd04c67a87fc";
  }
  if (chainId === 10) {
    return "0x1f728c2fd6a3008935c1446a965a313e657b7904";
  }
  if (chainId === 8453) {
    return "0x1f728c2fd6a3008935c1446a965a313e657b7904";
  }
  return "0x995dc9c89b6605a1e8cc028b37cb8e568e27626f";
}
