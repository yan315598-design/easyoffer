#!/usr/bin/env node
// 独立回归：工具栏图标 → contentPing/补注 → 单次 showDock（不修改现有 test/run.mjs）
// 运行：node test/action-dock.test.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const backgroundCode = read('scripts/background.js');
const contentReadyCode = read('scripts/content-ready.js');
const mainCode = read('scripts/content/main.js');
const popupCode = read('popup/popup.js');
const sidebarCode = read('popup/sidebar.js');
const profileCompletenessCode = read('scripts/profile-completeness.js');

// 连接失败不得变成未处理 rejection。
const unhandledRejections = [];
process.on('unhandledRejection', (reason) => { unhandledRejections.push(reason); });

/** 复制 manifest 并移除 default_popup，用于验证 onClicked 回退入口。 */
function manifestWithoutPopup(source = manifest) {
  const copy = JSON.parse(JSON.stringify(source));
  delete copy.action.default_popup;
  delete copy.side_panel;
  return copy;
}
const FALLBACK_MANIFEST = manifestWithoutPopup();

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL  ${name}`);
    console.error(`      ${error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n      ') : error}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}
function eq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message || 'eq'}: expected ${b}, got ${a}`);
}
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitUntil(predicate, timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await wait(20);
  }
  throw new Error('等待条件超时');
}

function makeActionHarness({
  ping,
  showDockResponse,
  pingDelay = 0,
  nativePanel = false,
  manifestOverride = FALLBACK_MANIFEST
} = {}) {
  const usedManifest = manifestOverride;
  const messages = [];
  const injections = [];
  const badgeEvents = [];
  const titleEvents = [];
  const panelBehaviors = [];
  const longTimers = new Map();
  let longTimerId = 10000;
  let actionListener = null;
  let onClickedRegistrations = 0;

  const sandboxSetTimeout = (fn, ms) => {
    if (ms >= 4000) {
      const id = longTimerId++;
      longTimers.set(id, fn);
      return id;
    }
    return setTimeout(fn, ms);
  };
  const sandboxClearTimeout = (id) => {
    if (longTimers.delete(id)) return;
    clearTimeout(id);
  };

  const runtime = {
    lastError: undefined,
    getManifest: () => usedManifest,
    getURL: (path) => 'chrome-extension://test/' + path,
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} }
  };
  const chrome = {
    runtime,
    sidePanel: nativePanel ? { async setPanelBehavior(value) { panelBehaviors.push(value); } } : undefined,
    action: {
      onClicked: {
        addListener(fn) {
          onClickedRegistrations++;
          actionListener = fn;
        }
      },
      setBadgeBackgroundColor(details, callback) {
        badgeEvents.push(['color', details.tabId, details.color]);
        if (callback) callback();
      },
      setBadgeText(details, callback) {
        badgeEvents.push(['text', details.tabId, details.text]);
        if (callback) callback();
      },
      setTitle(details, callback) {
        titleEvents.push([details.tabId, details.title]);
        if (callback) callback();
      }
    },
    tabs: {
      query: async () => [{ id: 7, url: 'https://example.com/apply' }],
      sendMessage(tabId, message, callback) {
        messages.push(message);
        setTimeout(() => {
          if (message.action === 'contentPing') {
            if (typeof ping !== 'function') {
              callback({ success: true, ready: true });
              return;
            }
            ping({
              respond: (payload) => callback(payload),
              fail: (text) => {
                runtime.lastError = { message: text };
                callback(undefined);
                runtime.lastError = undefined;
              }
            });
            return;
          }
          callback(showDockResponse || { success: true, visible: true });
        }, pingDelay);
      }
    },
    scripting: {
      insertCSS: async ({ files }) => { injections.push(['css', ...files]); },
      executeScript: async ({ files }) => { injections.push(['js', ...files]); }
    }
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout: sandboxSetTimeout,
    clearTimeout: sandboxClearTimeout,
    chrome,
    storageManager: { initialize: () => Promise.resolve() },
    importScripts: (...files) => {
      for (const file of files) {
        if (file === 'content-ready.js') vm.runInContext(contentReadyCode, context, { filename: file });
      }
    }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(backgroundCode, context, { filename: 'scripts/background.js' });

  return {
    trigger: (tab = { id: 7, url: 'https://example.com/apply' }) => actionListener(tab),
    onClickedRegistrations,
    hasOnClickedListener: () => typeof actionListener === 'function',
    messages,
    injections,
    badgeEvents,
    titleEvents,
    panelBehaviors,
    runLongTimers: () => {
      for (const fn of [...longTimers.values()]) fn();
      longTimers.clear();
    }
  };
}

function makeMainHarness({ visibility = true } = {}) {
  let messageListener = null;
  const calls = { startRegionFillFlow: 0, yanyuShowRegionView: 0, exitRegionFillMode: 0 };
  const attributes = new Map();
  const host = {
    style: {},
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) || null; }
  };
  const requiredGlobals = [
    'smartFillMatchOptionText', 'detectField', 'waitFor', 'fillSelectWidget', 'fillSmartFillCascadeGroup',
    'fillForm', 'cancelActiveFillTask', 'buildSmartFillProfileDigest', 'matchFieldType', 'computeAgeFromBirthDate',
    'getCopyItemsForCategory', 'normalizeSmartFillAiItem', 'collectSmartFillFields', 'resolveSmartFillField',
    'aiSmartFill', 'isWidgetSelectTrigger', 'smartFillFieldPayload', 'validateSmartFillValue', 'fillField',
    'setFillTargetFromElement', 'getFillTarget', 'fillTargetWithCopyValue', 'applyCopyItem', 'updateFillTargetBar',
    'regionRectsIntersectionArea', 'regionControlOverlapRatio', 'regionDateSideOfLabel', 'regionFieldizeEntry',
    'regionMatchRuleField', 'regionSplitDateRangeRefs', 'regionPanelCategories', 'collectRegionFields',
    'collectYanyuRegionFields', 'regionFillApply', 'runRegionFill', 'startRegionFillFlow', 'isRegionFillRunning',
    'aiStepByStepFill', 'enterRegionSelectMode', 'finishRegionSelect', 'exitRegionFillMode', 'isRegionFillActive'
  ];
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    __CAPYBARA_CONTENT_MAIN_STATE__: { listenerBound: false, initDone: true },
    yanyuDockState: {},
    chrome: {
      runtime: { onMessage: { addListener(fn) { messageListener = fn; } } },
      storage: { onChanged: { addListener() {} } }
    },
    document: {
      readyState: 'complete',
      getElementById: () => host,
      addEventListener() {}
    }
  };
  for (const name of requiredGlobals) sandbox[name] = () => {};
  sandbox.startRegionFillFlow = async () => {
    calls.startRegionFillFlow++;
    return { started: true };
  };
  sandbox.yanyuSetDockVisible = () => {
    calls.yanyuSetDockVisible++;
    return visibility;
  };
  sandbox.yanyuShowRegionView = () => {
    calls.yanyuShowRegionView++;
    return visibility;
  };
  sandbox.exitRegionFillMode = () => {
    calls.exitRegionFillMode++;
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(mainCode, context, { filename: 'scripts/content/main.js' });
  return {
    calls,
    attributes,
    setRegionState(state) { sandbox.regionFillState = state; },
    trigger(message) {
      let response = null;
      const keepOpen = messageListener(message, {}, (payload) => { response = payload; });
      return { response, keepOpen };
    }
  };
}

/**
 * popup.js 真实接线环境：加载完整度脚本 + ContentReady + popup.js，
 * 通过真实的 DOMContentLoaded 初始化流程观察 tabs 消息。
 */
function makePopupHarness({
  tabUrl = 'https://example.com/apply',
  pingResponse = { success: true, ready: true }
} = {}) {
  const tabMessages = [];
  const runtimeMessages = [];
  const elements = new Map();
  const documentListeners = {};
  let domReadyListener = null;

  const makeElement = (id = '') => {
    const el = {
      id,
      textContent: '',
      innerHTML: '',
      title: '',
      hidden: false,
      className: '',
      disabled: false,
      value: '',
      children: [],
      style: {},
      _listeners: {},
      classList: {
        add(name) {
          el.className = el.className ? `${el.className} ${name}` : name;
        },
        remove() {},
        toggle() {},
        contains: () => false
      },
      addEventListener(type, fn) {
        (el._listeners[type] ||= []).push(fn);
      },
      dispatch(type, event = {}) {
        for (const fn of el._listeners[type] || []) fn(event);
      },
      insertBefore() {},
      appendChild() {},
      append() {},
      replaceChildren() {},
      remove() {},
      querySelector: () => makeElement(),
      querySelectorAll: () => [],
      setAttribute() {},
      getAttribute: () => null
    };
    return el;
  };

  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };

  const chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => manifest,
      getURL: (path) => 'chrome-extension://test/' + path,
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        if (!callback) return;
        if (message.action === 'getSettings') {
          callback({ success: true, settings: { uiTheme: 'dark' } });
          return;
        }
        if (message.action === 'getAllProfiles') {
          callback({ success: true, profiles: [], activeProfileId: null });
          return;
        }
        if (message.action === 'getSubmissions') {
          callback({ success: true, submissions: [] });
          return;
        }
        callback({ success: true });
      },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} }
    },
    storage: { onChanged: { addListener() {} } },
    tabs: {
      query: async () => [{ id: 7, url: tabUrl }],
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, disconnect() {} }),
      sendMessage(tabId, message, callback) {
        tabMessages.push(message);
        setTimeout(() => {
          if (message.action === 'contentPing') {
            callback(pingResponse);
            return;
          }
          callback({ success: true });
        }, 0);
      }
    },
    scripting: {
      insertCSS: async () => {},
      executeScript: async () => {}
    }
  };

  const documentMock = {
    readyState: 'complete',
    documentElement: { setAttribute() {}, getAttribute: () => null },
    addEventListener(type, fn) {
      (documentListeners[type] ||= []).push(fn);
      if (type === 'DOMContentLoaded') domReadyListener = fn;
    },
    getElementById,
    querySelector: () => null,
    querySelectorAll: () => [],
    createDocumentFragment: () => makeElement(),
    createElement: () => makeElement(''),
    body: { appendChild() {} }
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    // 长超时/自动隐藏计时器不落表，避免测试进程被无意义地挂住
    setTimeout: (fn, ms) => (ms >= 1000 ? 0 : setTimeout(fn, ms)),
    clearTimeout: (id) => { if (id) clearTimeout(id); },
    chrome,
    document: documentMock,
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: { setItem() {} }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(profileCompletenessCode, context, { filename: 'scripts/profile-completeness.js' });
  vm.runInContext(contentReadyCode, context, { filename: 'scripts/content-ready.js' });
  for (const file of ['scripts/profile-schema.js', 'scripts/content/profile-catalog.js']) {
    vm.runInContext(read(file), context, { filename: file });
  }
  vm.runInContext(sidebarCode, context, { filename: 'popup/sidebar.js' });
  vm.runInContext(popupCode, context, { filename: 'popup/popup.js' });

  return {
    context,
    elements,
    tabMessages,
    runtimeMessages,
    fireDomReady() {
      if (!domReadyListener) throw new Error('popup.js 未注册 DOMContentLoaded');
      return domReadyListener();
    }
  };
}

await test('manifest：工具栏入口声明原生侧栏', () => {
  eq(manifest.action.default_popup, undefined, '工具栏点击不打开弹窗');
  eq(manifest.side_panel.default_path, 'popup/popup.html');
  assert(manifest.permissions.includes('sidePanel'));
  assert(manifest.action.default_icon && manifest.action.default_icon['128'], 'action 图标应保留');
  assert(manifest.icons && manifest.icons['128'], '扩展图标应保留');
  assert(read('popup/popup.html').includes('id="fillBtn"'), 'popup 文件应保留');
  assert(backgroundCode.includes("'content-ready.js'"), 'background 应 importScripts content-ready.js');
});

await test('manifest 配置 default_popup：background 不注册 chrome.action.onClicked', () => {
  const harness = makeActionHarness({ manifestOverride: { ...manifest, action: { ...manifest.action, default_popup: 'popup/popup.html' } } });
  eq(harness.onClickedRegistrations, 0, '配置 popup 时不得注册 onClicked');
  eq(harness.hasOnClickedListener(), false, '不应存在 onClicked 监听器');
});

await test('原生侧栏可用：工具栏设置成功后禁止 Dock 回退', async () => {
  const harness = makeActionHarness({ manifestOverride: manifest, nativePanel: true });
  await harness.trigger();
  eq(harness.panelBehaviors, [{ openPanelOnActionClick: true }]);
  eq(harness.messages, []);
});

await test('manifest 无 default_popup：onClicked 回退仍注册一次，点击后单次 showDock', async () => {
  const fallbackManifest = manifestWithoutPopup();
  const harness = makeActionHarness({ manifestOverride: fallbackManifest });
  eq(harness.onClickedRegistrations, 1, 'onClicked 只注册一次');
  eq(harness.hasOnClickedListener(), true, '回退入口应注册');
  harness.trigger();
  await waitUntil(() => harness.messages.some(message => message.action === 'showDock'));
  eq(harness.messages.filter(message => message.action === 'showDock').length, 1, 'showDock 只发送一次');
});

await test('图标点击：contentPing 已就绪时只发送一次 showDock，不补注', async () => {
  const harness = makeActionHarness();
  harness.trigger();
  await waitUntil(() => harness.messages.some(message => message.action === 'showDock'));
  eq(harness.injections, [], '不应补注');
  eq(harness.messages.filter(message => message.action === 'showDock').length, 1, 'showDock 只发送一次');
  eq(harness.messages[0].action, 'contentPing');
});

await test('明确无接收端：CSS 先于 JS 按 manifest 顺序补注，重试后 showDock 只发一次', async () => {
  let pingCount = 0;
  const harness = makeActionHarness({
    ping: ({ fail, respond }) => {
      pingCount++;
      if (pingCount === 1) fail('Could not establish connection. Receiving end does not exist.');
      else respond({ success: true, ready: true });
    }
  });
  harness.trigger();
  await waitUntil(() => harness.messages.some(message => message.action === 'showDock'));
  const expected = [['css', manifest.content_scripts[0].css[0]]]
    .concat(manifest.content_scripts[0].js.map(file => ['js', file]));
  eq(harness.injections, expected, '按 manifest 顺序补注 CSS + JS');
  eq(harness.messages.filter(message => message.action === 'showDock').length, 1, 'showDock 只发送一次');
});

await test('ping 超时：不盲注入、不发送 showDock，badge/title 报错后恢复默认', async () => {
  const harness = makeActionHarness({
    ping: ({ fail }) => fail('contentPing 等待页面应答超时')
  });
  harness.trigger();
  await waitUntil(() => harness.badgeEvents.some(event => event[0] === 'text' && event[2] === '!'));
  eq(harness.injections, [], '超时绝不补注');
  assert(!harness.messages.some(message => message.action === 'showDock'), '超时不发送 showDock');
  assert(harness.titleEvents.some(event => String(event[1]).includes('无响应')), 'title 应展示失败原因');

  harness.runLongTimers();
  const textEvents = harness.badgeEvents.filter(event => event[0] === 'text');
  assert(textEvents.some(event => event[2] === ''), '失败提示应自动清除');
  eq(harness.titleEvents.at(-1)[1], manifest.action.default_title, 'title 应恢复默认');
});

await test('message port closed：不补注、不发送 showDock', async () => {
  const harness = makeActionHarness({
    ping: ({ fail }) => fail('The message port closed before a response was received.')
  });
  harness.trigger();
  await waitUntil(() => harness.badgeEvents.some(event => event[0] === 'text' && event[2] === '!'));
  eq(harness.injections, [], 'port closed 不补注');
  assert(!harness.messages.some(message => message.action === 'showDock'), 'port closed 不发送 showDock');
});

await test('showDock 返回 success:false：按实际结果报失败，且不重发', async () => {
  const harness = makeActionHarness({
    showDockResponse: { success: false, visible: false, error: '悬浮助手尚未就绪' }
  });
  harness.trigger();
  await waitUntil(() => harness.badgeEvents.some(event => event[0] === 'text' && event[2] === '!'));
  eq(harness.messages.filter(message => message.action === 'showDock').length, 1, '不重发 showDock');
  assert(harness.titleEvents.some(event => String(event[1]).includes('尚未就绪')), '应展示页面返回的错误');
});

await test('同一 tab 快速连点：in-flight 去重，只 ping 一次、只 showDock 一次', async () => {
  const harness = makeActionHarness({ pingDelay: 30 });
  const tab = { id: 7, url: 'https://example.com/apply' };
  harness.trigger(tab);
  harness.trigger(tab);
  harness.trigger(tab);
  await waitUntil(() => harness.messages.some(message => message.action === 'showDock'));
  eq(harness.messages.filter(message => message.action === 'contentPing').length, 1, '只 ping 一次');
  eq(harness.messages.filter(message => message.action === 'showDock').length, 1, '只 showDock 一次');
});

await test('main.showDock：按 yanyuSetDockVisible 实际结果返回，失败不假成功', () => {
  const hidden = makeMainHarness({ visibility: false });
  const hiddenResponse = hidden.trigger({ action: 'showDock' }).response;
  eq(hiddenResponse, { success: false, visible: false, error: '悬浮助手尚未就绪，请刷新网页后重试' });

  const shown = makeMainHarness({ visibility: true });
  const shownResponse = shown.trigger({ action: 'showDock' }).response;
  eq(shownResponse, { success: true, visible: true });
});

await test('region-yanyu：资料选择视图复用 dock shadow，不再创建 body 独立面板', () => {
  const regionCode = read('scripts/content/region-yanyu.js');
  const dockCode = read('scripts/content/dock-yanyu.js');
  assert(!regionCode.includes('panel.id = REGION_PANEL_ID'), '不应再创建独立 #job-autofill-region-panel');
  assert(regionCode.includes('data-yy-region-view-body'), '选区视图应渲染进 dock shadow');
  assert(regionCode.includes('yanyuShowRegionView()'), '完成后应切到同一个 dock view');
  assert(regionCode.includes('runRegionFill(refs, skipped, category, entry)'), '立即填入应只调用 runRegionFill');
  assert(dockCode.includes('right:18px; bottom:18px; top:auto; left:auto;'), 'dock 默认定位应明确四轴');
  assert(!dockCode.includes(':host([data-region-active="true"]) { display:none'), '选区时不应整个 host 隐藏');
  assert(dockCode.includes("host.style.right = 'auto';") && dockCode.includes("host.style.bottom = 'auto';"), '拖动/恢复应成对清理 right/bottom');
});

await test('main.showDock：已有选区状态时只显示同一 host，不重启/清空选区', () => {
  const selectHarness = makeMainHarness();
  const selectState = { phase: 'select' };
  selectHarness.setRegionState(selectState);
  const selectResponse = selectHarness.trigger({ action: 'showDock' }).response;
  eq(selectResponse, { success: true, visible: true });
  eq(selectHarness.calls.startRegionFillFlow, 0, '不得调用 startRegionFillFlow');
  eq(selectHarness.attributes.get('data-region-active'), 'true', '框选阶段仍隐藏普通卡片');
  eq(selectHarness.calls.exitRegionFillMode, 0, '不得退出/清空选区');

  const panelHarness = makeMainHarness();
  panelHarness.setRegionState({ phase: 'panel' });
  const panelResponse = panelHarness.trigger({ action: 'showDock' }).response;
  eq(panelResponse, { success: true, visible: true });
  eq(panelHarness.calls.startRegionFillFlow, 0, '不得重启选区流程');
  eq(panelHarness.calls.yanyuShowRegionView, 1, '应复用已生成的选区资料视图');
  eq(panelHarness.calls.exitRegionFillMode, 0, '不得清空选区');
});

await test('侧栏初始化：连接资料速查，不弹出 Dock 或自动填写', async () => {
  const harness = makePopupHarness();
  await harness.fireDomReady();
  await waitUntil(() => harness.elements.get('pageStatusText')?.textContent === '页面已就绪');

  eq(harness.tabMessages.filter(message => message.action === 'contentPing').length, 1, '就绪时只 ping 一次');
  eq(harness.tabMessages.length, 1, '资料速查不从当前网页读取');
  assert(!harness.tabMessages.some(message => message.action === 'showDock'));
  assert(!harness.tabMessages.some(message => message.action === 'toggleDock'), '初始化不得使用 toggleDock');
  assert(!harness.tabMessages.some(message => ['fillForm', 'aiStepByStepFill', 'startRegionFill'].includes(message.action)), '初始化不得自动填入');
  eq(harness.elements.get('pageStatus').className, 'page-status is-ready', '成功后状态行应为 ready');
  eq(harness.runtimeMessages.filter(message => message.action === 'getAllProfiles').length, 1, '资料加载应照常执行');
});

await test('侧栏初始化：连接异常可重新连接，资料仍加载', async () => {
  const harness = makePopupHarness({
    pingResponse: { success: false }
  });
  await harness.fireDomReady();
  await waitUntil(() => harness.elements.get('pageStatus')?.className === 'page-status is-needs-action');

  eq(harness.tabMessages.filter(message => message.action === 'contentPing').length, 1);
  eq(harness.elements.get('reconnectBtn').hidden, false);
  eq(harness.runtimeMessages.filter(message => message.action === 'getAllProfiles').length, 1, '资料加载不受影响');
  await wait(20);
  eq(unhandledRejections.length, 0, '不得产生未处理 rejection');
});

await test('浏览器受限页面：侧栏保留简历，不向页面发消息', async () => {
  const harness = makePopupHarness({ tabUrl: 'chrome://extensions/' });
  await harness.fireDomReady();
  await waitUntil(() => harness.elements.get('pageStatus')?.className === 'page-status is-restricted');
  eq(harness.tabMessages.length, 0);
});

await test('全部用例结束后无未处理的 Promise rejection', async () => {
  await wait(30);
  const reasons = unhandledRejections.map(reason => (reason && reason.message) ? reason.message : String(reason));
  eq(reasons, [], '不应有 unhandledRejection');
});

console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
if (failures.length) process.exitCode = 1;
