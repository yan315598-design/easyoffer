// yanyu 右侧悬浮卡片：Shadow DOM 与宿主页样式隔离。
// 在 dock.js 之后加载，复用其速查、AI Copilot、日志和通知能力。

'use strict';

var yanyuDockState = { host: null, shadow: null, running: false, profileMenuOpen: false, visibilityTouched: false, expandRequested: false };

function usesNativeSidebar() {
  return Boolean(chrome.runtime.getManifest?.().side_panel);
}

var YANYU_DOCK_CSS = `
  :host { position:fixed; right:18px; bottom:18px; top:auto; left:auto; z-index:2147483646; width:min(280px, calc(100vw - 36px)); color:#171b26; font-family:"App UI",-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif; user-select:none; }
  :host([data-theme="dark"]) { color:#e9ecf4; }
  :host([data-region-active="true"]) .card,
  :host([data-region-active="true"]) .mini { display:none !important; }
  * { box-sizing:border-box; }
  button { font:inherit; }
  .card,.mini { border:1px solid #e3e7f0; background:#fff; box-shadow:0 12px 38px rgba(23,27,38,.16); }
  .card { max-height:calc(100vh - 36px); overflow:auto; border-radius:16px; }
  :host([data-theme="dark"]) .card,:host([data-theme="dark"]) .mini { border-color:#343b50; background:#171b25; }
  .head { display:flex; align-items:center; gap:8px; padding:12px 12px 10px; cursor:grab; touch-action:none; }
  .head:active { cursor:grabbing; }
  .logo { display:block; width:28px; height:28px; flex:0 0 28px; border-radius:8px; }
  .mini img { width:26px; height:26px; border-radius:7px; }
  .brand { min-width:0; flex:1; }
  .brand strong { display:block; font-size:13px; letter-spacing:.01em; }
  .brand small { display:block; margin-top:2px; color:#8a92a8; font-size:10px; }
  .icon-btn { display:grid; place-items:center; width:25px; height:25px; padding:0; border:0; border-radius:7px; background:transparent; color:inherit; cursor:pointer; }
  .icon-btn:hover { background:#eef1f7; }
  :host([data-theme="dark"]) .icon-btn:hover { background:#252b3b; }
  .profile { position:relative; margin:0 10px 9px; }
  .profile-trigger { display:flex; align-items:center; width:100%; gap:6px; padding:8px 9px; border:1px solid #e3e7f0; border-radius:9px; background:#f7f8fc; color:inherit; cursor:pointer; font-size:11px; }
  :host([data-theme="dark"]) .profile-trigger { border-color:#343b50; background:#1e2330; }
  .profile-name { overflow:hidden; flex:1; text-align:left; text-overflow:ellipsis; white-space:nowrap; }
  .menu { position:absolute; top:calc(100% + 5px); left:0; right:0; display:none; max-height:180px; overflow:auto; padding:5px; border:1px solid #e3e7f0; border-radius:10px; background:#fff; box-shadow:0 8px 24px rgba(23,27,38,.18); }
  .menu.open { display:block; }
  :host([data-theme="dark"]) .menu { border-color:#343b50; background:#1b2030; }
  .menu button { display:block; width:100%; padding:8px; overflow:hidden; border:0; border-radius:6px; background:transparent; color:inherit; cursor:pointer; text-align:left; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
  .menu button:hover,.menu button.active { background:#eef0fe; color:#4f46e5; }
  .actions { display:grid; gap:7px; padding:0 10px 10px; }
  .action { display:flex; align-items:center; justify-content:center; gap:7px; width:100%; min-height:37px; padding:8px 10px; border:1px solid transparent; border-radius:9px; cursor:pointer; font-size:12px; font-weight:650; transition:background .15s,transform .15s; }
  .action:active { transform:translateY(1px); }
  .action.primary { background:#4f46e5; color:#fff; }
  .action.primary:hover { background:#4338ca; }
  .action.secondary { border-color:#dfe3f8; background:#eef0fe; color:#4338ca; }
  .action.secondary:hover { background:#e2e5fd; }
  .action.region { border-color:#b8ecf7; background:#e0f6fb; color:#0e7490; }
  :host([data-theme="dark"]) .action.secondary { border-color:#3f4474; background:#272b51; color:#c7d2fe; }
  :host([data-theme="dark"]) .action.region { border-color:#155e75; background:#153744; color:#67e8f9; }
  .action:disabled { opacity:.55; cursor:wait; transform:none; }
  .more { width:100%; padding:7px; border:0; background:transparent; color:#8a92a8; cursor:pointer; font-size:11px; }
  .more-panel { display:none; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; padding:0 10px 10px; }
  .more-panel.open { display:grid; }
  .more-panel button { min-height:30px; padding:6px 4px; border:1px solid #e3e7f0; border-radius:7px; background:#f7f8fc; color:inherit; cursor:pointer; font-size:10px; }
  :host([data-theme="dark"]) .more-panel button { border-color:#343b50; background:#1e2330; }
  .task { display:none; margin:0 10px 10px; padding:9px; border-radius:9px; background:#f4f6fa; font-size:10px; }
  :host([data-theme="dark"]) .task { background:#1e2330; }
  .task.open { display:block; }
  .task-head { display:flex; align-items:center; justify-content:space-between; gap:6px; font-weight:700; }
  .task-summary { margin-top:5px; color:#4b5368; line-height:1.5; }
  :host([data-theme="dark"]) .task-summary { color:#b3bacb; }
  .task-list { max-height:150px; margin-top:6px; overflow:auto; }
  .task-row { display:flex; align-items:flex-start; gap:5px; padding:5px 0; border-top:1px solid #e3e7f0; line-height:1.35; }
  :host([data-theme="dark"]) .task-row { border-color:#343b50; }
  .task-row .reason { flex:1; min-width:0; overflow-wrap:anywhere; }
  .task-row button { padding:2px 4px; border:0; background:transparent; color:#4f46e5; cursor:pointer; font-size:10px; }
  .cancel { min-height:28px; padding:2px 4px; border:0; background:transparent; color:#b91c1c; cursor:pointer; font-size:10px; }
  .task-controls { display:inline-flex; align-items:center; gap:5px; flex:0 0 auto; }
  .pause { min-height:28px; padding:2px 6px; align-items:center; justify-content:center; border:0; border-radius:5px; background:#e7e9ff; color:#4338ca; cursor:pointer; font-size:10px; }
  :host([data-theme="dark"]) .pause { color:#a5b0fc; }
  .mini { display:none; place-items:center; width:44px; height:44px; margin-left:auto; border-radius:50%; color:#4f46e5; cursor:pointer; font-size:20px; font-weight:800; }
  :host([collapsed="true"]) .card { display:none; }
  :host([collapsed="true"]) .mini { display:grid; }
  .region-view { display:none; flex-direction:column; width:320px; max-width:calc(100vw - 16px); max-height:min(72vh,640px); overflow:hidden; border:1px solid #e3e7f0; border-radius:16px; background:#fff; box-shadow:0 12px 38px rgba(23,27,38,.16); }
  :host([data-theme="dark"]) .region-view { border-color:#343b50; background:#171b25; }
  :host([data-dock-view="region"]) .region-view { display:flex; }
  :host([data-dock-view="region"]) .card,
  :host([data-dock-view="region"]) .mini { display:none !important; }
  .region-head { display:flex; align-items:center; gap:8px; padding:12px 12px 10px; border-bottom:1px solid #e3e7f0; touch-action:none; }
  :host([data-theme="dark"]) .region-head { border-color:#343b50; }
  .region-head-text { min-width:0; flex:1; }
  .region-head-text strong { display:block; font-size:13px; }
  .region-head-text small { display:block; margin-top:2px; overflow:hidden; color:#8a92a8; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }
  .region-body { flex:1; overflow-y:auto; padding:6px 8px; }
  .region-summary { padding:2px 6px 8px; color:#8a92a8; font-size:10px; line-height:1.45; }
  .region-cat { margin-bottom:3px; }
  .region-cat-head { display:flex; align-items:center; gap:8px; width:100%; padding:8px 9px; border:0; border-radius:8px; background:transparent; color:inherit; cursor:pointer; text-align:left; font-size:12px; font-weight:600; }
  .region-cat-head:hover { background:#eef1f7; }
  :host([data-theme="dark"]) .region-cat-head:hover { background:#252b3b; }
  .region-cat-name { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .region-cat-count { min-width:20px; padding:1px 7px; border-radius:999px; background:#eef0fe; color:#4f46e5; font-size:10px; font-weight:650; text-align:center; }
  :host([data-theme="dark"]) .region-cat-count { background:#272b51; color:#c7d2fe; }
  .region-items { display:flex; flex-direction:column; gap:4px; padding:2px 4px 7px 12px; }
  .region-items[hidden] { display:none; }
  .region-item { display:block; width:100%; padding:7px 9px; overflow:hidden; border:1px solid #e3e7f0; border-radius:7px; background:#f7f8fc; color:inherit; cursor:pointer; text-align:left; text-overflow:ellipsis; white-space:nowrap; font-size:11px; }
  .region-item:hover { border-color:#c7cdf8; background:#eef0fe; }
  .region-item.active { border-color:#4f46e5; background:#eef0fe; color:#3730a3; font-weight:650; }
  :host([data-theme="dark"]) .region-item { border-color:#343b50; background:#1e2330; }
  :host([data-theme="dark"]) .region-item:hover,
  :host([data-theme="dark"]) .region-item.active { border-color:#4f46e5; background:#2d3260; color:#c7d2fe; }
  .region-foot { padding:10px 12px 12px; border-top:1px solid #e3e7f0; }
  :host([data-theme="dark"]) .region-foot { border-color:#343b50; }
  .region-apply { width:100%; padding:9px 0; border:0; border-radius:9px; background:#4f46e5; color:#fff; cursor:pointer; font-size:12.5px; font-weight:700; }
  .region-apply:hover:not(:disabled) { background:#4338ca; }
  .region-apply:disabled { background:#dfe3f2; color:#8a92a8; cursor:not-allowed; }
  :host([data-theme="dark"]) .region-apply:disabled { background:#2a3042; color:#69728a; }
  .region-hint { margin-top:7px; color:#8a92a8; font-size:10px; line-height:1.45; text-align:center; }
  button:focus-visible { outline:2px solid #818cf8; outline-offset:2px; }
  @media (max-width:640px) { :host { right:8px; width:176px; } .region-view { width:calc(100vw - 16px); } }
  @media (prefers-reduced-motion:reduce) { * { transition:none!important; } }
`;

