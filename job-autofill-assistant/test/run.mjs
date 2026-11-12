#!/usr/bin/env node
// ============================================================================
// node 端单测（无第三方依赖）：node test/run.mjs
// 覆盖：
//  1. 共享简历完整度（scripts/profile-completeness.js，VM 加载）
//  2. 页面连通性编排（scripts/content-ready.js）：受限页 / ping 失败补注完整顺序+CSS /
//     有界重试 / 业务任务只发送一次 / 结构化错误
//  3. popup 真实接线（popup.js VM 加载）：注入顺序、任务单次发送、结构化状态
//  4. content script 消息协议与幂等（main.js 按 manifest 顺序 VM 加载 + 模拟重注入）
//  5. 静态守卫：HTML/manifest 引用与关键 ID 保留
// ============================================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ----------------------------------------------------------------------------
// 极简测试运行器
// ----------------------------------------------------------------------------
let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`FAIL  ${name}`);
    console.error(`      ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n      ') : err}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function eq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message || 'eq'}: expected ${b}, got ${a}`);
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ----------------------------------------------------------------------------
// VM 加载工具
// ----------------------------------------------------------------------------
function loadScript(code, sandbox, filename) {
  vm.runInContext(code, sandbox, { filename });
}

function makeContext(extra = {}) {
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    navigator: { userAgent: 'node-test' },
    ...extra
  };
  return vm.createContext(sandbox);
}

// content script 环境的 DOM / chrome mock
function makeContentDomMocks() {
  const windowListeners = {};
  const documentListeners = {};
  const document = {
    readyState: 'complete',
    body: null,
    addEventListener: (type, fn) => { (documentListeners[type] ||= []).push(fn); },
    removeEventListener: () => {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute() {},
      appendChild() {},
      addEventListener() {}
    })
  };
  const location = { href: 'https://example.com/apply', pathname: '/apply', host: 'example.com', hostname: 'example.com', origin: 'https://example.com' };
  const window = {
    addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
    removeEventListener: () => {},
    location
  };
  return { document, window, location, windowListeners, documentListeners };
}

function makeChromeMock({ runtimeListeners = [], storageListeners = [] } = {}) {
  return {
    _runtimeListeners: runtimeListeners,
    _storageListeners: storageListeners,
    runtime: {
      onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
      sendMessage: (msg, cb) => { if (cb) cb(undefined); },
      getURL: (p) => 'chrome-extension://test/' + p
    },
    storage: {
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
      local: { get: (_keys, cb) => cb && cb({}), set: (_items, cb) => cb && cb() }
    }
  };
}

// 向 content mock 派发一条 runtime 消息；返回可变状态对象（异步应答会回填 response/responded）
function dispatchMessage(chromeMock, message) {
  const state = { response: null, responded: false, async: false };
  const keepOpen = chromeMock._runtimeListeners.map((listener) => listener(message, {}, (payload) => {
    state.response = payload;
    state.responded = true;
  }));
  state.async = keepOpen.some(Boolean);
  return state;
}

// ============================================================================
console.log('\n[1] 共享简历完整度 scripts/profile-completeness.js');
// ============================================================================

const completenessCtx = makeContext();
loadScript(read('scripts/profile-completeness.js'), completenessCtx, 'profile-completeness.js');
const PC = completenessCtx.ProfileCompleteness;
assert(PC && typeof PC.computeProfileCompleteness === 'function', 'ProfileCompleteness 全局应可用');

const FULL_PROFILE = {
  basicInfo: { fullName: '张三', phone: '13800000000', email: 'z@x.com', gender: '男', birthDate: '2000-01-01', politicalStatus: '中共党员', hometown: '浙江杭州' },
  jobIntention: { expectedPosition: '前端开发', expectedCity: '杭州' },
  languageSkills: { cet6: '580' },
  education: [{ school: '浙江大学', major: '软件工程', degree: '本科' }],
  workExperience: [{ company: '字节跳动' }],
  projects: [{ name: '网申助手' }],
  skills: ['JS'],
  resumeFile: { name: 'resume.pdf' }
};

await test('检查项共 15 项，与旧 popup calculateCompleteness 对齐', () => {
  eq(PC.PROFILE_COMPLETENESS_CHECKS.length, 15, 'check count');
});

