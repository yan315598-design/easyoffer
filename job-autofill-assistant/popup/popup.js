// ============================================================================
// yanyu 网申侧栏交互
// - 填入 / AI 助填 / 选区先经 ContentReady 连通性编排
//   （受限页检查 → 短超时 contentPing → 必要时按 manifest 完整列表补注 → 有界重试），
//   业务任务仅在就绪后发送且只发送一次
// - 任务反馈区展示真实的 success / error 信息，不再吞掉错误
// ============================================================================

let currentProfile = null;
let allProfiles = [];
let activeProfileId = null;

// 一键/增量填入的页面响应超时；AI 助填逐题解析较慢，给足 5 分钟
const FILL_TIMEOUT_MS = 30 * 1000;
const AI_FILL_TIMEOUT_MS = 5 * 60 * 1000;
const REGION_START_TIMEOUT_MS = 10 * 1000;

// 任务反馈自动消失时长（错误信息保持展示，便于阅读真实原因）
const FEEDBACK_AUTO_HIDE_MS = {
  success: 6000,
  warning: 8000
};

let feedbackHideTimer = null;

// ============================================================================
// 初始化
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof appLog !== 'undefined') {
    appLog.info('popup', 'page.init', '侧栏已打开');
    appLog.watchClicks(document);
  }
  await initTheme();
  await loadProfiles();
  bindEvents();
  Sidebar.bind();
  updateStatus();
});

function preferredTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', mode);
  // 存储键与 scripts/theme-init.js 保持一致，勿改名
  try { localStorage.setItem('capybara-ui-theme', mode); } catch (e) {}
}

async function initTheme() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }
      const saved = response && response.success ? response.settings?.uiTheme : '';
      const legacy = document.documentElement.getAttribute('data-theme');
      applyTheme(saved || legacy || preferredTheme());
      if (!saved && legacy && response?.success) {
        chrome.runtime.sendMessage({ action: 'updateSettings', settings: { uiTheme: legacy } }, () => {
          if (chrome.runtime.lastError) return;
        });
      }
      resolve();
    });
  });
}

async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  chrome.runtime.sendMessage({ action: 'updateSettings', settings: { uiTheme: next } }, () => {
    if (chrome.runtime.lastError) {}
  });
}

// ============================================================================
// 消息工具：带超时的 tab 消息
// ============================================================================

/**
 * 向指定标签页发送消息，超时或通道错误时 reject。
 * @param {number} tabId 目标标签页
 * @param {object} message 消息体
 * @param {number} timeoutMs 超时毫秒数
 * @returns {Promise<object>} content script 的响应
 */
function sendTabMessage(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`等待页面响应超时（${Math.round(timeoutMs / 1000)} 秒），请刷新网页后重试`));
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '消息通道错误'));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

/** 把底层错误翻译成用户能行动的提示，但保留原始信息 */
function friendlyTabError(err) {
  // 来自 ContentReady 编排的结构化错误：message 已是面向用户的行动指引
  if (err && err.reason) {
    return err.message;
  }
  const msg = err && err.message ? err.message : String(err);
  if (ContentReady.isMissingReceiverError(err)) {
    return '页面尚未加载助手脚本，请刷新网页（F5）后重试';
  }
  return msg;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    throw new Error('未找到当前活动标签页');
  }
  return tab;
}

/**
 * 向页面发送 contentPing，短超时；供 ContentReady.ensureContentReady 判定连通性。
 * 超时/通道错误均 reject，由编排层分类（是否允许补注）。
 */
function pingContentScript(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('contentPing 等待页面应答超时'));
    }, ContentReady.PING_TIMEOUT_MS);

    try {
      chrome.tabs.sendMessage(tabId, { action: 'contentPing' }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '消息通道错误'));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

/**
 * 按 manifest content_scripts 的完整有序列表补注脚本：CSS 先注入，JS 按声明顺序逐个注入。
 * @returns {Promise<void>} 任一文件注入失败即 reject
 */
