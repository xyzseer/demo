import type { Address } from "viem";
import { zeroAddress } from "viem";
import type { IndexerContext } from "./context";
import { getMarketViewAddress } from "./addresses";
import { getPublicClient } from "./chain";
import MarketViewAbi from "../abis/MarketView.json";
import MarketFactoryAbi from "../abis/MarketFactory.json";
import FutarchyFactoryAbi from "../abis/FutarchyFactory.json";
import FutarchyProposalAbi from "../abis/FutarchyProposal.json";
import RealityAbi from "../abis/Realitiy.json";

export const DEFAULT_FINALIZE_TS = 33260976000n;

export type QuestionRow = {
  opening_ts: bigint;
  arbitrator: Address;
  timeout: bigint;
  finalize_ts: bigint;
  is_pending_arbitration: boolean;
  best_answer: `0x${string}`;
  bond: bigint;
  min_bond: bigint;
};

export type MarketProcessInput = {
  id: string;
  marketType: "Generic" | "Futarchy";
  marketName: string;
  outcomes: string[];
  lowerBound: bigint;
  upperBound: bigint;
  parentCollectionId: `0x${string}`;
  parentOutcome: bigint;
  parentMarket: Address;
  collateralToken1: Address;
  collateralToken2: Address;
  wrappedTokens: Address[];
  conditionId: `0x${string}`;
  questionId: `0x${string}`;
  questionsIds: `0x${string}`[];
  templateId: bigint;
  encodedQuestions: string[];
  questions: QuestionRow[];
};

function addrLower(a: string): string {
  return a.toLowerCase() as `0x${string}`;
}

async function getNextMarketIndex(context: IndexerContext): Promise<bigint> {
  let row = await context.MarketsCount.get("markets-count");
  if (!row) {
    row = { id: "markets-count", count: 0n };
  }
  const next = row.count + 1n;
  context.MarketsCount.set({ id: "markets-count", count: next });
  return next;
}

async function getCollateralToken(
  context: IndexerContext,
  parentMarket: Address,
  parentOutcome: bigint,
  collateralToken: Address
): Promise<`0x${string}`> {
  if (parentMarket === zeroAddress || parentMarket.toLowerCase() === zeroAddress) {
    return addrLower(collateralToken) as `0x${string}`;
  }
  const market = await context.Market.get(parentMarket.toLowerCase());
  if (!market) {
    return addrLower(collateralToken) as `0x${string}`;
  }
  const idx = Number(parentOutcome);
  const wt = market.wrappedTokens[idx];
  return (wt ? wt.toLowerCase() : collateralToken.toLowerCase()) as `0x${string}`;
}

