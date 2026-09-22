const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { archiveConfig, runArchivePull } = require('../lib/intelligence/archive-client.cjs');

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('archive pull verifies bytes, writes object and manifest, then acknowledges once', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nrgopt-archive-'));
  const bytes = Buffer.from('official evidence');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const job = { id: randomUUID(), source_id: randomUUID(), requested_url: 'https://official.example/a', final_url: 'https://official.example/a',
    fetched_at: '2026-09-22T00:00:00Z', content_type: 'text/plain', byte_size: bytes.length, content_sha256: hash,
    download_url: `/api/intelligence?action=archive-object&id=${randomUUID()}&node_id=mac-mini` };
  const calls = [];
  let claims = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.searchParams.get('action') === 'archive-claim') return json({ job: claims++ ? null : job });
    if (url.searchParams.get('action') === 'archive-object') return new Response(bytes);
    if (url.searchParams.get('action') === 'archive-ack') return json({ ok: true });
    throw new Error('unexpected request');
  };
  try {
    assert.deepEqual(await runArchivePull({ baseUrl: 'https://nrgopt.example', token: 'secret', nodeId: 'mac-mini', directory, fetchImpl }), { archived: 1 });
    const sourceDir = path.join(directory, job.source_id);
    assert.deepEqual(await fs.readFile(path.join(sourceDir, `${hash}.txt`)), bytes);
    const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, `${hash}.manifest.json`), 'utf8'));
    assert.equal(manifest.source_id, job.source_id);
    assert.equal(manifest.files[0].content_sha256, hash);
    assert.equal(calls.filter(call => call.url.searchParams.get('action') === 'archive-ack').length, 1);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('hash mismatch reports failure and never acknowledges or leaves an archive object', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nrgopt-archive-'));
  const job = { id: randomUUID(), source_id: randomUUID(), content_type: 'text/plain', byte_size: 3,
    content_sha256: 'a'.repeat(64), download_url: `/api/intelligence?action=archive-object&id=${randomUUID()}&node_id=mac-mini` };
  const actions = [];
  const fetchImpl = async (input, init) => {
    const action = new URL(input).searchParams.get('action');
    actions.push({ action, body: init.body && JSON.parse(init.body) });
    if (action === 'archive-claim') return json({ job });
    if (action === 'archive-object') return new Response(Buffer.from('bad'));
    if (action === 'archive-fail') return json({ ok: true });
    throw new Error('unexpected request');
  };
  try {
    await assert.rejects(runArchivePull({ baseUrl: 'https://nrgopt.example', token: 'secret', nodeId: 'mac-mini', directory, fetchImpl, maxItems: 1 }), { code: 'hash_mismatch' });
    assert.equal(actions.some(call => call.action === 'archive-ack'), false);
    assert.equal(actions.find(call => call.action === 'archive-fail').body.error_code, 'hash_mismatch');
    assert.deepEqual(await fs.readdir(directory), []);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('archive configuration accepts HTTPS or loopback only and requires an absolute local path', () => {
  assert.equal(archiveConfig({ NRGOPT_ARCHIVE_BASE_URL: 'http://127.0.0.1:4317', NRGOPT_ARCHIVE_TOKEN: 'secret',
    NRGOPT_ARCHIVE_NODE_ID: 'mac-mini', NRGOPT_ARCHIVE_DIR: '/tmp/archive' }).baseUrl, 'http://127.0.0.1:4317');
  assert.throws(() => archiveConfig({ NRGOPT_ARCHIVE_BASE_URL: 'http://remote.example', NRGOPT_ARCHIVE_TOKEN: 'secret',
    NRGOPT_ARCHIVE_NODE_ID: 'mac-mini', NRGOPT_ARCHIVE_DIR: 'relative' }), { code: 'invalid_archive_config' });
});