async function injectContentScriptsIntoTab(tabId) {
  const plan = ContentReady.buildScriptPlan(chrome.runtime.getManifest());
  for (const cssFile of plan.cssFiles) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] });
  }
  for (const jsFile of plan.jsFiles) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] });
  }
}

/**
 * 共享发送流程：受限页检查 → ping → 必要时补注 → 有界重试 → 发送业务任务（仅一次）。
 * 失败时抛出带 reason 的 Error（message 为面向用户的行动指引），成功时返回 outcome.response。
 */
async function sendTabTaskWithReady(tab, message, timeoutMs) {
  const outcome = await ContentReady.runTabTask({
    url: tab.url,
    sendPing: () => pingContentScript(tab.id),
    inject: () => injectContentScriptsIntoTab(tab.id),
    sendTask: () => sendTabMessage(tab.id, message, timeoutMs),
    onEvent: handleReadyEvent
  });
  if (!outcome.ok) {
    updatePageStatusFromOutcome(outcome);
    const err = new Error(outcome.message);
    err.reason = outcome.reason;
    throw err;
  }
  setPageStatus('ready');
  return outcome;
}

// ============================================================================
// 任务反馈区
// ============================================================================

/**
 * 展示任务反馈。type: loading | success | warning | error
 * @param {string} type 反馈类型
 * @param {string} message 展示的真实信息
 */
function showTaskFeedback(type, message) {
  const box = document.getElementById('taskFeedback');
  const text = document.getElementById('taskFeedbackText');
  if (!box || !text) return;

  if (feedbackHideTimer) {
    clearTimeout(feedbackHideTimer);
    feedbackHideTimer = null;
  }

  box.className = 'task-feedback';
  if (type !== 'loading') {
    box.classList.add(`is-${type}`);
  } else {
    box.classList.add('is-loading');
  }
  text.textContent = message;
  box.hidden = false;

  const autoHide = FEEDBACK_AUTO_HIDE_MS[type];
  if (autoHide) {
    feedbackHideTimer = setTimeout(() => {
      box.hidden = true;
      feedbackHideTimer = null;
    }, autoHide);
  }
}

function hideTaskFeedback() {
  const box = document.getElementById('taskFeedback');
  if (box) box.hidden = true;
  if (feedbackHideTimer) {
    clearTimeout(feedbackHideTimer);
    feedbackHideTimer = null;
  }
}

// ============================================================================
// 页面连接状态：初始检测 / 恢复中 / 已就绪 / 受限 / 需用户操作
// ============================================================================

// 状态行只放克制的一句话；完整原因与行动指引由任务反馈区展示
const PAGE_STATUS_TEXT = {
  checking: '正在检测页面…',
  recovering: '正在恢复助手连接…',
  ready: '页面已就绪',
  restricted: '受保护页面 · 可复制资料',
  'needs-action': '页面未就绪'
};

// 需用户操作时按失败原因给出更具体的短语
const PAGE_STATUS_FAIL_TEXT = {
  unreachable: '页面响应超时',
  'inject-failed': '无法注入助手脚本',
  'inject-not-ready': '补注后页面仍未响应',
  restricted: '受保护页面 · 可复制资料'
};


/**
 * 更新页面连接状态行。state: checking | recovering | ready | restricted | needs-action
 * @param {string} state 状态
 * @param {string} [text] 自定义展示文案，缺省用 PAGE_STATUS_TEXT
 */
function setPageStatus(state, text) {
  const row = document.getElementById('pageStatus');
  const textEl = document.getElementById('pageStatusText');
  const reconnectBtn = document.getElementById('reconnectBtn');
  if (!row || !textEl) return;

  row.className = 'page-status is-' + state;
  const restricted = state === 'restricted';
  document.getElementById('sidebarPageActions').disabled = restricted;
  document.getElementById('highlightBtn').disabled = restricted;
  textEl.textContent = text || PAGE_STATUS_TEXT[state] || state;
  if (reconnectBtn) {
    reconnectBtn.hidden = state !== 'needs-action';
  }
}

