// Rebuild the four static SVGs. The two layouts share node content and relationships.
const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, '../images/engine');
function chart(name, width, height, title, draw) {
  const parts = [];
  const text = (x, y, lines, cls = '') => parts.push(`<text x="${x}" y="${y}" class="${cls}" text-anchor="middle">${lines.map((s, i) => `<tspan x="${x}" dy="${i ? 22 : 0}">${s}</tspan>`).join('')}</text>`);
  const node = (x, y, w, h, heading, lines = []) => {
    parts.push(`<rect class="node" x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/>`);
    const start = y + h / 2 - lines.length * 11 + 6;
    text(x + w / 2, start, [heading], 'heading');
    if (lines.length) text(x + w / 2, start + 24, lines);
  };
  const group = (x, y, w, h, label) => {
    parts.push(`<rect class="group" x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/>`);
    text(x + w / 2, y + 27, [label], 'group-title');
  };
  const edge = (d, dashed = false, both = false) => parts.push(`<path class="edge${dashed ? ' dashed' : ''}" d="${d}" marker-end="url(#arrow)"${both ? ' marker-start="url(#arrow)"' : ''}/>`);
  const label = (x, y, value) => text(x, y, [value], 'label');
  draw({node, group, edge, label});
  fs.writeFileSync(path.join(out, `${name}-20260928.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">${title}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="#8fa5ba" stroke-width="1.5"/></marker></defs><style>svg{background:#111827;color:#c6d9eb;font-family:PingFang SC,Microsoft YaHei,Arial,sans-serif}text{fill:#a9ccea;font-size:14px}.heading{fill:#b9ddff;font-size:17px;font-weight:600}.node{fill:#062b4b;stroke:#345570;stroke-width:1.3}.group{fill:#182230;stroke:#344253;stroke-width:1}.group-title{fill:#d4dfeb;font-size:15px}.edge{fill:none;stroke:#8fa5ba;stroke-width:1.3;stroke-linejoin:round}.dashed{stroke-dasharray:5 5}.label{fill:#c3d1df;font-size:13px;paint-order:stroke;stroke:#111827;stroke-width:7px;stroke-linejoin:round}</style>${width === 390 ? '<style>text{font-size:16px}.heading{font-size:18px}.label{font-size:14px}.group-title{font-size:15px}</style>' : ''}${parts.join('\n')}</svg>\n`);
}
const flow = [
  ['① 设定方向与渠道', ['地区、行业、企业与主题']],
  ['② 自动搜集原文', ['搜索线索 · 监测渠道', '抓取与保存原件']],
  ['③ 分析与核验', ['匹配方向 · 核对引文', '标明事实、冲突与未知']],
  ['④ 查看与判断', ['总览 · 发现 · 详情', '判断是否值得跟进']],
  ['⑤ 持续跟踪与处理', ['系统关注证据变化', '你记录计划与实际结果']]
];
const failure = ['保留失败与缺口', ['不建立未经核验的候选']];
const queue = ['通知队列', ['日报 · 重大变化 · 系统告警']];
const settings = ['读取推送设置', ['总开关 · 类型 · 接收目标', '遵守免打扰时段']];
const feishu = ['⑥ 飞书推送', ['群聊与个人通知', '记录投递结果']];
const back = ['打开站内详情', ['继续查看与判断']];
chart('workflow-desktop', 1120, 570, '情报工作流程图：桌面布局', ({node,group,edge,label}) => {
  group(20,65,1080,170,'主流程 · 你决定方向与行动，系统搜集和核验');
  const xs=[40,258,476,694,912];
  xs.forEach((x,i)=>node(x,115,168,95,...flow[i]));
  for(let i=0;i<4;i++) edge(`M${xs[i]+168} 160H${xs[i+1]}`);
  edge('M996 115V30H124V115',true); label(560,30,'根据发现与处理结果，调整关注重点');
  edge('M342 210V270H124V325',true); label(206,270,'原文获取失败');
  edge('M500 210V295H124V325',true); label(290,295,'提取或引文校验失败');
  edge('M560 210V275H430V325'); label(670,275,'满足日报或重大变化通知条件');
  node(24,325,200,92,...failure);node(300,325,260,92,...queue);
  node(628,325,230,92,...settings);node(912,325,184,92,...feishu);
  edge('M224 371H300');label(262,350,'告警条件');
  edge('M560 371H628');edge('M858 371H912');
  edge('M1004 417V463',true);node(890,463,228,78,...back);
  label(470,484,'自动推送独立触发，无需先手动跟踪或填写处理结果');
  label(470,517,'实线：工作流与推送　虚线：反馈、异常与回链');
});
chart('workflow-mobile',390,1360,'情报工作流程图：手机布局',({node,edge,label})=>{
  flow.forEach((n,i)=>node(83,55+i*130,240,90,...n));
  for(let i=0;i<4;i++) edge(`M203 ${145+i*130}V${185+i*130}`);
  edge('M83 620H27V100H83',true);label(182,25,'发现与处理结果 → 调整关注重点');
  edge('M83 230H52V727H83',true);
  edge('M83 360H66V727H83',true);
  node(83,692,240,70,...failure);label(198,680,'原文 / 提取 / 引文校验失败');
  edge('M323 360H362V852H323');label(204,810,'分析结果或变化满足通知条件');
  edge('M203 762V827');label(202,787,'满足系统告警条件');
  node(83,827,240,74,...queue);edge('M203 901V941');
  node(83,941,240,90,...settings);edge('M203 1031V1071');
  node(83,1071,240,90,...feishu);edge('M203 1161V1201',true);
  node(83,1201,240,74,...back);
  label(195,1310,'推送独立触发，无需先手动跟踪');
  label(195,1335,'虚线：反馈、异常与通知回链');
});
const web=['网站与 API',['页面、配置、情报查询','读取通知队列并发送']];
const worker=['独立采集服务',['取任务 · 搜索与抓原文','调用分析 · 核验后入库']];
const auth=['Auth',['登录与身份验证']];
const data=['PostgreSQL',['方向、源库、情报','任务与通知队列']];
const storage=['Storage',['原文文件','私有证据存档']];
const cron=['Cron / pg_net',['采集、通知、健康检查独立调度']];
const search=['MiniMax',['搜索并发现线索']];
const sources=['公开信息渠道',['机构、企业、媒体与作者']];
const analysis=['DeepSeek',['分析原文 · 匹配方向']];
chart('architecture-desktop',1120,890,'系统架构图：桌面布局',({node,group,edge,label})=>{
  group(60,185,710,210,'Vercel · 网站与独立采集，两个部署');
  group(60,490,710,245,'Supabase · 数据与运行支持');
  group(810,185,280,405,'搜索、原文与分析');
  node(60,40,170,76,'用户浏览器',['www.nrgopt.com']);
  node(300,40,270,76,'域名与 DNS',['新网管理 · Vercel DNS 解析']);
  node(650,40,180,76,'Codex',['开发、测试与维护']);
  node(900,40,180,76,'GitHub',['版本管理与发布']);
  edge('M230 78H300',true);edge('M145 116V255');label(145,169,'HTTPS 访问');
  edge('M435 116V158H250V255',true);label(339,158,'解析目标');
  edge('M830 78H900',true);edge('M990 116V144H700V255',true);edge('M700 144H320V255',true);label(679,144,'开发发布');
  node(90,255,260,100,...web);node(460,255,280,100,...worker);
  edge('M280 355V490',false,true);label(265,437,'身份、数据与原件');
  edge('M590 355V490',false,true);label(590,437,'任务、原件与分析结果');
  node(80,540,165,90,...auth);node(260,540,245,90,...data);node(520,540,225,90,...storage);
  node(100,660,630,55,...cron);
  edge('M100 688H35V304H90');label(35,474,'通知 / 健康');
  edge('M730 688H790V322H740');label(790,622,'采集调度');
  node(835,235,230,78,...search);node(835,355,230,78,...sources);node(835,475,230,78,...analysis);
  edge('M740 274H835',false,true);
  edge('M740 294H775V394H835',false,true);
  edge('M740 312H755V514H835',false,true);
  node(835,675,230,78,'飞书',['群聊与个人通知']);
  edge('M90 330H15V805H950V753');label(500,805,'网站 API 按推送设置发送 · Supabase 每分钟独立调度通知');
  label(560,861,'虚线：域名解析与开发发布；Codex / GitHub 不参与每日自动采集');
});
chart('architecture-mobile',390,1730,'系统架构图：手机布局',({node,group,edge,label})=>{
  group(60,265,280,285,'Vercel · 两个独立部署');
  group(60,605,280,440,'Supabase · 数据与调度');
  group(60,1110,280,340,'搜索、原文与分析');
  node(85,25,230,70,'用户浏览器',['www.nrgopt.com']);
  node(85,145,230,82,'域名与 DNS',['新网：域名管理','Vercel DNS：解析']);
  edge('M200 95V145',true);edge('M200 227V310',true);label(205,251,'解析与 HTTPS 访问');
  node(85,310,230,88,...web);node(85,439,230,88,...worker);
  edge('M85 345H45V624H60',false,true);label(203,583,'网站与采集服务读写数据及原件');
  edge('M315 479H349V624H340',false,true);
  node(85,646,230,65,...auth);node(85,738,230,87,...data);node(85,852,230,78,...storage);
  node(85,957,230,65,'Cron / pg_net',['独立采集 / 通知 / 健康调度']);
  edge('M85 990H28V378H85');edge('M28 483H85');
  node(85,1155,230,70,...search);node(85,1253,230,70,...sources);node(85,1351,230,70,...analysis);
  edge('M315 499H368V1386H315',false,true);edge('M368 1190H315',false,true);edge('M368 1288H315',false,true);
  node(85,1505,230,78,'飞书',['群聊与个人通知']);
  edge('M85 362H13V1544H85');label(201,1485,'网站 API 按设置发送通知');
  node(60,1650,115,55,'Codex');node(225,1650,115,55,'GitHub');
  edge('M175 1678H225',true);edge('M340 1678H383V287H340',true);
  label(195,1624,'开发发布 · 不参与每日自动采集');
});
