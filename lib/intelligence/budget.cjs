const { randomUUID } = require('node:crypto');

function reserveAmount(env, key) {
  const value = Number(env[key]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function tokenCount(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
}

function usageCharge(operation, result) {
  const usage = result?.usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  if (operation === 'discovery') {
    const input = tokenCount(usage.input_tokens);
    const output = tokenCount(usage.output_tokens);
    const cacheRead = tokenCount(usage.cache_read_input_tokens);
    const cacheCreate = tokenCount(usage.cache_creation_input_tokens);
    const searches = tokenCount(result.search_count);
    if (!input && !output && !cacheRead && !cacheCreate && !searches) return null;
    return {
      chargedMicro: Math.ceil((input + cacheCreate) * 2.1 + output * 8.4 + cacheRead * 0.42 + searches * 30_000),
      provider: 'minimax', model: result.model || 'MiniMax-M3',
      usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate, search_count: searches },
      pricingVersion: 'minimax-cn-standard-2026-09-22'
    };
  }
  if (operation === 'extraction' || operation === 'cross_check') {
    const prompt = tokenCount(usage.prompt_tokens);
    const output = tokenCount(usage.completion_tokens);
    const hit = Math.min(tokenCount(usage.prompt_cache_hit_tokens), prompt);
    const reportedMiss = tokenCount(usage.prompt_cache_miss_tokens);
    const miss = reportedMiss || Math.max(prompt - hit, 0);
    if (!prompt && !output && !hit && !reportedMiss) return null;
    return {
      chargedMicro: Math.ceil(hit * 0.04 + miss * 2 + output * 8),
      provider: 'deepseek', model: result.model || 'deepseek-flash',
      usage: { prompt_tokens: prompt, completion_tokens: output,
        prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: miss },
      pricingVersion: 'deepseek-flash-cn-peak-2026-09-22'
    };
  }
  return null;
}

async function runPaidCall({ store, owner, jobId = null, operation, currency, budgetKey, providerMissingCode,
  env = process.env, idempotencyKey = `manual:${operation}:${randomUUID()}`, call }) {
  if (!['CNY', 'USD'].includes(currency)) throw Object.assign(new Error('budget_not_configured'), { code: 'budget_not_configured', status: 503 });
  const amount = reserveAmount(env, budgetKey);
  if (!amount) throw Object.assign(new Error('budget_not_configured'), { code: 'budget_not_configured', status: 503 });
  const reservationId = await store.reserveBudget(owner, jobId, operation, currency, idempotencyKey, amount);
  if (!reservationId) throw Object.assign(new Error('budget_exhausted'), { code: 'budget_exhausted', status: 409 });
  try {
    const result = await call();
    const calculated = usageCharge(operation, result);
    const charge = calculated && calculated.chargedMicro > 0 && calculated.chargedMicro <= amount ? calculated : null;
    await store.settleBudget(owner, reservationId, charge?.chargedMicro || amount, 'estimated', charge ? {
      provider: charge.provider, model: charge.model, usage: charge.usage, pricingVersion: charge.pricingVersion
    } : null);
    return result;
  } catch (error) {
    if (error?.code === providerMissingCode) await store.releaseBudget(owner, reservationId);
    else await store.settleBudget(owner, reservationId, amount, 'estimated');
    throw error;
  }
}

module.exports = { reserveAmount, usageCharge, runPaidCall };
