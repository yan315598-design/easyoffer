// ============================================================================
// Background Service Worker
// 处理跨页面消息和数据管理
// ============================================================================

// 导入storage manager（在service worker中需要用importScripts）
importScripts('profile-schema.js', 'attachments.js', 'storage.js', 'resume-parser.js', 'content-ready.js', 'backup-directory.js');

console.log('[易offer] Background Service Worker 已启动');

// 初始化存储
const storageReady = storageManager.initialize();
storageReady.then(() => {
  console.log('[易offer] 存储初始化完成');
}).catch((error) => {
  console.error('[易offer] 存储初始化失败，后续消息将返回结构化错误', error?.message || error);
});

// ============================================================================
// 工具栏图标：优先打开浏览器侧栏，旧入口使用页内悬浮助手。
// ----------------------------------------------------------------------------
// manifest 配置 default_popup 时由 popup 承载入口，不能再注册 onClicked；
// 仅在未配置 default_popup 时保留 onClicked 回退，点击唤出页面右下角助手。
// 连通性只沿用 content-ready 的严格编排：仅在"明确无接收端"时补注；超时或
// message port closed 一律不盲注入。任务（showDock）只发送一次；同一 tab
// 的快速连点在首次流程结束前直接忽略。
// ============================================================================

const ACTION_MANIFEST = chrome.runtime.getManifest();
const ACTION_HAS_DEFAULT_POPUP = Boolean(ACTION_MANIFEST.action?.default_popup);
const nativePanelBehavior = ACTION_MANIFEST.side_panel && chrome.sidePanel?.setPanelBehavior
  ? chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => true, error => {
    console.warn('[易offer] 无法开启原生侧栏:', error.message);
    return false;
  })
  : Promise.resolve(false);
const ACTION_DEFAULT_TITLE = ACTION_MANIFEST.action?.default_title ||
  ACTION_MANIFEST.name || '易offer 网申填写助手';
const ACTION_ERROR_RESET_MS = 5000;
const DOCK_TASK_TIMEOUT_MS = 5000;
const actionClicksInFlight = new Set();
const actionFeedbackTimers = new Map();

// 仅在 manifest 未配置 default_popup 时注册回退入口，避免与 popup 重复触发。
if (!ACTION_HAS_DEFAULT_POPUP) {
  chrome.action.onClicked.addListener(async (clickedTab) => {
    if (await nativePanelBehavior) return;
    const tabId = clickedTab && Number.isInteger(clickedTab.id) ? clickedTab.id : null;
    if (tabId !== null) {
      startActionClick(clickedTab, tabId);
      return;
    }
    void resolveActiveTabAndStart();
  });
}

/** 同步占位 in-flight，保证同一 tabId 的快速连点不会并发补注/发送。 */
function startActionClick(tab, tabId) {
  if (actionClicksInFlight.has(tabId)) return;
  actionClicksInFlight.add(tabId);
  void handleActionClick(tab)
    .finally(() => actionClicksInFlight.delete(tabId));
}

async function resolveActiveTabAndStart() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !Number.isInteger(tab.id)) {
      console.warn('[易offer] 未找到可用的活动标签页');
      return;
    }
    startActionClick(tab, tab.id);
  } catch (error) {
    console.warn('[易offer] 读取活动标签页失败:', error?.message || error);
  }
}

async function handleActionClick(tab) {
  const tabId = tab.id;
  try {
    await showDockForTab(tab);
    clearActionFailure(tabId);
  } catch (error) {
    showActionFailure(tabId, error?.message || String(error));
  }
}

async function showDockForTab(tab) {
  const outcome = await ContentReady.runTabTask({
    url: tab.url || tab.pendingUrl || '',
    sendPing: () => pingContentScript(tab.id),
    inject: () => injectContentScriptsIntoTab(tab.id),
    sendTask: () => sendTabMessage(tab.id, { action: 'showDock' }, DOCK_TASK_TIMEOUT_MS)
  });
  if (!outcome.ok) throw new Error(outcome.message);

  const response = outcome.response;
  if (!response || response.success !== true || response.visible !== true) {
    throw new Error(response?.error || '悬浮助手未能显示，请刷新页面后重试');
  }
  return response;
}

/** contentPing 短超时；超时/通道错误都交给 ContentReady 分类，不在这里补注。 */
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
    } catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    }
  });
}