await test('空资料：0%，缺失 15 项且均带可导航 moduleKey', () => {
  const r = PC.computeProfileCompleteness({});
  eq(r.percent, 0);
  eq(r.filled, 0);
  eq(r.missing.length, 15);
  const validModules = new Set(['basic', 'intention', 'languageCertificates', 'education', 'work', 'projects', 'skills', 'parser']);
  for (const item of r.missing) {
    assert(validModules.has(item.moduleKey), `非法 moduleKey: ${item.moduleKey}`);
    assert(item.label && item.key, '缺失项必须带 key/label');
  }
  eq(PC.computeProfileCompleteness(null).percent, 0, 'null 容错');
});

await test('仅基础信息 7 项：percent = round(7/15*100) = 47', () => {
  const r = PC.computeProfileCompleteness({ basicInfo: FULL_PROFILE.basicInfo });
  eq(r.filled, 7);
  eq(r.percent, 47);
  assert(!r.missing.some((m) => m.key.startsWith('basic.')), '基础项不应缺失');
});

await test('完整资料：100%，missing 为空', () => {
  const r = PC.computeProfileCompleteness(FULL_PROFILE);
  eq(r.percent, 100);
  eq(r.missing, []);
});

await test('教育经历语义：有学校但缺学位时 majorDegree 仍缺失', () => {
  const r = PC.computeProfileCompleteness({ education: [{ school: '浙大', major: '软工', degree: '' }] });
  const keys = r.missing.map((m) => m.key);
  assert(!keys.includes('education.school'), 'school 已满足');
  assert(keys.includes('education.majorDegree'), 'major+degree 需同时满足');
});

await test('教育/工作/项目完整度忽略首条空占位，使用后续有效条目', () => {
  const r = PC.computeProfileCompleteness({
    education: [{}, { school: '浙大', major: '软工', degree: '本科' }],
    workExperience: [{}, { company: '字节跳动' }],
    projects: [{}, { name: '网申助手' }]
  });
  const keys = r.missing.map((m) => m.key);
  for (const key of ['education.school', 'education.majorDegree', 'work.company', 'projects.name']) {
    assert(!keys.includes(key), `${key} 应由第二条有效经历满足`);
  }
});

await test('语言成绩：四六级/雅思/托福任一即满足', () => {
  for (const field of ['cet4', 'cet6', 'ielts', 'toefl']) {
    const r = PC.computeProfileCompleteness({ languageSkills: { [field]: '6.5' } });
    assert(!r.missing.some((m) => m.key === 'intention.language'), `${field} 应满足语言项`);
  }
  const none = PC.computeProfileCompleteness({ languageSkills: { otherLanguages: '日语' } });
  assert(none.missing.some((m) => m.key === 'intention.language'), 'otherLanguages 不计入语言项（与旧实现一致）');
});

await test('简历源文件：resumeFile 或 attachments.resume 任一即满足', () => {
  assert(PC.computeProfileCompleteness({ resumeFile: { name: 'a.pdf' } }).filled === 1, 'resumeFile');
  assert(PC.computeProfileCompleteness({ attachments: { resume: { id: 'x' } } }).filled === 1, 'attachments.resume');
});

await test('缺失项顺序：基础信息在前，便于快捷补充', () => {
  const r = PC.computeProfileCompleteness({});
  eq(r.missing[0].key, 'basic.fullName');
});

// ============================================================================
console.log('\n[2] 连通性编排 scripts/content-ready.js');
// ============================================================================

const readyCtx = makeContext();
loadScript(read('scripts/content-ready.js'), readyCtx, 'content-ready.js');
const CR = readyCtx.ContentReady;
assert(CR && typeof CR.ensureContentReady === 'function', 'ContentReady 全局应可用');

const manifest = JSON.parse(read('manifest.json'));

await test('buildScriptPlan：按 manifest 声明顺序输出 CSS + JS 完整列表', () => {
  const plan = CR.buildScriptPlan(manifest);
  const group = manifest.content_scripts[0];
  eq(plan.cssFiles, group.css, 'css 顺序与 manifest 一致');
  eq(plan.jsFiles, group.js, 'js 顺序与 manifest 一致');
});

