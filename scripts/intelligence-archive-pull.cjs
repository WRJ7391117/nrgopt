const { archiveConfig, runArchivePull } = require('../lib/intelligence/archive-client.cjs');

(async () => {
  const config = archiveConfig(process.env);
  const maxItems = Number(process.env.NRGOPT_ARCHIVE_MAX_ITEMS || 10);
  const result = await runArchivePull({ ...config, maxItems });
  process.stdout.write(`归档完成：${result.archived} 个原件。\n`);
})().catch(error => {
  const messages = { archive_disabled: '云端归档尚未启用，请检查目标部署的归档开关。',
    archive_unauthorized: '归档凭据未通过验证，请核对节点与目标部署的配置。',
    writes_disabled: '目标部署处于只读状态，无法领取或确认归档任务。',
    archive_request_failed: '无法完成归档请求，请检查网络、目标地址及部署访问保护。' };
  process.stderr.write(`归档失败：${messages[error.code] || (/^[a-z_]{1,64}$/.test(error.code || '') ? error.code : 'archive_failed')}\n`);
  process.exitCode = 1;
});
