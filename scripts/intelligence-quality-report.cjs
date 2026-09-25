// Offline, explicit-reference evaluation. No network, database writes or model calls.
const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs');

function evaluateQuality(cases, predictions) {
  if (!Array.isArray(cases) || !Array.isArray(predictions)) throw new Error('quality_input_invalid');
  const unique = rows => rows.every(row => typeof row.id === 'string' && row.id) && new Set(rows.map(row => row.id)).size === rows.length;
  if (!unique(cases) || !unique(predictions)) throw new Error('quality_ids_invalid');
  const actual = new Map(predictions.map(row => [row.id, row.extraction]));
  const empty = () => ({ cases: 0, labelled_cases: 0, missing_predictions: 0, checked_fields: 0, correct_fields: 0,
    early_signal_positives: 0, early_signal_detected: 0 });
  const total = empty(), languages = {}, failures = [];
  for (const sample of cases) {
    if (!['en', 'zh', 'ar'].includes(sample.language)) throw new Error('quality_language_invalid');
    const expected = sample.expected || {};
    if (Object.keys(expected).some(key => !['disposition', 'maturity', 'occurrence_countries', 'radars', 'project', 'procurement'].includes(key))) throw new Error('quality_reference_field_invalid');
    if (sample.early_signal != null && typeof sample.early_signal !== 'boolean') throw new Error('quality_reference_signal_invalid');
    const language = languages[sample.language] ||= empty();
    const buckets = [total, language];
    buckets.forEach(value => value.cases++);
    const extraction = actual.get(sample.id);
    if (!extraction) buckets.forEach(value => value.missing_predictions++);
    if (Object.keys(expected).length || sample.early_signal != null) buckets.forEach(value => value.labelled_cases++);
    const fields = extraction ? { disposition: extraction.classification?.disposition, maturity: extraction.maturity,
      occurrence_countries: extraction.classification?.countries?.filter(item => item.relation === 'occurrence').map(item => item.code),
      radars: extraction.classification?.radars, project: extraction.classification?.project, procurement: extraction.classification?.procurement } : {};
    for (const [field, reference] of Object.entries(expected)) {
      const setField = ['occurrence_countries', 'radars'].includes(field);
      if (setField && !Array.isArray(reference)) throw new Error('quality_reference_set_invalid');
      const normalized = value => Array.isArray(value) ? [...new Set(value)].sort() : value;
      const correct = isDeepStrictEqual(setField ? normalized(fields[field]) : fields[field], setField ? normalized(reference) : reference);
      buckets.forEach(value => { value.checked_fields++; if (correct) value.correct_fields++; });
      if (!correct) {
        let reason = !extraction ? 'prediction_missing' : fields[field] === undefined ? 'field_missing'
          : reference === null ? 'unsupported_inference' : fields[field] === null ? 'missed_fact' : 'reference_mismatch';
        if (extraction && setField && Array.isArray(fields[field])) {
          const missing = reference.some(value => !fields[field].includes(value));
          const extra = fields[field].some(value => !reference.includes(value));
          reason = missing && extra ? 'set_missing_and_extra' : missing ? 'set_missing_values' : 'set_extra_values';
        }
        if (reason === 'reference_mismatch' && field === 'maturity') reason = 'stage_mismatch';
        failures.push({ id: sample.id, language: sample.language, field, reason });
      }
    }
    // Recall denominator includes every explicitly labelled positive, including failed extraction.
    if (sample.early_signal === true) {
      const detected = fields.disposition === 'candidate' && fields.radars?.some(radar => ['trigger', 'demand'].includes(radar));
      buckets.forEach(value => { value.early_signal_positives++; if (detected) value.early_signal_detected++; });
      if (!detected) failures.push({ id: sample.id, language: sample.language, field: 'early_signal', reason: extraction ? 'not_detected' : 'prediction_missing' });
    }
  }
  for (const stats of [total, ...Object.values(languages)]) {
    stats.unlabelled_cases = stats.cases - stats.labelled_cases;
    stats.field_accuracy = stats.checked_fields ? stats.correct_fields / stats.checked_fields : null;
    stats.early_signal_recall = stats.early_signal_positives ? stats.early_signal_detected / stats.early_signal_positives : null;
  }
  const caseIds = new Set(cases.map(row => row.id));
  const countErrors = rows => rows.reduce((counts, item) => { counts[item.reason] = (counts[item.reason] || 0) + 1; return counts; }, {});
  for (const [language, stats] of Object.entries(languages)) {
    stats.error_types = countErrors(failures.filter(item => item.language === language));
  }
  return { scope: 'Only explicitly referenced fields and labelled early-signal positives; not whole-product accuracy certification.',
    total, languages, unmatched_predictions: predictions.filter(row => !caseIds.has(row.id)).length,
    error_types: countErrors(failures), failures };
}

if (require.main === module) {
  try {
    const [references, predictions] = process.argv.slice(2);
    if (!references || !predictions) throw new Error('usage: node scripts/intelligence-quality-report.cjs references.json predictions.json');
    process.stdout.write(JSON.stringify(evaluateQuality(JSON.parse(fs.readFileSync(references, 'utf8')), JSON.parse(fs.readFileSync(predictions, 'utf8'))), null, 2) + '\n');
  } catch (error) {
    process.stderr.write((error.message.startsWith('quality_') || error.message.startsWith('usage:') ? error.message : 'quality_report_failed') + '\n');
    process.exitCode = 1;
  }
}
module.exports = { evaluateQuality };