function yanyuDockElements() {
  return yanyuDockState;
}

function yanyuApplyDockTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  const host = yanyuDockState.host;
  if (host) host.setAttribute('data-theme', mode);
}

function yanyuSetDockVisible(visible, expand = true, persist = true) {
  yanyuDockState.visibilityTouched = true;
  const host = yanyuDockState.host;
  if (!host) {
    createFloatingButton();
  }
  const current = yanyuDockState.host;
  if (!current) return false;
  current.style.display = visible ? 'block' : 'none';
  if (visible && expand) {
    // 记录显式展开，避免稍后返回的 storage 读取把用户刚打开的 dock 又折叠。
    yanyuDockState.expandRequested = true;
    current.setAttribute('collapsed', 'false');
  }
  if (persist) chrome.storage.local.set({ jobAutofillDockHidden: !visible, jobAutofillDockCollapsed: visible && expand ? false : current.getAttribute('collapsed') === 'true' });
  return !!visible && current.style.display !== 'none' && current.isConnected !== false;
}

/** 在同一 dock host 内切换到选区资料视图；不删除 host，也不覆盖当前折叠偏好。 */
function yanyuShowRegionView() {
  let host = yanyuDockState.host;
  if (!host) {
    createFloatingButton();
    host = yanyuDockState.host;
  }
  if (!host) return false;
  const viewportWidth = Number(window.innerWidth) || 360;
  host.style.width = `${Math.max(220, Math.min(320, viewportWidth - 16))}px`;
  host.removeAttribute('data-region-active');
  host.setAttribute('data-dock-view', 'region');
  return yanyuSetDockVisible(true, false, !usesNativeSidebar());
}