await test('受限 URL 判定覆盖内置页和真实扩展商店', () => {
  for (const url of ['chrome://settings', 'edge://about', 'about:blank', 'chrome-extension://abc/popup.html', 'chrome-web-store',
    'https://chromewebstore.google.com/detail/abc', 'https://chrome.google.com/webstore/detail/abc']) {
    assert(CR.isRestrictedUrl(url), `${url} 应为受限`);
  }
  for (const url of ['https://example.com', 'http://a.b/c', 'https://notchromewebstore.google.com', '', undefined]) {
    assert(!CR.isRestrictedUrl(url), `${url} 不应为受限`);
  }
});

await test('受限页：直接结构化失败 reason=restricted，绝不注入', async () => {
  let injected = 0;
  const out = await CR.ensureContentReady({
    url: 'chrome://settings',
    sendPing: async () => { throw new Error('should not ping'); },
    inject: async () => { injected++; }
  });
  assert(!out.ok && out.reason === 'restricted', 'reason 应为 restricted');
  eq(injected, 0, '受限页不注入');
});

await test('ping 首次成功：ok 且不注入', async () => {
  let injected = 0;
  const events = [];
  const out = await CR.ensureContentReady({
    url: 'https://example.com',
    sendPing: async () => ({ success: true, ready: true, version: '2.0.0' }),
    inject: async () => { injected++; },
    onEvent: (evt) => events.push(evt)
  });
  assert(out.ok && out.recovered === false, '应直接就绪');
  eq(out.version, '2.0.0');
  eq(injected, 0);
  assert(events.includes('checking'), '应发出 checking 事件');
});

await test('明确无接收端 → 补注 → 有界重试 ping 后恢复（recovered=true）', async () => {
  const calls = [];
  let attempt = 0;
  const out = await CR.ensureContentReady({
    url: 'https://example.com',
    // 前两次（首次 + 重试第 1 次）无接收端，之后就绪
    sendPing: async () => {
      attempt++;
      calls.push(`ping:${attempt}`);
      if (attempt <= 2) throw new Error('Could not establish connection. Receiving end does not exist.');
      return { success: true, ready: true };
    },
    inject: async () => { calls.push('inject'); },
    delay: async () => { calls.push('delay'); }
  });
  assert(out.ok && out.recovered === true, '应通过补注恢复');
  eq(calls[0], 'ping:1');
  eq(calls[1], 'inject', '无接收端后应立即补注');
  eq(calls.filter((c) => c === 'inject').length, 1, '注入只执行一次');
  assert(calls.includes('delay'), '重试前应有间隔');
});

await test('补注后 ping 持续失败：有界重试后结构化失败 reason=inject-not-ready', async () => {
  let pingCount = 0;
  let injectCount = 0;
  const out = await CR.ensureContentReady({
    url: 'https://example.com',
    sendPing: async () => { pingCount++; throw new Error('Receiving end does not exist'); },
    inject: async () => { injectCount++; },
    delay: async () => {}
  });
  assert(!out.ok && out.reason === 'inject-not-ready', `reason 应为 inject-not-ready，实际 ${out.reason}`);
  // 1 次首发 + INJECT_RETRY_ATTEMPTS 次重试
  eq(pingCount, 1 + CR.INJECT_RETRY_ATTEMPTS, 'ping 次数应有界');
  eq(injectCount, 1, '注入不重复执行');
  assert(out.message.includes('刷新'), '失败信息应给出行动指引');
});

await test('注入失败（权限/受限站点）：结构化 reason=inject-failed', async () => {
  const out = await CR.ensureContentReady({
    url: 'https://example.com',
    sendPing: async () => { throw new Error('Receiving end does not exist'); },
    inject: async () => { throw new Error('Cannot access contents of the page.'); },
    delay: async () => {}
  });
  assert(!out.ok && out.reason === 'inject-failed', 'reason 应为 inject-failed');
  assert(out.message.includes('权限'), '应提示权限问题');
});

await test('ping 超时（非无接收端）：不盲注入，reason=unreachable', async () => {
  let injected = 0;
  const out = await CR.ensureContentReady({
    url: 'https://example.com',
    sendPing: async () => { throw new Error('contentPing 等待页面应答超时'); },
    inject: async () => { injected++; },
    delay: async () => {}
  });
  assert(!out.ok && out.reason === 'unreachable', 'reason 应为 unreachable');
  eq(injected, 0, '超时不允许盲注入');
});

