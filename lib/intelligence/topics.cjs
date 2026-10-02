const { randomUUID } = require('node:crypto');
const { failure } = require('./store.cjs');
const regions = require('./regions.json');

const definitions = {
  'red-sea': '红海及沿岸跨境航运、能源运输与电力项目',
  hormuz: '霍尔木兹海峡相关的跨境能源运输与供应',
  'bab-el-mandeb': '曼德海峡相关的跨境航运与能源运输',
  suez: '苏伊士运河相关的跨境航运与能源运输',
  'east-mediterranean': '东地中海跨境能源资源、管网与电力合作',
  'mediterranean-interconnection': '地中海两岸跨境电力互联',
  'trans-saharan-gas': '跨撒哈拉天然气管道及相关跨境建设'
};
const defaults = Object.entries(regions.topics).map(([code, name]) => ({ code, name, description: definitions[code], active: true, revision: 0, built_in: true }));
const codePattern = /^(?:red-sea|hormuz|bab-el-mandeb|suez|east-mediterranean|mediterranean-interconnection|trans-saharan-gas|custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function catalog(rows = []) {
  const overrides = new Map(rows.map(row => [row.code, row]));
  return defaults.map(item => ({ ...item, ...overrides.get(item.code) })).concat(rows.filter(row => !Object.hasOwn(regions.topics, row.code)));
}
function validateTopic(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Number.isInteger(body.revision) || body.revision < 0
    || typeof body.active !== 'boolean' || (body.code !== null && body.code !== undefined && !codePattern.test(body.code))) throw failure('invalid_request', 400);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!name || [...name].length > 60 || !description || [...description].length > 240) throw failure('invalid_request', 400);
  if (!body.code && (body.revision !== 0 || !body.active)) throw failure('invalid_request', 400);
  return { code: body.code || `custom-${randomUUID()}`, revision: body.revision, name, description, active: body.active };
}
function activeTopics(items) { return items.filter(item => item.active).map(({ code, name, description }) => ({ code, name, description })); }
function topicNames(items) { return Object.fromEntries(items.map(item => [item.code, item.name])); }

module.exports = { defaults, catalog, validateTopic, activeTopics, topicNames };
