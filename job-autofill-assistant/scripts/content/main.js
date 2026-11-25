// ============================================================================
// Capybara 网申助手 content script —— main.js
// 入口：初始化、消息监听（fillForm/cancelFill 等）、全局 API 与测试钩子
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';

// 幂等状态：popup / 后台 action 的 ensureContentReady 会在"明确无接收端"时按 manifest
// 完整列表补注脚本；chrome.scripting.executeScript 的重注入与首次注入共享同一隔离世界，
// 因此标记必须挂在"仅在缺失时创建"的 globalThis 哨兵对象上——
// 直接 var xxx = false 会在二次执行时被重新赋值，导致重复注册。
var contentMainState = globalThis.__CAPYBARA_CONTENT_MAIN_STATE__;
if (!contentMainState) {
  contentMainState = { listenerBound: false, initDone: false };
  globalThis.__CAPYBARA_CONTENT_MAIN_STATE__ = contentMainState;
}
var contentMainVersion = '2.0.0';

function publishSidePanel(message) {
  for (const port of contentMainState.sidePanelPorts || []) {
    try { port.postMessage({ ...message, url: location.href }); } catch { /* Panel already closed. */ }
  }
}

function getFillPageSummary() {
  const fields = new Set();
  const selector = SMART_FILL_FIELD_SELECTOR + ', input[type="radio"], input[type="search"], [contenteditable="true"]';
  for (const node of document.querySelectorAll(selector)) {
    const field = writableBox(node);
    const widget = field.closest('.ant-picker, .el-date-editor, ' + SMART_FILL_WIDGET_CONTAINER_SELECTOR);
    if (field.disabled || field.closest('[aria-disabled="true"], fieldset:disabled') ||
        (field.readOnly && !widget && !isSelectWidget(field)) || isIgnoredInput(field) ||
        (!isElementTrulyVisible(field) && !isElementTrulyVisible(widget || (field.type === 'radio' && field.closest('label'))))) continue;
    fields.add(field);
  }
  // Some resume editors start with empty repeatable sections, or just a resume attachment.
  const hasResumeForm = fields.size > 0 || [...document.querySelectorAll('input[type="file"]')].some(node =>
    !node.disabled && attachmentSlot(node) &&
    (isElementTrulyVisible(node) || isElementTrulyVisible(node.parentElement))) ||
    repeatModules().some(module => repeatAddControl(module, []));
  return { fillableCount: fields.size, hasResumeForm };
}

function publishPageSummary() {
  if (!contentMainState.sidePanelPorts?.size) return;
  const summary = getFillPageSummary();
  if (contentMainState.lastPageSummary?.fillableCount === summary.fillableCount &&
      contentMainState.lastPageSummary?.hasResumeForm === summary.hasResumeForm) return;
  contentMainState.lastPageSummary = summary;
  publishSidePanel({ kind: 'pageSummary', summary });
}

function observeFillPageSummary() {
  if (contentMainState.pageObserver) return;
  let timer;
  const observer = new MutationObserver(mutations => {
    if (timer || mutations.every(mutation => mutation.target.closest?.('[id^="job-autofill-"]'))) return;
    timer = setTimeout(() => {
      timer = null;
      publishPageSummary();
    }, 220);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['disabled', 'readonly', 'hidden', 'aria-disabled', 'class', 'style', 'type'] });
  contentMainState.pageObserver = () => {
    observer.disconnect();
    clearTimeout(timer);
    contentMainState.pageObserver = null;
  };
}

function publishSidePanelTarget() {
  if (!contentMainState.sidePanelPorts?.size) return;
  const selected = getFillTarget();
  const context = sidePanelRow(selected);
  const field = context?.row.fields.find(item => item.input === selected?.el);
  const detection = field?.detection || (selected?.el.isConnected && detectField(selected.el));
  const target = selected?.el.isConnected && selected.url === location.href
    ? { id: selected.id, label: selected.label, kind: selected.kindName, section: context?.module.section,
        key: field?.key, row: context?.label,
        fieldType: detection?.confidence >= FIELD_WRITE_MIN_CONFIDENCE ? detection.fieldType : undefined,
        identity: context ? Object.fromEntries(repeatRowIdentity(context.module, context.row)
          .map(({ key, actual }) => [key, actual])) : undefined }
    : null;
  if (target?.label === '加入党派时间' && selected.el.closest('.form-item--phoenix')) {
    target.partyStatus = beisenPartyStatus(selected.el.closest('.ux-standard-form'));
  }
  publishSidePanel({ kind: 'target', target });
}