await test('message port closed 不自动补注，避免旧版与新版监听器双执行', async () => {
  assert(!CR.isMissingReceiverError(new Error('The message port closed before a response was received.')), 'port closed 不算确无接收端');
  assert(!CR.isMissingReceiverError(new Error('contentPing 等待页面应答超时')), '超时不算');
  let injected = 0;
  let tasks = 0;
  const out = await CR.runTabTask({
    url: 'https://example.com',
    sendPing: async () => { throw new Error('The message port closed before a response was received.'); },
    inject: async () => { injected++; },
    sendTask: async () => { tasks++; }
  });
  assert(!out.ok && out.reason === 'unreachable', '旧版残留脚本应要求刷新而非补注');
  eq(injected, 0, '不得让旧、新 listener 同时存在');
  eq(tasks, 0, '业务任务不得发送');
});

await test('runTabTask：就绪后业务任务只发送一次', async () => {
  let taskCount = 0;
  const out = await CR.runTabTask({
    url: 'https://example.com',
    sendPing: async () => ({ success: true, ready: true }),
    inject: async () => {},
    sendTask: async () => { taskCount++; return { success: true, result: { filledCount: 3 } }; }
  });
  assert(out.ok, '任务应成功');
  eq(taskCount, 1, '业务任务只发送一次');
  eq(out.response.result.filledCount, 3);
});

await test('runTabTask：连通失败时任务 0 次发送，且不会自动重试业务', async () => {
  let taskCount = 0;
  let injectCount = 0;
  const out = await CR.runTabTask({
    url: 'https://example.com',
    sendPing: async () => { throw new Error('Receiving end does not exist'); },
    inject: async () => { injectCount++; throw new Error('Cannot access'); },
    sendTask: async () => { taskCount++; },
    delay: async () => {}
  });
  assert(!out.ok && out.reason === 'inject-failed');
  eq(taskCount, 0, '连通失败绝不发送任务');
  eq(injectCount, 1);
});

await test('runTabTask：任务执行中通道中断 → reason=task-channel-error（不重发）', async () => {
  let taskCount = 0;
  const out = await CR.runTabTask({
    url: 'https://example.com',
    sendPing: async () => ({ success: true, ready: true }),
    inject: async () => {},
    sendTask: async () => { taskCount++; throw new Error('等待页面响应超时（30 秒）'); }
  });
  assert(!out.ok && out.reason === 'task-channel-error');
  eq(taskCount, 1, '失败后不自动重发');
});

// ============================================================================
console.log('\n[3] popup 真实接线（popup.js VM 加载 + chrome mock）');
// ============================================================================

function makePopupContext({ tabUrl = 'https://example.com/apply', pingBehavior } = {}) {
  const elementStubs = new Map();
  const fakeEl = () => ({
    textContent: '', title: '', hidden: false, className: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, insertBefore() {}, appendChild() {}, remove() {},
    querySelector: () => null, innerHTML: ''
  });
  const scriptingCalls = [];
  const sentMessages = [];
  const chrome = {
    runtime: {
      getManifest: () => manifest,
      sendMessage: (msg, cb) => { if (cb) cb(undefined); },
      lastError: undefined
    },
    tabs: {
      query: async () => [{ id: 7, url: tabUrl }],
      sendMessage: (tabId, message, cb) => {
        sentMessages.push(message);
        setTimeout(() => {
          if (message.action === 'contentPing' && pingBehavior) {
            pingBehavior({ respond: (payload) => cb(payload), fail: (errText) => { chrome.runtime.lastError = { message: errText }; cb(undefined); } });
            chrome.runtime.lastError = undefined;
            return;
          }
          cb({ success: true, result: { filledCount: 0 } });
        }, 0);
      }
    },
    scripting: {
      insertCSS: async (details) => { scriptingCalls.push(['css', details.files[0]]); },
      executeScript: async (details) => { scriptingCalls.push(['js', details.files[0]]); }
    }
  };
  const ctx = makeContext({
    chrome,
    // popup 的连通性编排会用到真实定时器（补注重试间隔 / ping 超时兜底）
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    document: {
      addEventListener() {},
      getElementById: (id) => { if (!elementStubs.has(id)) elementStubs.set(id, fakeEl()); return elementStubs.get(id); },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: fakeEl,
      body: { appendChild() {} }
    },
    window: { matchMedia: () => ({ matches: false }) },
    _sentMessages: sentMessages,
    _scriptingCalls: scriptingCalls
  });
  loadScript(read('scripts/profile-completeness.js'), ctx, 'profile-completeness.js');
  loadScript(read('scripts/content-ready.js'), ctx, 'content-ready.js');
  loadScript(read('popup/popup.js'), ctx, 'popup.js');
  return ctx;
}

