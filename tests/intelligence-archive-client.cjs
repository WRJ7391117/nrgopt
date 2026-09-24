const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { archiveConfig, runArchivePull, verifyArchive } = require('../lib/intelligence/archive-client.cjs');

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
    assert.deepEqual(await verifyArchive(directory), { verified: 1, failures: [] });
    await fs.writeFile(path.join(sourceDir, `${hash}.txt`), Buffer.alloc(bytes.length));
    assert.equal((await verifyArchive(directory)).failures[0].code, 'hash_mismatch');
    await fs.unlink(path.join(sourceDir, `${hash}.txt`));
    assert.equal((await verifyArchive(directory)).failures[0].code, 'archive_object_missing');
    manifest.files[0].name = '../../outside.txt';
    await fs.writeFile(path.join(sourceDir, `${hash}.manifest.json`), JSON.stringify(manifest));
    assert.equal((await verifyArchive(directory)).failures[0].code, 'archive_manifest_invalid');
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

test('interrupted acknowledgement resumes from intact files without duplicating the object', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nrgopt-archive-resume-'));
  const bytes = Buffer.from('saved before connection loss');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const job = { id: randomUUID(), source_id: randomUUID(), byte_size: bytes.length, content_sha256: hash,
    content_type: 'text/plain', download_url: '/api/intelligence?action=archive-object' };
  let disconnected = true;
  let acknowledgements = 0;
  const fetchImpl = async input => {
    const action = new URL(input).searchParams.get('action');
    if (action === 'archive-claim') return json({ job });
    if (action === 'archive-object') return new Response(bytes);
    if (action === 'archive-ack') {
      if (disconnected) throw new Error('simulated transport interruption');
      acknowledgements++;
      return json({ ok: true });
    }
    if (action === 'archive-fail') throw new Error('offline');
    throw new Error('unexpected request');
  };
  const options = { baseUrl: 'https://archive.example', token: 'fixture', nodeId: 'test', directory, fetchImpl, maxItems: 1 };
  try {
    await assert.rejects(runArchivePull(options), { code: 'archive_request_failed' });
    assert.deepEqual(await verifyArchive(directory), { verified: 1, failures: [] });
    disconnected = false;
    assert.deepEqual(await runArchivePull(options), { archived: 1 });
    assert.equal(acknowledgements, 1);
    assert.equal((await fs.readdir(path.join(directory, job.source_id))).length, 2);
    assert.deepEqual(await verifyArchive(directory), { verified: 1, failures: [] });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('disk-full writes report failure without ACK, remove partial temp files and recover', async t => {
  for (const stage of ['object', 'manifest']) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nrgopt-archive-disk-'));
    const bytes = Buffer.from('evidence retained in cloud until local storage succeeds');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const job = { id: randomUUID(), source_id: randomUUID(), byte_size: bytes.length, content_sha256: hash,
      content_type: 'text/plain', download_url: '/api/intelligence?action=archive-object' };
    const actions = [];
    const fetchImpl = async (input, init) => {
      const action = new URL(input).searchParams.get('action');
      actions.push({ action, body: init.body && JSON.parse(init.body) });
      if (action === 'archive-claim') return json({ job });
      if (action === 'archive-object') return new Response(bytes);
      if (['archive-ack', 'archive-fail'].includes(action)) return json({ ok: true });
      throw new Error('unexpected request');
    };
    const writeFile = fs.writeFile;
    const disk = t.mock.method(fs, 'writeFile', async (filename, data, options) => {
      if (String(filename).includes('.manifest.json') === (stage === 'manifest')) {
        await writeFile(filename, Buffer.from('partial'), options);
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      return writeFile(filename, data, options);
    });
    const options = { baseUrl: 'https://archive.example', token: 'fixture', nodeId: 'test', directory, fetchImpl, maxItems: 1 };
    try {
      await assert.rejects(runArchivePull(options), { code: 'disk_full' });
      assert.equal(actions.some(call => call.action === 'archive-ack'), false);
      assert.equal(actions.find(call => call.action === 'archive-fail').body.error_code, 'disk_full');
      assert.equal((await fs.readdir(path.join(directory, job.source_id))).some(name => name.endsWith('.tmp')), false);
      disk.mock.restore();
      assert.deepEqual(await runArchivePull(options), { archived: 1 });
      assert.deepEqual(await verifyArchive(directory), { verified: 1, failures: [] });
      assert.equal(actions.filter(call => call.action === 'archive-ack').length, 1);
    } finally { disk.mock.restore(); await fs.rm(directory, { recursive: true, force: true }); }
  }
});

test('encrypted backup rejects modified bytes and the wrong recovery key', () => {
  const { encrypt, decrypt } = require('../scripts/intelligence-local-backup.cjs');
  const key = Buffer.alloc(32, 7), original = Buffer.from('private original and auth data');
  const encrypted = encrypt(original, key);
  assert.deepEqual(decrypt(encrypted, key), original);
  assert.throws(() => decrypt(encrypted, Buffer.alloc(32, 8)));
  for (const index of [0, 12, encrypted.length - 1]) {
    const tampered = Buffer.from(encrypted); tampered[index] ^= 1;
    assert.throws(() => decrypt(tampered, key));
  }
});
