// @ts-nocheck — Envio handler registration infers event/context as any until upstream fixes generated typings.
import {
  ArbitratorIEvidence,
  ConditionalTokens,
  CurateIEvidence,
  FutarchyFactory,
  MarketFactory,
  Reality,
} from "generated";
import type { Address } from "viem";
import type { IndexerContext } from "./context";
import {
  collateralForSplitMerge,
  getMarketFromTx,
  mergeMethods,
  redeemMethods,
  splitMethods,
} from "./conditionalLogic";
import {
  fetchFutarchyMarketData,
  fetchGenericMarketData,
  processMarket,
  readCollateralToken,
} from "./marketsLogic";
import { entityId } from "./entityIds";
import { getFinalizeTs, processReopenedQuestion } from "./realityLogic";

function qid(p: `0x${string}` | string): string {
  return p.toLowerCase();
}

async function forEachQuestionMarket(
  context: IndexerContext,
  chainId: number,
  questionId: string,
  fn: (marketId: string) => Promise<void>
): Promise<void> {
  const question = await context.Question.get(entityId(chainId, questionId));
  if (!question) return;
  for (const mqId of question.marketQuestionIds) {
    const mq = await context.MarketQuestion.get(mqId);
    if (!mq) continue;
    await fn(mq.market_id);
  }
}

MarketFactory.NewMarket.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const blockNumber = event.block.number;
  const factory = event.srcAddress as Address;
  const marketAddr = event.params.market as Address;
  const data = await fetchGenericMarketData(chainId, blockNumber, factory, marketAddr);
  const collateral = await readCollateralToken(chainId, blockNumber, factory);
  await processMarket(
    context,
    {
      chainId,
      factory,
      creator: (event.transaction as { from: Address }).from,
      txHash: (event.transaction as { hash: string }).hash,
      blockNumber,
      blockTimestamp: event.block.timestamp,
    },
    data,
    collateral
  );
});

FutarchyFactory.NewProposal.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const blockNumber = event.block.number;
  const futarchyFactory = event.srcAddress as Address;
  const proposal = event.params.proposal as Address;
  const data = await fetchFutarchyMarketData(
    chainId,
    blockNumber,
    futarchyFactory,
    proposal,
    event.params.marketName,
    event.params.conditionId,
    event.params.questionId
  );
  await processMarket(
    context,
    {
      chainId,
      factory: futarchyFactory,
      creator: (event.transaction as { from: Address }).from,
      txHash: (event.transaction as { hash: string }).hash,
      blockNumber,
      blockTimestamp: event.block.timestamp,
    },
    data,
    "0x0000000000000000000000000000000000000000" as Address
  );
});

Reality.LogNewAnswer.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const questionId = qid(event.params.question_id as `0x${string}`);
  const question = await context.Question.get(entityId(chainId, questionId));
  if (!question) return;

  const finalizeTs = question.arbitration_occurred
    ? event.params.ts
    : event.params.ts + question.timeout;

  context.Question.set({
    ...question,
    finalize_ts: finalizeTs,
    best_answer: (event.params.answer as `0x${string}`).toLowerCase() as `0x${string}`,
    bond: event.params.bond,
  });

  await forEachQuestionMarket(context, chainId, questionId, async (marketId) => {
    const market = await context.Market.get(marketId);
    if (!market) return;
    const ft = await getFinalizeTs(context, market.id);
    context.Market.set({
      ...market,
      hasAnswers: true,
      finalizeTs: ft,
      updatedAt: event.block.timestamp,
    });
  });
});

Reality.LogNotifyOfArbitrationRequest.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const questionId = qid(event.params.question_id as `0x${string}`);
  const question = await context.Question.get(entityId(chainId, questionId));
  if (!question) return;
  context.Question.set({ ...question, is_pending_arbitration: true });
  await forEachQuestionMarket(context, chainId, questionId, async (marketId) => {
    const market = await context.Market.get(marketId);
    if (!market) return;
    context.Market.set({
      ...market,
      questionsInArbitration: market.questionsInArbitration + 1n,
      updatedAt: event.block.timestamp,
    });
  });
});

