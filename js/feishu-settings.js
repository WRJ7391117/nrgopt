(function () {
  'use strict';
  var form = document.getElementById('feishu-form');
  if (!form) return;
  var fields = form.elements, revision = 0, writable = false, dirty = false;
  var flags = ['enabled', 'send_chat', 'send_user', 'daily_enabled', 'flash_enabled', 'system_enabled'];
  function message(id, text, error) { var node = document.getElementById(id); node.textContent = text; node.className = 'intel-status' + (error ? ' error' : ''); }
  async function api(action, body) {
    var r = await fetch('/api/intelligence?action=' + action, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    var result = await r.json(); if (!r.ok) throw new Error(result.message || '操作未完成，请重试。'); return result;
  }
  function fill(config) {
    revision = config.revision;
    ['app_id', 'chat_id', 'user_open_id'].forEach(function (k) { fields[k].value = config[k] || ''; });
    fields.app_secret.value = '';
    flags.forEach(function (k) { fields[k].checked = config[k]; });
    document.getElementById('feishu-secret-status').textContent = config.secret_configured ? '已有密钥，留空即可保留。' : '尚未配置密钥。';
    document.getElementById('feishu-origin').textContent = (config.managed ? '当前使用网页保存的配置。' : config.legacy_webhook ? '当前沿用原 Webhook 配置。保存本页会切换为自建应用机器人。' : '当前沿用已有部署配置，保存本页后由网页管理。') + (config.enabled ? '推送开关已开启。' : '推送开关已关闭。');
    dirty = false;
  }
  function history(rows) {
    var list = document.getElementById('feishu-history'); list.replaceChildren();
    var types = { daily: '每日摘要', flash: '重大提醒', system: '系统告警' };
    var states = { pending: '等待发送', sending: '发送中', accepted: '飞书已接收', retry: '等待自动重试', failed: '发送失败', unknown: '发送结果未知' };
    rows.forEach(function (r) {
      var li = document.createElement('li');
      li.textContent = new Date(r.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间） · ' + (types[r.notification_type] || '通知') + ' · ' + (states[r.status] || '状态未知') + ' · 尝试 ' + r.attempts + ' 次';
      if (r.error_code) { var reason = document.createElement('p'); reason.className = 'intel-muted'; reason.textContent = r.error_code === 'not_sent_before_production_enablement' ? '接通前旧通知，保留记录，不补发。' : '诊断代码：' + r.error_code; li.append(reason); }
      list.append(li);
    });
    message('feishu-history-status', rows.length ? '记录已读取。' : '暂无投递记录。');
  }
  async function load() {
    if (dirty && !window.confirm('重新读取会放弃尚未保存的机器人和推送修改，是否继续？')) return;
    form.querySelector('fieldset').disabled = true;
    try { var data = await api('feishu-config'); writable = data.writable; fill(data.config); history(data.history); message('feishu-save-status', writable ? '当前设置已读取。修改后请保存。' : '当前环境只读。'); }
    catch (e) { writable = false; message('feishu-save-status', e.message, true); }
    finally { form.querySelector('fieldset').disabled = !writable; }
  }
  form.addEventListener('input', function () { dirty = true; });
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); if (!writable) return;
    var value = { revision: revision };
    ['app_id', 'app_secret', 'chat_id', 'user_open_id'].forEach(function (k) { value[k] = fields[k].value.trim(); });
    flags.forEach(function (k) { value[k] = fields[k].checked; });
    form.querySelector('fieldset').disabled = true; document.getElementById('feishu-refresh').disabled = true;
    message('feishu-save-status', '正在保存…');
    try { var saved = await api('save-feishu-config', value); fill(saved.config); message('feishu-save-status', '已保存。后续待发消息按新配置处理；历史消息不会重发。'); message('feishu-check-status', '设置已更新，可检查已保存的机器人凭据。'); }
    catch (e) { message('feishu-save-status', e.message, true); }
    finally { form.querySelector('fieldset').disabled = !writable; document.getElementById('feishu-refresh').disabled = false; }
  });
  document.getElementById('feishu-check').addEventListener('click', async function () {
    if (dirty) { message('feishu-check-status', '请先保存修改，再检查已保存的凭据。', true); return; }
    form.querySelector('fieldset').disabled = true; document.getElementById('feishu-refresh').disabled = true;
    message('feishu-check-status', '正在检查机器人凭据，不会发送消息…');
    try { var result = await api('check-feishu-config', {}); message('feishu-check-status', result.message); }
    catch (e) { message('feishu-check-status', e.message, true); }
    finally { form.querySelector('fieldset').disabled = !writable; document.getElementById('feishu-refresh').disabled = false; }
  });
  document.getElementById('feishu-refresh').addEventListener('click', load);
  load();
}());