/** ContentReady 编排过程中的过程事件 → 状态行 */
function handleReadyEvent(evt) {
  if (evt === 'checking') setPageStatus('checking');
  else if (evt === 'recovering') setPageStatus('recovering');
}

/** ensure/runTabTask 结果 → 状态行 */
function updatePageStatusFromOutcome(outcome) {
  if (!outcome) return;
  if (outcome.ok) {
    setPageStatus('ready', outcome.recovered ? '页面已就绪（已自动恢复连接）' : PAGE_STATUS_TEXT.ready);
    return;
  }
  if (outcome.reason === 'restricted') {
    setPageStatus('restricted');
    return;
  }
  setPageStatus('needs-action', PAGE_STATUS_FAIL_TEXT[outcome.reason] || PAGE_STATUS_TEXT['needs-action']);
}

// ============================================================================
// 数据加载
// ============================================================================

async function loadProfiles() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getAllProfiles' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }
      if (response && response.success) {
        allProfiles = response.profiles || [];
        activeProfileId = response.activeProfileId;

        // 填充隐式下拉框（保留兼容）
        const select = document.getElementById('profileSelect');
        if (select) {
          select.innerHTML = '';
          if (allProfiles.length === 0) {
            select.innerHTML = '<option value="">暂无简历资料</option>';
          } else {
            allProfiles.forEach(profile => {
              const option = document.createElement('option');
              option.value = profile.id;
              option.textContent = profile.name;
              if (profile.id === activeProfileId) {
                option.selected = true;
              }
              select.appendChild(option);
            });
          }
        }

        currentProfile = allProfiles.find(p => p.id === activeProfileId) || allProfiles[0] || null;
        renderCustomDropdown();
      }
      resolve();
    });
  });
}

function renderCustomDropdown() {
  const nameLabel = document.getElementById('selectedProfileName');
  const menu = document.getElementById('profileDropdownMenu');
  if (!nameLabel || !menu) return;

  if (!currentProfile) {
    nameLabel.textContent = '暂无简历资料';
    menu.innerHTML = '<div class="dropdown-item" style="color:var(--yy-text-3);cursor:default;">暂无简历资料</div>';
    return;
  }

  nameLabel.textContent = currentProfile.name || '默认资料';
  menu.innerHTML = '';

  allProfiles.forEach(profile => {
    const isAct = profile.id === currentProfile.id;
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('aria-pressed', String(isAct));
    item.className = 'dropdown-item' + (isAct ? ' active' : '');
    item.innerHTML = `
      <span>${escapeHtml(profile.name || '默认资料')}</span>
      ${isAct ? '<span class="check-icon">✓</span>' : ''}
    `;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeCustomDropdown();
      document.getElementById('profileDropdownBtn').focus();
      if (profile.id !== currentProfile.id) {
        await switchProfile(profile.id);
        updateStatus();
      }
    });
    menu.appendChild(item);
  });
}

function toggleCustomDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('profileDropdown');
  if (dropdown) {
    const open = dropdown.classList.toggle('is-open');
    document.getElementById('profileDropdownBtn').setAttribute('aria-expanded', String(open));
  }
}

function closeCustomDropdown() {
  const dropdown = document.getElementById('profileDropdown');
  if (dropdown) {
    dropdown.classList.remove('is-open');
    document.getElementById('profileDropdownBtn').setAttribute('aria-expanded', 'false');
  }
}

// ============================================================================
// 事件绑定
// ============================================================================

