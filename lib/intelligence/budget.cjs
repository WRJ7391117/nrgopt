const { randomUUID } = require('node:crypto');

function reserveAmount(env, key) {
  const value = Number(env[key]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function automaticCallReserve(operation, currency, budgetLimitMicro) {
  const limit = reserveAmount({ value: budgetLimitMicro }, 'value');
  if (!limit || !['CNY', 'USD'].includes(currency)) return null;
  const ceilings = currency === 'CNY'
    ? { discovery: 2_000_000, extraction: 1_000_000, cross_check: 500_000 }
    : { discovery: 500_000, extraction: 250_000, cross_check: 100_000 };
  return Math.min(limit, ceilings[operation] || 0) || null;
}

async function runPaidCall({ store, owner, jobId = null, operation, currency, budgetKey, providerMissingCode,
  budgetLimitMicro = null, billingMode = 'balance', readBalance = null, env = process.env,
  idempotencyKey = `manual:${operation}:${randomUUID()}`, call }) {
  if (!['CNY', 'USD'].includes(currency)) throw Object.assign(new Error('budget_not_configured'), { code: 'budget_not_configured', status: 503 });
  const limit = budgetLimitMicro == null ? reserveAmount(env, budgetKey) : reserveAmount({ value: budgetLimitMicro }, 'value');
  const amount = automaticCallReserve(operation, currency, limit);
  if (!amount) throw Object.assign(new Error('budget_not_configured'), { code: 'budget_not_configured', status: 503 });
  if (billingMode === 'included') {
    const reservationId = await store.reserveBudget(owner, jobId, operation, currency, idempotencyKey, amount);
    if (!reservationId) throw Object.assign(new Error('budget_exhausted'), { code: 'budget_exhausted', status: 409 });
    try { return await call(); }
    finally { await store.releaseBudget(owner, reservationId); }
  }
  if (billingMode !== 'balance' || typeof readBalance !== 'function') {
    throw Object.assign(new Error('billing_sync_not_configured'), { code: 'billing_sync_not_configured', status: 503 });
  }
  let before;
  try {
    before = await readBalance(currency);
    const synced = await store.syncProviderBalance(owner, operation === 'discovery' ? 'discovery' : 'analysis', currency, before);
    if (!synced) throw new Error('balance sync rejected');
  } catch (error) {
    if (error?.code === 'billing_sync_auth_failed') throw error;
    throw Object.assign(new Error('billing_sync_unavailable'), { code: 'billing_sync_unavailable', status: 502 });
  }
  const reservationId = await store.reserveBudget(owner, jobId, operation, currency, idempotencyKey, amount);
  if (!reservationId) throw Object.assign(new Error('budget_exhausted'), { code: 'budget_exhausted', status: 409 });
  let result;
  let callError;
  try { result = await call(); }
  catch (error) { callError = error; }
  let after;
  try { after = await readBalance(currency); }
  catch {
    throw Object.assign(new Error('billing_sync_pending'), { code: 'billing_sync_pending', status: 502, cause: callError });
  }
  try {
    const synced = await store.syncProviderBalance(owner, operation === 'discovery' ? 'discovery' : 'analysis', currency, after);
    if (!synced || !await store.releaseBudget(owner, reservationId)) throw new Error('balance sync rejected');
  } catch {
    throw Object.assign(new Error('billing_sync_pending'), { code: 'billing_sync_pending', status: 502, cause: callError });
  }
  if (callError) throw callError;
  return result;
}

module.exports = { reserveAmount, automaticCallReserve, runPaidCall };
