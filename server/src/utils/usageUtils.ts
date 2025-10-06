import type { CompletionUsage } from 'openai/resources';

import type { TokenUsageSnapshot } from '../types';

const asNumber = (value: number | null | undefined): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export const toTokenUsage = (usage: CompletionUsage | null | undefined, model?: string): TokenUsageSnapshot | undefined => {
  if (!usage) {
    return undefined;
  }

  const promptTokens = asNumber(usage.prompt_tokens);
  const completionTokens = asNumber(usage.completion_tokens);
  const totalTokens = asNumber(usage.total_tokens) || promptTokens + completionTokens;

  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return undefined;
  }

  const snapshot: TokenUsageSnapshot = {
    promptTokens,
    completionTokens,
    totalTokens,
  };

  if (model) {
    snapshot.model = model;
  }

  return snapshot;
};

export const mergeTokenUsage = (
  ...snapshots: Array<TokenUsageSnapshot | null | undefined>
): TokenUsageSnapshot | undefined => {
  const filtered = snapshots.filter((value): value is TokenUsageSnapshot => Boolean(value));
  if (filtered.length === 0) {
    return undefined;
  }

  const first = filtered[0]!;
  const rest = filtered.slice(1);
  const result: TokenUsageSnapshot = {
    promptTokens: first.promptTokens,
    completionTokens: first.completionTokens,
    totalTokens: first.totalTokens,
    ...(typeof first.model === 'string' ? { model: first.model } : {}),
  };

  for (const current of rest) {
    result.promptTokens += current.promptTokens;
    result.completionTokens += current.completionTokens;
    result.totalTokens += current.totalTokens;

    if (typeof result.model !== 'string' && typeof current.model === 'string') {
      result.model = current.model;
    }
  }

  return result;
};

export const addTokenUsage = (
  base: TokenUsageSnapshot | undefined,
  increment: TokenUsageSnapshot | undefined
): TokenUsageSnapshot | undefined => {
  if (!base) {
    return increment ? { ...increment } : undefined;
  }

  if (!increment) {
    return { ...base };
  }

  const combined: TokenUsageSnapshot = {
    promptTokens: base.promptTokens + increment.promptTokens,
    completionTokens: base.completionTokens + increment.completionTokens,
    totalTokens: base.totalTokens + increment.totalTokens,
  };

  const model = base.model ?? increment.model;
  if (typeof model === 'string') {
    combined.model = model;
  }

  return combined;
};

export const isTokenUsageDefined = (usage: TokenUsageSnapshot | undefined): usage is TokenUsageSnapshot =>
  Boolean(usage && (usage.promptTokens > 0 || usage.completionTokens > 0 || usage.totalTokens > 0));