function sidePanelRow(target) {
  if (!target?.el?.isConnected || target.url !== location.href || typeof repeatModules !== 'function') return null;
  for (const module of repeatModules()) {
    if (!module.root.contains(target.el)) continue;
    const { rows } = repeatRows(module);
    const row = rows.find(row => row.root.contains(target.el));
    if (row) return { module, row, label: `${module.label || '当前模块'} · 第 ${rows.indexOf(row) + 1} 条` };
  }
  return null;
}

function previewSidePanelRow(request, target) {
  contentMainState.rowPreview = null;
  const context = sidePanelRow(target);
  const entry = request.entry;
  if (!context || context.module.section !== request.section || !entry || typeof entry !== 'object' ||
      !repeatProfileEntries(context.module, { [request.section]: [entry] }).length) return { error: '请在网页选中同类条目中的一个字段。' };
  const identity = context.row.fields.filter(field => context.module.identity.includes(field.key) && fieldHasValue(field.input));
  if (identity.some(field => {
    const existing = repeatControlValue(field.input);
    const expected = repeatFieldValue(entry, field.key);
    return existing && !optionTextEquals(existing, expected);
  })) return { error: '这条网页记录已有不同的身份信息，请先核对或选一条空记录。' };
  const fields = context.row.fields.flatMap(({ input, detection, key }) => {
    const value = repeatFieldValue(entry, key);
    if (!key || detection.confidence < FIELD_WRITE_MIN_CONFIDENCE || !['string', 'number'].includes(typeof value) ||
        !String(value).trim() || !resolveFillTarget(input)) return [];
    return [{ input, key, value, label: fillTargetLabelOf(input), keep: fieldHasValue(input) }];
  });
  if (!fields.some(field => !field.keep)) return { error: '该条目没有可填的空白字段。' };
  const token = globalThis.crypto.randomUUID();
  contentMainState.rowPreview = { token, targetId: target.id, root: context.row.root, module: context.module, fields };
  return { token, row: context.label, fields: fields.map(({ label, value, keep }) => ({ label, value, keep })) };
}

async function applySidePanelRow(request, target) {
  const preview = contentMainState.rowPreview;
  if (!preview || preview.token !== request.token || preview.targetId !== target.id) return { error: '预览已失效，请重新选择目标。' };
  contentMainState.rowPreview = null;
  const { root, module, fields } = preview;
  const task = startActiveFillTask('quick-entry', 'incremental');
  if (!task) return { error: '请等当前填写任务结束。' };
  const signal = task.controller.signal;
  let filled = 0;
  let pending = 0;
  try {
    for (const field of fields) {
      if (field.keep) continue;
      await waitForFillCheckpoint(task);
      if (signal.aborted || request.url !== location.href || !root.isConnected ||
          !root.contains(field.input) || !resolveFillTarget(field.input) || fieldHasValue(field.input) ||
          repeatFieldKey(module.section, detectField(field.input)?.fieldType) !== field.key ||
          fillTargetLabelDrifted(field.label, fillTargetLabelOf(field.input))) { pending++; continue; }
      if (await fillField(field.input, field.value, { signal, task })) filled++;
      else pending++;
    }
    return { filled, pending };
  } finally {
    finishActiveFillTask(task);
  }
}

function publishSidePanelTask() {
  if (!contentMainState.sidePanelPorts?.size) return;
  publishSidePanel({ kind: 'task', ...sidePanelTaskState() });
}

// A React form can roll back a controlled input after the fill task has finished.
// Value-property changes need no DOM mutation. Only a verified original write can
// change status. Never send its committed value or row identity to the side panel.
function reconcileBeisenTextResult(run) {
  if (!run?.completion || run.url !== location.href || !run.beisenRows?.length) return false;
  const cache = {};
  const byItem = new Map();
  const totals = {...run.otherCounts};
  const details = [...run.otherDetails];
  for (const row of run.beisenRows) {
    const item = beisenCurrentItem(row.proof, cache);
    if (!row.edited && row.proof.expected != null) {
      row.reason = beisenResultStatus(row.proof, item);
      row.status = row.reason ? 'needs_review' : row.proof.retained ? 'skipped_has_value' : 'filled';
    }
    const key = item || row.proof.item;
    const previous = byItem.get(key);
    if (!previous || beisenResultRank(row) > beisenResultRank(previous)) byItem.set(key, row);
  }
  for (const {label, status, reason} of byItem.values()) {
    totals[status] = (totals[status] || 0) + 1;
    if (status === 'needs_review' || status === 'failed') details.push({label, status, reason});
  }
  const result = run.completion;
  if (result.filledCount === totals.filled && result.reviewCount === totals.needs_review &&
      result.skippedCount === totals.skipped_has_value && result.failedCount === totals.failed &&
      JSON.stringify(result.results) === JSON.stringify(details)) return false;
  Object.assign(result, {filledCount: totals.filled, reviewCount: totals.needs_review, skippedCount: totals.skipped_has_value,
    failedCount: totals.failed, results: details, revision: (result.revision || 0) + 1});
  return true;
}

