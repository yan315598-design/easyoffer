(() => {
'use strict';
const KEY = 'jobAutofillData';
const stages = ['已收藏','已投递','筛选沟通','测评／笔试','面试中','Offer','已结束'];
const interviewRounds = ['待一面','待二面','待终面'];
const schemaVersion = 2;
const jobTypes = ['全职', '实习', '兼职', '其他'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const dateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = () => dateKey(new Date());
const stageLabel = r => r.status === '面试中' && r.interviewRound ? r.interviewRound : r.status;
function normalize(r) {
 const old = {'在投':'已投递','笔试':'测评／笔试','面试':'面试中','挂了':'已结束', 'submitted':'已投递'};
 const known = stages.includes(r.status);
 const status = known ? r.status : interviewRounds.includes(r.status) ? '面试中' : (Object.hasOwn(old, r.status) ? old[r.status] : '已投递');
 const round = r.interviewRound || r.status;
 return {
   ...r,
   id: r.id || uid(),
   status,
   interviewRound: status === '面试中' && interviewRounds.includes(round) ? round : '',
   legacyStatus: r.legacyStatus || (known ? '' : r.status || ''),
   schemaVersion,
   confirmed: r.confirmed === true,
   archived: r.archived === true,
   history: Array.isArray(r.history) ? r.history : []
 };
}
const roleKey = record => JSON.stringify([record.company, record.position].map(value =>
 String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
));
function jobLink(url) {
 try {
   const target = new URL(url);
   if (target.protocol === 'https:' || target.protocol === 'http:') {
     return `<a href="${esc(target.href)}" target="_blank" rel="noopener noreferrer">打开岗位 ↗</a>`;
   }
 } catch {}
 return '—';
}
const stageBadge = record => `<span class="tracker-stage" data-stage="${stages.indexOf(record.status)}">${esc(stageLabel(record))}</span>`;
const displayDateTime = value => esc(String(value || '—').replace('T',' '));
function renderTable(records) {
 return `<div class="tracker-table-scroll" tabindex="0" aria-label="投递记录表格，可横向滚动">
  <table class="tracker-table">
    <thead><tr>${['公司','职位','当前阶段','类型','地点','投递日期','下一场笔试 / 面试','关联简历','职位链接','操作']
      .map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
    <tbody>${records.map(record => `<tr>
      <th scope="row"><button class="tracker-company" data-edit="${esc(record.id)}" aria-label="编辑 ${esc(record.company)} · ${esc(record.position)}">${esc(record.company)}</button></th>
      <td class="tracker-position">${esc(record.position)}</td>
      <td>${stageBadge(record)} ${record.confirmed ? '' : '<span class="tracker-review">待核实</span>'}
        ${record.archived ? '<span class="tracker-stage">已归档</span>' : ''}</td>
      <td>${esc(record.jobType || '—')}</td><td>${esc(record.location || '—')}</td>
      <td>${esc(record.date || '—')}</td><td>${displayDateTime(record.nextEventAt)}</td>
      <td>${esc(record.profileName || '—')}</td><td>${jobLink(record.url)}</td>
      <td><button data-archive="${esc(record.id)}">${record.archived ? '恢复' : '归档'}</button></td>
    </tr>`).join('') || '<tr><td colspan="10" class="tracker-empty">暂无匹配记录。可添加申请，或试试调整筛选条件。</td></tr>'}</tbody>
  </table>
 </div>`;
}
function renderDashboard(list, confirmed) {
 const stageCounts = stages.map(stage => [stage, list.filter(record => record.status === stage).length]);
 const weeks = Array.from({ length: 4 }, (_, index) => {
   const start = new Date();
   start.setDate(start.getDate() - (3 - index) * 7 - 6);
   const end = new Date(start);
   end.setDate(start.getDate() + 6);
   const from = dateKey(start);
   const to = dateKey(end);
   const count = confirmed.filter(r => r.status !== '已收藏' && r.date >= from && r.date <= to).length;
   return [`${from.slice(5)} 至 ${to.slice(5)}`, count];
 });
 const bars = (entries, max) => `<ul class="tracker-bars">${entries.map(([label, count]) =>
   `<li><span>${label}</span><div class="tracker-bar-track" aria-hidden="true"><i style="width:${count / max * 100}%"></i></div><strong>${count}</strong></li>`).join('')}</ul>`;
 return `<div class="tracker-dashboard">
   <section><h2>近四周投递节奏</h2><p>按投递日期统计已核实的申请。缺少投递日期的记录不会显示在这里。</p>
     ${bars(weeks, Math.max(1, ...weeks.map(([, count]) => count)))}</section>
   <section><h2>阶段分布</h2><p>按当前筛选的岗位统计，包含待核实记录。</p>${bars(stageCounts, Math.max(1, list.length))}</section>
 </div>`;
}
function csvParse(text) {
 const rows=[];let row=[],v='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n')){row.push(v.replace(/\r$/,''));v='';if(c==='\n'){rows.push(row);row=[];}}else v+=c;}
 if(quoted) throw Error('CSV 引号未闭合');if(v||row.length){row.push(v.replace(/\r$/,''));rows.push(row);}return rows;
}
const columns = ['id','company','position','location','jobType','url','profileId','profileName','status','interviewRound','date','nextEventAt','summary','notes','confirmed','archived','outcome','history','legacyStatus','schemaVersion'];
const formulaPrefix = /^'*(?:\s*[=+@-]|[\t\r\n])/;
function csvSerialize(rows) {
 const values = rows.map(record => columns.map(key => key === 'schemaVersion' ? schemaVersion :
   key === 'history' ? JSON.stringify(record.history || []) : record[key] ?? ''));
 return '\uFEFF' + [columns, ...values].map(row => row.map(value => {
   const cell = String(value);
   return '"' + (formulaPrefix.test(cell) ? "'" + cell : cell).replace(/"/g, '""') + '"';
 }).join(',')).join('\r\n');
}
function csvRecords(text) {
 const [header, ...rows] = csvParse(text.replace(/^\uFEFF/, ''));
 if (!header?.includes('company') || !header.includes('position')) throw Error('CSV 需要 company 和 position 列');
 return rows.filter(row => row.some(Boolean)).map((row, index) => {
   const read = key => row[header.indexOf(key)] ?? '';
   const record = Object.fromEntries(columns.map(key => {
     const value = read(key);
     return [key, ['1', String(schemaVersion)].includes(read('schemaVersion')) && value.startsWith("'") && formulaPrefix.test(value.slice(1))
       ? value.slice(1) : value];
   }));
   if (!record.company.trim() || !record.position.trim()) throw Error(`第 ${index + 2} 行的公司与职位不能为空`);
   let history;
   try { history = record.history ? JSON.parse(record.history) : []; }
   catch { throw Error(`第 ${index + 2} 行的阶段历史格式异常`); }
   if (!Array.isArray(history) || history.some(entry => !entry || typeof entry !== 'object')) {
     throw Error(`第 ${index + 2} 行的阶段历史格式异常`);
   }
   return normalize({
     ...record,
     company: record.company.trim(),
     position: record.position.trim(),
     confirmed: record.confirmed === 'true',
     archived: record.archived === 'true',
     source: 'csv',
     history
   });
 });
}
async function read(){const all=await chrome.storage.local.get([KEY,'yanyuSubmissionsV1']);const data=all[KEY] || {profiles:[],submissions:[]};if(Array.isArray(all.yanyuSubmissionsV1))data.submissions=all.yanyuSubmissionsV1;return data;}
function snapshot(records) {
 return JSON.stringify(records, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
   ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}
async function write(records, baseline) {
 const run = async () => {
   const data = await read();
   if (snapshot((data.submissions || []).map(normalize)) !== snapshot(baseline)) {
     throw Error('记录已在其他页面更新，请重新打开工作台后再修改');
   }
   await chrome.storage.local.set({ yanyuSubmissionsV1: records });
 };
 return navigator.locks ? navigator.locks.request('yanyu-submissions',run) : run();
}
const mounts=new WeakMap();
async function mount(root){
 mounts.get(root)?.abort();const controller=new AbortController();mounts.set(root,controller);const listenerOptions={signal:controller.signal};
 const migrate = async () => {
   const all = await chrome.storage.local.get([KEY, 'yanyuSubmissionsV1']);
   const previous = all.yanyuSubmissionsV1;
   const rows = (Array.isArray(previous) ? previous : all[KEY]?.submissions || []).map(normalize);
   if (JSON.stringify(previous) !== JSON.stringify(rows)) await chrome.storage.local.set({ yanyuSubmissionsV1: rows });
 };
 if(navigator.locks)await navigator.locks.request('yanyu-submissions',migrate);else await migrate();
 const data = await read();
 if (controller.signal.aborted) return;
 let records = (data.submissions || []).map(normalize);
 let view = 'list';
 root.innerHTML = `<div class="tracker">
   <header class="tracker-title">
     <div><h1>求职工作台</h1><p>管理岗位、投递进度和下一场笔试或面试。</p></div>
     <button data-act="add">＋ 添加申请</button>
   </header>
   <div class="tracker-tools">
     <div class="tracker-views" role="group" aria-label="工作台视图">
       <button data-act="list">表格</button><button data-act="board">看板</button><button data-act="dashboard">仪表盘</button>
     </div>
     <div class="tracker-data-tools">
       <button data-act="import">导入 CSV</button><button data-act="export">导出 CSV</button>
       <input type="file" accept=".csv,text/csv" hidden data-file>
     </div>
   </div>
   <div class="tracker-filters">
     <input name="q" type="search" placeholder="搜索公司、职位或地点" aria-label="搜索公司、职位或地点">
     <select name="stage" aria-label="阶段"><option value="">全部阶段</option>${stages.map(s=>`<option>${s}</option>`).join('')}</select>
     <select name="type" aria-label="职位类型"><option value="">全部类型</option>${jobTypes.map(type=>`<option>${type}</option>`).join('')}</select>
     <select name="archive" aria-label="归档"><option value="active">未归档</option><option value="archive">已归档</option><option value="all">全部记录</option></select>
     <div class="tracker-date-filter"><span>投递日期</span><input type="date" name="from" aria-label="投递日期起始">
       <span>至</span><input type="date" name="to" aria-label="投递日期截止"></div>
     <select name="sort" aria-label="排序"><option value="recent">按最近投递</option><option value="next">按下一场安排</option><option value="company">按公司名称</option></select>
   </div>
   <div data-error role="status"></div>
   <div class="tracker-stats"></div>
   <section class="tracker-upcoming" aria-label="即将到来的笔试与面试" hidden></section>
   <div class="tracker-results"></div>
   <p class="tracker-count" role="status"></p>
 </div>`;
 const error=e=>root.querySelector('[data-error]').textContent=e?.message||e||'';
 function filtered() {
   const val = name => root.querySelector(`[name="${name}"]`).value;
   const query = val('q').trim().toLowerCase();
   const stage = val('stage'), type = val('type'), archive = val('archive'), from = val('from'), to = val('to');
   const list = records.filter(r => `${r.company} ${r.position} ${r.location || ''}`.toLowerCase().includes(query) &&
     (!stage || r.status === stage) && (!type || r.jobType === type) &&
     (archive === 'all' || r.archived === (archive === 'archive')) &&
     (!from || (r.date && r.date >= from)) && (!to || (r.date && r.date <= to)));
   const sort = val('sort');
   if (sort === 'company') return list.sort((a, b) => String(a.company || '').localeCompare(b.company || '', 'zh-CN'));
   if (sort === 'next') return list.sort((a, b) => (a.nextEventAt || '9999').localeCompare(b.nextEventAt || '9999'));
   return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
 }
 function card(r){return `<article class="tracker-record"><h3>${esc(r.position)}</h3><p>${esc(r.company)}${r.location?' · '+esc(r.location):''}</p><p>${esc(r.date||'投递日期未填写')} · ${esc(r.profileName||'未关联简历')}</p>${r.interviewRound ? stageBadge(r) : ''}${!r.confirmed?'<span class="tracker-review">待核实</span>':''}${r.nextEventAt?`<p>下次安排：${displayDateTime(r.nextEventAt)}</p>`:''}<button data-edit="${esc(r.id)}">查看 / 编辑</button><button data-archive="${esc(r.id)}">${r.archived?'恢复':'归档'}</button></article>`;}
 function render() {
   const list = filtered();
   const confirmed = list.filter(record => record.confirmed);
   const upcoming = list.filter(record => !record.archived && record.status !== '已结束' &&
     record.nextEventAt && new Date(record.nextEventAt) >= new Date())
     .sort((a, b) => a.nextEventAt.localeCompare(b.nextEventAt));
   const metrics = [
     ['收藏', list.filter(record => record.status === '已收藏').length],
     ['已确认投递', confirmed.filter(record => record.status !== '已收藏').length],
     ['处理中', confirmed.filter(record => stages.slice(1, 5).includes(record.status)).length],
     ['Offer', confirmed.filter(record => record.status === 'Offer').length],
     ['即将笔试 / 面试', upcoming.length]
   ];
   root.querySelector('.tracker-stats').innerHTML = metrics.map(([label, count]) =>
     `<div><strong>${count}</strong><span>${label}</span></div>`).join('');
   const agenda = root.querySelector('.tracker-upcoming');
   agenda.hidden = upcoming.length === 0;
   agenda.innerHTML = `<h2>下一场笔试与面试</h2><ul>${upcoming.map(record =>
     `<li><button data-edit="${esc(record.id)}"><time datetime="${esc(record.nextEventAt)}">${esc(record.nextEventAt.replace('T',' '))}</time>
       ${esc(record.company)} · ${esc(record.position)}</button></li>`).join('')}</ul>`;
   for (const mode of ['board', 'list', 'dashboard']) root.querySelector(`[data-act="${mode}"]`).setAttribute('aria-pressed', String(view === mode));
   root.querySelector('.tracker-count').textContent = `${list.length} 条记录`;
   const results = root.querySelector('.tracker-results');
   results.innerHTML = view === 'board' ? `<div class="tracker-board" tabindex="0" aria-label="阶段看板">${stages.map(stage => {
     const group = list.filter(record => record.status === stage);
     return `<section><h2>${stage} <small>${group.length}</small></h2>
       ${group.map(card).join('') || '<p class="tracker-empty">暂无记录</p>'}</section>`;
   }).join('')}</div>` : view === 'dashboard' ? renderDashboard(list, confirmed) : renderTable(list);
 }
 async function persist(next) {
   const normalized = next.map(normalize);
   await write(normalized, records);
   records = normalized;
   syncTypeFilter();
   render();
 }
 function dialog(title, drawer = false) {
   const d = document.createElement('dialog');
   d.className = drawer ? 'tracker-dialog tracker-drawer' : 'tracker-dialog';
   d.setAttribute('aria-label', title);
   d.innerHTML = drawer ? `<header><div><small>求职工作台</small><h2>${esc(title)}</h2></div>
     <button type="button" data-close aria-label="关闭">×</button></header>` : `<h2>${esc(title)}</h2>`;
   document.body.append(d);
   d.addEventListener('close', () => d.remove());
   if (!drawer) d.showModal();
   return d;
 }
 function edit(record = {}) {
   const existing = Boolean(record.id);
   const r = { status: '已收藏', date: '', ...record };
   const preview = !existing && r.source === 'browser-preview';
   const d = dialog(existing ? '编辑申请' : preview ? '核对当前岗位' : '添加申请', true);
   const option = (value, selected, label = value) =>
     `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
   const input = (name, label, type = 'text', required = false, wide = false) =>
     `<label ${wide ? 'class="tracker-field-wide"' : ''}><span>${label}${required ? ' <i aria-hidden="true">*</i>' : ''}</span>
       ${type === 'textarea' ? `<textarea name="${name}">${esc(r[name])}</textarea>`
         : `<input name="${name}" type="${type}" value="${esc(r[name])}" ${required ? 'required' : ''}>`}</label>`;
   const types = [...new Set([...jobTypes, r.jobType].filter(Boolean))];
   const profiles = data.profiles || [];
   const profileSnapshot = r.profileId && !profiles.some(profile => profile.id === r.profileId)
     ? option(r.profileId, r.profileId, `${r.profileName || '旧简历'}（快照）`) : '';
   d.insertAdjacentHTML('beforeend', `<form>
     <div class="tracker-drawer-body">
       <p class="tracker-drawer-intro">${preview ? '请核对网页提取的信息。如果已经在招聘网站提交申请，可以将阶段改为「已投递」。' : '公司和职位必填，其余信息可以稍后补上。'}</p>
       <div class="tracker-form">
         ${input('company', '公司', 'text', true)}${input('position', '职位', 'text', true)}
         ${input('location', '工作地点')}
         <label>职位类型<select name="jobType">${option('', r.jobType, '未指定')}${types.map(type => option(type, r.jobType)).join('')}</select></label>
         <label>阶段<select name="status">${stages.map(stage => option(stage, r.status)).join('')}</select></label>
         ${input('date', '投递日期', 'date')}
         <label data-round>面试轮次<select name="interviewRound">${option('', r.interviewRound, '未指定')}${interviewRounds.map(round => option(round, r.interviewRound)).join('')}</select></label>
         <label data-outcome>结束原因<select name="outcome">${option('', r.outcome, '未指定')}${['未通过','主动放弃','已入职','其他'].map(outcome => option(outcome, r.outcome)).join('')}</select></label>
         ${input('nextEventAt', '下一场笔试 / 面试', 'datetime-local')}
         <label>关联简历<select name="profileId">${option('', r.profileId, '不关联')}${profileSnapshot}
           ${profiles.map(profile => option(profile.id, r.profileId, profile.name)).join('')}</select></label>
         ${input('url', '职位链接', 'url', false, true)}
         ${input('summary', '职位摘要', 'textarea', false, true)}
         ${input('notes', '个人备注', 'textarea', false, true)}
         <label class="tracker-field-wide tracker-check"><input type="checkbox" name="confirmed" ${r.confirmed || !existing ? 'checked' : ''}> 我已核实这条记录</label>
       </div>
       ${existing ? `<details><summary>阶段变更历史</summary>${r.history?.map(h =>
         `<p>${displayDateTime(h.at)} ${esc(h.from)} → ${esc(h.to)}</p>`).join('') || '<p>暂无变更</p>'}</details>` : ''}
     </div>
     <p role="alert" data-form-error></p>
     <footer>
       ${existing ? '<button type="button" data-delete>删除</button>' : ''}
       <button type="button" data-cancel>取消</button><button type="submit">${existing ? '保存修改' : '添加到工作台'}</button>
     </footer>
   </form>`);
   const form = d.querySelector('form');
   const status = form.elements.status;
   function syncStage() {
     d.querySelector('[data-outcome]').hidden = status.value !== '已结束';
     d.querySelector('[data-round]').hidden = status.value !== '面试中';
   }
   status.addEventListener('change', syncStage);
   syncStage();
   const errorBox = d.querySelector('[data-form-error]');
   for (const button of d.querySelectorAll('[data-close], [data-cancel]')) button.onclick = () => d.close();
   if (existing) d.querySelector('[data-delete]').onclick = async () => {
     if (!confirm('删除这条申请记录？')) return;
     try {
       await persist(records.filter(row => row.id !== r.id));
       d.close();
     } catch (error) { errorBox.textContent = error.message; }
   };
   form.onsubmit = async event => {
     event.preventDefault();
     const values = new FormData(form);
     const next = normalize({
       ...r, ...Object.fromEntries(values), id: r.id || uid(), confirmed: values.has('confirmed'),
       updatedAt: new Date().toISOString(), source: r.source || 'manual', history: [...(r.history || [])]
     });
     next.company = next.company.trim();
     next.position = next.position.trim();
     if (!next.company || !next.position) {
       errorBox.textContent = '请填写公司与职位。';
       return;
     }
     if (next.url && !/^https?:\/\//i.test(next.url)) {
       errorBox.textContent = '职位链接需要以 https:// 或 http:// 开头。';
       return;
     }
     next.profileName = profiles.find(profile => profile.id === next.profileId)?.name || (next.profileId ? r.profileName : '');
     if (!existing && records.some(row => roleKey(row) === roleKey(next)) &&
         !confirm('已有相同公司和职位的记录，仍创建独立记录？')) return;
     if (next.status !== '已结束') next.outcome = '';
     if (stageLabel(r) !== stageLabel(next)) next.history.push({ at: next.updatedAt, from: stageLabel(r), to: stageLabel(next) });
     const save = d.querySelector('[type=submit]');
     save.disabled = true;
     try {
       await persist(existing ? records.map(row => row.id === next.id ? next : row) : [next, ...records]);
       d.close();
     } catch (error) {
       errorBox.textContent = error.message;
     } finally { save.disabled = false; }
   };
   d.showModal();
   form.elements.company.focus({ preventScroll: true });
 }
 root.addEventListener('input',e=>{if(e.target.closest('.tracker-filters'))render();},listenerOptions);
 root.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.dataset.edit)edit(records.find(r=>r.id===b.dataset.edit));if(b.dataset.archive)await persist(records.map(r=>r.id===b.dataset.archive?{...r,archived:!r.archived}:r));const action=b.dataset.act;if(action==='add')edit();if(['list','board','dashboard'].includes(action)){view=action;render();}if(action==='import')root.querySelector('[data-file]').click();if(action==='export'){const url=URL.createObjectURL(new Blob([csvSerialize(filtered())],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`easyoffer-applications-${today()}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}catch(err){error(err);}},listenerOptions);
 function syncTypeFilter() {
   const typeFilter = root.querySelector('[name=type]');
   const options = new Set(Array.from(typeFilter.options, option => option.value));
   for (const type of new Set(records.map(record => record.jobType))) {
     if (type && !options.has(type)) typeFilter.add(new Option(type, type));
   }
 }
 root.querySelector('[data-file]').onchange = async event => {
   try {
     const file = event.target.files[0];
     if (!file) return;
     const incoming = csvRecords(await file.text());
     if (!incoming.length) throw Error('文件中没有申请记录');
     const ids = new Set();
     const roles = new Set(records.map(roleKey));
     const existing = new Map(records.map(record => [record.id, record]));
     const preview = incoming.map(record => {
       const key = roleKey(record);
       const known = existing.get(record.id);
       const same = known && columns.filter(key => !['schemaVersion','legacyStatus'].includes(key))
         .every(key => snapshot(known[key] ?? '') === snapshot(record[key] ?? ''));
       const kind = ids.has(record.id) ? '文件内 ID 重复' : same ? '已存在' : known ? 'ID 冲突'
         : roles.has(key) ? '同公司同职位' : '新记录';
       ids.add(record.id);
       roles.add(key);
       return { record, kind };
     });
     const newCount = preview.filter(row => row.kind === '新记录').length;
     const d = dialog('导入预览');
     d.insertAdjacentHTML('beforeend', `<p>共 ${preview.length} 条，${newCount} 条新记录。重复和冲突默认跳过。</p>
       <div class="tracker-import-preview">${preview.map(({record,kind}) =>
         `<p><strong>${kind}</strong> ${esc(record.company)} · ${esc(record.position)}</p>`).join('')}</div>
       <label><input type="checkbox" data-replace> 使用文件中的记录更新同 ID 冲突</label>
       <label><input type="checkbox" data-keep> 将同公司同职位的其他记录作为独立申请保留</label>
       <footer><button data-cancel>取消</button><button data-confirm>确认导入</button></footer><p role="alert"></p>`);
     d.querySelector('[data-cancel]').onclick = () => d.close();
     d.querySelector('[data-confirm]').onclick = async e => {
       e.target.disabled = true;
       try {
         const keep = d.querySelector('[data-keep]').checked;
         const replace = d.querySelector('[data-replace]').checked;
         for (const {record,kind} of preview) {
           if (kind === '新记录' || (kind === '同公司同职位' && keep)) existing.set(record.id, record);
           if (kind === 'ID 冲突' && replace) {
             const old = existing.get(record.id);
             const history = [...old.history];
             for (const entry of record.history) {
               if (!history.some(item => snapshot(item) === snapshot(entry))) history.push(entry);
             }
             if (stageLabel(old) !== stageLabel(record)) history.push({at:new Date().toISOString(),from:stageLabel(old),to:stageLabel(record)});
             existing.set(record.id, {...old, ...record, history});
           }
         }
         await persist([...existing.values()]);
         d.close();
       } catch (err) {
         d.querySelector('[role="alert"]').textContent = err.message;
       } finally {
         e.target.disabled = false;
       }
     };
   } catch (err) {
     error(err);
   } finally {
     event.target.value = '';
   }
 };
 syncTypeFilter();
 render();
 const draftId = new URLSearchParams(location.search).get('draft');
 if (draftId && chrome.storage.session) {
   const key = 'yanyuTrackerDraft:' + draftId;
   const draft = (await chrome.storage.session.get(key))[key];
   if (draft && !controller.signal.aborted) {
     await chrome.storage.session.remove(key);
     edit(draft);
   }
 } else {
   const draft = (await chrome.storage.local.get('yanyuTrackerDraft')).yanyuTrackerDraft;
   if (draft && !controller.signal.aborted) {
     await chrome.storage.local.remove('yanyuTrackerDraft');
     edit(draft);
   }
 }
}
window.YanyuTracker={mount,normalize,csvParse,csvSerialize,csvRecords,stages};
})();