/** 关闭选区视图，恢复普通悬浮卡片；只清理选区相关 DOM/属性。 */
function yanyuRestoreDockView() {
  const host = yanyuDockState.host;
  if (!host) return false;
  host.removeAttribute('data-dock-view');
  host.removeAttribute('data-region-active');
  host.style.width = '';
  const shadow = yanyuDockState.shadow;
  if (shadow) {
    const body = shadow.querySelector('[data-yy-region-view-body]');
    if (body) body.innerHTML = '';
    const summary = shadow.querySelector('[data-yy-region-summary]');
    if (summary) summary.textContent = '请选择资料条目';
    const hint = shadow.querySelector('[data-yy-region-view-hint]');
    if (hint) hint.textContent = '手动选择一条资料后，点击立即填入';
    const apply = shadow.querySelector('[data-yy-region-view-apply]');
    if (apply) {
      apply.disabled = true;
      apply.onclick = null;
    }
    const close = shadow.querySelector('[data-yy-region-view-close]');
    if (close) close.onclick = null;
  }
  return yanyuSetDockVisible(!usesNativeSidebar() || yanyuDockState.fallbackOpen === true, false, !usesNativeSidebar());
}

function applyFloatTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  ['job-autofill-mini-ball', 'job-autofill-toolbar', 'job-autofill-profile-menu', 'job-autofill-copy-panel', 'job-autofill-ai-panel', 'job-autofill-log-panel', 'job-autofill-region-overlay', 'job-autofill-region-panel'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('data-theme', mode);
  });
  yanyuApplyDockTheme(mode);
}