function bindEvents() {
  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', toggleTheme);
  }
  document.getElementById('captureJobBtn')?.addEventListener('click', event => captureCurrentJob(event));

  // 手动重新连接：重新执行 初始检测 → 必要时补注 的完整流程
  const reconnectBtn = document.getElementById('reconnectBtn');
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', () => {
      Sidebar.refresh();
    });
  }

  // 自定义下拉触发
  const dropdownBtn = document.getElementById('profileDropdownBtn');
  if (dropdownBtn) {
    dropdownBtn.addEventListener('click', toggleCustomDropdown);
    document.getElementById('profileDropdown').addEventListener('keydown', event => {
      if (event.key !== 'Escape' || dropdownBtn.getAttribute('aria-expanded') !== 'true') return;
      closeCustomDropdown();
      dropdownBtn.focus();
    });
  }

  // 点击外部关闭下拉菜单
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      closeCustomDropdown();
    }
  });

  // 资料切换（隐式 select 联动）
  const profileSelect = document.getElementById('profileSelect');
  if (profileSelect) {
    profileSelect.addEventListener('change', async (e) => {
      const profileId = e.target.value;
      if (!profileId) return;
      await switchProfile(profileId);
      updateStatus();
    });
  }

  // 重命名资料
  const renameProfileBtn = document.getElementById('renameProfileBtn');
  if (renameProfileBtn) {
    renameProfileBtn.addEventListener('click', async () => {
      if (!currentProfile) {
        showToast('当前没有选中的资料', 'warning');
        return;
      }
      const oldName = currentProfile.name || '默认资料';
      const newName = await showModalPrompt({
        title: '重命名简历资料',
        subtitle: '修改此份简历的名称，便于在投递不同岗位时快速识别',
        defaultValue: oldName,
        placeholder: '例如：前端开发版 / 字节专版',
        confirmText: '保存名称'
      });
      if (newName === null) return;
      const trimmed = newName.trim();
      if (!trimmed) {
        showToast('资料名称不能为空', 'warning');
        return;
      }
      if (trimmed === oldName) return;

      chrome.runtime.sendMessage({
        action: 'updateProfile',
        profileId: activeProfileId,
        updates: { name: trimmed }
      }, async (response) => {
        if (chrome.runtime.lastError) {
          showToast('通信错误：' + chrome.runtime.lastError.message, 'error');
          return;
        }
        if (response && response.success) {
          await loadProfiles();
          updateStatus();
          showToast(`资料已重命名为「${trimmed}」`, 'success');
        } else {
          showToast('重命名失败：' + (response?.error || '请重试'), 'error');
        }
      });
    });
  }

  // 新增资料
  const addProfileBtn = document.getElementById('addProfileBtn');
  if (addProfileBtn) {
    addProfileBtn.addEventListener('click', async () => {
      const creation = await chooseNewProfile(allProfiles, currentProfile?.id);
      if (!creation) return;

      chrome.runtime.sendMessage({ action: 'addProfile', ...creation }, async (response) => {
        if (chrome.runtime.lastError) {
          showToast('通信错误：' + chrome.runtime.lastError.message, 'error');
          return;
        }
        if (response && response.success) {
          await loadProfiles();
          updateStatus();
          showToast('新资料已创建', 'success');
        } else {
          showToast('创建失败：' + (response?.error || '请重试'), 'error');
        }
      });
    });
  }

  // 一键填入
  const fillBtn = document.getElementById('fillBtn');
  if (fillBtn) {
    fillBtn.addEventListener('click', () => runFillTask({ btn: fillBtn, mode: null, loadingText: '正在识别并一键填入表单…' }));
  }

  // 增量填入：沿用 fillForm 协议，携带 mode:'incremental'
  const incrementalFillBtn = document.getElementById('incrementalFillBtn');
  if (incrementalFillBtn) {
    incrementalFillBtn.addEventListener('click', () => runFillTask({ btn: incrementalFillBtn, mode: 'incremental', loadingText: '正在增量填入空白字段…' }));
  }

  // AI 助填
  const aiFillBtn = document.getElementById('aiFillBtn');
  if (aiFillBtn) {
    aiFillBtn.addEventListener('click', () => runAiFillTask(aiFillBtn));
  }

  // 选区填入在招聘网页上框选，浏览器侧栏保留。
  const regionFillBtn = document.getElementById('regionFillBtn');
  if (regionFillBtn) {
    regionFillBtn.addEventListener('click', async () => {
      regionFillBtn.disabled = true;
      try {
        const tab = await getActiveTab();
        const outcome = await sendTabTaskWithReady(tab, { action: 'startRegionFill' }, REGION_START_TIMEOUT_MS);
        const response = outcome.response;
        if (!Sidebar.isCurrentPage(tab)) return;
        if (!response) {
          showTaskFeedback('warning', '页面没有返回选区填入状态，请重试');
          return;
        }
        if (response.success === false || response.result?.started !== true) {
          showTaskFeedback('warning', '选区填入未启动：' + (response.error || '页面端已取消或正忙'));
          return;
        }
        Sidebar.clearResult();
        showTaskFeedback('info', '在网页上拖动框选要填的字段，再选择一条简历经历。按 Esc 退出。');
      } catch (err) {
        showTaskFeedback('warning', friendlyTabError(err));
      } finally {
        regionFillBtn.disabled = false;
      }
    });
  }

  // 配置按钮 - 打开配置页面
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') });
    });
  }

  for (const link of document.querySelectorAll('[data-workspace-link]')) {
    link.addEventListener('click', async event => {
      event.preventDefault();
      try {
        await chrome.tabs.create({ url: link.href });
      } catch (error) {
        showTaskFeedback('warning', '打开页面失败：' + error.message);
      }
    });
  }
}

