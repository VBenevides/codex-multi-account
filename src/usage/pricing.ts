const TOKENS_PER_MILLION = 1_000_000n;

export type ModelPricingTable = Readonly<
  Record<string, { input: number; output: number; cachedInput?: number }>
>;

// USD per million tokens. User settings override these defaults by model.
const DEFAULT_MODEL_PRICING: ModelPricingTable = {
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "codex-auto-review": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30 },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15 },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
};

export function estimateModelCostMicros(
  model: string,
  inputTokens: bigint,
  cachedInputTokens: bigint,
  outputTokens: bigint,
  overrides: ModelPricingTable = {},
): bigint | undefined {
  const key = model.trim().toLowerCase();
  const pricing = { ...DEFAULT_MODEL_PRICING[key], ...overrides[key] };
  const inputPrice = toMicros(pricing.input);
  const cachedInputPrice = pricing.cachedInput === undefined ? 0n : toMicros(pricing.cachedInput);
  const outputPrice = toMicros(pricing.output);
  if (inputPrice === undefined || cachedInputPrice === undefined || outputPrice === undefined)
    return undefined;
  const cached = cachedInputTokens > inputTokens ? inputTokens : cachedInputTokens;
  const uncached = inputTokens - cached;
  return (
    (uncached * inputPrice + cached * cachedInputPrice + outputTokens * outputPrice) /
    TOKENS_PER_MILLION
  );
}

function toMicros(value: number | undefined): bigint | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? BigInt(Math.round(value * 1_000_000))
    : undefined;
}