function yanyuTaskCounts(result) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  return {
    filled: Number(result?.filledCount) || rows.filter(row => row.status === 'filled').length,
    skipped: result?.skippedCount ?? rows.filter(row => row.status === 'skipped_has_value').length,
    review: result?.reviewCount ?? rows.filter(row => row.status === 'needs_review').length,
    failed: result?.failedCount ?? rows.filter(row => row.status === 'failed').length
  };
}

function syncYanyuTaskControls() {
  const shadow = yanyuDockState.shadow;
  if (!shadow) return;
  const running = !!activeFillTask?.running;
  const paused = !!activeFillTask?.paused;
  if (running) shadow.querySelector('[data-yy-task]')?.classList.add('open');
  const pause = shadow.querySelector('[data-yy-pause]');
  const cancel = shadow.querySelector('[data-yy-cancel]');
  if (pause) {
    pause.style.display = running ? 'inline-flex' : 'none';
    pause.textContent = paused ? '继续' : '暂停';
    pause.title = paused ? '从当前进度继续填写' : '暂停后续填写操作';
  }
  if (cancel) cancel.style.display = running ? 'inline-flex' : 'none';
}

function showYanyuTaskResult(result) {
  const shadow = yanyuDockState.shadow;
  if (!shadow) {
    showNotification(`已填入 ${result?.filledCount || 0} 个字段`, (result?.failedCount || result?.reviewCount) ? 'warning' : 'success');
    return;
  }
  const panel = shadow.querySelector('[data-yy-task]');
  if (!panel) return;
  const counts = yanyuTaskCounts(result);
  panel.classList.add('open');
  const title = result?.cancelled ? '任务已取消' : counts.failed ? '填入完成（有失败项）' : '填入结果';
  shadow.querySelector('[data-yy-task-title]').textContent = result?.error || title;
  const blocked = result?.structure?.failed ? ` · 新增受限 ${result.structure.failed}` : '';
  shadow.querySelector('[data-yy-task-summary]').textContent = `成功 ${counts.filled} · 已有值 ${counts.skipped} · 待人工 ${counts.review} · 失败 ${counts.failed}${blocked}`;
  shadow.querySelector('[data-yy-cancel]').style.display = yanyuDockState.running ? 'inline' : 'none';
  const list = shadow.querySelector('[data-yy-task-list]');
  list.innerHTML = '';
  const reasons = {
    no_profile_value: '当前资料缺少对应值',
    language_score_ambiguous: '同一考试有多条成绩，请在外语能力里设为默认',
    numeric_score_required: '网站需要数字成绩，请核对资料',
    low_confidence: '字段含义需要确认',
    write_failed_or_option_not_found: '控件未确认或没有匹配选项',
    value_reset: '网页清空或改写了选中值',
    validation_failed: '网页校验未通过',
    record_ambiguous: '无法确认该网页行对应的简历条目',
    range_not_committed: '日期范围未确认',
    date_precision_required: '网站需要具体日期，请核对资料',
    field_timeout: '等待控件响应超时',
    unrecognized_field: '尚未识别此字段'
  };
  const priorities = { date_precision_required: 1, write_failed_or_option_not_found: 1 };
  const rows = [
    ...(result?.structure?.manual || []).map(reason => ({ label: '多条经历', reason, status: 'needs_review', priority: 0 })),
    ...(Array.isArray(result?.results) ? result.results : [])
      .filter(row => row.status && row.status !== 'filled')
      .map(row => ({ ...row, priority: priorities[row.reason] ?? (row.status === 'skipped_has_value' ? 4 : 3) }))
  ].sort((a, b) => a.priority - b.priority)
    .slice(0, 80);
  rows.forEach((row, index) => {
    const item = document.createElement('div');
    item.className = 'task-row';
    const icon = row.status === 'failed' ? '×' : row.status === 'filled' ? '✓' : row.status === 'skipped_has_value' ? '○' : '!';
    const reason = document.createElement('span');
    reason.className = 'reason';
    reason.textContent = `${icon} ${row.label || row.fieldType || '字段'}：${reasons[row.reason] || row.reason || row.status}`;
    item.appendChild(reason);
    const article = { date_precision_required: 'date', write_failed_or_option_not_found: 'controls' }[row.reason];
    if (article) {
      const help = document.createElement('button');
      help.type = 'button';
      help.textContent = '帮助';
      help.addEventListener('click', () => {
        runtimeSend({ action: 'openOptions', article }, 5000).catch(error => showNotification(error.message, 'warning'));
      });
      item.appendChild(help);
    }
    if (row.element?.isConnected) {
      const locate = document.createElement('button');
      locate.type = 'button';
      locate.textContent = '定位';
      locate.addEventListener('click', () => {
        row.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        try { row.element.focus({ preventScroll: true }); } catch {}
      });
      item.appendChild(locate);
      if (row.value !== undefined && !['skipped_has_value', 'filled'].includes(row.status) && row.reason !== 'date_precision_required') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '重试';
        retry.dataset.yyRetry = String(index);
        retry.addEventListener('click', async () => {
          if (activeFillTask?.running || fieldHasValue(row.element)) return;
          retry.disabled = true;
          try {
            const ok = await fillField(row.element, row.value, { openTimeoutMs: 2200 });
            reason.textContent = ok ? `✓ ${row.label || '字段'}：重试成功` : `! ${row.label || '字段'}：仍需人工确认`;
            if (ok) retry.remove();
          } finally { retry.disabled = false; }
        });
        item.appendChild(retry);
      }
    }
    list.appendChild(item);
  });
  syncYanyuTaskControls();
}