Reality.LogCancelArbitration.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const questionId = qid(event.params.question_id as `0x${string}`);
  const question = await context.Question.get(entityId(chainId, questionId));
  if (!question) return;
  context.Question.set({ ...question, is_pending_arbitration: false });
  await forEachQuestionMarket(context, chainId, questionId, async (marketId) => {
    const market = await context.Market.get(marketId);
    if (!market) return;
    context.Market.set({
      ...market,
      questionsInArbitration: market.questionsInArbitration - 1n,
      updatedAt: event.block.timestamp,
    });
  });
});

Reality.LogFinalize.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const questionId = qid(event.params.question_id as `0x${string}`);
  const question = await context.Question.get(entityId(chainId, questionId));
  if (!question) return;
  context.Question.set({
    ...question,
    best_answer: (event.params.answer as `0x${string}`).toLowerCase() as `0x${string}`,
    is_pending_arbitration: false,
    arbitration_occurred: true,
  });
  await forEachQuestionMarket(context, chainId, questionId, async (marketId) => {
    const market = await context.Market.get(marketId);
    if (!market) return;
    context.Market.set({
      ...market,
      questionsInArbitration: market.questionsInArbitration - 1n,
      updatedAt: event.block.timestamp,
    });
  });
});

Reality.LogReopenQuestion.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const reopened = qid(event.params.reopened_question_id as `0x${string}`);
  const newQ = qid(event.params.question_id as `0x${string}`);
  await processReopenedQuestion(context, chainId, reopened, newQ, event.block.timestamp);
});

ConditionalTokens.PositionSplit.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const conditionId = entityId(chainId, qid(event.params.conditionId as `0x${string}`));
  const condition = await context.Condition.get(conditionId);
  if (!condition) return;
  const parentCol = (event.params.parentCollectionId as `0x${string}`).toLowerCase();
  for (const mid of condition.marketIds) {
    const market = await context.Market.get(mid);
    if (!market) continue;
    if (market.parentCollectionId === parentCol) {
      context.Market.set({
        ...market,
        outcomesSupply: market.outcomesSupply + event.params.amount,
        updatedAt: event.block.timestamp,
      });
    }
  }
  const input = (event.transaction as { input?: `0x${string}` }).input;
  const market = await getMarketFromTx(context, chainId, input, splitMethods);
  if (!market) return;
  const full = await context.Market.get(market.id);
  if (!full) return;
  const id = entityId(
    chainId,
    `${(event.transaction as { hash: string }).hash.toLowerCase()}-${event.logIndex}`,
  );
  context.ConditionalEvent.set({
    id,
    market_id: full.id,
    accountId: (event.transaction as { from: Address }).from.toLowerCase(),
    eventType: "split",
    amount: event.params.amount,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    collateral: collateralForSplitMerge(full, event.params.collateralToken as Address),
    transactionHash: (event.transaction as { hash: string }).hash.toLowerCase(),
  });
});

ConditionalTokens.PositionsMerge.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const conditionId = entityId(chainId, qid(event.params.conditionId as `0x${string}`));
  const condition = await context.Condition.get(conditionId);
  if (!condition) return;
  const parentCol = (event.params.parentCollectionId as `0x${string}`).toLowerCase();
  for (const mid of condition.marketIds) {
    const market = await context.Market.get(mid);
    if (!market) continue;
    if (market.parentCollectionId === parentCol) {
      context.Market.set({
        ...market,
        outcomesSupply: market.outcomesSupply - event.params.amount,
        updatedAt: event.block.timestamp,
      });
    }
  }
  const input = (event.transaction as { input?: `0x${string}` }).input;
  const market = await getMarketFromTx(context, chainId, input, mergeMethods);
  if (!market) return;
  const full = await context.Market.get(market.id);
  if (!full) return;
  const id = entityId(
    chainId,
    `${(event.transaction as { hash: string }).hash.toLowerCase()}-${event.logIndex}`,
  );
  context.ConditionalEvent.set({
    id,
    market_id: full.id,
    accountId: (event.transaction as { from: Address }).from.toLowerCase(),
    eventType: "merge",
    amount: event.params.amount,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    collateral: collateralForSplitMerge(full, event.params.collateralToken as Address),
    transactionHash: (event.transaction as { hash: string }).hash.toLowerCase(),
  });
});