/** 按 manifest 的 content_scripts 完整顺序补注：CSS 先，JS 逐个执行。 */
async function injectContentScriptsIntoTab(tabId) {
  const plan = ContentReady.buildScriptPlan(chrome.runtime.getManifest());
  for (const cssFile of plan.cssFiles) {
    await chrome.scripting.insertCSS({ target: { tabId }, files: [cssFile] });
  }
  for (const jsFile of plan.jsFiles) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [jsFile] });
  }
}

/** 发送一次消息并等待页面应答；超时只失败，不触发补注或重发。 */
function sendTabMessage(tabId, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('等待页面响应超时'));
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
    } catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    }
  });
}

/** 失败反馈：badge + tooltip 显示原因，短暂保留后恢复默认。 */
function showActionFailure(tabId, message) {
  const reason = String(message || '助手未能启动').replace(/\s+/g, ' ').trim().slice(0, 120);
  try {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' }, () => { void chrome.runtime.lastError; });
    chrome.action.setBadgeText({ tabId, text: '!' }, () => { void chrome.runtime.lastError; });
    chrome.action.setTitle({ tabId, title: `${ACTION_DEFAULT_TITLE}：${reason}` }, () => { void chrome.runtime.lastError; });
  } catch (error) {
    console.warn('[易offer] 写入 action 失败提示失败:', error?.message || error);
  }

  const previous = actionFeedbackTimers.get(tabId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    actionFeedbackTimers.delete(tabId);
    clearActionFailure(tabId);
  }, ACTION_ERROR_RESET_MS);
  actionFeedbackTimers.set(tabId, timer);
}

function clearActionFailure(tabId) {
  const timer = actionFeedbackTimers.get(tabId);
  if (timer) clearTimeout(timer);
  actionFeedbackTimers.delete(tabId);
  try {
    chrome.action.setBadgeText({ tabId, text: '' }, () => { void chrome.runtime.lastError; });
    chrome.action.setTitle({ tabId, title: ACTION_DEFAULT_TITLE }, () => { void chrome.runtime.lastError; });
  } catch { /* 标签页可能已关闭 */ }
}

// 数据操作串行执行；导出/导入先等待编辑页保存，避免与队列互相等待。
let dataMessageQueue = Promise.resolve();
let snapshotTimer;
let snapshotRevision = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.jobAutofillData && !changes.yanyuSubmissionsV1)) return;
  snapshotRevision++;
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => void queueDataMessage({ action: 'writeSnapshot', automatic: true }).catch(console.warn), 1800);
});

async function writeBackupSnapshot(automatic) {
  const revision = snapshotRevision;
  const previous = (await chrome.storage.local.get('easyofferBackupStatus')).easyofferBackupStatus || {};
  const handle = await backupDirectory.get();
  if (!handle && automatic) return { success: true };
  try {
    if (!handle || await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('请重新选择备份目录并授权');
    const data = await storageManager.exportData();
    const filename = await backupDirectory.write(handle, data);
    await chrome.storage.local.set({ easyofferBackupStatus: { filename, directory: handle.name, completedAt: new Date().toISOString(), dirty: revision !== snapshotRevision } });
    return { success: true, filename };
  } catch (error) {
    await chrome.storage.local.set({ easyofferBackupStatus: { ...previous, dirty: true, error: error.message } });
    return { success: false, error: error.message };
  }
}

function queueDataMessage(request, sender) {
  dataMessageQueue = dataMessageQueue.catch(() => {}).then(() => storageReady).then(() => new Promise(resolve => {
    dispatchMessage(request, sender, resolve);
  }));
  return dataMessageQueue;
}

async function handleDataAfterEditorSave(request, sender) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  const editors = contexts.filter(context => context.documentUrl?.split('#')[0] === chrome.runtime.getURL('options/options.html'));
  let result;
  try {
    for (const editor of editors) {
      const response = await chrome.runtime.sendMessage({ action: 'flushProfileEditor', documentId: editor.documentId, importing: request.action === 'importData' });
      if (!response?.success) throw new Error(response?.error || '资料编辑页保存未完成，请保存后重试');
    }
    result = await queueDataMessage(request, sender);
    return result;
  } finally {
    if (request.action === 'importData') {
      await Promise.allSettled(editors.map(editor => chrome.runtime.sendMessage({
        action: 'finishProfileImport', documentId: editor.documentId, success: !!result?.success
      })));
    }
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (['flushProfileEditor', 'finishProfileImport'].includes(request.action)) return false;
  if (request.action === 'getEditorIdentity') { sendResponse({ documentId: sender.documentId }); return false; }
  if (['aiGenerate', 'parseResume'].includes(request.action)) return dispatchMessage(request, sender, sendResponse);
  const needsSavedEditor = ['exportData', 'importData', 'writeSnapshot'].includes(request.action) ||
    (request.action === 'addProfile' && !!request.sourceProfileId);
  const result = needsSavedEditor ? handleDataAfterEditorSave(request, sender) : queueDataMessage(request, sender);
  result.then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});

