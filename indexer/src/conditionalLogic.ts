import type { Address } from "viem";
import type { IndexerContext } from "./context";

type MethodSig = { name: string; signature: string; marketParamPos: number };

const splitMethods: MethodSig[] = [
  { name: "splitFromBase", signature: "0x50d9991c", marketParamPos: 0 },
  { name: "splitFromDai", signature: "0x59a89d8b", marketParamPos: 0 },
  { name: "splitPosition", signature: "0xd5f82280", marketParamPos: 1 },
  { name: "splitPosition", signature: "0x21816254", marketParamPos: 0 },
];

const mergeMethods: MethodSig[] = [
  { name: "mergeToBase", signature: "0xd6d150d1", marketParamPos: 0 },
  { name: "mergeToDai", signature: "0x4c95d98b", marketParamPos: 0 },
  { name: "mergePositions", signature: "0x7abef8d1", marketParamPos: 1 },
  { name: "mergePositions", signature: "0xaab8ff62", marketParamPos: 0 },
];

const redeemMethods: MethodSig[] = [
  { name: "redeemToBase", signature: "0x9fe603e8", marketParamPos: 0 },
  { name: "redeemToDai", signature: "0xb6fefc75", marketParamPos: 0 },
  { name: "redeemPositions", signature: "0x865955a0", marketParamPos: 1 },
  { name: "redeemProposal", signature: "0x3f325a2b", marketParamPos: 0 },
];

function getMethodSignature(methods: MethodSig[], methodId: string): MethodSig | null {
  for (const m of methods) {
    if (m.signature === methodId) return m;
  }
  return null;
}

function decodeAddressArgInner(input: `0x${string}`, marketParamPos: number): Address | null {
  const byteStart = 4 + marketParamPos * 32;
  const hexStart = 2 + byteStart * 2;
  if (input.length < hexStart + 64) return null;
  const word = input.slice(hexStart, hexStart + 64);
  return ("0x" + word.slice(24)).toLowerCase() as Address;
}

export async function getMarketFromTx(
  context: IndexerContext,
  input: `0x${string}` | undefined,
  methods: MethodSig[]
): Promise<{ id: string; marketType: "Generic" | "Futarchy"; collateralToken: string } | null> {
  if (!input || input.length < 10) return null;
  const methodId = input.slice(0, 10).toLowerCase();
  const matchingMethod = getMethodSignature(methods, methodId);
  if (!matchingMethod) return null;
  const addr = decodeAddressArgInner(input, matchingMethod.marketParamPos);
  if (!addr) return null;
  const market = await context.Market.get(addr.toLowerCase());
  return market ?? null;
}

export function collateralForSplitMerge(
  market: { marketType: "Generic" | "Futarchy"; collateralToken: string },
  evtCollateral: Address
): `0x${string}` {
  return (
    market.marketType === "Generic" ? market.collateralToken : evtCollateral.toLowerCase()
  ) as `0x${string}`;
}

export { splitMethods, mergeMethods, redeemMethods };