// ============================================================================
// 核心功能：填入任务
// ============================================================================

async function switchProfile(profileId) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'setActiveProfile', profileId }, (response) => {
      if (chrome.runtime.lastError) {
        resolve();
        return;
      }
      if (response && response.success) {
        activeProfileId = profileId;
        currentProfile = allProfiles.find(p => p.id === profileId);
        renderCustomDropdown();
        showToast('已切换资料', 'success');
      }
      resolve();
    });
  });
}

/**
 * 一键 / 增量填入共用流程：发送 fillForm（增量携带 mode:'incremental'）。
 * 按钮在 finally 中恢复；错误信息原样呈现给用户。
 */
async function runFillTask({ btn, mode, loadingText }) {
  if (!currentProfile) {
    showTaskFeedback('warning', '请先在「配置资料与简历」中完善简历资料');
    return;
  }

  const profile = currentProfile;
  Sidebar.clearResult();
  btn.disabled = true;
  showTaskFeedback('loading', loadingText);
  if (typeof appLog !== 'undefined') {
    appLog.info('popup', 'fill.start', mode === 'incremental' ? '开始增量填入' : '开始一键填入', { profile: currentProfile.name });
  }

  try {
    const tab = await getActiveTab();

    const message = { action: 'fillForm', profile, sidePanel: true };
    if (mode) message.mode = mode;

    // 连通性编排 + 任务单次发送；失败抛出带 reason 的结构化错误
    const outcome = await sendTabTaskWithReady(tab, message, FILL_TIMEOUT_MS);
    if (!Sidebar.isCurrentPage(tab)) return;
    const response = outcome.response;

    if (!response) {
      showTaskFeedback('error', '页面没有返回填入结果，请刷新网页后重试');
      return;
    }
    if (response.success === false) {
      const detail = response.error || '未知错误';
      if (typeof appLog !== 'undefined') appLog.error('popup', 'fill.fail', '填入失败', detail);
      showTaskFeedback('error', '填入失败：' + detail);
      return;
    }

    const result = response.result || {};
    if (result.cancelled) {
      showTaskFeedback('warning', '已取消填写。请核对网页上已经写入的内容。');
      return;
    }
    const count = result.filledCount ?? 0;
    Sidebar.showDetails(tab, result);
    const manualCount = Array.isArray(result.manualFields) ? result.manualFields.length : 0;
    const rows = Array.isArray(result.results) ? result.results : [];
    const skippedCount = result.skippedCount ?? rows.filter(item => item.status === 'skipped_has_value').length;
    const reviewCount = (result.reviewCount ?? rows.filter(item => item.status === 'needs_review').length) +
      (result.failedCount ?? rows.filter(item => item.status === 'failed').length);

    if (count > 0) {
      let msg = `已填入 ${count} 个字段`;
      if (manualCount > 0) msg += `，另有 ${manualCount} 项建议人工核对`;
      if (mode === 'incremental') msg += '（仅补空白字段）';
      showTaskFeedback('success', msg);
      Sidebar.rememberResult(tab, profile.id);
      if (typeof appLog !== 'undefined') appLog.success('popup', 'fill.done', `填入成功，${count} 个字段`);
      updateLastUsed();
    } else {
      if (typeof appLog !== 'undefined') appLog.warn('popup', 'fill.empty', '本轮没有新增填入');
      if (skippedCount > 0 && reviewCount === 0) {
        showTaskFeedback('warning', '本轮没有新增填入；已有内容保持不变，缺失资料请手动补充');
      } else if (reviewCount > 0) {
        showTaskFeedback('warning', `没有新增填入，${reviewCount} 项待人工核对。可展开字段清单，或用资料速查逐项补填。`);
      } else {
        showTaskFeedback('warning', '未匹配到可填写的字段；可尝试「AI 助填」处理开放题，或用「选区填入」手动指定区域');
      }
    }
  } catch (err) {
    if (typeof appLog !== 'undefined') appLog.error('popup', 'fill.fail', '填入失败', err.message);
    showTaskFeedback('error', '填入失败：' + friendlyTabError(err));
  } finally {
    btn.disabled = false;
  }
}