export async function processMarket(
  context: IndexerContext,
  meta: {
    factory: string;
    creator: string;
    txHash: string;
    blockNumber: bigint;
    blockTimestamp: bigint;
  },
  data: MarketProcessInput,
  collateralToken: Address
): Promise<void> {
  const marketId = data.id.toLowerCase();
  const conditionIdHex = data.conditionId.toLowerCase();

  const condPrev = await context.Condition.get(conditionIdHex);
  const nextMarketIds = [...(condPrev?.marketIds ?? [])];
  if (!nextMarketIds.includes(marketId)) {
    nextMarketIds.push(marketId);
  }
  context.Condition.set({ id: conditionIdHex, marketIds: nextMarketIds });

  const parentId =
    data.parentMarket === zeroAddress || data.parentMarket.toLowerCase() === zeroAddress
      ? undefined
      : data.parentMarket.toLowerCase();

  const ct = await getCollateralToken(context, data.parentMarket, data.parentOutcome, collateralToken);

  const marketEntity = {
    id: marketId,
    marketType: data.marketType === "Futarchy" ? ("Futarchy" as const) : ("Generic" as const),
    factory: addrLower(meta.factory),
    creator: addrLower(meta.creator),
    marketName: data.marketName,
    outcomes: data.outcomes,
    outcomesSupply: 0n,
    lowerBound: data.lowerBound,
    upperBound: data.upperBound,
    parentCollectionId: data.parentCollectionId.toLowerCase(),
    parentOutcome: data.parentOutcome,
    parentMarket_id: parentId,
    wrappedTokens: data.wrappedTokens.map((w) => w.toLowerCase() as `0x${string}`),
    collateralToken: ct,
    collateralToken1: addrLower(data.collateralToken1) as `0x${string}`,
    collateralToken2: addrLower(data.collateralToken2) as `0x${string}`,
    conditionId: data.conditionId.toLowerCase() as `0x${string}`,
    ctfCondition_id: conditionIdHex,
    questionId: data.questionId.toLowerCase() as `0x${string}`,
    templateId: data.templateId,
    encodedQuestions: data.encodedQuestions,
    payoutReported: false,
    payoutNumerators: data.outcomes.map(() => 0n),
    openingTs: 0n,
    finalizeTs: DEFAULT_FINALIZE_TS,
    questionsInArbitration: 0n,
    hasAnswers: false,
    index: await getNextMarketIndex(context),
    blockNumber: meta.blockNumber,
    blockTimestamp: meta.blockTimestamp,
    transactionHash: meta.txHash.toLowerCase() as `0x${string}`,
    updatedAt: meta.blockTimestamp,
  };

  let openingTs = 0n;
  const mqIds: string[] = [];
  for (let i = 0; i < data.questionsIds.length; i++) {
    const qRow = data.questions[i];
    if (i === 0) {
      openingTs = qRow.opening_ts;
    }
    const qid = data.questionsIds[i].toLowerCase();
    const mqId = `${marketId}${qid}${i}`;
    mqIds.push(mqId);
    const prevQ = await context.Question.get(qid);
    const prevMqIds = prevQ?.marketQuestionIds ?? [];
    const nextQmq = prevMqIds.includes(mqId) ? prevMqIds : [...prevMqIds, mqId];
    context.Question.set({
      id: qid,
      index: i,
      arbitrator: addrLower(qRow.arbitrator) as `0x${string}`,
      opening_ts: qRow.opening_ts,
      timeout: qRow.timeout,
      finalize_ts: qRow.finalize_ts,
      is_pending_arbitration: qRow.is_pending_arbitration,
      best_answer: qRow.best_answer.toLowerCase() as `0x${string}`,
      bond: qRow.bond,
      min_bond: qRow.min_bond,
      arbitration_occurred: false,
      marketQuestionIds: nextQmq,
    });
    context.MarketQuestion.set({
      id: mqId,
      market_id: marketId,
      baseQuestion_id: qid,
      question_id: qid,
      index: i,
    });
  }

  context.Market.set({
    ...marketEntity,
    openingTs,
    marketQuestionIds: mqIds,
  });
}

export async function fetchGenericMarketData(
  chainId: number,
  blockNumber: bigint,
  factoryAddress: Address,
  marketAddress: Address
): Promise<MarketProcessInput> {
  const client = getPublicClient(chainId);
  const view = getMarketViewAddress(chainId);
  const data = (await client.readContract({
    address: view,
    abi: MarketViewAbi as readonly unknown[],
    functionName: "getMarket",
    args: [factoryAddress, marketAddress],
    blockNumber,
  })) as {
    id: Address;
    marketName: string;
    outcomes: string[];
    parentMarket: Address;
    parentOutcome: bigint;
    wrappedTokens: Address[];
    outcomesSupply: bigint;
    lowerBound: bigint;
    upperBound: bigint;
    parentCollectionId: `0x${string}`;
    conditionId: `0x${string}`;
    questionId: `0x${string}`;
    templateId: bigint;
    questions: {
      content_hash: `0x${string}`;
      arbitrator: Address;
      opening_ts: number;
      timeout: number;
      finalize_ts: number;
      is_pending_arbitration: boolean;
      bounty: bigint;
      best_answer: `0x${string}`;
      history_hash: `0x${string}`;
      bond: bigint;
      min_bond: bigint;
    }[];
    questionsIds: `0x${string}`[];
    encodedQuestions: string[];
    payoutReported: boolean;
  };

  const questions: QuestionRow[] = data.questions.map((q) => ({
    opening_ts: BigInt(q.opening_ts),
    arbitrator: q.arbitrator,
    timeout: BigInt(q.timeout),
    finalize_ts: BigInt(q.finalize_ts),
    is_pending_arbitration: q.is_pending_arbitration,
    best_answer: q.best_answer,
    bond: q.bond,
    min_bond: q.min_bond,
  }));

  return {
    id: marketAddress.toLowerCase(),
    marketType: "Generic",
    marketName: data.marketName,
    outcomes: data.outcomes,
    lowerBound: data.lowerBound,
    upperBound: data.upperBound,
    parentCollectionId: data.parentCollectionId,
    parentOutcome: data.parentOutcome,
    parentMarket: data.parentMarket,
    collateralToken1: zeroAddress,
    collateralToken2: zeroAddress,
    wrappedTokens: data.wrappedTokens,
    conditionId: data.conditionId,
    questionId: data.questionId,
    questionsIds: data.questionsIds.map((x) => x.toLowerCase() as `0x${string}`),
    templateId: data.templateId,
    encodedQuestions: data.encodedQuestions,
    questions,
  };
}