ConditionalTokens.PayoutRedemption.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const conditionId = entityId(chainId, qid(event.params.conditionId as `0x${string}`));
  const condition = await context.Condition.get(conditionId);
  if (!condition) return;
  const parentCol = (event.params.parentCollectionId as `0x${string}`).toLowerCase();
  for (const mid of condition.marketIds) {
    const market = await context.Market.get(mid);
    if (!market) continue;
    if (market.parentCollectionId === parentCol) {
      context.Market.set({
        ...market,
        outcomesSupply: market.outcomesSupply - event.params.payout,
        updatedAt: event.block.timestamp,
      });
    }
  }
  const input = (event.transaction as { input?: `0x${string}` }).input;
  const market = await getMarketFromTx(context, chainId, input, redeemMethods);
  if (!market) return;
  const full = await context.Market.get(market.id);
  if (!full) return;
  const id = entityId(
    chainId,
    `${(event.transaction as { hash: string }).hash.toLowerCase()}-${event.logIndex}`,
  );
  context.ConditionalEvent.set({
    id,
    market_id: full.id,
    accountId: (event.transaction as { from: Address }).from.toLowerCase(),
    eventType: "redeem",
    amount: event.params.payout,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    collateral: collateralForSplitMerge(full, event.params.collateralToken as Address),
    transactionHash: (event.transaction as { hash: string }).hash.toLowerCase(),
  });
});

ConditionalTokens.ConditionResolution.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const conditionId = entityId(chainId, qid(event.params.conditionId as `0x${string}`));
  const condition = await context.Condition.get(conditionId);
  if (!condition) return;
  const nums = [...event.params.payoutNumerators] as bigint[];
  for (const mid of condition.marketIds) {
    const market = await context.Market.get(mid);
    if (!market) continue;
    context.Market.set({
      ...market,
      payoutReported: true,
      payoutNumerators: nums,
      updatedAt: event.block.timestamp,
    });
  }
});

CurateIEvidence.MetaEvidence.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const addr = event.srcAddress.toLowerCase();
  const id = entityId(chainId, addr);
  let meta = await context.CurateMetadata.get(id);
  if (!meta) {
    meta = {
      id,
      registrationMetaEvidenceURI: "",
      clearingMetaEvidenceURI: "",
      metaEvidenceCount: 0n,
    };
  }
  const nextCount = meta.metaEvidenceCount + 1n;
  const isOdd = nextCount % 2n === 1n;
  context.CurateMetadata.set({
    ...meta,
    metaEvidenceCount: nextCount,
    registrationMetaEvidenceURI: isOdd
      ? event.params._evidence
      : meta.registrationMetaEvidenceURI,
    clearingMetaEvidenceURI: !isOdd ? event.params._evidence : meta.clearingMetaEvidenceURI,
  });
});

ArbitratorIEvidence.MetaEvidence.handler(async ({ event, context }) => {
  const chainId = Number(event.chainId);
  const addr = event.srcAddress.toLowerCase();
  const id = entityId(chainId, addr);
  let meta = await context.ArbitratorMetadata.get(id);
  if (!meta) {
    meta = { id, registrationMetaEvidenceURI: "" };
  }
  context.ArbitratorMetadata.set({
    ...meta,
    registrationMetaEvidenceURI: event.params._evidence,
  });
});
