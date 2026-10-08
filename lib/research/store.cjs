const { randomUUID, createHash } = require('node:crypto');
const { failure } = require('../intelligence/store.cjs');

const BUCKET = 'nrgopt-research';
const ENTRY_FIELDS = 'id,project_id,title,kind,source_url,file_name,file_type,byte_size,revision,created_at,updated_at';

function createResearchStore(config, fetchImpl = global.fetch) {
  async function request(path, options = {}) {
    const { raw = false, ...init } = options;
    let response;
    try {
      response = await fetchImpl(config.url + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
          'Content-Type': 'application/json', ...init.headers } });
    } catch { throw failure('upstream_unavailable'); }
    if (!response.ok) throw failure('upstream_unavailable');
    if (raw) return Buffer.from(await response.arrayBuffer());
    const text = await response.text();
    try { return text ? JSON.parse(text) : null; } catch { throw failure('upstream_unavailable'); }
  }
  const rows = (table, query, options) => request(`/rest/v1/research_${table}?${query}`, options);
  const filter = (owner, id) => `owner_id=eq.${encodeURIComponent(owner)}&id=eq.${encodeURIComponent(id)}`;
  async function one(table, owner, id) {
    const result = await rows(table, `${filter(owner, id)}&select=*&limit=1`);
    if (!result?.[0]) throw failure('not_found', 404);
    return result[0];
  }
  async function save(table, owner, value) {
    const { id, revision, ...fields } = value;
    const result = await rows(table, id ? `${filter(owner, id)}&revision=eq.${revision}` : '', {
      method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...fields, ...(id ? { revision: revision + 1, updated_at: new Date().toISOString() } : { owner_id: owner }) })
    });
    if (!result?.[0]) throw failure('research_conflict', 409);
    return result[0];
  }
  return {
    projects: owner => rows('projects', `owner_id=eq.${encodeURIComponent(owner)}&select=*&order=updated_at.desc`),
    project: (owner, id) => one('projects', owner, id),
    saveProject: (owner, value) => save('projects', owner, value),
    async entries(owner, project) {
      await one('projects', owner, project);
      return rows('entries', `owner_id=eq.${encodeURIComponent(owner)}&project_id=eq.${encodeURIComponent(project)}&select=${ENTRY_FIELDS}&order=updated_at.desc`);
    },
    async entry(owner, id) {
      const { storage_path, content_sha256, owner_id, ...entry } = await one('entries', owner, id);
      return entry;
    },
    async saveEntry(owner, value, attachment) {
      if (value.id) {
        const current = await one('entries', owner, value.id);
        if (current.project_id !== value.project_id) throw failure('invalid_request', 400);
      }
      await one('projects', owner, value.project_id);
      let storagePath;
      if (attachment) {
        storagePath = `${owner}/${value.project_id}/${randomUUID()}`;
        await request(`/storage/v1/object/${BUCKET}/${storagePath}`, { method: 'POST', body: attachment.bytes,
          headers: { 'Content-Type': 'application/octet-stream' } });
      }
      try {
        const result = await save('entries', owner, { ...value, ...(attachment ? {
          file_name: attachment.name, file_type: attachment.type, byte_size: attachment.bytes.length,
          content_sha256: createHash('sha256').update(attachment.bytes).digest('hex'), storage_path: storagePath
        } : {}) });
        return this.entry(owner, result.id);
      } catch (error) {
        if (storagePath) {
          try { await request(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: [storagePath] }) }); }
          catch { /* The failed upload remains private; the original error is returned. */ }
        }
        throw error;
      }
    },
    async file(owner, id) {
      const entry = await one('entries', owner, id);
      if (!entry.storage_path) throw failure('not_found', 404);
      const bytes = await request(`/storage/v1/object/${BUCKET}/${entry.storage_path}`, { raw: true });
      if (bytes.length !== entry.byte_size || createHash('sha256').update(bytes).digest('hex') !== entry.content_sha256) throw failure('evidence_corrupt', 502);
      return { entry, bytes };
    }
  };
}
module.exports = { createResearchStore };
