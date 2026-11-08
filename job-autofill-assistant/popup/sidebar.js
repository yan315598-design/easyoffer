/* The browser owns the sidebar. Each connection belongs to one top-level document. */
const Sidebar = (() => {
  const el = id => document.getElementById(id);
  let tab = null;
  let port = null;
  let target = null;
  let catalog = {};
  let category = 'basic';
  let lastResult = null;
  let taskRunning = false;
  let revision = 0;
  let refreshTimer;

  function showTarget(next) {
    if (target?.id !== next?.id) el('quickNotice').textContent = '';
    target = next;
    const box = el('quickTarget');
    box.classList.toggle('has-target', Boolean(next));
    const restricted = tab && (!tab.url || ContentReady.isRestrictedUrl(tab.url));
    el('quickResults').setAttribute('data-copy-only', String(Boolean(restricted)));
    box.querySelector('strong').textContent = next ? '填入目标 · ' + next.label : restricted ? '复制后粘贴' : '先选一个网页字段';
    box.querySelector('span').textContent = next ? next.kind + ' · 核对字段名后再填入。' : restricted
      ? '浏览器保护内置页面和其他扩展。点击资料旁的「复制」，再到目标输入框按 Ctrl+V 或 ⌘V。'
      : '点击网页输入框，或用 Tab 移到该字段。你也可以只复制资料。';
    box.title = next?.label || '';
    for (const button of el('quickResults').querySelectorAll('[data-write]')) {
      button.disabled = !next || taskRunning;
    }
  }

  function drawCatalog() {
    const list = el('quickResults');
    const query = el('quickSearch').value.trim().toLowerCase();
    const rows = query ? Object.values(catalog).flat().filter(item =>
      `${item.label} ${item.val}`.toLowerCase().includes(query)) : catalog[category] || [];
    const uniqueRows = [...new Map(rows.map(item => [JSON.stringify([item.label, item.val]), item])).values()];
    const fragment = document.createDocumentFragment();
    for (const item of uniqueRows) {
      const row = document.createElement('article');
      row.className = 'sidebar-value';
      const title = document.createElement('h2');
      title.textContent = item.label;
      const value = document.createElement('p');
      value.textContent = item.val;
      if (item.block) {
        value.className = 'sidebar-long-value';
        const fullText = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '查看全文';
        fullText.append(summary, value);
        row.append(title, fullText);
      } else {
        row.append(title, value);
      }
      const controls = document.createElement('div');
      controls.className = 'sidebar-value-actions';
      for (const action of ['填入', '复制']) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action;
        button.setAttribute('aria-label', action + item.label);
        if (action === '填入') {
          button.dataset.write = '';
          button.disabled = !target || taskRunning;
          button.onclick = () => writeValue(item, button);
        } else {
          button.onclick = async () => {
            try {
              await navigator.clipboard.writeText(item.val);
              el('quickNotice').textContent = '已复制' + item.label;
            } catch {
              el('quickNotice').textContent = '复制失败，可以选中资料文字手动复制。';
            }
          };
        }
        controls.append(button);
      }
      row.append(controls);
      fragment.append(row);
    }
    if (!uniqueRows.length) {
      const empty = document.createElement('p');
      empty.className = 'sidebar-empty';
      empty.textContent = query ? '没有找到相关资料。试试换个关键词。' : '这里还没有可用资料。请检查所选简历及已启用的模块。';
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
  }

  function samePage(a, b) {
    return Boolean(a && b && a.id === b.id && a.url === b.url);
  }

  async function writeValue(item, button) {
    const selected = target;
    const sourceTab = tab;
    button.disabled = true;
    try {
      const active = await getActiveTab();
      if (!samePage(sourceTab, active) || selected !== target || !selected) throw new Error('目标已切换，请重新点击要填写的字段。');
      const result = await sendTabMessage(active.id, {
        action: 'sidePanelFillField', url: active.url, targetId: selected.id, value: item.val
      }, 8000);
      el('quickNotice').textContent = result?.filled ? `已将「${item.label}」填入「${result.label}」。`
        : result?.reason === 'task-running' ? '请等当前填入任务结束，再补填这个字段。'
        : result?.reason === 'needs-full-date' ? '这个字段需要完整日期。请在「我的简历」补上具体日后重试。'
        : '这个字段未能填入。请重新选择字段，或复制后手动填写。';
    } catch (error) {
      el('quickNotice').textContent = friendlyTabError(error);
    } finally {
      button.disabled = !target || taskRunning;
    }
  }

  function clearResult() {
    lastResult = null;
    el('sidebarResult').hidden = true;
    el('sidebarDetails').hidden = true;
    el('sidebarDetails').open = false;
  }

  function showDetails(origin, result) {
    if (!samePage(origin, tab)) return;
    const labels = new Set([
      ...(Array.isArray(result.manualFields) ? result.manualFields : []),
      ...(Array.isArray(result.results) ? result.results.filter(row =>
        ['needs_review', 'failed'].includes(row.status)).map(row => row.label) : [])
    ].filter(Boolean));
    const details = el('sidebarDetails');
    details.hidden = labels.size === 0;
    details.querySelector('ul').replaceChildren(...Array.from(labels, label => {
      const item = document.createElement('li');
      item.textContent = label;
      return item;
    }));
  }

  function rememberResult(origin, usedProfileId) {
    if (!samePage(origin, tab)) return;
    lastResult = { tab: { id: origin.id, url: origin.url }, profileId: usedProfileId };
    el('sidebarResult').hidden = false;
  }

  function setTaskState(message) {
    taskRunning = message.running;
    el('sidebarTaskControls').hidden = !taskRunning;
    el('sidebarPause').textContent = message.paused ? '继续填入' : '暂停';
    for (const button of el('quickResults').querySelectorAll('[data-write]')) button.disabled = !target || taskRunning;
  }

  function resetConnection() {
    const oldPort = port;
    port = null;
    oldPort?.disconnect();
    showTarget(null);
    setTaskState({ running: false });
    el('quickNotice').textContent = '';
  }

  function refresh({ changedPage = false } = {}) {
    const nextRevision = ++revision;
    clearTimeout(refreshTimer);
    if (changedPage) {
      tab = null;
      clearResult();
      resetConnection();
      hideTaskFeedback();
    }
    refreshTimer = setTimeout(() => connect(nextRevision), 80);
  }

  async function connect(version) {
    setPageStatus('checking');
    try {
      const currentTab = await getActiveTab();
      if (version !== revision) return;
      if (!samePage(tab, currentTab)) {
        clearResult();
        tab = currentTab;
        resetConnection();
      }
      if (!currentTab.url) {
        setPageStatus('restricted');
        return;
      }
      const outcome = await ContentReady.ensureContentReady({
        url: currentTab.url,
        sendPing: () => pingContentScript(currentTab.id),
        inject: () => injectContentScriptsIntoTab(currentTab.id),
        onEvent: event => { if (version === revision) handleReadyEvent(event); }
      });
      if (version !== revision) return;
      updatePageStatusFromOutcome(outcome);
      if (!outcome.ok) {
        resetConnection();
        return;
      }
      if (port) return;
      const connection = chrome.tabs.connect(tab.id, { name: 'yanyu-side-panel', frameId: 0 });
      port = connection;
      connection.onMessage.addListener(message => {
        if (port !== connection || message.url !== tab?.url) return;
        if (message.kind === 'target') showTarget(message.target);
        if (message.kind === 'task') setTaskState(message);
        if (message.kind === 'regionResult' && message.count > 0) {
          showTaskFeedback('success', `选区填入完成，已写入 ${message.count} 个字段。`);
          rememberResult(tab, message.profileId);
        }
      });
      connection.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (port !== connection) return;
        resetConnection();
        setPageStatus('needs-action', error ? '无法连接到网页' : '网页连接已断开');
      });
    } catch (error) {
      if (version !== revision) return;
      if (!error.reason) setPageStatus('needs-action', error.message);
    }
  }

  async function controlTask(action) {
    const origin = tab;
    try {
      if (!samePage(origin, await getActiveTab())) return;
      await sendTabMessage(origin.id, { action }, 3000);
    } catch (error) {
      showTaskFeedback('warning', friendlyTabError(error));
    }
  }

  function bind() {
    el('quickSearch').addEventListener('input', drawCatalog);
    el('quickCategories').addEventListener('click', event => {
      const button = event.target.closest('[data-quick]');
      if (!button) return;
      category = button.dataset.quick;
      el('quickSearch').value = '';
      for (const group of el('quickCategories').children) group.setAttribute('aria-pressed', String(group === button));
      drawCatalog();
    });
    el('sidebarPause').onclick = () => controlTask('pauseFill');
    el('sidebarCancel').onclick = () => controlTask('cancelFill');
    el('captureResultBtn').onclick = event => captureCurrentJob(event, lastResult);
    el('highlightBtn').onclick = async () => {
      try {
        const active = await getActiveTab();
        const outcome = await sendTabTaskWithReady(active, { action: 'toggleFieldHighlights' }, 5000);
        if (samePage(tab, active)) showToast(outcome.response?.highlighted ? '已开启字段高亮' : '已关闭字段高亮');
      } catch (error) {
        showTaskFeedback('warning', friendlyTabError(error));
      }
    };
    chrome.tabs.onActivated.addListener(info => {
      if (tab && info.windowId !== tab.windowId) return;
      refresh({ changedPage: true });
    });
    chrome.tabs.onUpdated.addListener((id, change, updated) => {
      if (!updated.active || (tab && id !== tab.id)) return;
      if (change.status === 'loading' || change.url) refresh({ changedPage: true });
      if (change.status === 'complete') refresh();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      const change = changes.jobAutofillData;
      if (area !== 'local' || !change?.newValue) return;
      const current = change.newValue;
      const previous = change.oldValue;
      const theme = current.settings?.uiTheme;
      if (theme && theme !== previous?.settings?.uiTheme) applyTheme(theme);
      const active = data => data?.profiles?.find(p => p.id === data.activeProfileId);
      if (JSON.stringify(active(current)) === JSON.stringify(active(previous))) return;
      void loadProfiles().then(updateStatus);
    });
    drawCatalog();
  }

  return { bind, refresh, clearResult, showDetails, rememberResult, profileChanged() {
    const profile = profileForFilling(currentProfile);
    catalog = Object.fromEntries(['basic', 'edu', 'exp', 'qa'].map(key =>
      [key, getCopyItemsForCategory(profile, key)]));
    drawCatalog();
    if (!tab) refresh();
  }, isCurrentPage: origin => samePage(origin, tab) };
})();
