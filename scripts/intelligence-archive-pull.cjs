const { archiveConfig, runManagedArchivePull } = require('../lib/intelligence/archive-client.cjs');

(async () => {
  const config = archiveConfig(process.env);
  const maxItems = Number(process.env.NRGOPT_ARCHIVE_MAX_ITEMS || 10);
  const result = await runManagedArchivePull({ ...config, maxItems });
  process.stdout.write(`归档完成：${result.archived} 个原件。\n`);
})().catch(error => {
  const messages = { archive_disabled: '云端归档尚未启用，请检查目标部署的归档开关。',
    archive_unauthorized: '归档凭据未通过验证，请核对节点与目标部署的配置。',
    writes_disabled: '目标部署处于只读状态，无法领取或确认归档任务。',
    archive_request_failed: '无法完成归档请求，请检查网络、目标地址及部署访问保护。',
    invalid_directory: '新归档目录必须是 Mac 用户目录或已挂载磁盘中的现有子目录。',
    directory_unavailable: '归档目录不存在、磁盘未挂载或目录位置已变化；没有领取新任务。',
    directory_not_writable: '归档目录不可写；没有领取新任务。',
    archive_state_failed: '本地归档目录状态无法保存或读取；没有领取新任务。' };
  process.stderr.write(`归档失败：${messages[error.code] || (/^[a-z_]{1,64}$/.test(error.code || '') ? error.code : 'archive_failed')}\n`);
  process.exitCode = 1;
});
