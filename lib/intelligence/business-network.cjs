const { failure } = require('./store.cjs');

const STATUSES = ['identified', 'contacted', 'communicating', 'paused'];
const FIELDS = { organization: 160, contact_name: 120, role: 160, region: 120,
  contact_details: 800, business_context: 1000, source_note: 800, communication_note: 1600, next_action: 600 };
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;

function validateBusinessRelation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)
    || !Number.isInteger(body.revision) || body.revision < 0 || body.revision > 2147483646
    || !STATUSES.includes(body.status)) throw failure('invalid_request', 400);
  const value = { id: body.id.toLowerCase(), revision: body.revision };
  for (const [key, max] of Object.entries(FIELDS)) {
    if (typeof body[key] !== 'string' || CONTROL_CHARACTERS.test(body[key])) throw failure('invalid_request', 400);
    value[key] = body[key].trim();
    if ([...value[key]].length > max || (key === 'organization' && !value[key])) throw failure('invalid_request', 400);
  }
  if (body.followup_on !== null) {
    if (typeof body.followup_on !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body.followup_on)
      || body.followup_on.startsWith('0000-')) throw failure('invalid_request', 400);
    const date = Date.parse(body.followup_on + 'T00:00:00Z');
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== body.followup_on) throw failure('invalid_request', 400);
  }
  if (body.archived !== undefined && typeof body.archived !== 'boolean') throw failure('invalid_request', 400);
  return { ...value, status: body.status, followup_on: body.followup_on, archived: body.archived ?? false };
}

module.exports = { validateBusinessRelation };