async function runYanyuDockFill(mode) {
  if (yanyuDockState.running) {
    showNotification('已有填入任务正在进行，可先在结果区取消', 'info');
    return;
  }
  yanyuDockState.running = true;
  const shadow = yanyuDockState.shadow;
  shadow?.querySelectorAll('[data-yy-action="fill"],[data-yy-action="incremental"]').forEach(btn => { btn.disabled = true; });
  showYanyuTaskResult({ results: [], error: mode === 'incremental' ? '正在增量填入空白字段…' : '正在扫描并一键填入…' });
  try {
    const response = await runtimeSend({ action: 'getActiveProfile' }, 8000);
    if (!response?.success || !response.profile) throw new Error(response?.error || '请先配置当前简历资料');
    currentActiveProfile = response.profile;
    const result = await fillForm(response.profile, { mode });
    if (result?.error) showNotification(result.error, 'warning');
  } catch (error) {
    showYanyuTaskResult({ results: [], failedCount: 1, error: `填入失败：${error?.message || error}` });
  } finally {
    yanyuDockState.running = false;
    shadow?.querySelectorAll('[data-yy-action="fill"],[data-yy-action="incremental"]').forEach(btn => { btn.disabled = false; });
    const cancel = shadow?.querySelector('[data-yy-cancel]');
    if (cancel) cancel.style.display = 'none';
  }
}

