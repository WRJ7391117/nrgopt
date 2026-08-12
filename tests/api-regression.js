const assert = require('node:assert/strict');

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

(async () => {
  const solar = (await import('../api/solar-data.js')).default;
  let res = response();
  await solar({ method: 'POST', query: {} }, res);
  assert.equal(res.statusCode, 405);

  res = response();
  await solar({ method: 'GET', query: { lat: '91', lon: '0' } }, res);
  assert.equal(res.statusCode, 400);

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ properties: { parameter: { ALLSKY_SFC_SW_DWN: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), 4])) } } }),
  });
  res = response();
  await solar({ method: 'GET', query: { lat: '31.23', lon: '121.47' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.irradiance >= 500 && res.body.irradiance <= 3000);
  global.fetch = originalFetch;

  console.log('api-regression: all assertions passed');
})().catch((error) => { console.error(error); process.exit(1); });