await test('popup.injectContentScriptsIntoTab：真实 manifest 顺序，CSS 先于全部 JS', async () => {
  const ctx = makePopupContext();
  await ctx.injectContentScriptsIntoTab(7);
  const calls = ctx._scriptingCalls;
  eq(calls[0], ['css', 'styles/content.css'], '第一个必须是 content.css');
  eq(calls.slice(1).map((c) => c[0]).every((kind) => kind === 'js'), true, '其余全部为 js');
  eq(calls.slice(1).map((c) => c[1]), manifest.content_scripts[0].js, 'js 顺序与 manifest 完全一致');
});

await test('popup.sendTabTaskWithReady：无接收端 → 自动补注 → 任务恰好发送一次', async () => {
  let pingCount = 0;
  const ctx = makePopupContext({
    pingBehavior: ({ fail, respond }) => {
      pingCount++;
      if (pingCount === 1) fail('Receiving end does not exist');
      else respond({ success: true, ready: true });
    }
  });
  const tab = await ctx.getActiveTab();
  const outcome = await ctx.sendTabTaskWithReady(tab, { action: 'fillForm', profile: { id: 'p1' } }, 1000);
  eq(outcome.response.result.filledCount, 0);
  const pings = ctx._sentMessages.filter((m) => m.action === 'contentPing');
  const tasks = ctx._sentMessages.filter((m) => m.action === 'fillForm');
  eq(tasks.length, 1, '业务任务只发送一次');
  assert(pings.length >= 2, '补注后应有重试 ping');
  assert(ctx._scriptingCalls.length > 0, '应发生补注');
});

await test('popup.sendTabTaskWithReady：注入被拒（权限）时任务不发送且抛结构化错误', async () => {
  const ctx = makePopupContext({
    pingBehavior: ({ fail }) => fail('Receiving end does not exist')
  });
  // scripting 全部失败
  ctx.chrome.scripting.insertCSS = async () => { throw new Error('Cannot access contents of the page'); };
  ctx.chrome.scripting.executeScript = async () => { throw new Error('Cannot access contents of the page'); };
  const tab = await ctx.getActiveTab();
  let caught = null;
  try {
    await ctx.sendTabTaskWithReady(tab, { action: 'fillForm' }, 1000);
  } catch (err) {
    caught = err;
  }
  assert(caught && caught.reason === 'inject-failed', '应抛出结构化 inject-failed');
  eq(ctx._sentMessages.filter((m) => m.action === 'fillForm').length, 0, '任务未发送');
});

await test('popup.sendTabTaskWithReady：受限页直接失败且无任何注入/任务', async () => {
  const ctx = makePopupContext({ tabUrl: 'chrome://settings' });
  const tab = await ctx.getActiveTab();
  let caught = null;
  try {
    await ctx.sendTabTaskWithReady(tab, { action: 'fillForm' }, 1000);
  } catch (err) {
    caught = err;
  }
  assert(caught && caught.reason === 'restricted', '应抛出 restricted');
  eq(ctx._sentMessages.length, 0, '不发 ping 也不发任务');
  eq(ctx._scriptingCalls.length, 0);
});

// ============================================================================
console.log('\n[4] content script 消息协议与幂等（main.js + manifest 顺序加载）');
// ============================================================================

function makeContentContext() {
  const dom = makeContentDomMocks();
  const chrome = makeChromeMock();
  const ctx = makeContext({
    chrome,
    document: dom.document,
    window: dom.window,
    location: dom.location
  });
  return { ctx, dom, chrome };
}

function loadContentScripts({ ctx, dom, chrome }) {
  for (const file of manifest.content_scripts[0].js) {
    // DOM 相关初始化副作用以空实现替换，测试聚焦 main.js 的监听与幂等
    if (file === 'scripts/content/main.js') {
      ctx.cacheJobMetaFromPage = () => {};
      ctx.createFloatingButton = () => {};
    }
    loadScript(read(file), ctx, file);
  }
  void dom; void chrome;
}