function refreshProfilesMenu() {
  const shadow = yanyuDockState.shadow;
  if (!shadow) return;
  chrome.runtime.sendMessage({ action: 'getAllProfiles' }, (res) => {
    if (chrome.runtime.lastError || !res?.success) return;
    allProfilesCache = res.profiles || [];
    const active = allProfilesCache.find(p => p.id === res.activeProfileId) || allProfilesCache[0];
    if (active) {
      currentActiveProfile = active;
      const name = shadow.querySelector('[data-yy-profile-name]');
      if (name) {
        name.textContent = active.name || '默认资料';
        name.title = active.name || '默认资料';
      }
    }
    const menu = shadow.querySelector('[data-yy-profile-menu]');
    if (!menu) return;
    menu.innerHTML = '';
    allProfilesCache.forEach(profile => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${profile.id === active?.id ? '✓ ' : ''}${profile.name || '默认资料'}`;
      btn.classList.toggle('active', profile.id === active?.id);
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'setActiveProfile', profileId: profile.id }, () => {
          menu.classList.remove('open');
          yanyuDockState.profileMenuOpen = false;
          refreshProfilesMenu();
        });
      });
      menu.appendChild(btn);
    });
  });
}

function initYanyuDockDragging(host, handle) {
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const rect = host.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    try { handle.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    const width = host.offsetWidth || 196;
    const height = host.offsetHeight || 420;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, drag.left + event.clientX - drag.x));
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, drag.top + event.clientY - drag.y));
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.dataset.dragged = 'true';
  });
  const finish = event => {
    if (!drag) return;
    drag = null;
    try { handle.releasePointerCapture(event.pointerId); } catch {}
    const rect = host.getBoundingClientRect();
    chrome.storage.local.set({ jobAutofillDockPos: { left: Math.round(rect.left), top: Math.round(rect.top) } });
    setTimeout(() => { delete host.dataset.dragged; }, 0);
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

function createFloatingButton() {
  const existing = document.getElementById('job-autofill-dock');
  if (existing) {
    if (yanyuDockState.host === existing) return;
    // 只处理带明确插件所有权标记的旧宿主；宿主页同名节点不删除也不占用。
    if (existing.dataset.yanyu !== 'dock') return;
    // 扩展重载/重新注入后，旧宿主仍在 DOM 中但状态已经失效；只清理插件自己的旧节点并重建。
    existing.remove();
    yanyuDockState.host = null;
    yanyuDockState.shadow = null;
  }
  if (!document.body) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createFloatingButton, { once: true });
    return;
  }
  const theme = preferredTheme();
  const host = document.createElement('div');
  host.id = 'job-autofill-dock';
  host.dataset.yanyu = 'dock';
  host.setAttribute('data-theme', theme);
  host.setAttribute('collapsed', 'false');
  if (usesNativeSidebar()) host.style.display = 'none';
  if (typeof host.attachShadow !== 'function') {
    // 极简 VM 测试 DOM 没有 Shadow DOM；真实 Chrome 始终走开放 ShadowRoot。
    yanyuDockState.host = host;
    yanyuDockState.shadow = null;
    document.body.appendChild(host);
    return;
  }
  const shadow = host.attachShadow({ mode: 'open' });
  yanyuDockState.host = host;
  yanyuDockState.shadow = shadow;
  const logoUrl = chrome.runtime.getURL('icons/icon48.png');
  shadow.innerHTML = `
    <style>${YANYU_DOCK_CSS}</style>
    <button class="mini" type="button" data-yy-action="expand" title="展开易offer网申填写助手" aria-label="展开易offer网申填写助手"><img src="${logoUrl}" alt=""></button>
    <section class="card" aria-label="易offer网申填写助手">
      <header class="head" data-yy-drag>
        <img class="logo" src="${logoUrl}" alt="">
        <span class="brand"><strong>易offer</strong><small>网申填写助手</small></span>
        <button type="button" class="icon-btn" data-yy-action="collapse" title="折叠" aria-label="折叠">−</button>
        <button type="button" class="icon-btn" data-yy-action="close" title="关闭，可点击浏览器工具栏插件图标恢复" aria-label="关闭">×</button>
      </header>
      <div class="profile">
        <button type="button" class="profile-trigger" data-yy-action="profile" title="切换当前简历">
          <span>▤</span><span class="profile-name" data-yy-profile-name>默认资料</span><span>▾</span>
        </button>
        <div class="menu" data-yy-profile-menu></div>
      </div>
      <div class="actions">
        <button type="button" class="action primary" data-yy-action="fill">⚡ 一键填入</button>
        <button type="button" class="action secondary" data-yy-action="incremental">＋ 增量填入</button>
        <button type="button" class="action region" data-yy-action="region">▧ 选区填入</button>
      </div>
      <button type="button" class="more" data-yy-action="more">更多功能 ▾</button>
      <div class="more-panel" data-yy-more>
        <button type="button" data-yy-action="ai">AI 助填</button>
        <button type="button" data-yy-action="copy">资料速查</button>
        <button type="button" data-yy-action="copilot">HR 招呼</button>
        <button type="button" data-yy-action="scan">字段高亮</button>
        <button type="button" data-yy-action="theme">深浅主题</button>
        <button type="button" data-yy-action="settings">配置资料</button>
        <button type="button" data-yy-action="feedback">建议反馈</button>
      </div>
      <div class="task" data-yy-task>
        <div class="task-head"><span data-yy-task-title>填入结果</span><span class="task-controls"><button type="button" class="pause" data-yy-pause style="display:none">暂停</button><button type="button" class="cancel" data-yy-cancel style="display:none">取消任务</button></span></div>
        <div class="task-summary" data-yy-task-summary></div>
        <div class="task-list" data-yy-task-list></div>
      </div>
    </section>
    <section class="region-view" data-yy-region-view aria-label="选区填入资料选择">
      <header class="region-head">
        <img class="logo" src="${logoUrl}" alt="">
        <span class="region-head-text"><strong>选区填入</strong><small data-yy-region-summary>请选择资料条目</small></span>
        <button type="button" class="icon-btn" data-yy-region-close data-yy-region-view-close title="取消本次选区填入" aria-label="取消本次选区填入">×</button>
      </header>
      <div class="region-body" data-yy-region-view-body></div>
      <div class="region-foot">
        <button type="button" class="region-apply" data-yy-region-apply data-yy-region-view-apply disabled>立即填入</button>
        <div class="region-hint" data-yy-region-view-hint>手动选择一条资料后，点击立即填入</div>
      </div>
    </section>`;
  document.body.appendChild(host);

  createCopyDrawer(theme);
  createAiCopilotDrawer(theme);
  initYanyuDockDragging(host, shadow.querySelector('[data-yy-drag]'));

  shadow.querySelector('[data-yy-action="expand"]').addEventListener('click', () => {
    host.setAttribute('collapsed', 'false');
    chrome.storage.local.set({ jobAutofillDockCollapsed: false });
  });
  shadow.querySelector('[data-yy-action="collapse"]').addEventListener('click', () => {
    host.setAttribute('collapsed', 'true');
    chrome.storage.local.set({ jobAutofillDockCollapsed: true });
  });
  shadow.querySelector('[data-yy-action="close"]').addEventListener('click', () => {
    if (activeFillTask?.running) cancelActiveFillTask();
    yanyuSetDockVisible(false, false);
    showNotification('已关闭悬浮窗，可点击浏览器工具栏的易offer图标恢复', 'info');
  });
  shadow.querySelector('[data-yy-action="fill"]').addEventListener('click', () => runYanyuDockFill('full'));
  shadow.querySelector('[data-yy-action="incremental"]').addEventListener('click', () => runYanyuDockFill('incremental'));
  shadow.querySelector('[data-yy-action="region"]').addEventListener('click', () => startRegionFillFlow());
  shadow.querySelector('[data-yy-action="more"]').addEventListener('click', event => {
    const open = shadow.querySelector('[data-yy-more]').classList.toggle('open');
    event.currentTarget.textContent = open ? '收起功能 ▴' : '更多功能 ▾';
  });
  shadow.querySelector('[data-yy-action="profile"]').addEventListener('click', () => {
    yanyuDockState.profileMenuOpen = !yanyuDockState.profileMenuOpen;
    shadow.querySelector('[data-yy-profile-menu]').classList.toggle('open', yanyuDockState.profileMenuOpen);
    if (yanyuDockState.profileMenuOpen) refreshProfilesMenu();
  });
  const taskControls = shadow.querySelector('.task-controls');
  taskControls.addEventListener('mousedown', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  taskControls.addEventListener('mouseup', event => event.stopPropagation());
  taskControls.addEventListener('click', event => event.stopPropagation());
  shadow.querySelector('[data-yy-cancel]').addEventListener('click', () => {
    if (cancelActiveFillTask()) showNotification('正在取消当前填入任务…', 'info');
  });
  shadow.querySelector('[data-yy-pause]').addEventListener('click', () => {
    if (toggleActiveFillPause()) {
      const paused = !!activeFillTask?.paused;
      showNotification(paused ? '已暂停后续填写操作' : '已从原进度继续填写', 'info');
    }
    syncYanyuTaskControls();
  });
  shadow.querySelector('[data-yy-action="copy"]').addEventListener('click', () => {
    const panel = document.getElementById('job-autofill-copy-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
    updateFillTargetBar();
    if (currentActiveProfile) renderCopyChips(currentActiveProfile, 'basic');
  });
  shadow.querySelector('[data-yy-action="copilot"]').addEventListener('click', () => {
    const panel = document.getElementById('job-autofill-ai-panel');
    if (panel) panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
  });
  shadow.querySelector('[data-yy-action="scan"]').addEventListener('click', () => toggleFieldHighlights());
  shadow.querySelector('[data-yy-action="theme"]').addEventListener('click', () => {
    const next = host.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyFloatTheme(next);
    chrome.runtime.sendMessage({ action: 'updateSettings', settings: { uiTheme: next } }, () => { if (chrome.runtime.lastError) {} });
  });
  shadow.querySelector('[data-yy-action="settings"]').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    else chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
  });
  shadow.querySelector('[data-yy-action="feedback"]').addEventListener('click', async () => {
    const diagnostic = `易offer网申填写助手反馈\n版本：${chrome.runtime.getManifest().version}\n页面：${location.hostname}\n时间：${new Date().toISOString()}\n请描述问题（请勿粘贴身份证号、手机号、API Key 等隐私）：\n`;
    try {
      await navigator.clipboard.writeText(diagnostic);
      showNotification('已复制脱敏反馈模板，请粘贴到你的反馈渠道并补充问题描述', 'success');
    } catch {
      showNotification('可记录当前网站和字段名称用于反馈', 'info');
    }
  });
  shadow.querySelector('[data-yy-action="ai"]').addEventListener('click', async event => {
    if (aiFillRunning) { showNotification('AI 助填正在进行中', 'info'); return; }
    const btn = event.currentTarget;
    btn.disabled = true;
    try {
      const response = await runtimeSend({ action: 'getActiveProfile' }, 8000);
      if (!response?.profile) throw new Error('请先配置资料与 AI 服务');
      currentActiveProfile = response.profile;
      await aiStepByStepFill(response.profile);
    } catch (error) {
      showNotification(error?.message || String(error), 'error');
    } finally { btn.disabled = false; }
  });

  chrome.storage.local.get(['jobAutofillDockPos', 'jobAutofillDockCollapsed', 'jobAutofillDockHidden'], res => {
    if (res?.jobAutofillDockHidden && !yanyuDockState.visibilityTouched) host.style.display = 'none';
    if (!yanyuDockState.expandRequested) {
      host.setAttribute('collapsed', res?.jobAutofillDockCollapsed ? 'true' : 'false');
    }
    const pos = res?.jobAutofillDockPos;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      host.style.left = `${Math.max(8, Math.min(window.innerWidth - host.offsetWidth - 8, pos.left))}px`;
      host.style.top = `${Math.max(8, Math.min(window.innerHeight - host.offsetHeight - 8, pos.top))}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }
  });
  syncYanyuTaskControls();
  refreshProfilesMenu();
  chrome.runtime.sendMessage({ action: 'getSettings' }, response => {
    if (chrome.runtime.lastError) return;
    const saved = response?.success ? response.settings?.uiTheme : '';
    applyFloatTheme(saved || theme);
  });
}
