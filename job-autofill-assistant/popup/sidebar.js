/* The browser owns the sidebar. Each connection belongs to one top-level document. */
const Sidebar = (() => {
  const el = id => document.getElementById(id);
  let tab = null;
  let port = null;
  let target = null;
  let catalog = {};
  let fullCatalog = {};
  let catalogRevision = 0;
  let browseModule = '';
  let openRecord = '';
  let catalogProfileId = '';
  let previewSession = null;
  let lastResult = null;
  let taskRunning = false;
  let revision = 0;
  let refreshTimer;

  function showTarget(next) {
    if (target && next && JSON.stringify(target) === JSON.stringify(next)) return;
    if (target?.id !== next?.id) {
      clearNotices();
    }
    target = next;
    const box = el('quickTarget');
    const restricted = tab && (!tab.url || ContentReady.isRestrictedUrl(tab.url));
    box.classList.toggle('has-target', Boolean(next));
    for (const list of document.querySelectorAll('.sidebar-quick-results')) list.dataset.copyOnly = String(Boolean(restricted));
    box.querySelector('strong').textContent = next ? '填入目标 · ' + next.label : restricted ? '复制后粘贴' : '先选一个网页字段';
    box.querySelector('span').textContent = next ? [next.row, next.kind].filter(Boolean).join(' · ') : restricted
      ? '此页面可从资料速查复制后粘贴。' : '点网页输入框查看候选，或按模块找资料。';
    drawCatalog();
  }

  function sidebarView(view) {
    document.querySelector('.container').dataset.view = view;
    for (const button of document.querySelectorAll('[data-sidebar-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset.sidebarView === view));
    }
    window.scrollTo(0, 0);
  }

  function makeElement(tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function makeButton(text, action) {
    const node = makeElement('button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function directoryName(group) {
    if (group.section === 'workExperience') return isInternshipRecord(group.entry) ? '实习经历' : '工作经历';
    return group.heading || group.title;
  }

  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim();
  const fieldName = value => normalize(value).replace(/[\s:：*（）()·_-]/g, '');
  const aliases = [
    ['项目职责', '项目中职责', '我的职责', '本人职责', '个人职责', '职责分工'],
    ['学校', '学校名称', '毕业院校', '毕业学校', '院校名称'],
    ['生日', '出生日期', '出生年月日', '出生年月', 'birthday', 'dateofbirth', 'dob'],
    ['电子邮箱', '邮箱', 'email', 'emailaddress'],
    ['手机号', '手机号码', '联系电话', '移动电话', 'mobile', 'phone'],
    ['姓名', '真实姓名', '本人姓名', 'fullname'],
    ['项目成果', '项目成效', '项目业绩'], ['项目描述', '项目介绍', '项目简介', '项目背景'],
    ['项目角色', '担任角色'], ['专业名称', '所学专业', '专业']
  ];

  function clearNotices() {
    el('quickNotice').textContent = '';
    el('quickBrowseNotice').textContent = '';
  }

  function actionNotice(button) {
    return el(button.closest('#quickResults') ? 'quickBrowseNotice' : 'quickNotice');
  }

  function recommended(groups) {
    if (!target) return [];
    const labels = [target.label, FIELD_LABELS[target.fieldType]].filter(Boolean).map(fieldName);
    const equivalents = new Set(labels);
    for (const names of aliases) {
      if (names.some(name => equivalents.has(name))) names.forEach(name => equivalents.add(name));
    }
    const candidates = [];
    for (const group of groups) {
      if (group.copyOnly || (target.section && group.section !== target.section)) continue;
      // With no record context, prefer personal fields over same-named family fields.
      if (!target.section && group.section === 'familyMembers' && !/家庭|家属|亲属/.test(target.label)) continue;
      const items = group.items.filter(item => !item.copyOnly && (
        (target.key && target.section) ? item.key === target.key : equivalents.has(fieldName(item.label))
      ));
      if (items.length) candidates.push({ ...group, items });
    }
    const identity = Object.entries(target.identity || {}).filter(([, value]) => normalize(value));
    if (target.section && identity.length) {
      const matches = candidates.filter(group => identity.every(([key, value]) =>
        normalize(group.entry?.[key]) === normalize(value)));
      if (matches.length === 1) return [matches[0], ...candidates.filter(group => group !== matches[0])];
    }
    return candidates;
  }

  function valueRow(group, item) {
    const row = makeElement('article', '', 'sidebar-value');
    row.append(makeElement('h3', item.label));
    const value = makeElement('p', item.val);
    if (item.block || item.val.length > 100 || item.val.includes('\n')) {
      const preview = makeElement('p', item.val, 'sidebar-snippet');
      const details = document.createElement('details');
      details.className = 'sidebar-full-text';
      details.append(makeElement('summary', '查看全文'), value);
      row.append(preview, details);
    } else {
      row.append(value);
    }
    const controls = makeElement('div', '', 'sidebar-value-actions');
    if (!group.copyOnly && !item.copyOnly) {
      const write = makeButton('填入', () => writeValue(item, write));
      write.dataset.write = '';
      write.disabled = !target || taskRunning;
      write.setAttribute('aria-label', '填入' + item.label);
      controls.append(write);
    }
    const copy = makeButton('复制', async () => {
      const notice = actionNotice(copy);
      clearNotices();
      try {
        await navigator.clipboard.writeText(item.val);
        notice.textContent = '已复制' + item.label;
      } catch {
        notice.textContent = '复制失败，可以选中资料文字手动复制。';
      }
    });
    copy.setAttribute('aria-label', '复制' + item.label);
    controls.append(copy);
    row.append(controls);
    return row;
  }

  function recordContents(group) {
    const body = document.createDocumentFragment();
    for (const item of group.items) body.append(valueRow(group, item));
    if (group.entry && group.section === target?.section && !group.copyOnly) {
      const preview = makeButton('预览整条', () => previewEntry(group, actionNotice(preview)));
      preview.dataset.write = '';
      preview.className = 'sidebar-preview-entry';
      preview.disabled = taskRunning;
      body.append(preview);
    }
    return body;
  }

  function renderRecord(group, collapse) {
    if (collapse && group.entry) {
      const record = makeElement('details', '', 'sidebar-record');
      record.open = group.recordKey === openRecord;
      const summary = makeElement('summary', group.title);
      record.append(summary);
      if (record.open) record.append(recordContents(group));
      summary.addEventListener('click', event => {
        event.preventDefault();
        openRecord = record.open ? '' : group.recordKey;
        drawDirectory();
        const summaryAfter = [...el('quickResults').querySelectorAll('details[data-record-key]')]
          .find(node => node.dataset.recordKey === group.recordKey)?.querySelector('summary');
        summaryAfter?.focus({ preventScroll: true });
        summaryAfter?.scrollIntoView({ block: 'nearest' });
      });
      record.dataset.recordKey = group.recordKey;
      return record;
    }
    const record = makeElement('section', '', 'sidebar-record');
    const header = document.createElement('header');
    const title = group.entry ? directoryName(group) + ' · ' + group.title : group.title;
    const heading = document.createElement('h2');
    if (group.entry) {
      const select = makeButton(title, () => {
        browseModule = directoryName(group);
        openRecord = group.recordKey;
        el('quickSearch').value = '';
        drawDirectory();
        const summary = el('quickResults').querySelector('.sidebar-record[open] > summary');
        summary?.focus({ preventScroll: true });
        summary?.scrollIntoView({ block: 'nearest' });
      });
      select.className = 'sidebar-open-record';
      select.title = '展开并连续使用这条资料';
      heading.append(select);
    } else {
      heading.textContent = title;
    }
    header.append(heading);
    record.append(header, recordContents(group));
    return record;
  }

  function drawCandidates() {
    const list = el('quickCandidates');
    const candidates = recommended(Object.values(catalog).flat());
    list.replaceChildren(...candidates.map(group => renderRecord(group, false)));
    if (target && !candidates.length) {
      list.append(makeElement('p', '当前简历没有匹配的资料，可在下方搜索或浏览。', 'sidebar-empty'));
    }
    list.scrollTop = 0;
  }

  function drawCatalog() {
    drawCandidates();
    drawDirectory();
  }

  function drawDirectory() {
    const list = el('quickResults');
    const query = normalize(el('quickSearch').value);
    const tokens = query.split(/\s+/).filter(Boolean);
    const searchTerms = tokens.map(token => aliases.find(names => names.includes(fieldName(token))) || [token]);
    const groups = Object.values(el('quickAll').checked ? fullCatalog : catalog).flat();
    const fragment = document.createDocumentFragment();
    const matches = tokens.length ? groups.map(group => {
      const context = normalize(directoryName(group) + ' ' + group.title);
      // A record-name-only search yields a compact result. Its heading opens all fields.
      if (group.entry && tokens.every(token => context.includes(token))) {
        const label = group.items.find(item => item.val === group.title) || group.items[0];
        return { ...group, items: [label] };
      }
      const items = group.items.filter(item => {
        const text = context + ' ' + normalize(item.label) + ' ' + normalize(item.val);
        return searchTerms.every(terms => terms.some(term => text.includes(term)));
      });
      return { ...group, items };
    }).filter(group => group.items.length) : [];
    el('quickBrowse').hidden = !query && !browseModule;
    if (query) {
      for (const group of matches) fragment.append(renderRecord(group, false));
      if (!matches.length) fragment.append(makeElement('p', '没有找到相关资料。试试项目简称或字段名。', 'sidebar-empty'));
    } else if (browseModule) {
      fragment.append(makeElement('h2', browseModule, 'sidebar-module-title'));
      const visible = groups.filter(group => directoryName(group) === browseModule);
      for (const group of visible) fragment.append(renderRecord(group, true));
      if (!visible.length) fragment.append(makeElement('p', '这个模块没有可用资料。', 'sidebar-empty'));
    } else {
      const modules = new Map();
      for (const group of groups) {
        const name = directoryName(group);
        modules.set(name, (modules.get(name) || 0) + (group.entry ? 1 : group.items.length));
      }
      const directory = makeElement('div', '', 'sidebar-directory');
      for (const [name, count] of modules) {
        const button = makeButton(name, () => {
          browseModule = name;
          drawDirectory();
          el('quickBrowse').focus({ preventScroll: true });
        });
        button.dataset.quickModule = name;
        button.append(makeElement('span', String(count)));
        directory.append(button);
      }
      fragment.append(modules.size ? directory : makeElement('p', '当前简历还没有可用资料。', 'sidebar-empty'));
    }
    list.replaceChildren(fragment);
  }

  function samePage(a, b) {
    return Boolean(a && b && a.id === b.id && a.url === b.url);
  }

  async function previewEntry(group, notice) {
    if (previewSession) return;
    clearNotices();
    const session = {};
    previewSession = session;
    const selected = target;
    const origin = tab;
    const sourceRevision = catalogRevision;
    try {
      if (!selected || !samePage(origin, await getActiveTab()) || selected !== target) return;
      const message = { url: origin.url, targetId: selected.id };
      const preview = await sendTabMessage(origin.id, { ...message, action: 'sidePanelPreviewEntry', section: group.section, entry: group.entry }, 5000);
      if (preview?.error) throw new Error(preview.error);
      if (!preview?.token || selected !== target || !samePage(origin, tab)) return;
      const dialog = el('quickEntryPreview');
      dialog.returnValue = '';
      dialog.querySelector('p').textContent = `${group.title} → ${preview.row}。保留网页已有内容。`;
      dialog.querySelector('ul').replaceChildren(...preview.fields.map(field => {
        const item = document.createElement('li');
        item.textContent = `${field.label} · ${field.keep ? '保留网页已有值' : field.value}`;
        return item;
      }));
      const accepted = await new Promise(resolve => {
        // A native close event can arrive after the next dialog has opened. Read
        // the clicked submitter (or Escape) at the moment this session is closed.
        const events = new AbortController();
        const finish = (event, write) => {
          event.preventDefault();
          events.abort();
          dialog.close();
          if (!write) previewSession = null;
          resolve(write);
        };
        dialog.addEventListener('submit', event => finish(event, event.submitter?.value === 'write'), { signal: events.signal });
        dialog.addEventListener('cancel', event => finish(event, false), { signal: events.signal });
        dialog.showModal();
      });
      if (!accepted) return;
      if (!samePage(origin, await getActiveTab()) || selected !== target || sourceRevision !== catalogRevision) {
        throw new Error('网页目标或简历资料已变化，请重新预览。');
      }
      const outcome = await sendTabMessage(origin.id, { ...message, action: 'sidePanelApplyEntry', token: preview.token }, 30000);
      if (outcome?.error) throw new Error(outcome.error);
      notice.textContent = `已填入 ${outcome.filled} 项，${outcome.pending} 项待核对。`;
    } catch (error) {
      notice.textContent = friendlyTabError(error);
    } finally {
      if (previewSession === session) previewSession = null;
    }
  }

  async function writeValue(item, button) {
    const selected = target;
    const sourceTab = tab;
    const notice = actionNotice(button);
    clearNotices();
    button.disabled = true;
    try {
      const active = await getActiveTab();
      if (!samePage(sourceTab, active) || selected !== target || !selected) throw new Error('目标已切换，请重新点击要填写的字段。');
      const result = await sendTabMessage(active.id, {
        action: 'sidePanelFillField', url: active.url, targetId: selected.id, value: item.val
      }, 8000);
      if (!samePage(sourceTab, tab) || selected.id !== target?.id) return;
      notice.textContent = result?.filled ? `已将「${item.label}」填入「${result.label}」。`
        : result?.reason === 'task-running' ? '请等当前填入任务结束，再补填这个字段。'
        : result?.reason === 'needs-full-date' ? '这个字段需要完整日期。请在「我的简历」补上具体日后重试。'
        : result?.reason === 'value_reset' ? '网页清空或更改了刚选的值，请手动核对。'
        : result?.reason === 'validation_failed' ? '网页未接受这个值，请检查格式或字数限制。'
        : '这个字段未能填入。请重新选择字段，或复制后手动填写。';
    } catch (error) {
      notice.textContent = friendlyTabError(error);
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
    const reasons = { value_reset: '网页清空或改写了选中值', validation_failed: '网页校验未通过',
      date_precision_required: '需要完整日期', record_ambiguous: '无法确认对应条目', unrecognized_field: '字段未识别',
      range_not_committed: '日期范围未确认', no_profile_value: '简历没有对应资料', low_confidence: '匹配置信度不足',
      write_failed_or_option_not_found: '控件未接受或未找到匹配选项' };
    const labels = new Set([
      ...(Array.isArray(result.manualFields) ? result.manualFields : []),
      ...(Array.isArray(result.results) ? result.results.filter(row =>
        ['needs_review', 'failed'].includes(row.status) && row.label)
        .map(row => reasons[row.reason] ? `${row.label} · ${reasons[row.reason]}` : row.label) : [])
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
    for (const button of document.querySelectorAll('.sidebar-quick-results [data-write]')) button.disabled = !target || taskRunning;
  }

  function resetConnection() {
    const oldPort = port;
    port = null;
    oldPort?.disconnect();
    showTarget(null);
    setTaskState({ running: false });
    clearNotices();
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
    for (const button of document.querySelectorAll('[data-sidebar-view]')) {
      button.onclick = () => sidebarView(button.dataset.sidebarView);
    }
    el('quickSearch').addEventListener('input', drawDirectory);
    el('quickAll').addEventListener('change', drawDirectory);
    el('quickBrowse').onclick = () => {
      browseModule = '';
      openRecord = '';
      el('quickSearch').value = '';
      drawDirectory();
      el('quickResults').querySelector('button')?.focus({ preventScroll: true });
    };
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
    catalogRevision++;
    if (catalogProfileId !== currentProfile?.id) {
      catalogProfileId = currentProfile?.id;
      browseModule = '';
      openRecord = '';
      el('quickSearch').value = '';
      clearNotices();
    }
    const profile = profileForFilling(currentProfile);
    catalog = quickReferenceCatalog(profile);
    fullCatalog = quickReferenceCatalog(currentProfile);
    for (const [category, groups] of Object.entries(fullCatalog)) {
      for (const group of groups) {
        const available = catalog[category]?.find(candidate => candidate.section === group.section &&
          candidate.title === group.title && (!group.section || JSON.stringify(candidate.entry) === JSON.stringify(group.entry)));
        group.copyOnly = !available;
        if (available && !group.section) {
          for (const item of group.items) item.copyOnly = !available.items.some(candidate => candidate.label === item.label && candidate.val === item.val);
        }
      }
    }
    drawCatalog();
    if (!tab) refresh();
  }, isCurrentPage: origin => samePage(origin, tab) };
})();