await test('contentPing 应答 success/ready/version（init 即刻完成时）', async () => {
  const env = makeContentContext();
  loadContentScripts(env);
  eq(env.chrome._runtimeListeners.length, 1, '应注册恰好 1 个监听器');
  const out = dispatchMessage(env.chrome, { action: 'contentPing' });
  assert(out.responded, 'contentPing 必须同步应答');
  eq(out.response.success, true);
  eq(out.response.ready, true);
  assert(typeof out.response.version === 'string' && out.response.version, 'version 应为非空字符串');
  eq(out.response.initialized, true);
});

await test('fillForm 结果带 error（如已有任务进行中）→ success:false', async () => {
  const env = makeContentContext();
  loadContentScripts(env);
  env.ctx.fillForm = async () => ({ filledCount: 0, results: [], cancelled: true, error: '已有填充任务正在进行' });
  const out = dispatchMessage(env.chrome, { action: 'fillForm', profile: { id: 'p1' } });
  assert(out.async, 'fillForm 应异步应答');
  await tick();
  assert(out.responded, 'fillForm 必须异步应答');
  eq(out.response.success, false);
  eq(out.response.error, '已有填充任务正在进行');
});

await test('fillForm 正常结果 → success:true 且透传 mode', async () => {
  const env = makeContentContext();
  loadContentScripts(env);
  let receivedOpts = null;
  env.ctx.fillForm = async (_profile, opts) => { receivedOpts = opts; return { filledCount: 2, results: [] }; };
  const out = dispatchMessage(env.chrome, { action: 'fillForm', profile: { id: 'p1' }, mode: 'incremental' });
  await tick();
  eq(out.response.success, true);
  eq(out.response.result.filledCount, 2);
  eq(receivedOpts.mode, 'incremental', 'mode 应透传为 incremental');
});

await test('aiStepByStepFill 结果带 error → success:false（对齐 fill 协议）', async () => {
  const env = makeContentContext();
  loadContentScripts(env);
  env.ctx.aiStepByStepFill = async () => ({ count: 0, error: '选区填入正在进行中，请稍后' });
  const out = dispatchMessage(env.chrome, { action: 'aiStepByStepFill', profile: { id: 'p1' } });
  await tick();
  eq(out.response.success, false);
  eq(out.response.error, '选区填入正在进行中，请稍后');
});

await test('startRegionFill 正忙/无资料等软失败 → success:false', async () => {
  const env = makeContentContext();
  loadContentScripts(env);
  env.ctx.startRegionFillFlow = async () => ({ started: false, error: 'AI 助填正在进行中' });
  const out = dispatchMessage(env.chrome, { action: 'startRegionFill' });
  await tick();
  eq(out.response.success, false);
  eq(out.response.error, 'AI 助填正在进行中');
});

await test('startRegionFill 只有 started:true 才返回启动成功', async () => {
  const env = makeContentContext();
  loadContentScripts(env);
  env.ctx.startRegionFillFlow = async () => ({ started: true });
  const out = dispatchMessage(env.chrome, { action: 'startRegionFill' });
  await tick();
  eq(out.response.success, true);
  eq(out.response.result.started, true);
});

await test('重复注入（整组文件再次执行）：监听器/初始化均不重复', async () => {
  const env = makeContentContext();
  loadContentScripts(env);
  const loadListeners = env.chrome._runtimeListeners.length;
  const storageListeners = env.chrome._storageListeners.length;
  const windowLoad = (env.dom.windowListeners.load || []).length;

  // 模拟 popup ensureContentReady 的补注：同一隔离世界内整组重执行
  loadContentScripts(env);

  eq(env.chrome._runtimeListeners.length, loadListeners, '消息监听器不重复注册');
  eq(env.chrome._storageListeners.length, storageListeners, 'storage 监听不重复注册');
  eq((env.dom.windowListeners.load || []).length, windowLoad, 'window load 监听不重复注册');
  eq((env.dom.documentListeners.focusin || []).length, 1, 'document focusin 监听不重复注册');
  const ping = dispatchMessage(env.chrome, { action: 'contentPing' });
  eq(ping.response.success, true, '重注入后 contentPing 仍可用');
});

// ============================================================================
console.log('\n[5] 静态守卫：引用关系与关键 ID');
// ============================================================================