/** AI 助填：先快速填入，再逐题深度解析，超时放宽到 5 分钟 */
async function runAiFillTask(btn) {
  if (!currentProfile) {
    showTaskFeedback('warning', '请先在「配置资料与简历」中完善简历资料');
    return;
  }

  const profile = currentProfile;
  Sidebar.clearResult();
  btn.disabled = true;
  showTaskFeedback('loading', 'AI 助填进行中：先填标准字段，再逐题解析开放题（最长 5 分钟）…');
  if (typeof appLog !== 'undefined') {
    appLog.info('popup', 'ai.fill_start', '开始 AI 助填', { profile: currentProfile.name });
  }

  try {
    const tab = await getActiveTab();

    const outcome = await sendTabTaskWithReady(tab, {
      action: 'aiStepByStepFill',
      profile
    }, AI_FILL_TIMEOUT_MS);
    if (!Sidebar.isCurrentPage(tab)) return;
    const response = outcome.response;

    if (!response) {
      showTaskFeedback('error', '页面没有返回 AI 助填结果，请刷新网页后重试');
      return;
    }
    if (response.success === false) {
      const detail = response.error || '未知错误';
      if (typeof appLog !== 'undefined') appLog.error('popup', 'ai.fill_fail', 'AI 助填失败', detail);
      showTaskFeedback('error', 'AI 助填失败：' + detail);
      return;
    }

    const result = response.result || {};
    if (result.cancelled) {
      showTaskFeedback('warning', '已取消填写。请核对网页上已经写入的内容。');
      return;
    }
    const count = result.filledCount ?? result.count ?? 0;
    Sidebar.showDetails(tab, result);
    if (count > 0) {
      if (result.aiConfigured === false) {
        showTaskFeedback('warning', `已填入 ${count} 个基础字段。需要处理开放题时，请先在设置中配置 AI。`);
      } else {
        showTaskFeedback('success', `AI 助填完成，共处理 ${count} 个字段`);
      }
      Sidebar.rememberResult(tab, profile.id);
    } else {
      showTaskFeedback('warning', 'AI 助填完成，但没有匹配到可处理的内容；请检查资料完整度与 API Key 配置');
    }
    updateLastUsed();
  } catch (err) {
    if (typeof appLog !== 'undefined') appLog.error('popup', 'ai.fill_fail', 'AI 助填失败', err.message);
    showTaskFeedback('error', 'AI 助填失败：' + friendlyTabError(err));
  } finally {
    btn.disabled = false;
  }
}

