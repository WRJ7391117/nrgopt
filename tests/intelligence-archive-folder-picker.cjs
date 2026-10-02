const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../scripts/intelligence-archive-folder-picker.cjs');

test('Mac folder picker returns only to the NRGOPT opener', async () => {
  let picks = 0;
  const directory = await fs.mkdtemp(path.join(os.homedir(), '.nrgopt-picker-test-'));
  const server = createServer(async () => { picks++; return directory; });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/pick`;
    const nonce = 'a'.repeat(32);
    const invalid = await fetch(`${base}?origin=https://other.example&nonce=${nonce}`);
    assert.equal(invalid.status, 404);
    assert.equal(picks, 0);
    const page = await fetch(`${base}?origin=https://www.nrgopt.com&nonce=${nonce}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /window\.opener\.postMessage/);
    assert.match(html, /https:\/\/www\.nrgopt\.com/);
    assert.equal(picks, 0);
    const result = await fetch(`${base.replace('/pick', '/choose')}?origin=https://www.nrgopt.com&nonce=${nonce}`);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { type: 'nrgopt-archive-directory', nonce, directory, result: 'selected' });
    assert.equal(picks, 1);
  } finally { server.close(); await fs.rm(directory, { recursive: true }); }
});