const popupHtml = read('popup/popup.html');
const optionsHtml = read('options/options.html');
const popupJs = read('popup/popup.js');
const optionsJs = read('options/options.js');

await test('共享脚本进入 popup/options 页面，且不进入 content manifest', () => {
  assert(popupHtml.includes('scripts/profile-completeness.js'), 'popup.html 应引入完整度脚本');
  assert(popupHtml.includes('scripts/content-ready.js'), 'popup.html 应引入连通性编排脚本');
  assert(optionsHtml.includes('scripts/profile-completeness.js'), 'options.html 应引入完整度脚本');
  const csFiles = manifest.content_scripts[0].js;
  assert(!csFiles.includes('scripts/profile-completeness.js'), '完整度脚本不应进 content');
  assert(!csFiles.includes('scripts/content-ready.js'), '编排脚本不应进 content');
});

await test('popup 旧 calculateCompleteness 已删除并委托共享实现', () => {
  assert(!/function calculateCompleteness/.test(popupJs), '旧实现应删除');
  assert(popupJs.includes('ProfileCompleteness.computeProfileCompleteness'), '应委托共享实现');
  assert(optionsJs.includes('ProfileCompleteness.computeProfileCompleteness'), 'options 也应使用共享实现');
});

await test('popup 关键 ID 全部保留（含新增 pageStatus/reconnectBtn）', () => {
  const ids = ['dockToggleBtn', 'themeToggle', 'profileDropdown', 'profileDropdownBtn', 'profileDropdownMenu',
    'selectedProfileName', 'profileSelect', 'renameProfileBtn', 'addProfileBtn', 'completeness', 'completenessBar',
    'currentProfile', 'lastUsed', 'fillBtn', 'aiFillBtn', 'regionFillBtn',
    'incrementalFillBtn', 'settingsBtn', 'taskFeedback', 'taskFeedbackText', 'exportLink', 'importLink',
    'pageStatus', 'pageStatusDot', 'pageStatusText', 'reconnectBtn'];
  for (const id of ids) {
    assert(popupHtml.includes(`id="${id}"`), `popup.html 缺少 id=${id}`);
  }
});

await test('options 关键 ID 全部保留（含右栏与工作区）', () => {
  const ids = ['profileOverview', 'moduleBackBar', 'backToOverviewBtn', 'moduleTitle', 'sidebarMenu', 'sidebarMore',
    'sidebarMoreList', 'sidebarSaveBtn', 'profileRail', 'railProfileName', 'railProfileMeta', 'navProfileGroup',
    'navProfileDropdown', 'navProfileDropdownBtn', 'navProfileDropdownMenu', 'navSelectedProfileName',
    'profileSelect', 'renameProfileBtn', 'addProfileBtn', 'saveBtn', 'saveBtn2', 'exportBackupBtn',
    'importBackupBtn', 'importBackupFile', 'deleteProfileBtn', 'themeToggle'];
  for (const id of ids) {
    assert(optionsHtml.includes(`id="${id}"`), `options.html 缺少 id=${id}`);
  }
});

await test('工作台头部包含完整度/缺失项/三个入口（委托到既有导航）', () => {
  assert(optionsJs.includes('overviewWorkbenchHtml'), '应构建工作台头部');
  assert(optionsJs.includes('data-goto-module="parser"'), '导入简历入口 → parser 模块');
  assert(optionsJs.includes('data-goto-module="basic"'), '编辑资料入口 → basic 模块');
  assert(optionsJs.includes('data-create-profile'), '工作台可新建简历');
  // [data-edit-module] 是模块卡“编辑”按钮的既定选择器（回归测试按 strict 模式取唯一元素），
  // 工作台头部与缺失项快捷不得复用该属性，避免选择器歧义
  const heroBlock = optionsJs.slice(optionsJs.indexOf('function overviewWorkbenchHtml'), optionsJs.indexOf('function renderProfileOverview'));
  assert(!heroBlock.includes('data-edit-module'), '工作台头部不应使用 data-edit-module');
});

// ----------------------------------------------------------------------------
console.log(`\n结果：${passed} 通过，${failures.length} 失败`);
if (failures.length) {
  process.exitCode = 1;
}
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED:', reason && reason.stack ? reason.stack.split('\n').slice(0, 4).join('\n') : reason);
});