// ============================================================================
// 状态更新
// ============================================================================

function updateStatus() {
  Sidebar.profileChanged();
  // 保留原 ID：此处展示求职方向（当前简历名已由顶部下拉展示，不再重复）
  const directionEl = document.getElementById('currentProfile');
  const completenessEl = document.getElementById('completeness');
  const progressBarEl = document.getElementById('completenessBar');
  const lastUsedEl = document.getElementById('lastUsed');

  if (!currentProfile) {
    if (directionEl) { directionEl.textContent = '未配置'; directionEl.title = ''; }
    if (completenessEl) completenessEl.textContent = '0%';
    if (progressBarEl) progressBarEl.style.width = '0%';
    if (lastUsedEl) lastUsedEl.textContent = '从未';
    updateProfilePreview(null);
    return;
  }

  const direction = [
    currentProfile.jobIntention?.expectedPosition,
    currentProfile.jobIntention?.expectedCity
  ].filter(Boolean).join(' · ');
  if (directionEl) {
    directionEl.textContent = direction || '未设置方向';
    directionEl.title = direction || '';
  }

  // 共享完整度计算（与 options 工作台同源）
  const completenessInfo = ProfileCompleteness.computeProfileCompleteness(currentProfile);
  if (completenessEl) completenessEl.textContent = `${completenessInfo.percent}%`;
  if (progressBarEl) progressBarEl.style.width = `${completenessInfo.percent}%`;

  const lastUsed = currentProfile.lastUsedAt || currentProfile.updatedAt;
  if (lastUsedEl) lastUsedEl.textContent = formatTime(lastUsed);

  updateProfilePreview(currentProfile);

}

// 资料速览：收进资料卡片内部（减少独立卡片数量）
function updateProfilePreview(profile) {
  const existingPreview = document.querySelector('.profile-preview');
  if (existingPreview) {
    existingPreview.remove();
  }

  const profileCard = document.querySelector('.profile-card');
  if (!profileCard) return;

  if (!profile) return;

  const email = profile?.basicInfo?.email || '未填邮箱';
  const phone = profile?.basicInfo?.phone || '未填手机';
  const school = (Array.isArray(profile?.education) ? profile.education.find(item => String(item?.school || '').trim())?.school : '') || '未填学校';
  const company = (Array.isArray(profile?.workExperience) ? profile.workExperience.find(item => String(item?.company || '').trim())?.company : '') || '未填工作/实习';

  const chips = [
    { icon: 'mail', title: '邮箱', value: email },
    { icon: 'phone', title: '手机', value: phone },
    { icon: 'school', title: '毕业院校', value: school },
    { icon: 'work', title: '工作/实习', value: company }
  ];

  const icons = {
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12 13 2,6"></polyline>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line>',
    school: '<path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path>',
    work: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>'
  };

  const preview = document.createElement('div');
  preview.className = 'profile-preview';
  preview.innerHTML = `
    <div class="preview-grid">
      ${chips.map(c => `
        <div class="preview-chip" title="${escapeHtml(c.title)}: ${escapeHtml(c.value)}">
          <div class="chip-icon-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[c.icon]}</svg>
          </div>
          <span class="chip-text">${escapeHtml(c.value)}</span>
        </div>
      `).join('')}
    </div>
  `;
  // 速览放在看板入口之前，保持卡片内信息顺序：名称 → 完整度 → 速览 → 看板入口
  profileCard.appendChild(preview);
}