function watchBeisenTextResult(run) {
  if (!run?.beisenRows?.some(row => !row.edited && row.proof.expected != null) ||
      run.textTimer || !contentMainState.sidePanelPorts?.size || run.url !== location.href) return;
  run.textTimer = setTimeout(() => {
    run.textTimer = null;
    if (contentMainState.panelRun !== run || activeFillTask?.running || !contentMainState.sidePanelPorts?.size) return;
    if (reconcileBeisenTextResult(run)) publishSidePanelTask();
    watchBeisenTextResult(run);
  }, 1200);
}

function sidePanelTaskState() {
  const task = activeFillTask;
  const run = contentMainState.panelRun;
  if (!task?.running && run?.completion) {
    reconcileBeisenTextResult(run);
    watchBeisenTextResult(run);
  }
  contentMainState.taskRevision = (contentMainState.taskRevision || 0) + 1;
  return {
    sequence: contentMainState.taskRevision,
    running: Boolean(task?.running), paused: Boolean(task?.paused), blocked: Boolean(task?.blockingDialog),
    taskId: task?.id, done: task?.done || 0, total: task?.total || 0, label: task?.currentLabel || '', stage: task?.stage,
    undoId: lastFillUndo?.url === location.href ? lastFillUndo.id : null,
    completion: !task?.running && run?.url === location.href ? run.completion : null,
    requestId: run?.url === location.href ? run.requestId : null
  };
}

function startSidePanelFill(request) {
  if (request.url !== location.href) return { success: false, error: '页面已切换，请重新选择填写页面。' };
  if (activeFillTask?.running) return { success: false, error: '已有填写任务正在进行。' };
  if (!getFillPageSummary().hasResumeForm) return { success: false, error: '未检测到网申表单，请先进入简历填写页。' };
  if (!contentMainState.beisenResultEditListenerBound) {
    contentMainState.beisenResultEditListenerBound = true;
    const stopCheckingEditedField = event => {
      const run = contentMainState.panelRun;
      if (!event.isTrusted || !run?.beisenRows || run.url !== location.href) return;
      let item = event.target.closest?.('.form-item--phoenix');
      if (event.type === 'click' || event.type === 'keydown') {
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        const menu = event.target.closest?.('.phoenix-selectList__listItem,.phoenix-calendar-cell,.phoenix-calendar-month-panel-cell,.selector-footer-button');
        if (menu && run.openedWidget) item = run.openedWidget;
        else if (item && event.target.closest('.phoenix-select')) {
          run.openedWidget = item;
          return;
        } else if (!event.target.closest?.('.phoenix-radio')) {
          run.openedWidget = null;
          return;
        }
      }
      if (!item) return;
      const cache = {};
      for (const row of run.beisenRows) {
        if (row.edited || row.proof.expected == null || row.proof.label !== beisenLabel(item) ||
            beisenCurrentItem(row.proof, cache) !== item) continue;
        if (event.type === 'beforeinput' || event.type === 'click' || event.type === 'keydown') {
          row.reason = beisenResultStatus(row.proof, item);
          row.status = row.reason ? 'needs_review' : row.proof.retained ? 'skipped_has_value' : 'filled';
        }
        row.edited = true;
      }
    };
    for (const type of ['beforeinput', 'input', 'change', 'click', 'keydown']) document.addEventListener(type, stopCheckingEditedField, true);
  }
  const run = { requestId: request.requestId, profileId: request.profile.id, url: location.href,
    mode: request.mode, ai: Boolean(request.ai), completion: null };
  contentMainState.panelRun = run;
  const work = run.ai ? aiStepByStepFill(request.profile)
    : fillForm(request.profile, { mode: run.mode, completeRows: request.completeRows === true });
  const task = activeFillTask;
  work.then(result => {
    // 侧栏只需要计数和核对提示，避免传输 DOM 元素或整份填写记录。
    const { filledCount, count, cancelled, error, manualFields, skippedCount, reviewCount, failedCount, aiConfigured } = result || {};
    run.completion = { filledCount: filledCount ?? count ?? 0, cancelled, error, manualFields,
      skippedCount, reviewCount, failedCount, aiConfigured, results: (result?.results || [])
        .filter(row => row.status === 'needs_review' || row.status === 'failed')
        .map(({ label, status, reason }) => ({ label, status, reason })) };
    run.beisenRows = [];
    run.otherCounts = {filled: run.completion.filledCount, needs_review: reviewCount || 0,
      skipped_has_value: skippedCount || 0, failed: failedCount || 0};
    run.otherDetails = [];
    for (const row of result?.results || []) {
      const {label, status, reason} = row;
      const proof = beisenResultProofs.get(row);
      if (proof) {
        run.beisenRows.push({proof, label, status, reason});
        if (Object.hasOwn(run.otherCounts, status)) run.otherCounts[status]--;
      } else if (status === 'needs_review' || status === 'failed') run.otherDetails.push({label, status, reason});
    }
  }, error => {
    run.completion = error.name === 'AbortError' || task?.controller.signal.aborted
      ? { cancelled: true } : { error: error.message || String(error) };
  }).then(() => {
    Object.assign(run.completion, { requestId: run.requestId, mode: run.mode, ai: run.ai, profileId: run.profileId,
      undoable: task?.undo?.size || 0, completedAt: new Date().toISOString() });
    publishSidePanelTask();
  });
  return { success: true, accepted: true, requestId: run.requestId };
}

