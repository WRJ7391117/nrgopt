const { failure } = require('./store.cjs');

function validateFollowup(body) {
  if (!Number.isInteger(body.revision) || body.revision < 0
    || !['active', 'expired', 'completed'].includes(body.status)) throw failure('invalid_request', 400);
  const value = {};
  for (const [key, max, required] of [['reason', 600, true], ['next_action', 240, true], ['exit_condition', 600, true], ['outcome', 2000, false], ['exit_reason', 600, body.status !== 'active']]) {
    if (typeof body[key] !== 'string' || [...body[key].trim()].length > max || (required && !body[key].trim())) throw failure('invalid_request', 400);
    value[key] = body[key].trim();
  }
  if (!['high', 'normal', 'low'].includes(body.priority) || !/^\d{4}-\d{2}-\d{2}$/.test(body.review_on || '')) throw failure('invalid_request', 400);
  const date = Date.parse(body.review_on + 'T00:00:00Z');
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== body.review_on) throw failure('invalid_request', 400);
  return { revision: body.revision, status: body.status, followup: { ...value, priority: body.priority, review_on: body.review_on } };
}

// Review dates use Beijing calendar days; a due review always stays visible and eligible.
function followupDue(watch, day) {
  if (!watch) return true;
  if (watch.status !== 'active') return false;
  const f = watch.followup;
  if (f.review_on <= day) return true;
  const anchor = new Date(Date.parse(watch.updated_at) + 8 * 3600000).toISOString().slice(0, 10);
  const elapsed = Math.round((Date.parse(day) - Date.parse(anchor)) / 86400000);
  return elapsed >= 0 && elapsed % ({ high: 1, normal: 7, low: 30 }[f.priority] || 7) === 0;
}
module.exports = { validateFollowup, followupDue };
