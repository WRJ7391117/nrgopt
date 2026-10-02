const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = code => Object.assign(new Error(code), { code });

function archiveConfig(env = process.env) {
  const url = new URL(env.NRGOPT_ARCHIVE_BASE_URL || '');
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw failure('invalid_archive_config');
  if (!env.NRGOPT_ARCHIVE_TOKEN || !/^[A-Za-z0-9._-]{1,80}$/.test(env.NRGOPT_ARCHIVE_NODE_ID || '') || !path.isAbsolute(env.NRGOPT_ARCHIVE_DIR || '')) throw failure('invalid_archive_config');
  return { baseUrl: url.origin, token: env.NRGOPT_ARCHIVE_TOKEN, nodeId: env.NRGOPT_ARCHIVE_NODE_ID, directory: env.NRGOPT_ARCHIVE_DIR };
}

function validArchiveDirectory(value) {
  return typeof value === 'string' && value.length <= 1024 &&
    /^\/(?:Users\/[^/]+\/.+|Volumes\/[^/]+\/.+)$/.test(value) && !/[\x00-\x1f\x7f\\]/.test(value) &&
    !value.slice(1).split('/').some(part => part === '.' || part === '..' || part === '');
}

async function runManagedArchivePull(config) {
  const { baseUrl, token, nodeId, directory, fetchImpl = global.fetch } = config;
  const stateFile = path.join(path.dirname(directory), 'archive-state.json');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (action, body) => {
    let response;
    try { response = await fetchImpl(`${baseUrl}/api/intelligence?action=${action}`, { method: 'POST', headers,
      body: JSON.stringify({ node_id: nodeId, ...body }), redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw failure('archive_request_failed'); }
    if (!response.ok) throw failure('archive_request_failed');
    try { return await response.json(); } catch { throw failure('archive_request_failed'); }
  };
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw failure('archive_state_failed'); }
  if (!state) state = { active_directory: directory, active_revision: 0, previous_directories: [] };
  if (!validArchiveDirectory(state.active_directory) || !Number.isInteger(state.active_revision) ||
      !Array.isArray(state.previous_directories) || state.previous_directories.length > 5 ||
      !state.previous_directories.every(validArchiveDirectory)) throw failure('archive_state_failed');
  const inspect = async (selected, expected) => {
    if (!validArchiveDirectory(selected)) throw failure('invalid_directory');
    let real, stat;
    try { real = await fs.realpath(selected); stat = await fs.stat(real); }
    catch { throw failure('directory_unavailable'); }
    if (!stat.isDirectory() || (expected && (expected.real !== real || expected.device !== stat.dev))) throw failure('directory_unavailable');
    try { await fs.access(real, require('node:fs').constants.W_OK); }
    catch { throw failure('directory_not_writable'); }
    return { real, device: stat.dev };
  };
  const remote = await request('archive-config', {});
  try {
    const current = await inspect(state.active_directory, state.active_location);
    if (!state.active_location) state.active_location = current;
    if (remote.requested_directory && remote.revision > state.active_revision) {
      const selected = await inspect(remote.requested_directory);
      if (remote.requested_directory !== state.active_directory) {
        state.previous_directories = [...new Set([...state.previous_directories, state.active_directory])].slice(-5);
        state.active_directory = remote.requested_directory;
        state.active_location = selected;
      }
      state.active_revision = remote.revision;
    }
    const temporary = `${stateFile}.${process.pid}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, stateFile); }
    catch { await fs.unlink(temporary).catch(() => {}); throw failure('archive_state_failed'); }
    await request('archive-report', { active_directory: state.active_directory, active_revision: state.active_revision,
      previous_directories: state.previous_directories, error_code: null });
  } catch (error) {
    const code = ['invalid_directory', 'directory_unavailable', 'directory_not_writable', 'archive_state_failed'].includes(error.code) ? error.code : 'archive_state_failed';
    await request('archive-report', { active_directory: state.active_directory, active_revision: state.active_revision,
      previous_directories: state.previous_directories, error_code: code }).catch(() => {});
    throw failure(code);
  }
  return runArchivePull({ ...config, directory: state.active_directory });
}

async function verifyManagedArchive(directory) {
  const stateFile = path.join(path.dirname(directory), 'archive-state.json');
  let state;
  try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw failure('archive_state_failed'); }
  const paths = state ? [...new Set([state.active_directory, ...(state.previous_directories || [])])] : [directory];
  if (!paths.every(validArchiveDirectory)) throw failure('archive_state_failed');
  const results = await Promise.all(paths.map(verifyArchive));
  return { verified: results.reduce((count, result) => count + result.verified, 0),
    failures: results.flatMap((result, index) => result.failures.map(item => ({ directory: paths[index], ...item }))) };
}

async function runArchivePull({ baseUrl, token, nodeId, directory, fetchImpl = global.fetch, maxItems = 10 }) {
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 500) throw failure('invalid_archive_config');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (action, body) => {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/api/intelligence?action=${action}`, { method: 'POST', headers,
        body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
    } catch { throw failure('archive_request_failed'); }
    if (!response.ok) {
      let code;
      try { code = (await response.json()).error; } catch { /* Deployment protection may return HTML. */ }
      throw failure(['archive_disabled', 'archive_unauthorized', 'writes_disabled'].includes(code) ? code : 'archive_request_failed');
    }
    try { return await response.json(); } catch { throw failure('archive_request_failed'); }
  };
  let archived = 0;
  for (let index = 0; index < maxItems; index++) {
    const claimed = await request('archive-claim', { node_id: nodeId });
    const job = claimed?.job;
    if (!job) break;
    let errorCode = 'archive_write_failed';
    let pendingFile = null;
    try {
      if (!UUID.test(job.id || '') || !UUID.test(job.source_id || '') || !/^[a-f0-9]{64}$/.test(job.content_sha256 || '') ||
          !Number.isInteger(job.byte_size) || job.byte_size < 0 || job.byte_size > MAX_BYTES) throw failure('archive_manifest_invalid');
      const download = new URL(job.download_url, baseUrl);
      if (download.origin !== baseUrl || download.pathname !== '/api/intelligence' || download.searchParams.get('action') !== 'archive-object') throw failure('archive_manifest_invalid');
      let response;
      try { response = await fetchImpl(download, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
      catch { throw failure('archive_download_failed'); }
      if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw failure('archive_download_failed');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== job.byte_size) throw failure('size_mismatch');
      if (createHash('sha256').update(bytes).digest('hex') !== job.content_sha256) throw failure('hash_mismatch');
      const sourceDir = path.join(directory, job.source_id);
      await fs.mkdir(sourceDir, { recursive: true, mode: 0o700 });
      const extension = job.content_type === 'text/html' ? 'html' : job.content_type === 'application/json' ? 'json' : 'txt';
      const objectName = `${job.content_sha256}.${extension}`;
      const objectPath = path.join(sourceDir, objectName);
      try {
        const existing = await fs.readFile(objectPath);
        if (existing.length !== bytes.length || createHash('sha256').update(existing).digest('hex') !== job.content_sha256) throw failure('local_conflict');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const temporary = path.join(sourceDir, `.${objectName}.${process.pid}.${randomUUID()}.tmp`);
        pendingFile = temporary;
        await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, objectPath);
        pendingFile = null;
      }
      const manifest = { schema_version: 1, visibility: 'private', archive_id: job.id, source_id: job.source_id,
        requested_url: job.requested_url, final_url: job.final_url, fetched_at: job.fetched_at,
        files: [{ name: objectName, byte_size: bytes.length, content_sha256: job.content_sha256 }] };
      const manifestPath = path.join(sourceDir, `${job.content_sha256}.manifest.json`);
      const manifestTemporary = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
      pendingFile = manifestTemporary;
      await fs.writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await fs.rename(manifestTemporary, manifestPath);
      pendingFile = null;
      const ack = await request('archive-ack', { id: job.id, node_id: nodeId, byte_size: bytes.length, content_sha256: job.content_sha256 });
      if (!ack?.ok) throw failure('archive_ack_failed');
      archived++;
    } catch (error) {
      if (pendingFile) await fs.unlink(pendingFile).catch(() => {});
      errorCode = /^[a-z_]{1,64}$/.test(error.code || '') ? error.code : (error.code === 'ENOSPC' ? 'disk_full' : errorCode);
      try { await request('archive-fail', { id: job.id, node_id: nodeId, error_code: errorCode }); } catch { /* The lease remains visible and can expire for retry. */ }
      throw failure(errorCode);
    }
  }
  return { archived };
}

async function verifyArchive(directory) {
  if (!path.isAbsolute(directory || '')) throw failure('invalid_archive_config');
  let verified = 0;
  const failures = [];
  for (const folder of await fs.readdir(directory, { withFileTypes: true })) {
    if (!UUID.test(folder.name)) continue;
    if (!folder.isDirectory()) { failures.push({ source_id: folder.name, code: 'archive_manifest_invalid' }); continue; }
    const sourceDir = path.join(directory, folder.name);
    const manifests = (await fs.readdir(sourceDir)).filter(name => name.endsWith('.manifest.json'));
    if (!manifests.length) failures.push({ source_id: folder.name, code: 'archive_manifest_missing' });
    for (const name of manifests) {
      try {
        if (!/^[a-f0-9]{64}\.manifest\.json$/.test(name)) throw failure('archive_manifest_invalid');
        const manifestPath = path.join(sourceDir, name);
        if (!(await fs.lstat(manifestPath)).isFile()) throw failure('archive_manifest_invalid');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        if (manifest.schema_version !== 1 || manifest.visibility !== 'private' || manifest.source_id !== folder.name
          || !Array.isArray(manifest.files) || manifest.files.length !== 1) throw failure('archive_manifest_invalid');
        const file = manifest.files[0];
        if (!/^[a-f0-9]{64}$/.test(file.content_sha256 || '') || name !== `${file.content_sha256}.manifest.json`
          || ![`${file.content_sha256}.html`, `${file.content_sha256}.txt`, `${file.content_sha256}.json`].includes(file.name)
          || !Number.isInteger(file.byte_size) || file.byte_size < 0 || file.byte_size > MAX_BYTES) throw failure('archive_manifest_invalid');
        const objectPath = path.join(sourceDir, file.name);
        const stat = await fs.lstat(objectPath);
        if (!stat.isFile()) throw failure('archive_manifest_invalid');
        if (stat.size !== file.byte_size) throw failure('size_mismatch');
        const bytes = await fs.readFile(objectPath);
        if (createHash('sha256').update(bytes).digest('hex') !== file.content_sha256) throw failure('hash_mismatch');
        verified++;
      } catch (error) {
        failures.push({ source_id: folder.name, code: error.code === 'ENOENT' ? 'archive_object_missing'
          : ['archive_manifest_invalid', 'size_mismatch', 'hash_mismatch'].includes(error.code) ? error.code : 'archive_verify_failed' });
      }
    }
  }
  return { verified, failures };
}

module.exports = { archiveConfig, runArchivePull, runManagedArchivePull, verifyArchive, verifyManagedArchive };
