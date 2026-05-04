/** Multichain-safe entity id: one DB for all chains → prefix chainId. */
export function entityId(chainId: number, hexKey: string): string {
  return `${chainId}:${hexKey.toLowerCase()}`;
}

export function marketsCountId(chainId: number): string {
  return `markets-count-${chainId}`;
}