// ========================================================================
// 消息监听：main.js 一执行就注册（先于 init 的定时器/DOM 等待），
// 保证 popup 打开瞬间 contentPing 即可命中；扩展重注入时只注册一次。
// ========================================================================

function bindContentMessageListener() {
  if (contentMainState.listenerBound) return;
  contentMainState.listenerBound = true;

  contentMainState.sidePanelPorts = new Set();
  chrome.runtime.onConnect?.addListener(port => {
    if (port.name !== 'yanyu-side-panel') return;
    watchSidebarPageWidth(port);
    contentMainState.sidePanelPorts.add(port);
    yanyuDockState.fallbackOpen = false;
    yanyuSetDockVisible(false, false, false);
    if (regionFillState?.phase === 'panel') showRegionEntryPanel();
    for (const id of ['job-autofill-copy-panel', 'job-autofill-ai-panel']) {
      const drawer = document.getElementById(id);
      if (drawer) drawer.style.display = 'none';
    }
    setFillTargetFromElement(document.activeElement);
    publishSidePanelTarget();
    contentMainState.lastPageSummary = null;
    publishPageSummary();
    observeFillPageSummary();
    publishSidePanelTask();
    port.onDisconnect.addListener(() => {
      contentMainState.sidePanelPorts.delete(port);
      if (!contentMainState.sidePanelPorts.size && regionFillState) exitRegionFillMode();
      if (!contentMainState.sidePanelPorts.size) contentMainState.pageObserver?.();
    });
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') return;

    if (request.action === 'selectRegionEntry' || request.action === 'cancelRegionSelection') {
      const state = regionFillState;
      const valid = state?.phase === 'panel' && state.panelToken && request.token === state.panelToken &&
        request.url === location.href && state.lastHref === location.href;
      if (valid && request.action === 'cancelRegionSelection') exitRegionFillMode();
      const success = valid && (request.action === 'cancelRegionSelection' ||
        applySelectedRegionEntry(state, request.category, request.idx));
      sendResponse({ success: Boolean(success) });
      return false;
    }

    // 连通性探测：init 未完成也应答，popup 只需确认脚本已就位
    if (request.action === 'contentPing') {
      sendResponse({
        success: true,
        ready: true,
        pageSummary: getFillPageSummary(),
        version: contentMainVersion,
        initialized: contentMainState.initDone
      });
      return false;
    }

    if (request.action === 'readJobPosting') {
      sendResponse(readJobPosting());
      return false;
    }

    if (request.action === 'sidePanelFillField') {
      const target = getFillTarget();
      if (request.url !== location.href || target?.url !== location.href || target?.id !== request.targetId || activeFillTask?.running) {
        publishSidePanelTarget();
        sendResponse({ filled: false, reason: activeFillTask?.running ? 'task-running' : 'target-changed' });
        return false;
      }
      fillTargetWithCopyValue(request.value).then(result => {
        publishSidePanelTarget();
        sendResponse(result);
      });
      return true;
    }
    if (request.action === 'sidePanelPreviewEntry' || request.action === 'sidePanelApplyEntry') {
      const target = getFillTarget();
      if (request.url !== location.href || !target?.el?.isConnected || target.url !== request.url ||
          target.id !== request.targetId || activeFillTask?.running) {
        sendResponse({ error: '网页目标已变化或正在填写，请重新选择。' });
        return false;
      }
      if (request.action === 'sidePanelPreviewEntry') {
        sendResponse(previewSidePanelRow(request, target));
        return false;
      }
      applySidePanelRow(request, target).then(sendResponse).catch(() => sendResponse({ error: '填写中断，请核对已写入的字段。' }));
      return true;
    }
    if (request.action === 'startSidePanelFill') {
      sendResponse(startSidePanelFill(request));
      return false;
    }
    if (request.action === 'queryFillTaskState') {
      sendResponse({ ...sidePanelTaskState(), url: location.href });
      return false;
    }
    if (request.action === 'undoFillText') {
      const result = undoFillText(request.taskId);
      if (result.success) {
        contentMainState.panelRun = null;
        publishSidePanelTask();
      }
      sendResponse(result);
      return false;
    }
    if (request.action === 'pauseFill') {
      const matches = !request.taskId || request.taskId === activeFillTask?.id;
      sendResponse({ success: matches && toggleActiveFillPause(), paused: Boolean(activeFillTask?.paused) });
      return false;
    }
    if (request.action === 'toggleFieldHighlights') {
      toggleFieldHighlights();
      sendResponse({ success: true, highlighted: isHighlightingFields });
      return false;
    }
    if (request.action === 'fillForm') {
      if (!request.sidePanel && typeof yanyuSetDockVisible === 'function') yanyuSetDockVisible(true, true);
      fillForm(request.profile, { mode: request.mode === 'incremental' ? 'incremental' : 'full', completeRows: request.completeRows === true }).then(result => {
        // 引擎的软失败（如"已有填充任务正在进行"）带 error 字段：如实返回 success:false
        if (result && result.error) {
          sendResponse({ success: false, error: result.error, cancelled: !!result.cancelled, result });
        } else {
          sendResponse({ success: true, result });
        }
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    if (request.action === 'cancelFill') {
      sendResponse({ success: true, cancelled: (!request.taskId || request.taskId === activeFillTask?.id) && cancelActiveFillTask() });
      return false;
    }
    if (request.action === 'aiStepByStepFill') {
      aiStepByStepFill(request.profile).then(result => {
        if (result && result.error) {
          sendResponse({ success: false, error: result.error, result });
        } else {
          sendResponse({ success: true, result });
        }
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    if (request.action === 'startRegionFill') {
      startRegionFillFlow().then(result => {
        if (!result || result.started !== true) {
          sendResponse({ success: false, error: result?.error || '选区填入未启动', result });
        } else {
          sendResponse({ success: true, result });
        }
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
    if (request.action === 'toggleDock') {
      const dock = document.getElementById('job-autofill-dock');
      const visible = dock ? dock.style.display === 'none' : true;
      yanyuSetDockVisible(visible, true);
      sendResponse({ success: true, visible });
      return false;
    }
    if (request.action === 'showDock') {
      // 已有选区流程时不重启/清空选区：只负责把同一个 dock host 显示出来。
      const regionState = typeof regionFillState !== 'undefined' ? regionFillState : null;
      yanyuDockState.fallbackOpen = true;
      let visible = yanyuSetDockVisible(true, true);
      if (visible && regionState?.phase === 'select') {
        document.getElementById('job-autofill-dock')?.setAttribute('data-region-active', 'true');
      } else if (visible && regionState?.phase === 'panel' && typeof yanyuShowRegionView === 'function') {
        visible = yanyuShowRegionView();
      }
      sendResponse(visible
        ? { success: true, visible: true }
        : { success: false, visible: false, error: '悬浮助手尚未就绪，请刷新网页后重试' });
      return false;
    }
  });
}

// ========================================================================
// 初始化
// ========================================================================

function init() {
  if (contentMainState.initDone) return;
  contentMainState.initDone = true;

  console.log('[易offer] Content Script 已加载');

  let jobMetaRefreshTimer = null;
  const scheduleJobMetaRefresh = (delay = 500) => {
    clearTimeout(jobMetaRefreshTimer);
    jobMetaRefreshTimer = setTimeout(cacheJobMetaFromPage, delay);
  };

  cacheJobMetaFromPage();
  createFloatingButton();

  window.addEventListener('load', () => {
    cacheJobMetaFromPage();
    createFloatingButton();
  });
  window.addEventListener('pageshow', () => {
    scheduleJobMetaRefresh(300);
    createFloatingButton();
  });
  window.addEventListener('hashchange', () => {
    scheduleJobMetaRefresh(800);
    createFloatingButton();
  });
  window.addEventListener('popstate', () => scheduleJobMetaRefresh(800));

  setTimeout(cacheJobMetaFromPage, 1200);
  setTimeout(cacheJobMetaFromPage, 3000);

  // SPA 的岗位详情通常晚于 document_idle 才渲染；DOM 稳定后重新提取岗位信息。
  if (window.MutationObserver) {
    const observer = new MutationObserver((mutations) => {
      if (document.body && !document.getElementById('job-autofill-dock')) {
        createFloatingButton();
      }
      if (mutations.some((mutation) => !mutation.target.closest?.('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel, #job-autofill-region-overlay, #job-autofill-region-panel'))) {
        scheduleJobMetaRefresh();
      }
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.jobAutofillData) {
      const newData = changes.jobAutofillData.newValue;
      const theme = newData?.settings?.uiTheme;
      if (theme) applyFloatTheme(theme);
      if (newData?.profiles && newData?.activeProfileId) {
        allProfilesCache = newData.profiles;
        const newActive = newData.profiles.find((p) => p.id === newData.activeProfileId);
        if (newActive) {
          if (regionFillState?.profile?.id && regionFillState.profile.id !== newActive.id) exitRegionFillMode();
          currentActiveProfile = newActive;
          const profileLabel = document.getElementById('job-autofill-active-profile-name');
          if (profileLabel) profileLabel.textContent = newActive.name || '默认资料';
          refreshProfilesMenu();
          const copyPanel = document.getElementById('job-autofill-copy-panel');
          if (copyPanel && copyPanel.style.display === 'flex') {
            const searchInput = copyPanel.querySelector('#job-autofill-copy-search-input');
            const kw = searchInput ? searchInput.value.trim() : '';
            if (kw) renderSearchResults(currentActiveProfile, kw);
            else {
              const activeTab = copyPanel.querySelector('.job-autofill-tab-btn.active')?.dataset.tab || 'basic';
              renderCopyChips(currentActiveProfile, activeTab);
            }
          }
        }
      }
    }
    if (changes.jobAutofillLogs) {
      renderPageLogs(changes.jobAutofillLogs.newValue || []);
    }
  });
}

// 供 node 端 test/run.mjs 做单测的钩子（页面逻辑不使用）
globalThis.__CAPYBARA_SMART_FILL_TEST_HOOKS__ = {
  smartFillMatchOptionText,
  detectField,
  waitFor,
  fillSelectWidget,
  fillSmartFillCascadeGroup,
  fillForm,
  cancelActiveFillTask,
  buildSmartFillProfileDigest,
  matchFieldType,
  computeAgeFromBirthDate,
  getCopyItemsForCategory,
  normalizeSmartFillAiItem,
  collectSmartFillFields,
  resolveSmartFillField,
  aiSmartFill,
  isWidgetSelectTrigger,
  smartFillFieldPayload,
  validateSmartFillValue,
  fillField,
  setFillTargetFromElement,
  getFillTarget,
  fillTargetWithCopyValue,
  applyCopyItem,
  updateFillTargetBar,
  regionRectsIntersectionArea,
  regionControlOverlapRatio,
  regionDateSideOfLabel,
  regionFieldizeEntry,
  regionMatchRuleField,
  regionSplitDateRangeRefs,
  regionPanelCategories,
  collectRegionFields,
  collectYanyuRegionFields,
  regionFillApply,
  runRegionFill,
  startRegionFillFlow,
  isRegionFillRunning,
  aiStepByStepFill,
  enterRegionSelectMode,
  finishRegionSelect,
  exitRegionFillMode,
  isRegionFillActive
};

// 页面加载完成后初始化；监听器在 main.js 执行时即注册（早于 init 的任何等待）
bindContentMessageListener();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