function dispatchMessage(request, sender, sendResponse) {
  console.log('[易offer] 收到消息:', request.action);

  switch (request.action) {
    case 'saveAttachment':
    case 'getAttachment':
    case 'deleteAttachment':
    case 'getStorageInfo':
      handleAttachmentMessage(request).then(result => sendResponse({ success: true, ...result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'getActiveProfile':
      handleGetActiveProfile(sendResponse, !!sender.tab);
      return true; // 异步响应

    case 'getAllProfiles':
      handleGetAllProfiles(sendResponse);
      return true;

    case 'addProfile':
      handleAddProfile(request.name, request.sourceProfileId, sendResponse);
      return true;

    case 'updateProfile':
      handleUpdateProfile(request.profileId, request.updates, sendResponse);
      return true;

    case 'deleteProfile':
      handleDeleteProfile(request.profileId, sendResponse);
      return true;

    case 'setActiveProfile':
      handleSetActiveProfile(request.profileId, sendResponse);
      return true;

    case 'getSettings':
      handleGetSettings(sendResponse);
      return true;

    case 'updateSettings':
      handleUpdateSettings(request.settings, sendResponse);
      return true;

    case 'addEducation':
      handleAddEducation(request.profileId, sendResponse);
      return true;

    case 'deleteEducation':
      handleDeleteEducation(request.profileId, request.eduId, sendResponse);
      return true;

    case 'addWorkExperience':
      handleAddWorkExperience(request.profileId, sendResponse);
      return true;

    case 'deleteWorkExperience':
      handleDeleteWorkExperience(request.profileId, request.workId, sendResponse);
      return true;

    case 'addProject':
      handleAddProject(request.profileId, sendResponse);
      return true;

    case 'deleteProject':
      handleDeleteProject(request.profileId, request.projectId, sendResponse);
      return true;

    case 'exportData':
      handleExportData(sendResponse, request.options);
      return true;

    case 'previewBackup':
      storageManager.previewBackup(request.data).then(preview => sendResponse({ success: true, preview }),
        error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'writeSnapshot':
      writeBackupSnapshot(request.automatic).then(sendResponse, error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'importData':
      handleImportData(request.data, sendResponse, request.options);
      return true;

    case 'parseResume':
      handleParseResume(request.fileData, request.fileName, sendResponse);
      return true;

    case 'openOptions':
      if (['date', 'controls', 'entries', 'ai'].includes(request.article)) {
        chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html#help-${request.article}`) })
          .then(() => sendResponse({ success: true }), error => sendResponse({ success: false, error: error.message }));
        return true;
      }
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return true;

    case 'aiGenerate':
      handleAiGenerate(request.prompt, request.systemPrompt, sendResponse, request.maxTokens);
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
}

// ============================================================================
// 消息处理函数
// ============================================================================

async function handleAiGenerate(prompt, systemPrompt, sendResponse, maxTokens) {
  try {
    const settings = await storageManager.getSettings();
    if (!settings.aiEnabled || !settings.aiApiKey) {
      sendResponse({
        success: false,
        error: 'AI_NOT_CONFIGURED',
        message: '请先在插件设置中启用 AI 并配置 API Key'
      });
      return;
    }
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    const parsedTokens = Number(maxTokens);
    const tokenLimit = Math.min(parsedTokens && parsedTokens >= 1000 ? parsedTokens : 2000, 4000);
    const reply = await resumeParser.chat(settings, messages, {
      temperature: 0.3,
      maxTokens: tokenLimit,
      enableThinking: false
    });
    sendResponse({ success: true, text: reply });
  } catch (error) {
    sendResponse({
      success: false,
      error: error.message || 'AI 生成失败'
    });
  }
}

async function handleGetActiveProfile(sendResponse, forFilling = false) {
  try {
    const profile = await storageManager.getActiveProfile();
    sendResponse({ success: true, profile: forFilling ? profileForFilling(profile) : profile });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleGetAllProfiles(sendResponse) {
  try {
    const profiles = await storageManager.getAllProfiles();
    const data = await storageManager.loadAll();
    sendResponse({
      success: true,
      profiles,
      activeProfileId: data.activeProfileId
    });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddProfile(name, sourceProfileId, sendResponse) {
  try {
    const profileId = await storageManager.addProfile(name, sourceProfileId);
    sendResponse({ success: true, profileId });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleUpdateProfile(profileId, updates, sendResponse) {
  try {
    await storageManager.updateProfile(profileId, updates);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteProfile(profileId, sendResponse) {
  try {
    const result = await storageManager.deleteProfile(profileId);
    sendResponse({ success: result });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleSetActiveProfile(profileId, sendResponse) {
  try {
    await storageManager.setActiveProfile(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleGetSettings(sendResponse) {
  try {
    const settings = await storageManager.getSettings();
    sendResponse({ success: true, settings });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleUpdateSettings(settings, sendResponse) {
  try {
    await storageManager.updateSettings(settings);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddEducation(profileId, sendResponse) {
  try {
    await storageManager.addEducation(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteEducation(profileId, eduId, sendResponse) {
  try {
    await storageManager.deleteEducation(profileId, eduId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddWorkExperience(profileId, sendResponse) {
  try {
    await storageManager.addWorkExperience(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteWorkExperience(profileId, workId, sendResponse) {
  try {
    await storageManager.deleteWorkExperience(profileId, workId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleAddProject(profileId, sendResponse) {
  try {
    await storageManager.addProject(profileId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleDeleteProject(profileId, projectId, sendResponse) {
  try {
    await storageManager.deleteProject(profileId, projectId);
    sendResponse({ success: true });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleExportData(sendResponse, options) {
  try {
    const data = await storageManager.exportData(options);
    sendResponse({ success: true, data });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

async function handleImportData(data, sendResponse, options) {
  try {
    const result = await storageManager.importData(data, options);
    sendResponse({ success: true, ...result });
  } catch (e) {
    sendResponse({ success: false, error: e.message });
  }
}

// AI简历解析
async function handleParseResume(fileData, fileName, sendResponse) {
  try {
    console.log('[简历解析] 开始解析:', fileName);

    // 获取AI设置
    const settings = await storageManager.getSettings();

    if (!settings.aiEnabled || !settings.aiApiKey) {
      sendResponse({
        success: false,
        error: 'AI_NOT_CONFIGURED',
        message: '请先在设置中配置AI API Key'
      });
      return;
    }

    // 将base64转换为Blob
    const response = await fetch(fileData);
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: blob.type });

    // 优先让模型读取原始文件；接口不支持时由解析器自动提取文字重试
    try {
      const result = await resumeParser.parseFileWithAI(file, settings);
      console.log('[简历解析] AI解析成功，输入模式:', result.inputMode);

      sendResponse({
        success: true,
        data: result.data,
        inputMode: result.inputMode,
        extractionMode: result.extractionMode || ''
      });
    } catch (error) {
      console.error('[简历解析] AI解析失败:', error);
      sendResponse({
        success: false,
        error: 'AI_PARSE_FAILED',
        message: error.message || 'AI解析失败，请重试'
      });
    }
  } catch (e) {
    console.error('[简历解析] 未知错误:', e);
    sendResponse({
      success: false,
      error: 'UNKNOWN_ERROR',
      message: e.message || '解析失败'
    });
  }
}

// ============================================================================
// 投递历史处理函数
// ============================================================================

// 监听扩展安装/更新
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[易offer] 首次安装');
    // 打开欢迎页面（可选）
    // chrome.tabs.create({ url: 'welcome.html' });
  } else if (details.reason === 'update') {
    console.log('[易offer] 更新到版本:', chrome.runtime.getManifest().version);
  }
});

async function handleAttachmentMessage(request) {
  await storageReady;
  if (request.action === 'getStorageInfo') return { info: await storageManager.getStorageInfo() };
  if (request.action === 'getAttachment') return { file: await storageManager.getAttachment(request.profileId, request.id) };
  const attachments = request.action === 'saveAttachment'
    ? await storageManager.saveAttachment(request.profileId, request.kind, request.file, request.replaceId)
    : await storageManager.deleteAttachment(request.profileId, request.kind, request.id);
  return { attachments };
}