export async function readCollateralToken(
  chainId: number,
  blockNumber: bigint,
  factoryAddress: Address
): Promise<Address> {
  const client = getPublicClient(chainId);
  return client.readContract({
    address: factoryAddress,
    abi: MarketFactoryAbi as readonly unknown[],
    functionName: "collateralToken",
    blockNumber,
  }) as Promise<Address>;
}

export async function fetchFutarchyMarketData(
  chainId: number,
  blockNumber: bigint,
  futarchyFactory: Address,
  proposal: Address,
  marketName: string,
  conditionId: `0x${string}`,
  questionId: `0x${string}`
): Promise<MarketProcessInput> {
  const client = getPublicClient(chainId);
  const outcomes: string[] = [];
  const wrappedTokens: Address[] = [];
  for (let i = 0; i < 4; i++) {
    const o = (await client.readContract({
      address: proposal,
      abi: FutarchyProposalAbi as readonly unknown[],
      functionName: "outcomes",
      args: [BigInt(i)],
      blockNumber,
    })) as string;
    outcomes.push(o);
    const wo = (await client.readContract({
      address: proposal,
      abi: FutarchyProposalAbi as readonly unknown[],
      functionName: "wrappedOutcome",
      args: [BigInt(i)],
      blockNumber,
    })) as readonly [Address, `0x${string}`];
    wrappedTokens.push(wo[0]);
  }
  const realitio = (await client.readContract({
    address: futarchyFactory,
    abi: FutarchyFactoryAbi as readonly unknown[],
    functionName: "realitio",
    blockNumber,
  })) as Address;

  const q = (await client.readContract({
    address: realitio,
    abi: RealityAbi as readonly unknown[],
    functionName: "questions",
    args: [questionId],
    blockNumber,
  })) as readonly [
    `0x${string}`,
    Address,
    number,
    number,
    number,
    boolean,
    bigint,
    `0x${string}`,
    `0x${string}`,
    bigint,
    bigint,
  ];
  // content_hash, arbitrator, opening_ts, timeout, finalize_ts, is_pending_arbitration, bounty, best_answer, history_hash, bond, min_bond

  const encodedQuestion = (await client.readContract({
    address: proposal,
    abi: FutarchyProposalAbi as readonly unknown[],
    functionName: "encodedQuestion",
    blockNumber,
  })) as string;

  const parentCollectionId = (await client.readContract({
    address: proposal,
    abi: FutarchyProposalAbi as readonly unknown[],
    functionName: "parentCollectionId",
    blockNumber,
  })) as `0x${string}`;
  const parentOutcome = (await client.readContract({
    address: proposal,
    abi: FutarchyProposalAbi as readonly unknown[],
    functionName: "parentOutcome",
    blockNumber,
  })) as bigint;
  const parentMarket = (await client.readContract({
    address: proposal,
    abi: FutarchyProposalAbi as readonly unknown[],
    functionName: "parentMarket",
    blockNumber,
  })) as Address;
  const ct1 = (await client.readContract({
    address: proposal,
    abi: FutarchyProposalAbi as readonly unknown[],
    functionName: "collateralToken1",
    blockNumber,
  })) as Address;
  const ct2 = (await client.readContract({
    address: proposal,
    abi: FutarchyProposalAbi as readonly unknown[],
    functionName: "collateralToken2",
    blockNumber,
  })) as Address;

  const questionRow: QuestionRow = {
    opening_ts: BigInt(q[2]),
    arbitrator: q[1],
    timeout: BigInt(q[3]),
    finalize_ts: BigInt(q[4]),
    is_pending_arbitration: q[5],
    best_answer: q[7],
    bond: q[9],
    min_bond: q[10],
  };

  return {
    id: proposal.toLowerCase(),
    marketType: "Futarchy",
    marketName,
    outcomes,
    lowerBound: 0n,
    upperBound: 0n,
    collateralToken1: ct1,
    collateralToken2: ct2,
    parentCollectionId,
    parentOutcome,
    parentMarket,
    wrappedTokens,
    conditionId,
    questionId,
    questionsIds: [questionId.toLowerCase() as `0x${string}`],
    templateId: 2n,
    encodedQuestions: [encodedQuestion],
    questions: [questionRow],
  };
}
