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

function publishSidePanelTarget() {
  if (!contentMainState.sidePanelPorts?.size) return;
  const selected = getFillTarget();
  const context = sidePanelRow(selected);
  const target = selected?.el.isConnected && selected.url === location.href
    ? { id: selected.id, label: selected.label, kind: selected.kindName, section: context?.module.section,
        key: context?.row.fields.find(field => field.input === selected.el)?.key, row: context?.label }
    : null;
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
  contentMainState.rowPreview = null;
  if (!preview || preview.token !== request.token || preview.targetId !== target.id) return { error: '预览已失效，请重新选择目标。' };
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
  publishSidePanel({ kind: 'task', running: Boolean(activeFillTask?.running), paused: Boolean(activeFillTask?.paused) });
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
    contentMainState.sidePanelPorts.add(port);
    yanyuDockState.fallbackOpen = false;
    if (regionFillState?.phase !== 'panel') yanyuSetDockVisible(false, false, false);
    for (const id of ['job-autofill-copy-panel', 'job-autofill-ai-panel']) {
      const drawer = document.getElementById(id);
      if (drawer) drawer.style.display = 'none';
    }
    setFillTargetFromElement(document.activeElement);
    publishSidePanelTarget();
    publishSidePanelTask();
    port.onDisconnect.addListener(() => contentMainState.sidePanelPorts.delete(port));
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string') return;

    // 连通性探测：init 未完成也应答，popup 只需确认脚本已就位
    if (request.action === 'contentPing') {
      sendResponse({
        success: true,
        ready: true,
        version: contentMainVersion,
        initialized: contentMainState.initDone
      });
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
    if (request.action === 'pauseFill') {
      sendResponse({ success: toggleActiveFillPause(), paused: Boolean(activeFillTask?.paused) });
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
      sendResponse({ success: true, cancelled: cancelActiveFillTask() });
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
