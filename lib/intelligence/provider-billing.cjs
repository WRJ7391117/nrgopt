function failure(code, status = 502) {
  return Object.assign(new Error(code), { code, status });
}

function microAmount(value) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value || '').trim());
  if (!match) return null;
  const amount = Number(match[1]) * 1_000_000 + Number((match[2] || '').padEnd(6, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
}

function createProviderBalanceReader(profile, fetchImpl = global.fetch) {
  if (profile?.billingMode !== 'balance') return null;
  if (profile.provider !== 'deepseek' || typeof profile.apiKey !== 'string') return null;
  let balanceUrl;
  try {
    const endpoint = new URL(profile.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'api.deepseek.com') return null;
    balanceUrl = new URL('/user/balance', endpoint).href;
  } catch { return null; }
  return async currency => {
    let response;
    try {
      response = await fetchImpl(balanceUrl, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json', Authorization: `Bearer ${profile.apiKey}` },
      });
    } catch { throw failure('billing_sync_unavailable'); }
    if (!response.ok) throw failure(response.status === 401 || response.status === 403
      ? 'billing_sync_auth_failed' : 'billing_sync_unavailable');
    let payload;
    try { payload = await response.json(); } catch { throw failure('billing_sync_unavailable'); }
    const balance = Array.isArray(payload?.balance_infos)
      ? payload.balance_infos.find(item => item?.currency === currency) : null;
    const amount = microAmount(balance?.total_balance);
    if (amount == null) throw failure('billing_sync_unavailable');
    return amount;
  };
}

module.exports = { microAmount, createProviderBalanceReader };
