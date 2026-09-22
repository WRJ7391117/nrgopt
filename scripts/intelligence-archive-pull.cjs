const { archiveConfig, runArchivePull } = require('../lib/intelligence/archive-client.cjs');

(async () => {
  const config = archiveConfig(process.env);
  const maxItems = Number(process.env.NRGOPT_ARCHIVE_MAX_ITEMS || 10);
  const result = await runArchivePull({ ...config, maxItems });
  process.stdout.write(`归档完成：${result.archived} 个原件。\n`);
})().catch(error => {
  process.stderr.write(`归档失败：${/^[a-z_]{1,64}$/.test(error.code || '') ? error.code : 'archive_failed'}\n`);
  process.exitCode = 1;
});
