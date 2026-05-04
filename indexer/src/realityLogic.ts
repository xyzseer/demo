import type { IndexerContext } from "./context";
import { entityId } from "./entityIds";
import { DEFAULT_FINALIZE_TS } from "./marketsLogic";

export async function getFinalizeTs(context: IndexerContext, marketId: string): Promise<bigint> {
  const market = await context.Market.get(marketId);
  if (!market) return 0n;
  let finalizeTs = 0n;
  for (const mqId of market.marketQuestionIds) {
    const mq = await context.MarketQuestion.get(mqId);
    if (!mq) continue;
    const question = await context.Question.get(mq.question_id);
    if (!question) continue;
    if (question.finalize_ts === 0n) {
      return DEFAULT_FINALIZE_TS;
    }
    if (question.finalize_ts > finalizeTs) {
      finalizeTs = question.finalize_ts;
    }
  }
  return finalizeTs;
}

export async function processReopenedQuestion(
  context: IndexerContext,
  chainId: number,
  baseQuestionId: string,
  newQuestionId: string,
  blockTimestamp: bigint
): Promise<void> {
  const baseQuestion = await context.Question.get(entityId(chainId, baseQuestionId));
  if (!baseQuestion) return;

  const mqIds = baseQuestion.marketQuestionIds;
  if (mqIds.length === 0) return;

  const newQKey = entityId(chainId, newQuestionId);
  context.Question.set({
    id: newQKey,
    questionId: newQuestionId.toLowerCase() as `0x${string}`,
    index: baseQuestion.index,
    arbitrator: baseQuestion.arbitrator,
    opening_ts: baseQuestion.opening_ts,
    timeout: baseQuestion.timeout,
    finalize_ts: 0n,
    is_pending_arbitration: false,
    best_answer: "0x" + "0".repeat(64),
    bond: 0n,
    min_bond: baseQuestion.min_bond,
    arbitration_occurred: false,
    marketQuestionIds: [...mqIds],
  });

  for (const mqId of mqIds) {
    const mq = await context.MarketQuestion.get(mqId);
    if (!mq) continue;
    context.MarketQuestion.set({
      ...mq,
      question_id: newQKey,
    });
    const market = await context.Market.get(mq.market_id);
    if (market) {
      const ft = await getFinalizeTs(context, market.id);
      context.Market.set({
        ...market,
        finalizeTs: ft,
        updatedAt: blockTimestamp,
      });
    }
  }

  context.Question.set({
    ...baseQuestion,
    marketQuestionIds: [],
  });
}
