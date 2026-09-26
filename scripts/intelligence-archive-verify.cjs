const { verifyArchive } = require('../lib/intelligence/archive-client.cjs');

(async () => {
  const report = await verifyArchive(process.env.NRGOPT_ARCHIVE_DIR);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failures.length || !report.verified) process.exitCode = 1;
})().catch(error => {
  process.stderr.write(`归档校验失败：${/^[a-z_]{1,64}$/.test(error.code || '') ? error.code : 'archive_verify_failed'}\n`);
  process.exitCode = 1;
});