function formatTime(isoString) {
  if (!isoString) return '从未';

  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '从未';

  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function updateLastUsed() {
  if (!currentProfile) return;

  const nowIso = new Date().toISOString();
  currentProfile.lastUsedAt = nowIso;
  const lastUsedEl = document.getElementById('lastUsed');
  if (lastUsedEl) lastUsedEl.textContent = '刚刚';

  chrome.runtime.sendMessage({
    action: 'updateProfile',
    profileId: currentProfile.id,
    updates: { lastUsedAt: nowIso }
  }, () => { if (chrome.runtime.lastError) {} });
}

// ============================================================================
// UI 辅助函数 - Toast 轻量提示
// ============================================================================

function showToast(message, type = 'info') {
  const oldToast = document.querySelector('.toast');
  if (oldToast) oldToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  } else if (type === 'warning') {
    iconSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  }

  toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.25s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 260);
  }, 2400);
}

// ============================================================================
// 模态输入框（替代原生 prompt）
// ============================================================================

function showModalPrompt({ title = '输入信息', subtitle = '', defaultValue = '', placeholder = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          ${subtitle ? `<p class="modal-subtitle">${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <div class="modal-body">
          <input type="text" class="modal-input" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-modal-cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn-modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.modal-input');
    const cancelBtn = overlay.querySelector('.btn-modal-cancel');
    const confirmBtn = overlay.querySelector('.btn-modal-confirm');

    input.focus();
    input.select();

    function cleanup(val) {
      overlay.remove();
      resolve(val);
    }

    cancelBtn.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(null);
    });

    function submit() {
      cleanup(input.value.trim());
    }

    confirmBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      }
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Read structured metadata in the active tab. The workbench confirms the draft before persisting.
function readJobPosting() {
  function plainText(value, max = 240) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }
  const postings = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const items = [JSON.parse(script.textContent)].flat();
      postings.push(...items.flatMap(item => [item, ...(Array.isArray(item?.['@graph']) ? item['@graph'] : [])])
        .filter(item => [item?.['@type']].flat().includes('JobPosting')));
    } catch {}
  }
  const job = postings.length === 1 ? postings[0] : {};
  const address = [job.jobLocation].flat()[0]?.address;
  const employmentTypes = { FULL_TIME: '全职', PART_TIME: '兼职', INTERN: '实习' };
  const description = document.createElement('template');
  description.innerHTML = plainText(job.description, 8000);
  return {
    pageUrl: location.href,
    company: plainText(job.hiringOrganization?.name),
    position: plainText(job.title || document.querySelector('meta[property="og:title"]')?.content || document.title),
    location: typeof address === 'string' ? plainText(address) : [address?.addressRegion, address?.addressLocality].filter(Boolean).join(' '),
    jobType: employmentTypes[[job.employmentType].flat()[0]] || '',
    summary: plainText(description.content.textContent, 2000)
  };
}

async function captureCurrentJob(event, result = null) {
  const button = event.currentTarget;
  button.disabled = true;
  let key;
  try {
    const tab = await getActiveTab();
    if (result && (tab.id !== result.tab.id || tab.url !== result.tab.url)) {
      throw new Error('刚才填写的是另一个页面，请切回原岗位再记录。');
    }
    if (!/^https?:\/\//.test(tab?.url || '')) throw new Error('请先打开招聘网页');
    const details = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readJobPosting })
      .then(rows => rows[0]?.result).catch(() => null);
    const active = await getActiveTab();
    if (tab.id !== active.id || tab.url !== active.url || (details && details.pageUrl !== tab.url)) {
      throw new Error('网页已经切换，请在岗位页面重新点「记录此岗位」。');
    }
    const { pageUrl, ...fields } = details || {};
    const draft = {
      company: '', position: tab.title || '', ...fields, url: tab.url,
      profileId: (result ? result.profileId : activeProfileId) || '', status: '已收藏', source: 'browser-preview'
    };
    const id = crypto.randomUUID();
    key = 'yanyuTrackerDraft:' + id;
    await chrome.storage.session.set({ [key]: draft });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html?draft=${id}#tracker`) });
  } catch (error) {
    if (key) await chrome.storage.session.remove(key).catch(() => {});
    showTaskFeedback('warning', error.message);
  } finally {
    button.disabled = false;
  }
}
