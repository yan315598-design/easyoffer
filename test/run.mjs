#!/usr/bin/env node
/**
 * 扩展上线前静态检查 + 单测
 * 运行：node test/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT, EXT, FIXTURES, read, exists, stripJs, declaredFunctions, classMethods,
  htmlIds, getElementByIds, loadScript, writeDocxFixture, makeChromeStorage,
  contentModuleSources
} from './helpers.mjs';

const results = [];
let failed = 0;

function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail) {
  failed += 1;
  results.push({ name, pass: false, detail });
  console.log(`  FAIL  ${name}`);
  console.log(`        ${String(detail).split('\n').join('\n        ')}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

const BUILTINS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void',
  'Promise', 'JSON', 'Date', 'Math', 'Number', 'String', 'Boolean', 'Array', 'Object',
  'Map', 'Set', 'WeakMap', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'fetch', 'btoa', 'atob', 'Blob', 'File', 'FileReader', 'URL',
  'Uint8Array', 'DataView', 'TextDecoder', 'TextEncoder', 'AbortController',
  'OffscreenCanvas', 'DecompressionStream', 'Response', 'Headers', 'Request',
  'console', 'chrome', 'document', 'window', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'confirm', 'prompt', 'alert', 'open',
  'parseFloat', 'unescape', 'escape', 'eval', 'isFinite',
  'resumeParser', 'storageManager', 'pdfjsLib', 'customElements',
  'HTMLElement', 'Event', 'CustomEvent', 'MutationObserver', 'IntersectionObserver',
  'ResizeObserver', 'CSS', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame',
  'cancelAnimationFrame', 'structuredClone', 'crypto', 'Intl', 'Proxy', 'Reflect',
  'Symbol', 'BigInt', 'WeakSet', 'ArrayBuffer', 'DataView', 'Float32Array',
  'Image', 'Option', 'DOMParser', 'XMLSerializer', 'FormData', 'URLSearchParams',
  'Worker', 'BroadcastChannel', 'MessageChannel', 'performance', 'atob',
  'CSSStyleSheet', 'ShadowRoot', 'Node', 'NodeFilter'
]);

function missingLocalCalls(js, extraKnown = []) {
  const known = new Set([...declaredFunctions(js), ...extraKnown, ...BUILTINS]);
  const stripped = stripJs(js).replace(/\basync\s+function\b/g, ' function ').replace(/\basync\s*\(/g, ' (');
  const missing = new Map();
  for (const match of stripped.matchAll(/(?<![.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (known.has(name) || BUILTINS.has(name)) continue;
    if (!/^[a-z][A-Za-z0-9]{3,}$/.test(name)) continue;
    if (['resolve', 'reject'].includes(name)) continue;
    missing.set(name, (missing.get(name) || 0) + 1);
  }
  return [...missing.entries()];
}

// ---------------------------------------------------------------------------
section('语法与清单');

const CONTENT_MODULE_FILES = contentModuleSources(); // manifest 声明的 content 模块顺序
for (const rel of [
  'scripts/profile-schema.js',
  'scripts/profile-create-dialog.js',
  'scripts/attachments.js',
  'scripts/resume-parser.js',
  'scripts/storage.js',
  'scripts/background.js',
  ...CONTENT_MODULE_FILES,
  'options/options.js',
  'options/app-shell.js',
  'options/product-demo.js',
  'options/tracker.js',
  'popup/sidebar.js',
  'popup/popup.js'
]) {
  const r = spawnSync(process.execPath, ['--check', path.join(EXT, rel)], { encoding: 'utf8' });
  if (r.status === 0) ok(`syntax ${rel}`);
  else fail(`syntax ${rel}`, r.stderr || r.stdout);
}

try {
  const manifest = JSON.parse(read('manifest.json'));
  if (manifest.manifest_version !== 3) fail('manifest v3', 'manifest_version != 3');
  else ok('manifest v3');
  const files = [
    manifest.action?.default_popup,
    manifest.side_panel?.default_path,
    manifest.options_page,
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ].filter(Boolean);
  const missingFiles = files.filter((f) => !exists(f));
  if (missingFiles.length) fail('manifest 引用文件存在', missingFiles.join(', '));
  else ok('manifest 引用文件存在', `${files.length} 个路径`);
  for (const extra of ['vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js', 'vendor/pdfjs/cmaps/Adobe-GB1-UCS2.bcmap', 'scripts/storage.js', 'scripts/resume-parser.js']) {
    if (exists(extra)) ok(`资源 ${extra}`);
    else fail(`资源 ${extra}`, '文件不存在');
  }
} catch (e) {
  fail('manifest.json 可解析', e.message);
}

// ---------------------------------------------------------------------------
section('HTML id 与脚本引用');

function checkPage(htmlRel, jsRel) {
  const html = read(htmlRel);
  const js = read(jsRel);
  const ids = htmlIds(html);
  const used = getElementByIds(js);
  if (jsRel === 'options/options.js') {
    const shell = read('options/app-shell.js');
    if (shell.includes("check.id='backupIncludeKey'")) ids.add('backupIncludeKey');
    if (js.includes("section.id = 'section-'+key") && js.includes('host.append(section)')) {
      for (const key of ['introduction','aiTools','modules']) {
        if (js.includes("['" + key + "',")) ids.add('section-'+key);
      }
    }
  }
  const missing = [...new Set(used)].filter((id) => !ids.has(id));
  // optional chaining getElementById('x')?. is still required to exist if we want UI
  if (missing.length) fail(`${htmlRel} 缺少 id`, missing.join(', '));
  else ok(`${jsRel} 用到的 id 都在 ${htmlRel}`, `${used.length} 处引用`);
}

checkPage('options/options.html', 'options/options.js');
checkPage('popup/popup.html', 'popup/popup.js');

for (const rel of ['options/options.html', 'popup/popup.html']) {
  const html = read(rel);
  const srcs = [...html.matchAll(/<(?:script|link|img)[^>]+(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]);
  const broken = srcs.filter((src) => {
    if (src.startsWith('http') || src.startsWith('data:')) return false;
    const from = path.join(EXT, path.dirname(rel), src);
    return !fs.existsSync(from);
  });
  if (broken.length) fail(`${rel} 静态资源`, broken.join(', '));
  else ok(`${rel} 静态资源存在`);
}

// ---------------------------------------------------------------------------
section('后台消息与方法是否对得上');

const backgroundJs = read('scripts/background.js');
const storageJs = read('scripts/storage.js');
const parserJs = read('scripts/resume-parser.js');
const optionsJs = read('options/options.js');
const popupJs = read('popup/popup.js');
const sidebarJs = read('popup/sidebar.js');
const contentJs = CONTENT_MODULE_FILES.map((rel) => read(rel)).join('\n'); // content.js 已模块化，按 manifest 顺序拼接扫描

const handledActions = new Set([...backgroundJs.matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]));
for (const [, action] of contentJs.matchAll(/request\.action === '([^']+)'/g)) handledActions.add(action);
handledActions.add('getEditorIdentity'); // 在 onMessage 入口直接回 documentId，供导出/导入前落盘
const sentActions = new Set();
for (const js of [optionsJs, popupJs, sidebarJs, contentJs]) {
  for (const m of js.matchAll(/action:\s*'([^']+)'/g)) sentActions.add(m[1]);
}
const unknownActions = [...sentActions].filter((a) => !handledActions.has(a));
if (unknownActions.length) fail('未处理的 runtime action', unknownActions.join(', '));
else ok('前台发出的 action 后台都有处理', [...sentActions].join(', '));

const storageMethods = classMethods(storageJs, 'StorageManager');
const parserMethods = classMethods(parserJs, 'ResumeParser');
const requiredParser = [
  'parseFileWithAI', 'parseWithAI', 'parseAIResponse', 'listModels',
  'testConnection', 'generateHrGreeting', 'isSupported',
  'extractText', 'fetchJsonRetry', 'isBusyError'
];
const missingParser = requiredParser.filter((n) => !parserMethods.has(n));
if (missingParser.length) fail('ResumeParser 必要方法', missingParser.join(', '));
else ok('ResumeParser 必要方法齐全');

const requiredStorage = [
  'initialize', 'getActiveProfile', 'getAllProfiles', 'addProfile', 'updateProfile',
  'deleteProfile', 'setActiveProfile', 'getSettings', 'updateSettings',
  'getSubmissions', 'addSubmission', 'updateSubmission', 'deleteSubmission',
  'exportData', 'importData'
];
const missingStorage = requiredStorage.filter((n) => !storageMethods.has(n));
if (missingStorage.length) fail('StorageManager 必要方法', missingStorage.join(', '));
else ok('StorageManager 必要方法齐全');

const parserCalls = [...optionsJs.matchAll(/resumeParser\.(\w+)/g)].map((m) => m[1]);
const missingParserCalls = [...new Set(parserCalls)].filter((n) => !parserMethods.has(n));
if (missingParserCalls.length) fail('options.js 调用了不存在的 parser 方法', missingParserCalls.join(', '));
else ok('options.js 的 resumeParser.* 都能对上');

const storageCalls = [...backgroundJs.matchAll(/storageManager\.(\w+)/g)].map((m) => m[1]);
const missingStorageCalls = [...new Set(storageCalls)].filter((n) => !storageMethods.has(n));
if (missingStorageCalls.length) fail('background.js 调用了不存在的 storage 方法', missingStorageCalls.join(', '));
else ok('background.js 的 storageManager.* 都能对上');

for (const [label, js] of [['options.js', optionsJs], ['popup.js', popupJs]]) {
  // 配置页在 options.js 之前加载共享资料工具。
  const globals = label === 'options.js' ? ['sendMessage', 'mergeProfile', 'chooseNewProfile', 'familyResidence',
    'profileLanguageEntries', 'languageEntryExam', 'languageScoreKey'] : ['sendMessage', 'chooseNewProfile'];
  const miss = missingLocalCalls(js, globals);
  if (miss.length) fail(`${label} 可能未定义的函数调用`, miss.map(([n, c]) => `${n}×${c}`).join(', '));
  else ok(`${label} 未见漏定义的本地函数调用`);
}

if (!optionsJs.includes('function debouncedSave')) fail('debouncedSave 已定义', 'options.js 中找不到 function debouncedSave');
else ok('debouncedSave 已定义');

if ((optionsJs.match(/function saveProfile/g) || []).length !== 1) {
  fail('saveProfile 唯一定义', '重复或缺失');
} else ok('saveProfile 唯一定义');

// ---------------------------------------------------------------------------
section('简历解析器');

const parser = loadScript('scripts/resume-parser.js').resumeParser;
if (!parser) fail('加载 resumeParser', 'vm 中没有 resumeParser');
else ok('加载 resumeParser');

const sampleText = fs.readFileSync(path.join(FIXTURES, 'sample-resume.txt'), 'utf8');

try {
  const parsed = parser.parseAIResponse(`这是一份优秀的简历
\`\`\`json
{
  "basicInfo": {
    "fullName": "张子涵",
    "phone": "(+86) 138-1234-5678",
    "email": "zihan.zhang_dev@example.com",
    "github": "github.com/zihan-dev-test",
    "city": "北京"
  },
  "education": [{"school":"北京航空航天大学","major":"计算机科学与技术","degree":"硕士","description":"班长；会议论文一篇；一等奖学金（2次）"}],
  "workExperience": [{"company":"字节跳动","position":"后端开发实习生"}],
  "projects": [{"name":"智能简历解析助手"}],
  "skills": ["Python", "FastAPI"],
  "hrGreeting": "您好，我是张子涵"
}
\`\`\`
`);
  if (parsed.basicInfo.fullName !== '张子涵') throw new Error('姓名未解析');
  if (parsed.basicInfo.phone !== '13812345678') throw new Error('手机号未清洗: ' + parsed.basicInfo.phone);
  if (parsed.basicInfo.lastName || parsed.basicInfo.firstName) throw new Error('未标注姓/名时不应自动拆分');
  if (!parsed.education[0].school.includes('航空')) throw new Error('教育经历丢失');
  if (parsed.education[0].description !== '班长；会议论文一篇；一等奖学金（2次）') throw new Error('教育补充信息丢失');
  if (parsed.education[0].degreeType !== '') throw new Error('未提供的培养方式必须留空');
  if (parsed.hrGreeting !== undefined) throw new Error('提取结果不应再包含 hrGreeting');
  ok('parseAIResponse 能从混杂文本抽出 JSON 并清洗');
} catch (e) {
  fail('parseAIResponse', e.message);
}

try {
  parser.parseAIResponse('这是一份优秀的简历，包含姓名张子涵，没有json');
  fail('纯文本应判定为 JSON 失败', '没有抛错');
} catch (e) {
  if (/JSON|解析/i.test(e.message)) ok('纯文本会被拒绝');
  else fail('纯文本应判定为 JSON 失败', e.message);
}

try {
  const think = parser.parseAIResponse('<think>先分析一下</think>{"basicInfo":{"fullName":"李雷","phone":"13900001111"}}');
  if (think.basicInfo.fullName !== '李雷') throw new Error(JSON.stringify(think.basicInfo));
  ok('能去掉 <think> 再解析 JSON');
} catch (e) {
  fail('think 标签', e.message);
}

try {
  const repaired = parser.parseAIResponse(`{
    "basicInfo": {"fullName": "王五", "phone": "13700001111"},
    "skills": ["Python"
    "Docker"],
    "education": [{"school":"清华"}
    {"school":"北大"}]
  }`);
  if (repaired.basicInfo.fullName !== '王五') throw new Error('姓名');
  if (!repaired.skills.includes('Python') || !repaired.skills.includes('Docker')) throw new Error('skills ' + repaired.skills);
  if (repaired.education.length < 2) throw new Error('education len ' + repaired.education.length);
  ok('能修复数组元素缺逗号的 JSON');
} catch (e) {
  fail('缺逗号 JSON 修复', e.message);
}

try {
  if (!parser.isSupported({ name: 'a.pdf', type: 'application/pdf' })) throw new Error('pdf');
  if (!parser.isSupported({ name: 'a.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })) throw new Error('docx');
  if (!parser.isSupported({ name: 'shot.png', type: 'image/png' })) throw new Error('png');
  if (!parser.isSupported({ name: 'note.md', type: 'text/markdown' })) throw new Error('md');
  if (parser.canSendFileDirect({ aiProvider: 'gemini', aiModel: 'gemini-2.0-flash' }, { name: 'a.pdf', type: 'application/pdf' }) !== true) {
    throw new Error('gemini 应能直读 pdf');
  }
  if (parser.canSendFileDirect({ aiProvider: 'deepseek', aiModel: 'deepseek-chat' }, { name: 'a.pdf', type: 'application/pdf' })) {
    throw new Error('deepseek 不应直读 pdf');
  }
  ok('文件类型路由');
} catch (e) {
  fail('文件类型路由', e.message);
}

try {
  const geminiProvider = { id: 'gemini', gemini: true, url: 'https://proxy.example.com' };
  const customUrl = parser.buildGeminiUrl(geminiProvider, { aiApiKey: 'secret_key' }, 'gemini-1.5-pro');
  if (!customUrl.startsWith('https://proxy.example.com/v1beta/models/gemini-1.5-pro:generateContent?key=secret_key')) {
    throw new Error('反代 URL 构建异常: ' + customUrl);
  }
  const defaultUrl = parser.buildGeminiUrl({ id: 'gemini', gemini: true }, { aiApiKey: 'secret_key' }, 'gemini-1.5-flash');
  if (!defaultUrl.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent')) {
    throw new Error('默认官方 URL 异常: ' + defaultUrl);
  }
  const modelsProxy = parser.toModelsUrl('https://proxy.example.com', 'gemini');
  if (modelsProxy !== 'https://proxy.example.com/v1beta/models') {
    throw new Error('Gemini 模型列表反代 URL 异常: ' + modelsProxy);
  }
  ok('Gemini 反代 Base URL 与模型列表地址解析');
} catch (e) {
  fail('Gemini 反代 URL', e.message);
}

try {
  const greetingParser = loadScript('scripts/resume-parser.js').resumeParser;
  greetingParser.chat = async (_settings, messages) => {
    const prompt = messages.map(m => m.content).join('\n');
    if (prompt.includes('data:application/pdf') || prompt.includes('ATTACHMENT_BYTES')) throw new Error('附件被发送到自荐语模型');
    if (!prompt.includes('测试同学')) throw new Error('结构化资料丢失');
    return '您好，我是测试同学';
  };
  const greeting = await greetingParser.generateHrGreeting({ basicInfo: { fullName: '测试同学' }, resumeFile: 'data:application/pdf;base64,ATTACHMENT_BYTES' }, { aiEnabled: true, aiApiKey: 'test' });
  if (!greeting.includes('测试同学')) throw new Error('自荐语未返回');
  ok('自荐语生成保留资料并排除 PDF 附件');
} catch (e) {
  fail('自荐语附件隔离', e.message);
}

try {
  const file = new File([sampleText], 'resume.txt', { type: 'text/plain' });
  const extracted = await parser.extractText(file);
  if (!extracted.includes('张子涵')) throw new Error(extracted.slice(0, 80));
  ok('extractText 纯文本');
} catch (e) {
  fail('extractText 纯文本', e.message);
}

try {
  const docxPath = path.join(FIXTURES, 'sample.docx');
  writeDocxFixture(docxPath);
  const buf = fs.readFileSync(docxPath);
  const file = new File([buf], 'sample.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  const text = await parser.extractText(file);
  if (!text.includes('张子涵') || !text.includes('13812345678')) {
    throw new Error('抽取结果: ' + JSON.stringify(text).slice(0, 200));
  }
  ok('extractText DOCX');
} catch (e) {
  fail('extractText DOCX', e.message);
}

try {
  const latex = `\\documentclass{article}\\begin{document}姓名：王五 手机：13700001111\\end{document}`;
  const file = new File([latex], 'cv.tex', { type: 'text/plain' });
  const text = await parser.extractText(file);
  if (!text.includes('王五')) throw new Error(text);
  ok('extractText LaTeX/文本');
} catch (e) {
  fail('extractText LaTeX/文本', e.message);
}

try {
  const busy = new Error('Gemini API 错误 (503): {"error":{"status":"UNAVAILABLE","message":"high demand"}}');
  if (!parser.isBusyError(busy)) throw new Error('503 应视为繁忙');
  if (!parser.isBusyError(new Error('Failed to fetch'))) throw new Error('Failed to fetch 应重试');
  if (parser.isBusyError(new Error('API Key 无效'))) throw new Error('401 不应当繁忙');
  const msg = parser.formatApiError('Gemini', 503, '{"error":{"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
  if (!/繁忙|拥挤/.test(msg)) throw new Error(msg);
  if (/UNAVAILABLE/.test(msg) && /\{/.test(msg)) {
    // 允许不含原始 JSON
  }
  if (msg.includes('"status"')) throw new Error('用户可见错误不该是整段 JSON: ' + msg);
  ok('繁忙错误分类与提示');
} catch (e) {
  fail('繁忙错误分类与提示', e.message);
}

try {
  let calls = 0;
  const origFetch = parser.fetchJsonRetry.bind(parser);
  const fakeParserCtxFetch = async () => {
    calls += 1;
    if (calls < 3) {
      return {
        ok: false,
        status: 503,
        text: async () => '{"error":{"message":"high demand","status":"UNAVAILABLE"}}'
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '{"hello":1}'
    };
  };
  // monkeypatch global fetch used inside vm? parser.fetchJsonRetry uses fetch from vm context.
  // Re-load with custom fetch.
  let n = 0;
  const p2 = loadScript('scripts/resume-parser.js', {
    fetch: async () => {
      n += 1;
      if (n < 3) {
        return {
          ok: false,
          status: 503,
          text: async () => '{"error":{"message":"high demand","status":"UNAVAILABLE"}}'
        };
      }
      return { ok: true, status: 200, text: async () => '{"ok":true}' };
    }
  }).resumeParser;
  const data = await p2.fetchJsonRetry('https://example.com', { method: 'POST' }, 'Gemini');
  if (!data.ok) throw new Error(JSON.stringify(data));
  if (n !== 3) throw new Error('应重试到第 3 次, actual=' + n);
  ok('fetchJsonRetry 对 503 退避重试', `请求 ${n} 次后成功`);
} catch (e) {
  fail('fetchJsonRetry 503', e.message);
}

try {
  const p3 = loadScript('scripts/resume-parser.js', {
    fetch: async () => { throw new TypeError('Failed to fetch'); }
  }).resumeParser;
  try {
    await p3.fetchJsonRetry('https://example.com', {}, 'Gemini');
    throw new Error('应当抛错');
  } catch (e) {
    if (e.message === '应当抛错') throw e;
    if (!/限流|网络/.test(e.message)) throw new Error(e.message);
  }
  ok('Failed to fetch 转成可读错误');
} catch (e) {
  fail('Failed to fetch 转成可读错误', e.message);
}

try {
  const p4 = loadScript('scripts/resume-parser.js', {
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          basicInfo: { fullName: '张子涵', phone: '13812345678', email: 'a@b.com' },
          education: [{ school: '北航', major: '计科', degree: '硕士' }],
          workExperience: [],
          projects: [],
          skills: ['Python']
        }) } }]
      })
    })
  }).resumeParser;
  const file = new File([sampleText], 'resume.txt', { type: 'text/plain' });
  const result = await p4.parseFileWithAI(file, {
    aiEnabled: true,
    aiApiKey: 'sk-test',
    aiProvider: 'deepseek',
    aiModel: 'deepseek-chat'
  });
  if (result.inputMode !== 'text') throw new Error('txt 应变为文字模式, got ' + result.inputMode);
  if (result.data.basicInfo.fullName !== '张子涵') throw new Error('未写入解析结果');
  if (!result.extractedText.includes('张子涵')) throw new Error('未保留抽取文本');
  ok('parseFileWithAI 文本文件走本地抽取再解析');
} catch (e) {
  fail('parseFileWithAI 文本回退', e.stack || e.message);
}

try {
  let geminiCalls = 0;
  const p5 = loadScript('scripts/resume-parser.js', {
    fetch: async (url) => {
      geminiCalls += 1;
      return {
        ok: false,
        status: 503,
        text: async () => '{"error":{"message":"high demand","status":"UNAVAILABLE"}}'
      };
    }
  }).resumeParser;
  const file = new File([new Uint8Array([37, 80, 68, 70])], 'scan.pdf', { type: 'application/pdf' });
  try {
    await p5.parseDirectFile(file, {
      aiEnabled: true,
      aiApiKey: 'sk-test',
      aiProvider: 'gemini',
      aiModel: 'gemini-2.0-flash'
    });
    throw new Error('503 应当失败');
  } catch (e) {
    if (e.message === '503 应当失败') throw e;
    if (!/繁忙|拥挤/.test(e.message)) throw new Error(e.message);
  }
  if (geminiCalls < 2) throw new Error('直读 503 应有重试, calls=' + geminiCalls);
  ok('Gemini 直读 503 会重试并给出中文繁忙提示', `请求 ${geminiCalls} 次`);
} catch (e) {
  fail('Gemini 直读 503', e.message);
}

// ---------------------------------------------------------------------------
section('存储');

try {
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  const data = await sm.initialize();
  if (!data.profiles?.length) throw new Error('未创建默认资料');
  if (!data.settings) throw new Error('缺少 settings');
  const profile = await sm.getActiveProfile();
  if (!profile.basicInfo || !Array.isArray(profile.education)) throw new Error('默认资料结构不完整');
  await sm.updateProfile(profile.id, { basicInfo: { ...profile.basicInfo, fullName: '测试用户' } });
  const again = await sm.getActiveProfile();
  if (again.basicInfo.fullName !== '测试用户') throw new Error('更新未生效');
  const sid = await sm.addSubmission({ company: '字节', position: '后端', status: '在投' });
  const list = await sm.getSubmissions();
  if (!list.length) throw new Error('投递记录未写入');
  const exported = await sm.exportData();
  JSON.parse(exported);
  ok('storage 初始化/更新/投递/导出');
} catch (e) {
  fail('storage', e.stack || e.message);
}

try {
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  await sm.initialize();
  const profiles = await sm.getAllProfiles();
  const id = profiles[0].id;
  await sm.addEducation(id);
  await sm.addWorkExperience(id);
  await sm.addProject(id);
  const p = await sm.getActiveProfile();
  if (p.education.length < 2) throw new Error('教育条数 ' + p.education.length);
  ok('动态添加教育/工作/项目');
} catch (e) {
  fail('动态添加经历', e.message);
}

try {
  const ctx = loadScript('scripts/storage.js');
  const smDebounce = ctx.storageManager;
  let saveCount = 0;
  let savedData = null;
  smDebounce.saveAll = async (d) => {
    saveCount++;
    savedData = d;
    return true;
  };
  smDebounce.saveDebounceDelay = 10;
  const p1 = smDebounce.saveAllDebounced({ val: 1 });
  const p2 = smDebounce.saveAllDebounced({ val: 2 });
  const [r1, r2] = await Promise.all([p1, p2]);
  if (saveCount !== 1) throw new Error('防抖未生效，调用次数: ' + saveCount);
  if (savedData?.val !== 2) throw new Error('未保存最新数据: ' + JSON.stringify(savedData));
  if (r1 !== true || r2 !== true) throw new Error('排队 Promise 解决异常');
  ok('saveAllDebounced 多次排队 Promise 解决与最新数据保存');
} catch (e) {
  fail('saveAllDebounced 排队', e.message);
}

// ---------------------------------------------------------------------------
section('内容脚本与弹窗脚本可加载');

const fakeElement = () => ({
  style: {},
  dataset: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  innerHTML: '',
  textContent: '',
  value: '',
  appendChild() {},
  append() {},
  prepend() {},
  remove() {},
  setAttribute() {},
  getAttribute: () => null,
  removeAttribute() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  querySelector: () => fakeElement(),
  querySelectorAll: () => [],
  closest: () => null,
  contains: () => false,
  focus() {},
  blur() {},
  click() {},
  insertAdjacentHTML() {},
  getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
});
const fakeDoc = {
  readyState: 'complete',
  body: { appendChild() {} },
  documentElement: { getAttribute: () => 'dark', setAttribute() {} },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => fakeElement(),
  addEventListener() {}
};
const fakeWindow = {
  location: { href: 'https://www.example.com/job/detail/123.html', hostname: 'www.example.com' },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  scrollTo() {},
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  innerWidth: 1280,
  innerHeight: 800,
  getComputedStyle: () => ({ getPropertyValue: () => '' })
};

try {
  loadScript('scripts/content.js', {
    document: fakeDoc,
    window: fakeWindow
  });
  ok('content.js 可在空页面上下文加载');
} catch (e) {
  fail('content.js 加载', e.message);
}

try {
  const ctx = loadScript('scripts/content.js', { document: fakeDoc, window: fakeWindow });
  const hooks = ctx.__CAPYBARA_SMART_FILL_TEST_HOOKS__;
  if (!hooks || !hooks.smartFillMatchOptionText || !hooks.buildSmartFillProfileDigest) {
    throw new Error('content.js 未导出 __CAPYBARA_SMART_FILL_TEST_HOOKS__');
  }
  const { smartFillMatchOptionText, buildSmartFillProfileDigest } = hooks;

  // —— AI 智能补填：select 选项匹配容差 ——
  if (smartFillMatchOptionText(['未婚', '已婚'], ' 已婚 ') !== '已婚') throw new Error('首尾空白容差失败');
  if (smartFillMatchOptionText(['本科（全日制）'], '本科(全日制)') !== '本科（全日制）') throw new Error('全半角容差失败');
  if (smartFillMatchOptionText(['硕士 研究生', '博士研究生'], '硕士研究生') !== '硕士 研究生') throw new Error('选项内空白容差失败');
  if (smartFillMatchOptionText(['硕士研究生', '博士研究生'], '硕士') !== '硕士研究生') throw new Error('前缀匹配失败');
  if (smartFillMatchOptionText(['Beijing', 'Shanghai'], 'BEIJING') !== 'Beijing') throw new Error('大小写容差失败');
  if (smartFillMatchOptionText(['未婚', '已婚'], '离异') !== null) throw new Error('无匹配应返回 null');
  if (smartFillMatchOptionText([], 'x') !== null) throw new Error('空选项应返回 null');
  if (smartFillMatchOptionText(['未婚'], '') !== null) throw new Error('空取值应返回 null');
  if (smartFillMatchOptionText(['未婚'], null) !== null) throw new Error('null 取值应返回 null');
  ok('AI 智能补填 select 选项匹配容差');

  // —— AI 智能补填：资料摘要生成 ——
  const profile = {
    basicInfo: { fullName: '张子涵', phone: '', email: 'zihan@example.com', gender: '男', idCard: '110101200001011234', politicalStatus: '中共党员' },
    education: [{ school: '北京航空航天大学', college: '计算机学院', major: '计算机科学与技术', degree: '硕士', startDate: '2023-09', endDate: '2026-06', gpa: '3.8/4.0', rank: '前5%', courses: '操作系统, 计算机网络' }],
    workExperience: [{ company: '字节跳动', position: '后端开发实习生', startDate: '2025-06', endDate: '2025-09', description: 'W'.repeat(300) }],
    projects: [{ name: '智能简历解析助手', role: '独立开发', startDate: '2024-03', endDate: '2024-09', responsibilities: 'R'.repeat(300) }],
    awards: [{ name: '国家奖学金', level: '国家级', date: '2024-11' }],
    certificates: [{ name: 'CET-6', code: '123', issuer: '教育部', date: '2022-06' }],
    familyMembers: [{ name: '张父', relation: '父亲', employer: '某某公司', position: '职员', phone: '13800000000' }],
    languageSkills: { cet4: '', cet6: '560' },
    commonAnswers: { selfEvaluation: 'S'.repeat(500), gameExperience: '' },
    jobIntention: { expectedCity: '北京', expectedPosition: '后端开发工程师' }
  };
  const digestText = buildSmartFillProfileDigest(profile);
  if (digestText.length > 3000) throw new Error('摘要超过 3000 字: ' + digestText.length);
  const digest = JSON.parse(digestText);
  if (digest.basicInfo.fullName !== '张子涵' || digest.basicInfo.politicalStatus !== '中共党员') throw new Error('basicInfo 丢失');
  if ('phone' in digest.basicInfo) throw new Error('空字段应被剔除');
  if (digest.education[0].school !== '北京航空航天大学') throw new Error('教育经历丢失');
  if (digest.workExperience[0].description.length > 100) throw new Error('工作职责未截断到 100 字');
  if (digest.projects[0].responsibilities.length > 100) throw new Error('项目职责未截断到 100 字');
  if (digest.familyMembers[0].name !== '张父') throw new Error('家庭成员丢失');
  if (digest.languageSkills.cet4 !== undefined || digest.languageSkills.cet6 !== '560') throw new Error('语言能力处理错误');
  if (digest.commonAnswers.selfEvaluation.length > 120) throw new Error('自我评价未截断');
  if (digest.commonAnswers.gameExperience !== undefined) throw new Error('空 commonAnswers 应被剔除');

  // —— 超大资料触发预算压缩：basicInfo/education 不能被裁掉 ——
  const fat = structuredClone(profile);
  fat.projects = Array.from({ length: 12 }, (_, i) => ({ name: `项目${i}`, role: '开发', startDate: '2024-01', endDate: '2024-06', responsibilities: 'R'.repeat(100), description: 'D'.repeat(200) }));
  fat.workExperience = Array.from({ length: 8 }, (_, i) => ({ company: `公司${i}`, position: '工程师', startDate: '2024-01', endDate: '2024-06', description: 'W'.repeat(100) }));
  fat.awards = Array.from({ length: 40 }, (_, i) => ({ name: `奖项${i}`, level: '校级', date: '2024-01' }));
  fat.commonAnswers = { selfEvaluation: 'S'.repeat(120), careerGoal: 'G'.repeat(120), hobbies: 'H'.repeat(120), strengthsWeaknesses: 'T'.repeat(120) };
  const fatDigest = buildSmartFillProfileDigest(fat);
  if (fatDigest.length > 3000) throw new Error('超大资料未压缩到 3000 字内: ' + fatDigest.length);
  const parsedFat = JSON.parse(fatDigest);
  if (!parsedFat.basicInfo || !parsedFat.education?.length) throw new Error('压缩时把高优先级资料裁掉了');
  ok('AI 智能补填 资料摘要生成与 3000 字预算压缩');
} catch (e) {
  fail('AI 智能补填纯函数', e.message);
}

try {
  const { buildSmartFillProfileDigest: digestOf } = loadScript('scripts/content.js', { document: fakeDoc, window: fakeWindow }).__CAPYBARA_SMART_FILL_TEST_HOOKS__;
  // —— 超长 basicInfo：丢弃区块救不了，必须靠字段级压缩保持合法 JSON ——
  const longInfo = {
    basicInfo: Object.fromEntries(['fullName', 'email', 'gender', 'idCard', 'politicalStatus', 'ethnicity', 'hometown',
      'address', 'street', 'city', 'state', 'country', 'zipCode', 'location', 'linkedin', 'github', 'website',
      'maritalStatus', 'currentCity', 'birthDate', 'graduationDate'].map((key) => [key, '超'.repeat(300)]))
  };
  const longText = digestOf(longInfo);
  if (longText.length > 3000) throw new Error('超长 basicInfo 未压到 3000 字内: ' + longText.length);
  const parsedLong = JSON.parse(longText);
  if (!parsedLong.basicInfo || !parsedLong.basicInfo.fullName) throw new Error('超长 basicInfo 压缩后丢失');
  const allValues = [];
  (function collect(node) {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') Object.values(node).forEach(collect);
    else if (typeof node === 'string') allValues.push(node);
  })(parsedLong);
  if (allValues.some((v) => v.length > 80)) throw new Error('字段级截断未生效');
  ok('AI 智能补填 超长 basicInfo 摘要保持合法 JSON');
} catch (e) {
  fail('AI 智能补填 超长摘要', e.message);
}

// ---------------------------------------------------------------------------
// AI 智能补填：字段收集/解析回归（极简 DOM，覆盖 P0/P1 审查项）
// ---------------------------------------------------------------------------

const fakeGlobals = {
  getComputedStyle: () => ({ visibility: 'visible', display: 'block', getPropertyValue: () => '' }),
  location: { hostname: 'www.example.com', href: 'https://www.example.com/apply' },
  CSS: { escape: (s) => s },
  Event: class Event { constructor(type) { this.type = type; } },
  InputEvent: class InputEvent { constructor(type, init) { this.type = type; this.init = init; } },
  MouseEvent: class MouseEvent { constructor(type) { this.type = type; } },
  HTMLInputElement: class HTMLInputElement {},
  HTMLTextAreaElement: class HTMLTextAreaElement {},
  HTMLSelectElement: class HTMLSelectElement {}
};

// 极简选择器引擎：支持 content.js 相关链路用到的 tag / #id / .class / [attr] / [attr="v"] / [attr*="v"] / tag:not([attr]) / tag:not([attr="v"])
function fakeDomParseSelectorPart(part) {
  const parsed = { tag: '', id: '', classes: [], attrs: [], notAttrs: [] };
  let rest = String(part).trim();
  const notMatch = rest.match(/:not\(\[([a-zA-Z][\w-]*)(?:([*^$|~]?=)"([^"]*)")?\]\)\s*$/);
  if (notMatch) {
    parsed.notAttrs.push({ name: notMatch[1].toLowerCase(), op: notMatch[2] || '', value: notMatch[3] || '' });
    rest = rest.slice(0, notMatch.index).trim();
  }
  const tagMatch = rest.match(/^([a-zA-Z][\w-]*)/);
  if (tagMatch) { parsed.tag = tagMatch[1].toLowerCase(); rest = rest.slice(tagMatch[1].length); }
  const tokenRe = /^(#([\w-]+)|\.([\w-]+)|\[([a-zA-Z][\w-]*)(?:([*^$|~]?=)"([^"]*)")?\])/;
  let m;
  while (rest && (m = rest.match(tokenRe))) {
    if (m[2]) parsed.id = m[2];
    else if (m[3]) parsed.classes.push(m[3]);
    else if (m[4]) parsed.attrs.push({ name: m[4].toLowerCase(), op: m[5] || '', value: m[6] || '' });
    rest = rest.slice(m[0].length);
  }
  return rest ? null : parsed;
}

function fakeDomNodeMatches(node, selector) {
  return String(selector).split(',').some((part) => {
    const parsed = fakeDomParseSelectorPart(part);
    if (!parsed || !node.tagName) return false;
    if (parsed.tag && node.tagName.toLowerCase() !== parsed.tag) return false;
    if (parsed.id && node.getAttribute('id') !== parsed.id) return false;
    const classes = String(node.getAttribute('class') || '').split(/\s+/);
    if (parsed.classes.some((c) => !classes.includes(c))) return false;
    for (const attr of parsed.attrs) {
      const actual = node.getAttribute(attr.name);
      if (actual === null) return false;
      if (attr.op === '=' && actual !== attr.value) return false;
      if (attr.op === '*=' && !actual.includes(attr.value)) return false;
    }
    return parsed.notAttrs.every((attr) => {
      const actual = node.getAttribute(attr.name);
      if (attr.op === '=') return actual !== attr.value; // :not([attr="v"])：等于该值才排除
      if (attr.op === '*=') return actual === null || !actual.includes(attr.value);
      return actual === null; // :not([attr])：存在即排除
    });
  });
}

function buildFakeDom() {
  const doc = { readyState: 'loading', nodeName: '#document', addEventListener() {}, removeEventListener() {} };
  doc.documentElement = makeFakeField({ tag: 'html' }, doc);
  doc.body = makeFakeField({ tag: 'body' }, doc);
  doc.documentElement.appendChild(doc.body);
  const walk = (node, fn) => { for (const child of node.children) { fn(child); walk(child, fn); } };
  doc.querySelectorAll = (sel) => { const out = []; walk(doc.documentElement, (n) => { if (fakeDomNodeMatches(n, sel)) out.push(n); }); return out; };
  doc.querySelector = (sel) => doc.querySelectorAll(sel)[0] || null;
  doc.getElementById = (id) => doc.querySelectorAll(`#${id}`)[0] || null;
  doc.createElement = (tag) => makeFakeField({ tag }, doc);
  return { doc, body: doc.body, make: (spec) => makeFakeField(spec, doc) };
}

function makeFakeField(spec, doc) {
  const attrs = { ...(spec.attrs || {}) };
  const children = [];
  const node = {
    tagName: String(spec.tag || 'input').toUpperCase(),
    attrs,
    children,
    style: {},
    value: spec.value !== undefined ? spec.value : '',
    readOnly: !!spec.readOnly,
    disabled: !!spec.disabled,
    textContent: spec.textContent || '',
    selectedIndex: 0,
    options: spec.options ? spec.options.map((o, i) => ({ text: o.text, value: o.value, disabled: false, index: i, parentElement: null })) : undefined,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    parentElement: null,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name.toLowerCase()) ? attrs[name.toLowerCase()] : null; },
    setAttribute(name, value) { attrs[name.toLowerCase()] = String(value); },
    removeAttribute(name) { delete attrs[name.toLowerCase()]; },
    get id() { return attrs.id || ''; },
    set id(value) { attrs.id = String(value); },
    get name() { return attrs.name || ''; },
    get placeholder() { return attrs.placeholder || ''; },
    get className() { return attrs['class'] || ''; },
    set className(value) { attrs['class'] = String(value); },
    get type() { return attrs.type || (node.tagName === 'INPUT' ? 'text' : ''); },
    get isConnected() { let cur = node; while (cur.parentElement) cur = cur.parentElement; return !!doc && cur === doc.documentElement; },
    get previousElementSibling() { const p = node.parentElement; if (!p) return null; const i = p.children.indexOf(node); return i > 0 ? p.children[i - 1] : null; },
    matches(selector) { return fakeDomNodeMatches(node, selector); },
    closest(selector) { let cur = node; while (cur) { if (fakeDomNodeMatches(cur, selector)) return cur; cur = cur.parentElement; } return null; },
    contains(other) { let cur = other; while (cur) { if (cur === node) return true; cur = cur.parentElement; } return false; },
    getBoundingClientRect() { return spec.rect ? { ...spec.rect } : { top: 100, left: 0, right: 100, bottom: 130, width: 100, height: 30 }; },
    appendChild(child) { if (child.parentElement) child.parentElement.removeChild(child); child.parentElement = node; node.children.push(child); return child; },
    insertBefore(child, ref) { if (child.parentElement) child.parentElement.removeChild(child); const i = node.children.indexOf(ref); child.parentElement = node; if (i < 0) node.children.push(child); else node.children.splice(i, 0, child); return child; },
    removeChild(child) { const i = node.children.indexOf(child); if (i >= 0) node.children.splice(i, 1); child.parentElement = null; return child; },
    remove() { if (node.parentElement) node.parentElement.removeChild(node); },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    click() {}, focus() {}, blur() {}, scrollIntoView() {},
    querySelector(sel) { return node.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const out = [];
      (function walkAll(cur) {
        for (const child of cur.children) {
          if (fakeDomNodeMatches(child, sel)) out.push(child);
          walkAll(child);
        }
      })(node);
      return out;
    }
  };
  return node;
}

function loadContentHooks(doc, chromeMock, extraGlobals = {}) {
  return loadScript('scripts/content.js', {
    document: doc,
    window: {
      location: fakeGlobals.location,
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, scrollTo() {},
      requestAnimationFrame: (fn) => setTimeout(fn, 0),
      innerWidth: 1280, innerHeight: 800,
      getComputedStyle: fakeGlobals.getComputedStyle
    },
    chrome: chromeMock || makeChromeStorage(),
    globals: { ...fakeGlobals, ...extraGlobals }
  }).__CAPYBARA_SMART_FILL_TEST_HOOKS__;
}

try {
  // —— P0：同 ID 节点被替换为密码框，所有解析路径必须拒绝 ——
  const domA = buildFakeDom();
  const hooksA = loadContentHooks(domA.doc);
  const fieldA = domA.make({ tag: 'input', attrs: { id: 'shared-login', type: 'text', 'aria-label': '丙项' } });
  domA.body.appendChild(fieldA);
  const refsA = hooksA.collectSmartFillFields();
  if (refsA.length !== 1) throw new Error('P0 收集数量异常: ' + refsA.length);
  if (hooksA.resolveSmartFillField(refsA[0]) !== fieldA) throw new Error('P0 正常解析失败');
  fieldA.setAttribute('type', 'password');
  if (hooksA.resolveSmartFillField(refsA[0]) !== null) throw new Error('原节点变为密码框未被拒绝');
  fieldA.setAttribute('type', 'text');
  if (hooksA.resolveSmartFillField(refsA[0]) !== fieldA) throw new Error('恢复后应可解析');
  domA.body.removeChild(fieldA);
  const pwNode = domA.make({ tag: 'input', attrs: { id: 'shared-login', type: 'password', 'aria-label': '丙项' } });
  domA.body.appendChild(pwNode);
  if (hooksA.resolveSmartFillField(refsA[0]) !== null) throw new Error('同 ID 密码框替换未被拒绝');
  domA.body.removeChild(pwNode);
  const rebuilt = domA.make({ tag: 'input', attrs: { id: 'shared-login', type: 'text', 'aria-label': '丙项' } });
  domA.body.appendChild(rebuilt);
  if (hooksA.resolveSmartFillField(refsA[0]) !== rebuilt) throw new Error('同签名重建节点应可解析');
  ok('AI 智能补填 P0 同 ID 密码框替换被拒绝');
} catch (e) {
  fail('AI 智能补填 P0 解析安全', e.message);
}

try {
  // —— P1-1：nameOrdinal 必须在过滤前的完整同名字段列表上计数，同名回退不错位 ——
  const domB = buildFakeDom();
  const hooksB = loadContentHooks(domB.doc);
  const filled = domB.make({ tag: 'input', attrs: { name: 'dup', type: 'text', 'aria-label': '甲项' }, value: '已填' });
  const empty = domB.make({ tag: 'input', attrs: { name: 'dup', type: 'text', 'aria-label': '乙项' } });
  domB.body.appendChild(filled);
  domB.body.appendChild(empty);
  const refsB = hooksB.collectSmartFillFields();
  if (refsB.length !== 1 || refsB[0].nameOrdinal !== 1) {
    throw new Error('nameOrdinal 口径错误: ' + JSON.stringify(refsB.map((r) => r.nameOrdinal)));
  }
  if (hooksB.resolveSmartFillField(refsB[0]) !== empty) throw new Error('原节点解析失败');
  const byName = hooksB.resolveSmartFillField({ ...refsB[0], el: null, id: '' });
  if (byName !== empty) throw new Error('同名回退解析错位');
  ok('AI 智能补填 P1-1 nameOrdinal 口径与同名解析');
} catch (e) {
  fail('AI 智能补填 P1-1 同名错位', e.message);
}

try {
  // —— P1-2：位置回退必须比对快照签名，DOM 插入错位时宁可跳过 ——
  const domC = buildFakeDom();
  const hooksC = loadContentHooks(domC.doc);
  const target = domC.make({ tag: 'input', attrs: { 'aria-label': '戊项' } });
  domC.body.appendChild(target);
  const refsC = hooksC.collectSmartFillFields();
  if (refsC.length !== 1) throw new Error('P1-2 收集数量异常');
  if (hooksC.resolveSmartFillField(refsC[0]) !== target) throw new Error('P1-2 正常解析失败');
  const intruder = domC.make({ tag: 'input', attrs: { 'aria-label': '新插入项' } });
  domC.body.insertBefore(intruder, target);
  if (hooksC.resolveSmartFillField({ ...refsC[0], el: null }) !== null) throw new Error('位置错位写入未被拒绝');
  ok('AI 智能补填 P1-2 位置错位签名拦截');
} catch (e) {
  fail('AI 智能补填 P1-2 位置错位', e.message);
}

try {
  // —— P1-3：畸形 AI 结果项被隔离，不中断本批后续字段的写入 ——
  const domD = buildFakeDom();
  const aiReply = JSON.stringify([
    null,
    [1, 2],
    { position: null, value: 'x' },
    { position: '0', value: 'x' },
    { position: 1.5, value: 'x' },
    { position: 0, value: {} },
    { position: 0, value: 12345 },
    { position: 0, value: '选项二' },
    { position: 1, value: '文本值' }
  ]);
  const chromeMock = {
    runtime: {
      lastError: null,
      getURL: (p) => p,
      sendMessage(_payload, cb) { Promise.resolve().then(() => cb({ success: true, text: aiReply })); },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} }
    },
    storage: { local: { get() {}, set() {}, remove() {}, getBytesInUse() {} }, onChanged: { addListener() {} } },
    tabs: { query: async () => [], sendMessage() {}, create() {} },
    scripting: { executeScript: async () => {} }
  };
  const hooksD = loadContentHooks(domD.doc, chromeMock);
  const sel = domD.make({
    tag: 'select',
    attrs: { id: 'sel-1', 'aria-label': '丙项' },
    options: [{ text: '请选择', value: '' }, { text: '选项一', value: '1' }, { text: '选项二', value: '2' }]
  });
  const text = domD.make({ tag: 'input', attrs: { id: 'txt-1', type: 'text', 'aria-label': '乙项' } });
  domD.body.appendChild(sel);
  domD.body.appendChild(text);

  const res = await hooksD.aiSmartFill({ basicInfo: { fullName: '测试' }, commonAnswers: { option: '选项二', text: '文本值' } }, { aiEnabled: true, aiApiKey: 'k', aiSmartFill: true });
  if (res.count !== 2) throw new Error('畸形项应只挡掉自己，实际写入 ' + res.count + ' 项');
  if (sel.value !== '2' || sel.selectedIndex !== 2) throw new Error('下拉未被写入: ' + JSON.stringify({ value: sel.value, index: sel.selectedIndex }));
  if (text.value !== '文本值') throw new Error('后续字段未被写入: ' + JSON.stringify(text.value));
  ok('AI 智能补填 P1-3 畸形 AI 项隔离不中断');
} catch (e) {
  fail('AI 智能补填 P1-3 畸形项隔离', e.message);
}

// ---------------------------------------------------------------------------
// AI 智能补填：组件型下拉框（readonly 触发器 / 级联 / 组合控件）
// ---------------------------------------------------------------------------

function makeAiChromeMock(reply, capture) {
  return {
    runtime: {
      lastError: null,
      getURL: (p) => p,
      sendMessage(payload, cb) {
        if (capture) capture(payload);
        Promise.resolve().then(() => cb({ success: true, text: reply }));
      },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} }
    },
    storage: { local: { get() {}, set() {}, remove() {}, getBytesInUse() {} }, onChanged: { addListener() {} } },
    tabs: { query: async () => [], sendMessage() {}, create() {} },
    scripting: { executeScript: async () => {} }
  };
}

// 模拟组件下拉面板：选项点击后写入所选值、收起面板，并可选回调（用于级联下一级异步加载）
function makeWidgetDropdown(doc, body, optionTexts, onSelect) {
  const panel = doc.createElement('div');
  panel.setAttribute('class', 'el-select-dropdown');
  for (const text of optionTexts) {
    const opt = doc.createElement('li');
    opt.setAttribute('class', 'el-select-dropdown__item');
    opt.setAttribute('role', 'option');
    opt.textContent = text;
    opt.click = () => onSelect(text);
    panel.appendChild(opt);
  }
  body.appendChild(panel);
  return panel;
}

try {
  // —— 组件下拉触发器：readonly 放行进候选；readonly 普通输入仍被排除；已有选中值跳过 ——
  const domW = buildFakeDom();
  const hooksW = loadContentHooks(domW.doc);
  const wrapA = domW.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const triggerA = domW.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '宗教信仰' }, readOnly: true });
  wrapA.appendChild(triggerA);
  domW.body.appendChild(wrapA);
  const wrapB = domW.make({ tag: 'div', attrs: { 'class': 'custom-select-wrapper' } });
  const triggerB = domW.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '政治面貌' }, readOnly: true });
  wrapB.appendChild(triggerB);
  domW.body.appendChild(wrapB);
  const wrapC = domW.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const triggerC = domW.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '婚姻状况' }, readOnly: true });
  const chosenC = domW.make({ tag: 'div', attrs: { 'class': 'el-select__selected-item' }, textContent: '未婚' });
  wrapC.appendChild(triggerC);
  wrapC.appendChild(chosenC);
  domW.body.appendChild(wrapC);
  const readonlyPlain = domW.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '户口所在地' }, readOnly: true });
  domW.body.appendChild(readonlyPlain);
  // P1-2：selection-container 这类普通容器不能命中自研组件启发式
  const wrapD = domW.make({ tag: 'div', attrs: { 'class': 'selection-container' } });
  const triggerD = domW.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '现住地址' }, readOnly: true });
  wrapD.appendChild(triggerD);
  domW.body.appendChild(wrapD);

  if (!hooksW.isWidgetSelectTrigger(triggerA)) throw new Error('el-select 触发器未识别');
  if (!hooksW.isWidgetSelectTrigger(triggerB)) throw new Error('自研 select-wrapper 触发器未识别');
  if (hooksW.isWidgetSelectTrigger(readonlyPlain)) throw new Error('普通输入被误判为组件下拉');
  if (hooksW.isWidgetSelectTrigger(triggerD)) throw new Error('selection-container 普通容器被误判为组件下拉');

  const refsW = hooksW.collectSmartFillFields();
  if (refsW.length !== 2) throw new Error('候选数量异常: ' + refsW.length);
  const elsW = refsW.map((r) => r.el);
  if (!elsW.includes(triggerA) || !elsW.includes(triggerB)) throw new Error('readonly 组件下拉触发器未进入候选');
  if (elsW.includes(readonlyPlain)) throw new Error('readonly 普通输入未被排除');
  if (elsW.includes(triggerD)) throw new Error('selection-container 内的 readonly 输入未被排除');
  if (elsW.includes(triggerC)) throw new Error('已有选中值的组件下拉未被跳过');
  if (!refsW.every((r) => r.kind === 'widget-select')) throw new Error('候选缺少 widget-select 标记');
  // P1-2：input 型组件候选仍走格式校验（免预校验仅对非 input 触发容器生效）
  const phoneWidgetRef = { ...refsW[0], label: '手机号', tagName: 'INPUT', kind: 'widget-select', options: null, maxLength: 0, type: 'text' };
  if (hooksW.validateSmartFillValue(phoneWidgetRef, 'not-a-phone').ok) throw new Error('input 型组件候选跳过了手机号格式校验');
  const payloadW = hooksW.smartFillFieldPayload(refsW[0]);
  if (payloadW.widgetSelect !== true) throw new Error('payload 缺少 widgetSelect 标记');
  ok('AI 智能补填 组件下拉 readonly 触发器进入候选且普通只读输入仍排除');
} catch (e) {
  fail('AI 智能补填 组件下拉候选', e.message);
}

try {
  // —— 级联下拉：同组两级组件下拉，AI 返回数组依次选择；市级选项在省级选择后才异步注入 ——
  const domCas = buildFakeDom();
  let capturedCas = '';
  const rowCas = domCas.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  rowCas.appendChild(domCas.make({ tag: 'label', textContent: '籍贯' }));
  const wrapProv = domCas.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const prov = domCas.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: '请选择省' }, readOnly: true });
  wrapProv.appendChild(prov);
  const wrapCity = domCas.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const city = domCas.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: '请选择市' }, readOnly: true });
  wrapCity.appendChild(city);
  rowCas.appendChild(wrapProv);
  rowCas.appendChild(wrapCity);
  domCas.body.appendChild(rowCas);

  const hooksCas = loadContentHooks(domCas.doc, makeAiChromeMock('', (p) => { capturedCas = p.prompt || ''; }));
  const refsCas = hooksCas.collectSmartFillFields();
  if (refsCas.length !== 2) throw new Error('级联候选数量异常: ' + refsCas.length);
  const [refProv, refCity] = refsCas;
  if (!refProv.cascadeGroupId || refProv.cascadeGroupId !== refCity.cascadeGroupId) throw new Error('两级下拉未编入同一级联组');
  if (refProv.cascadeIndex !== 0 || refCity.cascadeIndex !== 1 || refProv.cascadeLevels !== 2) throw new Error('级联层级标记错误');
  const payloadCas = hooksCas.smartFillFieldPayload(refProv);
  if (payloadCas.cascadeGroup !== refProv.cascadeGroupId || payloadCas.level !== 1 || payloadCas.cascadeLevels !== 2) {
    throw new Error('级联 payload 缺少组标记: ' + JSON.stringify(payloadCas));
  }

  let panelCity = null;
  const panelProv = makeWidgetDropdown(domCas.doc, domCas.body, ['广东省', '湖南省'], (text) => {
    const chosen = domCas.doc.createElement('div');
    chosen.setAttribute('class', 'el-select__selected-item');
    chosen.textContent = text;
    wrapProv.appendChild(chosen);
    panelProv.remove();
    setTimeout(() => { // 模拟选中省份后市级选项才异步加载
      panelCity = makeWidgetDropdown(domCas.doc, domCas.body, ['潮州市', '广州市'], (cityText) => {
        const chosen2 = domCas.doc.createElement('div');
        chosen2.setAttribute('class', 'el-select__selected-item');
        chosen2.textContent = cityText;
        wrapCity.appendChild(chosen2);
        if (panelCity) panelCity.remove();
      });
    }, 200);
  });

  const replyCas = JSON.stringify([{ position: refProv.position, value: ['广东省', '潮州市'] }]);
  const hooksCasRun = loadContentHooks(domCas.doc, makeAiChromeMock(replyCas, (p) => { capturedCas = p.prompt || ''; }));
  const resCas = await hooksCasRun.aiSmartFill(
    { basicInfo: { fullName: '测试', hometown: '广东省潮州市' } },
    { aiEnabled: true, aiApiKey: 'k', aiSmartFill: true }
  );
  if (!capturedCas.includes('cascadeGroup') || !capturedCas.includes('widgetSelect')) throw new Error('AI 提示缺少级联/组件下拉标记');
  if (resCas.count !== 2) throw new Error('级联应写入 2 层，实际: ' + resCas.count);
  if (wrapProv.querySelector('.el-select__selected-item')?.textContent !== '广东省') throw new Error('省级未被选择');
  if (wrapCity.querySelector('.el-select__selected-item')?.textContent !== '潮州市') throw new Error('市级未被选择（异步加载后）');
  ok('AI 智能补填 级联下拉按数组逐层选择且等待下级异步加载');
} catch (e) {
  fail('AI 智能补填 级联下拉', e.message);
}

try {
  // —— 组合控件：类型下拉+文本框拆成两个候选并分别写入 ——
  const domCb = buildFakeDom();
  let capturedCb = '';
  const rowCb = domCb.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  rowCb.appendChild(domCb.make({ tag: 'label', textContent: '证件号' }));
  const wrapType = domCb.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const typeTrigger = domCb.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: '请选择' }, readOnly: true });
  wrapType.appendChild(typeTrigger);
  const contentInput = domCb.make({ tag: 'input', attrs: { type: 'text', placeholder: '请填写账号' } });
  rowCb.appendChild(wrapType);
  rowCb.appendChild(contentInput);
  domCb.body.appendChild(rowCb);

  const hooksCb = loadContentHooks(domCb.doc, makeAiChromeMock('', (p) => { capturedCb = p.prompt || ''; }));
  const refsCb = hooksCb.collectSmartFillFields();
  if (refsCb.length !== 2) throw new Error('组合控件应拆成 2 个候选: ' + refsCb.length);
  const byEl = new Map(refsCb.map((r) => [r.el, r]));
  if (byEl.get(typeTrigger).label !== '证件号·类型') throw new Error('类型候选 label 错误: ' + byEl.get(typeTrigger).label);
  if (byEl.get(contentInput).label !== '证件号·内容') throw new Error('内容候选 label 错误: ' + byEl.get(contentInput).label);

  const panelType = makeWidgetDropdown(domCb.doc, domCb.body, ['身份证', '护照'], (text) => {
    const chosen = domCb.doc.createElement('div');
    chosen.setAttribute('class', 'el-select__selected-item');
    chosen.textContent = text;
    wrapType.appendChild(chosen);
    panelType.remove();
  });

  const replyCb = JSON.stringify([
    { position: byEl.get(typeTrigger).position, value: '身份证' },
    { position: byEl.get(contentInput).position, value: '110101200001011234' }
  ]);
  const hooksCbRun = loadContentHooks(domCb.doc, makeAiChromeMock(replyCb, (p) => { capturedCb = p.prompt || ''; }));
  const resCb = await hooksCbRun.aiSmartFill(
    { basicInfo: { fullName: '测试', idCard: '110101200001011234', idCardType: '身份证' } },
    { aiEnabled: true, aiApiKey: 'k', aiSmartFill: true }
  );
  if (!capturedCb.includes('证件号·类型') || !capturedCb.includes('证件号·内容')) throw new Error('AI 提示缺少组合控件拆分 label');
  if (resCb.count !== 2) throw new Error('组合控件应写入 2 项，实际: ' + resCb.count);
  if (wrapType.querySelector('.el-select__selected-item')?.textContent !== '身份证') throw new Error('类型下拉未被选择');
  if (contentInput.value !== '110101200001011234') throw new Error('内容输入框未被写入: ' + JSON.stringify(contentInput.value));
  ok('AI 智能补填 组合控件拆分为类型/内容两个候选并分别写入');
} catch (e) {
  fail('AI 智能补填 组合控件', e.message);
}

try {
  // —— widget-select 无选项列表：走 fillSelectWidget 尝试路径，失败仅记 warn 跳过不抛错 ——
  const domF = buildFakeDom();
  const wrapF = domF.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const triggerF = domF.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '宗教信仰' }, readOnly: true });
  wrapF.appendChild(triggerF);
  domF.body.appendChild(wrapF);
  // 不注入任何下拉面板，模拟组件点击后选项不可见/不匹配
  const hooksF = loadContentHooks(domF.doc);
  const refsF = hooksF.collectSmartFillFields();
  if (refsF.length !== 1 || refsF[0].kind !== 'widget-select') throw new Error('widget-select 候选缺失');
  const directCheck = hooksF.validateSmartFillValue(refsF[0], '无宗教信仰');
  if (!directCheck.ok || directCheck.value !== '无宗教信仰') throw new Error('无 options 时不应做选项预校验: ' + JSON.stringify(directCheck));

  const replyF = JSON.stringify([{ position: refsF[0].position, value: '无宗教信仰' }]);
  const hooksFRun = loadContentHooks(domF.doc, makeAiChromeMock(replyF));
  const resF = await hooksFRun.aiSmartFill(
    { basicInfo: { fullName: '测试' } },
    { aiEnabled: true, aiApiKey: 'k', aiSmartFill: true }
  );
  if (resF.count !== 0) throw new Error('无下拉面板时不应计入成功: ' + resF.count);
  if (wrapF.querySelector('.el-select__selected-item') !== null) throw new Error('失败路径不应写入选中值');
  if ((triggerF.value || '') !== '') throw new Error('失败路径不应改动触发 input 的值');
  ok('AI 智能补填 widget-select 无选项时尝试失败仅跳过不抛错');
} catch (e) {
  fail('AI 智能补填 widget-select 失败路径', e.message);
}

try {
  // —— P0：combobox 外壳内藏密码框/文件框，收集与写入双层拒绝 ——
  const domP0 = buildFakeDom();
  const hooksP0 = loadContentHooks(domP0.doc);
  const comboPw = domP0.make({ tag: 'div', attrs: { role: 'combobox', 'aria-label': '账号信息' } });
  const innerPw = domP0.make({ tag: 'input', attrs: { type: 'password' } });
  comboPw.appendChild(innerPw);
  domP0.body.appendChild(comboPw);
  const comboFile = domP0.make({ tag: 'div', attrs: { role: 'combobox', 'aria-label': '证件扫描' } });
  const innerFile = domP0.make({ tag: 'input', attrs: { type: 'file' } });
  comboFile.appendChild(innerFile);
  domP0.body.appendChild(comboFile);
  // 对照组：combobox 内层是普通文本输入，应正常进入候选
  const comboText = domP0.make({ tag: 'div', attrs: { role: 'combobox', 'aria-label': '城市' } });
  const innerText = domP0.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly' }, readOnly: true });
  comboText.appendChild(innerText);
  domP0.body.appendChild(comboText);

  const refsP0 = hooksP0.collectSmartFillFields();
  if (refsP0.some((r) => r.el === comboPw || r.el === comboFile)) throw new Error('内层敏感输入的 combobox 不应进入候选');
  if (!refsP0.some((r) => r.el === comboText)) throw new Error('内层文本输入的 combobox 被误拒');
  if (await hooksP0.fillField(comboPw, 'P@ssw0rd')) throw new Error('fillField 未拒绝内层密码框');
  if (innerPw.value !== '') throw new Error('密码框被写入');
  if (await hooksP0.fillField(comboFile, 'x')) throw new Error('fillField 未拒绝内层文件框');
  ok('AI 智能补填 P0 combobox 内层密码/文件输入拒绝写入');
} catch (e) {
  fail('AI 智能补填 P0 combobox 内层敏感输入', e.message);
}

try {
  // —— P1-1/P1-4：自研组件外壳强制走点击展开匹配；兜底选项排除清除按钮 ——
  const domCw = buildFakeDom();
  const shellCw = domCw.make({ tag: 'div', attrs: { 'class': 'custom-select-wrapper' } });
  const inputCw = domCw.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '宗教信仰' }, readOnly: true });
  shellCw.appendChild(inputCw);
  domCw.body.appendChild(shellCw);

  const hooksCw = loadContentHooks(domCw.doc);
  const refsCw = hooksCw.collectSmartFillFields();
  if (refsCw.length !== 1 || refsCw[0].kind !== 'widget-select') throw new Error('自研组件未识别为 widget-select');

  let clearClicked = false;
  const panelCw = domCw.doc.createElement('div');
  panelCw.setAttribute('class', 'custom-select-dropdown');
  const rowCw = domCw.doc.createElement('div');
  rowCw.setAttribute('class', 'custom-option-item');
  rowCw.textContent = '无宗教信仰';
  rowCw.click = () => { inputCw.value = '无宗教信仰'; };
  const clearBtn = domCw.doc.createElement('button');
  clearBtn.setAttribute('class', 'option-clear');
  clearBtn.textContent = '清除';
  clearBtn.click = () => { clearClicked = true; };
  panelCw.appendChild(rowCw);
  panelCw.appendChild(clearBtn);
  domCw.body.appendChild(panelCw);

  const replyCw = JSON.stringify([{ position: refsCw[0].position, value: '无宗教信仰' }]);
  const hooksCwRun = loadContentHooks(domCw.doc, makeAiChromeMock(replyCw));
  const resCw = await hooksCwRun.aiSmartFill({ basicInfo: { fullName: '测试', religion: '无宗教信仰' } }, { aiEnabled: true, aiApiKey: 'k', aiSmartFill: true });
  if (resCw.count !== 1) throw new Error('自研组件应通过点击选项写入，实际: ' + resCw.count);
  if (inputCw.value !== '无宗教信仰') throw new Error('自研组件未写入: ' + JSON.stringify(inputCw.value));
  if (clearClicked) throw new Error('兜底启发式误点击了清除按钮');
  ok('AI 智能补填 自研组件外壳点击展开匹配且兜底选项排除清除按钮');
} catch (e) {
  fail('AI 智能补填 自研组件写入', e.message);
}

try {
  // —— P1-3：级联数组必须由第一级返回且层数与组层数完全一致 ——
  const domCc = buildFakeDom();
  const rowCc = domCc.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  rowCc.appendChild(domCc.make({ tag: 'label', textContent: '籍贯' }));
  const wrapP = domCc.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const prov = domCc.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: '请选择省' }, readOnly: true });
  wrapP.appendChild(prov);
  const wrapCi = domCc.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const cityI = domCc.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: '请选择市' }, readOnly: true });
  wrapCi.appendChild(cityI);
  rowCc.appendChild(wrapP);
  rowCc.appendChild(wrapCi);
  domCc.body.appendChild(rowCc);
  const hooksCc = loadContentHooks(domCc.doc);
  const refsCc = hooksCc.collectSmartFillFields();
  if (refsCc.length !== 2) throw new Error('级联候选数量异常: ' + refsCc.length);
  const [refP, refC] = refsCc;
  if (hooksCc.validateSmartFillValue(refP, ['广东省']).ok) throw new Error('过短数组应拒绝');
  if (hooksCc.validateSmartFillValue(refP, ['广东省', '潮州市', '湘桥区']).ok) throw new Error('过长数组应拒绝');
  if (hooksCc.validateSmartFillValue(refC, ['潮州市']).ok) throw new Error('非第一级返回数组应拒绝');
  if (hooksCc.validateSmartFillValue(refC, '潮州市').ok) throw new Error('非第一级返回字符串应拒绝');
  if (hooksCc.validateSmartFillValue(refP, '广东省').ok) throw new Error('第一级返回字符串应拒绝');
  if (!hooksCc.validateSmartFillValue(refP, ['广东省', '潮州市']).ok) throw new Error('合法整组数组应通过');

  // 端到端：过短数组整组跳过，不写任何一层
  const replyCc = JSON.stringify([{ position: refP.position, value: ['广东省'] }]);
  const hooksCcRun = loadContentHooks(domCc.doc, makeAiChromeMock(replyCc));
  const resCc = await hooksCcRun.aiSmartFill(
    { basicInfo: { fullName: '测试', hometown: '广东省潮州市' } },
    { aiEnabled: true, aiApiKey: 'k', aiSmartFill: true }
  );
  if (resCc.count !== 0) throw new Error('过短数组不应写入，实际: ' + resCc.count);
  if (wrapP.querySelector('.el-select__selected-item') !== null) throw new Error('省级被部分写入');
  ok('AI 智能补填 级联数组层数与首层驱动强校验');
} catch (e) {
  fail('AI 智能补填 级联数组校验', e.message);
}

try {
  // —— P1-5：AI 等待期间组件已有选中值（semi 不在 fieldHasValue 覆盖内），resolve 必须拒绝 ——
  const domSemi = buildFakeDom();
  const wrapSemi = domSemi.make({ tag: 'div', attrs: { 'class': 'semi-select' } });
  const triggerSemi = domSemi.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '政治面貌' }, readOnly: true });
  wrapSemi.appendChild(triggerSemi);
  domSemi.body.appendChild(wrapSemi);
  const hooksSemi = loadContentHooks(domSemi.doc);
  const refsSemi = hooksSemi.collectSmartFillFields();
  if (refsSemi.length !== 1 || refsSemi[0].kind !== 'widget-select') throw new Error('semi 组件未进入候选');
  if (hooksSemi.resolveSmartFillField(refsSemi[0]) !== triggerSemi) throw new Error('空值时应可解析');
  // 模拟 AI 生成期间用户/页面已选好值
  const chosenSemi = domSemi.make({ tag: 'div', attrs: { 'class': 'semi-select-selection-text' }, textContent: '中共党员' });
  wrapSemi.appendChild(chosenSemi);
  if (hooksSemi.resolveSmartFillField(refsSemi[0]) !== null) throw new Error('已有选中值的组件未被拒绝');
  ok('AI 智能补填 组件已有选中值时解析拒绝');
} catch (e) {
  fail('AI 智能补填 组件已选值解析', e.message);
}

try {
  // —— P2-1：一行内多个候选文本框、或文本框与下拉不相邻时，不拆组合控件 ——
  const domG = buildFakeDom();
  // 行1：关系下拉 + 姓名 + 手机（两个候选文本框）→ 不拆分
  const row1 = domG.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  row1.appendChild(domG.make({ tag: 'label', textContent: '备用联络人' }));
  const wrapRel = domG.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const relTrigger = domG.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: '请选择关系' }, readOnly: true });
  wrapRel.appendChild(relTrigger);
  const nameInput = domG.make({ tag: 'input', attrs: { type: 'text', placeholder: '请填写姓名' } });
  const phoneInput = domG.make({ tag: 'input', attrs: { type: 'text', placeholder: '请填写手机' } });
  row1.appendChild(wrapRel);
  row1.appendChild(nameInput);
  row1.appendChild(phoneInput);
  domG.body.appendChild(row1);
  // 行2：下拉与文本框之间隔了元素 → 不相邻不拆分
  const row2 = domG.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  row2.appendChild(domG.make({ tag: 'label', textContent: '备用联络渠道' }));
  const wrapMail = domG.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const mailTrigger = domG.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: '请选择类型' }, readOnly: true });
  wrapMail.appendChild(mailTrigger);
  const spacer = domG.make({ tag: 'div', attrs: { 'class': 'spacer' }, textContent: '提示文字' });
  const mailInput = domG.make({ tag: 'input', attrs: { type: 'text', placeholder: '请填写账号' } });
  row2.appendChild(wrapMail);
  row2.appendChild(spacer);
  row2.appendChild(mailInput);
  domG.body.appendChild(row2);

  const hooksG = loadContentHooks(domG.doc);
  const refsG = hooksG.collectSmartFillFields();
  if (refsG.some((r) => r.label.includes('·类型') || r.label.includes('·内容'))) throw new Error('多文本框/不相邻的行不应拆分组合控件');
  if (!refsG.some((r) => r.el === relTrigger)) throw new Error('关系下拉候选缺失');
  if (!refsG.some((r) => r.el === phoneInput)) throw new Error('手机输入候选缺失');
  if (!refsG.some((r) => r.el === mailInput)) throw new Error('不相邻文本框候选缺失');
  ok('AI 智能补填 组合控件仅在单文本框且相邻时拆分');
} catch (e) {
  fail('AI 智能补填 组合控件拆分条件', e.message);
}

try {
  // —— P2-2：英文 label 含 "date" 子串（如 Candidate）不应误判为日期行 ——
  const domEn = buildFakeDom();
  const rowEn = domEn.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  rowEn.appendChild(domEn.make({ tag: 'label', textContent: 'Candidate Location' }));
  const wrapSt = domEn.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const st = domEn.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: 'State' }, readOnly: true });
  wrapSt.appendChild(st);
  const wrapCt = domEn.make({ tag: 'div', attrs: { 'class': 'el-select' } });
  const ct = domEn.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', placeholder: 'City' }, readOnly: true });
  wrapCt.appendChild(ct);
  rowEn.appendChild(wrapSt);
  rowEn.appendChild(wrapCt);
  domEn.body.appendChild(rowEn);
  const hooksEn = loadContentHooks(domEn.doc);
  const refsEn = hooksEn.collectSmartFillFields();
  if (refsEn.length !== 2) throw new Error('英文级联候选数量异常: ' + refsEn.length);
  if (!refsEn[0].cascadeGroupId || refsEn[0].cascadeGroupId !== refsEn[1].cascadeGroupId) {
    throw new Error('"Candidate" 内嵌 date 子串被误判为日期行，未编入级联组');
  }
  ok('AI 智能补填 英文级联 label 的 date 子串不误伤');
} catch (e) {
  fail('AI 智能补填 英文级联分组', e.message);
}

// ---------------------------------------------------------------------------
// 选取填入（快捷资料速查：点选填入聚焦框）
// ---------------------------------------------------------------------------

function makeFakeChip() {
  const flashes = [];
  return {
    flashes,
    classList: { add(cls) { flashes.push(cls); }, remove() {} }
  };
}

function lastNotificationText(doc) {
  return doc.getElementById('job-autofill-notification')?.textContent || '';
}

try {
  // —— 聚焦普通 input → 点条目 → 值写入 + 复制同时发生 ——
  const domT1 = buildFakeDom();
  const copiedT1 = [];
  const hooksT1 = loadContentHooks(domT1.doc, null, { navigator: { clipboard: { writeText: async (t) => { copiedT1.push(t); } } } });
  const nameInput = domT1.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '姓名' } });
  domT1.body.appendChild(nameInput);
  if (!hooksT1.setFillTargetFromElement(nameInput)) throw new Error('普通输入未成为填入目标');
  const chipT1 = makeFakeChip();
  const resT1 = await hooksT1.applyCopyItem('张子涵', '姓名', chipT1);
  if (!resT1.filled) throw new Error('填入失败: ' + JSON.stringify(resT1));
  if (nameInput.value !== '张子涵') throw new Error('值未写入: ' + JSON.stringify(nameInput.value));
  if (!copiedT1.includes('张子涵')) throw new Error('复制未同时发生');
  if (lastNotificationText(domT1.doc) !== '已填入：姓名') throw new Error('通知文案异常: ' + lastNotificationText(domT1.doc));
  if (!chipT1.flashes.includes('is-filled')) throw new Error('条目未闪绿');
  // 填入后目标保留，可连续改填
  await hooksT1.applyCopyItem('李雷', '姓名', makeFakeChip());
  if (nameInput.value !== '李雷') throw new Error('目标保留后无法连续填入');
  ok('选取填入 聚焦普通输入点条目写入且复制兜底');
} catch (e) {
  fail('选取填入 普通输入', e.message);
}

try {
  // —— 聚焦密码框 → 不设目标 → 点条目仅复制不写入 ——
  const domT2 = buildFakeDom();
  const copiedT2 = [];
  const hooksT2 = loadContentHooks(domT2.doc, null, { navigator: { clipboard: { writeText: async (t) => { copiedT2.push(t); } } } });
  const pwInput = domT2.make({ tag: 'input', attrs: { type: 'password', 'aria-label': '密码' } });
  domT2.body.appendChild(pwInput);
  if (hooksT2.setFillTargetFromElement(pwInput)) throw new Error('密码框不应成为填入目标');
  if (hooksT2.getFillTarget() !== null) throw new Error('目标状态异常');
  const resT2 = await hooksT2.applyCopyItem('P@ssw0rd', '密码', makeFakeChip());
  if (resT2.filled) throw new Error('密码框不应被写入');
  if (pwInput.value !== '') throw new Error('密码框被写入: ' + pwInput.value);
  if (!copiedT2.includes('P@ssw0rd')) throw new Error('复制未发生');
  if (lastNotificationText(domT2.doc) !== '已复制 密码') throw new Error('无目标时应提示复制: ' + lastNotificationText(domT2.doc));
  ok('选取填入 密码框不设目标仅复制');
} catch (e) {
  fail('选取填入 密码框', e.message);
}

try {
  // —— 聚焦组件下拉触发器 → 点条目走 fillSelectWidget 路径 ——
  const domT3 = buildFakeDom();
  const copiedT3 = [];
  const hooksT3 = loadContentHooks(domT3.doc, null, { navigator: { clipboard: { writeText: async (t) => { copiedT3.push(t); } } } });
  const shellT3 = domT3.make({ tag: 'div', attrs: { 'class': 'custom-select-wrapper' } });
  const triggerT3 = domT3.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '学历' }, readOnly: true });
  shellT3.appendChild(triggerT3);
  domT3.body.appendChild(shellT3);
  if (!hooksT3.setFillTargetFromElement(triggerT3)) throw new Error('组件触发器未成为填入目标');
  const targetT3 = hooksT3.getFillTarget();
  if (targetT3.kind !== 'widget') throw new Error('组件触发器 kind 异常: ' + targetT3.kind);
  const panelT3 = domT3.doc.createElement('div');
  panelT3.setAttribute('class', 'custom-select-dropdown');
  const optT3 = domT3.doc.createElement('div');
  optT3.setAttribute('class', 'custom-option-item');
  optT3.textContent = '本科';
  optT3.click = () => { triggerT3.value = '本科'; };
  panelT3.appendChild(optT3);
  domT3.body.appendChild(panelT3);
  const resT3 = await hooksT3.applyCopyItem('本科', '学历', makeFakeChip());
  if (!resT3.filled) throw new Error('组件下拉填入失败: ' + JSON.stringify(resT3));
  if (triggerT3.value !== '本科') throw new Error('组件下拉未写入（fillSelectWidget 路径未生效）');
  if (lastNotificationText(domT3.doc) !== '已填入：学历') throw new Error('通知文案异常: ' + lastNotificationText(domT3.doc));
  ok('选取填入 组件下拉触发器走选项点击路径');
} catch (e) {
  fail('选取填入 组件下拉', e.message);
}

try {
  // —— fillField 返回 false → 「未能写入」分支且不抛错 ——
  const domT4 = buildFakeDom();
  const copiedT4 = [];
  const hooksT4 = loadContentHooks(domT4.doc, null, { navigator: { clipboard: { writeText: async (t) => { copiedT4.push(t); } } } });
  const roInput = domT4.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '备注' }, readOnly: true });
  domT4.body.appendChild(roInput);
  if (!hooksT4.setFillTargetFromElement(roInput)) throw new Error('readonly 文本输入应可成为目标');
  const resT4 = await hooksT4.applyCopyItem('某段内容', '备注', makeFakeChip());
  if (resT4.filled) throw new Error('readonly 输入不应写入成功');
  if (roInput.value !== '') throw new Error('readonly 输入被写入');
  if (lastNotificationText(domT4.doc) !== '未能写入（可能是下拉选项不匹配），值已复制，可 Ctrl+V') {
    throw new Error('失败分支文案异常: ' + lastNotificationText(domT4.doc));
  }
  if (!copiedT4.includes('某段内容')) throw new Error('失败分支复制未发生');
  ok('选取填入 写入失败走提示分支不抛错');
} catch (e) {
  fail('选取填入 失败分支', e.message);
}

try {
  // —— 目标从 DOM 移除后再点条目 → 仅复制；抽屉内元素聚焦不改变目标 ——
  const domT5 = buildFakeDom();
  const copiedT5 = [];
  const hooksT5 = loadContentHooks(domT5.doc, null, { navigator: { clipboard: { writeText: async (t) => { copiedT5.push(t); } } } });
  const cityInput = domT5.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '城市' } });
  domT5.body.appendChild(cityInput);
  if (!hooksT5.setFillTargetFromElement(cityInput)) throw new Error('目标设置失败');
  // 抽屉自身元素聚焦：不打断既有目标
  const drawerPanel = domT5.make({ tag: 'div', attrs: { id: 'job-autofill-copy-panel' } });
  const drawerSearch = domT5.make({ tag: 'input', attrs: { type: 'text', id: 'job-autofill-copy-search-input' } });
  drawerPanel.appendChild(drawerSearch);
  domT5.body.appendChild(drawerPanel);
  if (hooksT5.setFillTargetFromElement(drawerSearch)) throw new Error('抽屉内元素不应成为目标');
  if (hooksT5.getFillTarget()?.el !== cityInput) throw new Error('聚焦抽屉清掉了既有目标');
  // 目标从 DOM 移除
  domT5.body.removeChild(cityInput);
  const resT5 = await hooksT5.applyCopyItem('北京', '城市', makeFakeChip());
  if (resT5.filled) throw new Error('目标已移除不应写入');
  if (hooksT5.getFillTarget() !== null) throw new Error('移除的目标未清除');
  if (!copiedT5.includes('北京')) throw new Error('移除后复制未发生');
  if (lastNotificationText(domT5.doc) !== '已复制 城市') throw new Error('移除后应提示复制: ' + lastNotificationText(domT5.doc));
  ok('选取填入 目标移除后仅复制且抽屉聚焦不改变目标');
} catch (e) {
  fail('选取填入 目标移除', e.message);
}

try {
  // —— P1-1：快速连点两条串行执行，最终组件值为有效那条、剪贴板为最后一次点击的值 ——
  const domQ = buildFakeDom();
  const copiedQ = [];
  const hooksQ = loadContentHooks(domQ.doc, null, { navigator: { clipboard: { writeText: async (t) => { copiedQ.push(t); } } } });
  const shellQ = domQ.make({ tag: 'div', attrs: { 'class': 'custom-select-wrapper' } });
  const triggerQ = domQ.make({ tag: 'input', attrs: { type: 'text', readonly: 'readonly', 'aria-label': '学历' }, readOnly: true });
  shellQ.appendChild(triggerQ);
  domQ.body.appendChild(shellQ);
  if (!hooksQ.setFillTargetFromElement(triggerQ)) throw new Error('目标设置失败');
  const panelQ = domQ.doc.createElement('div');
  panelQ.setAttribute('class', 'custom-select-dropdown');
  const optQ = domQ.doc.createElement('div');
  optQ.setAttribute('class', 'custom-option-item');
  optQ.textContent = '本科';
  optQ.click = () => { triggerQ.value = '本科'; };
  panelQ.appendChild(optQ);
  domQ.body.appendChild(panelQ);

  const p1 = hooksQ.applyCopyItem('不存在的选项', '学历', makeFakeChip());
  const p2 = hooksQ.applyCopyItem('本科', '学历', makeFakeChip());
  const [resQ1, resQ2] = await Promise.all([p1, p2]);
  if (resQ1.filled) throw new Error('无匹配选项不应写入');
  if (!resQ2.filled) throw new Error('有效选项未写入: ' + JSON.stringify(resQ2));
  if (triggerQ.value !== '本科') throw new Error('连点后组件值被旧操作污染: ' + JSON.stringify(triggerQ.value));
  if (copiedQ[copiedQ.length - 1] !== '本科') throw new Error('剪贴板被旧值覆盖: ' + JSON.stringify(copiedQ));
  ok('选取填入 快速连点串行化不污染组件值与剪贴板');
} catch (e) {
  fail('选取填入 连点串行化', e.message);
}

try {
  // —— P1-2：复制失败不影响填入（写入、闪绿、通知合并提示）——
  const domR = buildFakeDom();
  const hooksR = loadContentHooks(domR.doc, null, { navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
  const inputR = domR.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '姓名' } });
  domR.body.appendChild(inputR);
  if (!hooksR.setFillTargetFromElement(inputR)) throw new Error('目标设置失败');
  const chipR = makeFakeChip();
  const resR = await hooksR.applyCopyItem('张子涵', '姓名', chipR);
  if (!resR.filled) throw new Error('复制失败不应影响填入: ' + JSON.stringify(resR));
  if (inputR.value !== '张子涵') throw new Error('字段未写入: ' + JSON.stringify(inputR.value));
  if (!chipR.flashes.includes('is-filled')) throw new Error('复制失败时未闪绿');
  const msgR = lastNotificationText(domR.doc);
  if (!msgR.includes('已填入') || !msgR.includes('复制失败')) throw new Error('通知未合并复制失败信息: ' + msgR);
  ok('选取填入 复制失败不吞并填入结果');
} catch (e) {
  fail('选取填入 复制失败分支', e.message);
}

try {
  // —— P2-1/P2-2：写入前重跑安全解析；label 显著漂移目标失效；目标条文案实时重算 ——
  const domS = buildFakeDom();
  const copiedS = [];
  const hooksS = loadContentHooks(domS.doc, null, { navigator: { clipboard: { writeText: async (t) => { copiedS.push(t); } } } });
  // 场景1：已聚焦的 text 框被 SPA 改写为 checkbox
  const hijacked = domS.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '是否接受外派' } });
  domS.body.appendChild(hijacked);
  if (!hooksS.setFillTargetFromElement(hijacked)) throw new Error('目标设置失败');
  hijacked.setAttribute('type', 'checkbox');
  const resS1 = await hooksS.applyCopyItem('是', '是否接受外派', makeFakeChip());
  if (resS1.filled) throw new Error('被改写为 checkbox 的控件不应写入');
  if (hooksS.getFillTarget() !== null) throw new Error('失效目标未清除');
  // 场景2：label 被页面改写 → 目标条实时显示新字段名，写入时判定漂移仅复制
  const renamed = domS.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '姓名' } });
  domS.body.appendChild(renamed);
  if (!hooksS.setFillTargetFromElement(renamed)) throw new Error('目标设置失败');
  const barS = domS.make({ tag: 'div', attrs: { id: 'job-autofill-fill-target-bar' } });
  domS.body.appendChild(barS);
  renamed.setAttribute('aria-label', '电子邮箱');
  hooksS.updateFillTargetBar();
  if (!barS.textContent.includes('电子邮箱')) throw new Error('目标条仍显示旧字段名: ' + barS.textContent);
  const resS2 = await hooksS.applyCopyItem('张子涵', '姓名', makeFakeChip());
  if (resS2.filled) throw new Error('label 显著漂移后不应写入');
  if (hooksS.getFillTarget() !== null) throw new Error('漂移目标未清除');
  if (!copiedS.includes('是') || !copiedS.includes('张子涵')) throw new Error('失效场景复制未发生');
  ok('选取填入 写入前重解析与 label 漂移防护');
} catch (e) {
  fail('选取填入 写入前重解析', e.message);
}

// ---------------------------------------------------------------------------
// 选区填入（框选经历区域 → 选条目 → 定向填入空白字段）
// ---------------------------------------------------------------------------

try {
  // —— 几何判定：相交面积 > 控件面积 50% 才算框内（恰好 50% 不算）——
  const hooksRg = loadContentHooks(buildFakeDom().doc);
  const sel = { left: 0, top: 0, right: 200, bottom: 200 };
  if (hooksRg.regionRectsIntersectionArea(sel, { left: 50, top: 50, right: 150, bottom: 150 }) !== 10000) throw new Error('相交面积计算错误');
  if (hooksRg.regionRectsIntersectionArea(sel, { left: 300, top: 0, right: 400, bottom: 100 }) !== 0) throw new Error('不相交应为 0');
  if (hooksRg.regionRectsIntersectionArea(sel, null) !== 0) throw new Error('空矩形应为 0');
  if (hooksRg.regionControlOverlapRatio({ left: 10, top: 10, right: 110, bottom: 110 }, sel) !== 1) throw new Error('完全框内比例应为 1');
  // 控件宽 100，只有左半 50 落入选区 → 恰好 0.5，不满足"大于 50%"
  if (hooksRg.regionControlOverlapRatio({ left: -50, top: 0, right: 50, bottom: 40 }, sel) !== 0.5) throw new Error('半重叠比例应为 0.5');
  if (hooksRg.regionControlOverlapRatio({ left: -49, top: 0, right: 51, bottom: 40 }, sel) <= 0.5) throw new Error('超过半面积应大于 0.5');
  if (hooksRg.regionControlOverlapRatio({ left: 0, top: 0, right: 0, bottom: 40 }, sel) !== 0) throw new Error('零面积控件应为 0');
  ok('选区填入 框选矩形命中/不命中控件的几何判定');
} catch (e) {
  fail('选区填入 几何判定', e.message);
}

try {
  // —— 条目字段化：各分类输出正确、空值剔除、起止时间合并 ——
  const hooksFz = loadContentHooks(buildFakeDom().doc);
  const edu = hooksFz.regionFieldizeEntry('education', {
    school: '北京航空航天大学', college: '计算机学院', major: '计算机科学与技术', degree: '硕士',
    academicDegree: '硕士学位', schoolType: '', startDate: '2023-09', endDate: '2026-06', rank: '前5%', courses: '操作系统', gpa: '3.8'
  });
  const eduKeys = edu.map((f) => f.key);
  for (const key of ['school', 'college', 'major', 'degree', 'academicDegree', 'dateRange', 'rank', 'courses', 'gpa']) {
    if (!eduKeys.includes(key)) throw new Error(`教育字段化缺少 ${key}: ${eduKeys}`);
  }
  if (eduKeys.includes('schoolType')) throw new Error('教育字段化混入空字段: ' + eduKeys);
  const eduRange = edu.find((f) => f.key === 'dateRange');
  if (eduRange.value !== '2023-09 至 2026-06' || eduRange.startDate !== '2023-09' || eduRange.endDate !== '2026-06') {
    throw new Error('起止时间合并错误: ' + JSON.stringify(eduRange));
  }

  const work = hooksFz.regionFieldizeEntry('workExperience', {
    company: '字节跳动', department: '抖音', position: '后端开发实习生', city: '北京',
    startDate: '2025-06', endDate: '2025-09', description: '负责推荐服务', achievements: '性能提升 30%', workType: '实习'
  });
  if (work.map((f) => f.key).join(',') !== 'company,department,position,dateRange,description,achievements,city,workType') {
    throw new Error('工作字段化顺序/内容错误: ' + work.map((f) => f.key).join(','));
  }

  const proj = hooksFz.regionFieldizeEntry('projects', {
    name: '智能简历解析助手', role: '独立开发', startDate: '2024-03', endDate: '2024-09',
    description: '解析简历', responsibilities: '全栈开发', achievements: '开源 1k star'
  });
  if (proj.map((f) => f.key).join(',') !== 'name,role,dateRange,description,responsibilities,achievements') {
    throw new Error('项目字段化错误: ' + proj.map((f) => f.key).join(','));
  }

  const award = hooksFz.regionFieldizeEntry('awards', { name: '国家奖学金', level: '国家级', date: '2024-11', issuer: '教育部', description: '顶级荣誉' });
  // 奖项具体字段（级别/日期/颁发单位/说明）在 name 之前：规则匹配优先级随定义顺序
  if (award.map((f) => f.key).join(',') !== 'level,date,issuer,description,name') {
    throw new Error('奖项字段化错误: ' + award.map((f) => f.key).join(','));
  }

  const family = hooksFz.regionFieldizeEntry('familyMembers', { name: '张父', relation: '父亲', employer: '某某公司', position: '职员', phone: '13800000000' });
  if (family.map((f) => f.key).join(',') !== 'name,relation,employer,position,phone') {
    throw new Error('家庭成员字段化错误: ' + family.map((f) => f.key).join(','));
  }

  const basic = hooksFz.regionFieldizeEntry('basicInfo', { fullName: '张子涵', phone: '13812345678', customLegacy: '保留', email: '' });
  const basicByKey = Object.fromEntries(basic.map((f) => [f.key, f]));
  if (!basicByKey.fullName || !basicByKey.phone) throw new Error('基本信息字段化丢失: ' + JSON.stringify(Object.keys(basicByKey)));
  if (!basicByKey.customLegacy || basicByKey.customLegacy.pattern !== null) throw new Error('无映射的资料字段应保留且 pattern 为 null');
  if (basicByKey.email) throw new Error('空字段未剔除');
  if (hooksFz.regionFieldizeEntry('education', {}).length !== 0) throw new Error('空条目应返回空数组');
  ok('选区填入 条目字段化各分类输出');
} catch (e) {
  fail('选区填入 条目字段化', e.message);
}

try {
  // —— 规则层 label 匹配：字段名 ↔ 常见 label 词 ——
  const hooksRm = loadContentHooks(buildFakeDom().doc);
  const matchKey = (label, fields) => {
    const hit = hooksRm.regionMatchRuleField(label, fields);
    return hit ? hit.field.key : null;
  };
  const eduFields = hooksRm.regionFieldizeEntry('education', {
    school: '北航', college: '计算机学院', major: '计科', degree: '硕士', academicDegree: '硕士学位',
    startDate: '2023-09', endDate: '2026-06', rank: '前5%', courses: '操作系统'
  });
  if (matchKey('学校名称', eduFields) !== 'school') throw new Error('学校名称应命中 school');
  if (matchKey('毕业院校', eduFields) !== 'school') throw new Error('毕业院校应命中 school');
  if (matchKey('就读学院', eduFields) !== 'college') throw new Error('就读学院应命中 college');
  if (matchKey('专业名称', eduFields) !== 'major') throw new Error('专业名称应命中 major');
  if (matchKey('最高学历', eduFields) !== 'degree') throw new Error('最高学历应命中 degree');
  if (matchKey('授予学位', eduFields) !== 'academicDegree') throw new Error('授予学位应命中 academicDegree');
  const hitStart = hooksRm.regionMatchRuleField('入学时间', eduFields);
  if (!hitStart || hitStart.side !== 'start') throw new Error('入学时间应判 start');
  const hitEnd = hooksRm.regionMatchRuleField('毕业时间', eduFields);
  if (!hitEnd || hitEnd.side !== 'end') throw new Error('毕业时间应判 end');
  const hitRange = hooksRm.regionMatchRuleField('起止时间', eduFields);
  if (!hitRange || hitRange.side !== 'range') throw new Error('起止时间应判 range');

  const workFields = hooksRm.regionFieldizeEntry('workExperience', {
    company: '字节跳动', department: '抖音', position: '后端开发实习生',
    startDate: '2025-06', endDate: '2025-09', description: '负责推荐服务', achievements: '性能提升'
  });
  if (matchKey('实习单位', workFields) !== 'company') throw new Error('实习单位应命中 company');
  if (matchKey('所属部门', workFields) !== 'department') throw new Error('所属部门应命中 department');
  if (matchKey('担任职位', workFields) !== 'position') throw new Error('担任职位应命中 position');
  if (matchKey('工作内容', workFields) !== 'description') throw new Error('工作内容应命中 description');
  if (matchKey('主要业绩', workFields) !== 'achievements') throw new Error('主要业绩应命中 achievements');
  if (matchKey('兴趣爱好', workFields) !== null) throw new Error('无关 label 不应命中');

  const projFields = hooksRm.regionFieldizeEntry('projects', {
    name: '智能简历解析助手', role: '独立开发', description: '背景', responsibilities: '开发', achievements: '1k star'
  });
  if (matchKey('项目名称', projFields) !== 'name') throw new Error('项目名称应命中 name');
  if (matchKey('项目描述', projFields) !== 'description') throw new Error('项目描述应命中 description（不应误中 name）');
  if (matchKey('个人职责', projFields) !== 'responsibilities') throw new Error('个人职责应命中 responsibilities');

  const awardFields = hooksRm.regionFieldizeEntry('awards', { name: '国奖', level: '国家级', date: '2024-11', issuer: '教育部', description: '说明' });
  if (matchKey('奖项名称', awardFields) !== 'name') throw new Error('奖项名称应命中 name');
  if (matchKey('获奖时间', awardFields) !== 'date') throw new Error('获奖时间应命中 date（不应误中 name）');
  if (matchKey('颁发单位', awardFields) !== 'issuer') throw new Error('颁发单位应命中 issuer');
  // P1-2 回归：泛化"奖项/奖励/荣誉"不得抢占级别/时间/机构字段
  if (matchKey('奖项级别', awardFields) !== 'level') throw new Error('奖项级别被 name 抢占');
  if (matchKey('荣誉等级', awardFields) !== 'level') throw new Error('荣誉等级被 name 抢占');
  if (matchKey('奖项日期', awardFields) !== 'date') throw new Error('奖项日期被 name 抢占');
  if (matchKey('颁发机构', awardFields) !== 'issuer') throw new Error('颁发机构被 name 抢占');
  if (matchKey('奖项说明', awardFields) !== 'description') throw new Error('奖项说明应命中 description');

  const familyFields = hooksRm.regionFieldizeEntry('familyMembers', { name: '张父', relation: '父亲', employer: '某公司', position: '职员', phone: '13800000000' });
  if (matchKey('家庭成员姓名', familyFields) !== 'name') throw new Error('家庭成员姓名应命中 name');
  if (matchKey('与本人关系', familyFields) !== 'relation') throw new Error('与本人关系应命中 relation');
  if (matchKey('工作单位', familyFields) !== 'employer') throw new Error('工作单位应命中 employer');
  if (matchKey('联系电话', familyFields) !== 'phone') throw new Error('联系电话应命中 phone');

  const basicFields = hooksRm.regionFieldizeEntry('basicInfo', {
    fullName: '张子涵', phone: '13812345678', idCard: '110101200001011234',
    phoneType: 'Mobile', hometown: '山东青岛', sourcePlace: '山东'
  });
  if (matchKey('姓名', basicFields) !== 'fullName') throw new Error('姓名应命中 fullName');
  if (matchKey('手机号码', basicFields) !== 'phone') throw new Error('手机号码应命中 phone');
  if (matchKey('身份证号', basicFields) !== 'idCard') throw new Error('身份证号应命中 idCard');
  // P1-3 回归：资料中无紧急联系人时，紧急/应急/联系人语义 label 不得回退误填本人姓名/手机号
  if (matchKey('紧急联系人电话', basicFields) !== null) throw new Error('紧急联系人电话不应误填本人手机号');
  if (matchKey('紧急联系人姓名', basicFields) !== null) throw new Error('紧急联系人姓名不应误填本人姓名');
  if (matchKey('应急联系电话', basicFields) !== null) throw new Error('应急联系电话不应误填本人手机号');
  if (matchKey('联系人电话', basicFields) !== null) throw new Error('联系人电话不应误填本人手机号');
  if (matchKey('联系人姓名', basicFields) !== null) throw new Error('联系人姓名不应误填本人姓名');
  // P2-1 回归：具体字段先于泛化字段（手机类型≠手机号码、生源地≠籍贯）
  if (matchKey('手机类型', basicFields) !== 'phoneType') throw new Error('手机类型被 phone 抢占');
  if (matchKey('号码类型', basicFields) !== 'phoneType') throw new Error('号码类型被 phone 抢占');
  if (matchKey('生源地', basicFields) !== 'sourcePlace') throw new Error('生源地被 hometown 抢占');
  if (matchKey('籍贯', basicFields) !== 'hometown') throw new Error('籍贯应命中 hometown');
  ok('选区填入 规则层 label 匹配命中');
} catch (e) {
  fail('选区填入 规则层匹配', e.message);
}

try {
  // —— 起止时间分流：同 row 两个整段控件按 DOM 顺序拆 start/end，单框填合并区间 ——
  const domDt = buildFakeDom();
  const hooksDt = loadContentHooks(domDt.doc);
  const sideOfLabel = (label) => hooksDt.regionDateSideOfLabel(label);
  if (sideOfLabel('开始时间') !== 'start' || sideOfLabel('入职日期') !== 'start') throw new Error('开始类 label 判定错误');
  if (sideOfLabel('结束时间') !== 'end' || sideOfLabel('毕业时间') !== 'end') throw new Error('结束类 label 判定错误');
  if (sideOfLabel('起止时间') !== 'range' || sideOfLabel('在校时间') !== 'range') throw new Error('整段类 label 判定错误');
  if (sideOfLabel('兴趣爱好') !== null) throw new Error('无关 label 应为 null');

  const rowDt = domDt.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  const d1 = domDt.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '时间' } });
  const d2 = domDt.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '时间' } });
  rowDt.appendChild(d1);
  rowDt.appendChild(d2);
  domDt.body.appendChild(rowDt);
  const alone = domDt.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '起止时间' } });
  domDt.body.appendChild(alone);
  const hit1 = { ref: { el: d1 }, field: {} };
  const hit2 = { ref: { el: d2 }, field: {} };
  const hitAlone = { ref: { el: alone }, field: {} };
  const sideOf = hooksDt.regionSplitDateRangeRefs([hit1, hit2, hitAlone]);
  if (sideOf.get(hit1) !== 'start' || sideOf.get(hit2) !== 'end') throw new Error('同行两个整段控件应按 DOM 顺序拆 start/end');
  if (sideOf.get(hitAlone) !== 'range') throw new Error('孤立整段控件应保持 range');

  // 端到端（规则层，未配置 AI）：双框分别填起/止，单框填合并区间
  const entry = { company: '字节跳动', position: '后端开发实习生', startDate: '2025-06', endDate: '2025-09' };
  const resDt = await hooksDt.regionFillApply(
    hooksDt.collectRegionFields({ left: -10, top: 0, right: 400, bottom: 400 }).refs,
    0, 'workExperience', entry, { aiEnabled: false }
  );
  if (resDt.filled !== 3) throw new Error('分流应写入 3 项（双框+单框）: ' + JSON.stringify(resDt));
  if (d1.value !== '2025-06' || d2.value !== '2025-09') throw new Error(`双框分流错误: ${d1.value} / ${d2.value}`);
  if (alone.value !== '2025-06 至 2025-09') throw new Error('单框应填合并区间: ' + alone.value);
  if (d1.getAttribute('type') !== 'text') throw new Error('不应改动控件属性');

  // —— 单开始/单结束：显式 label 语义优先，单控件只填对应一侧（不填整段区间）——
  const domSingle = buildFakeDom();
  const hooksSingle = loadContentHooks(domSingle.doc);
  const startOnly = domSingle.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '入职时间' } });
  const endOnly = domSingle.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '离职时间' } });
  domSingle.body.appendChild(startOnly);
  domSingle.body.appendChild(endOnly);
  const resSingle = await hooksSingle.regionFillApply(
    hooksSingle.collectRegionFields({ left: -10, top: 0, right: 400, bottom: 400 }).refs,
    0, 'workExperience', entry, { aiEnabled: false }
  );
  if (startOnly.value !== '2025-06') throw new Error(`单"入职时间"应只填开始时间: ${startOnly.value}`);
  if (endOnly.value !== '2025-09') throw new Error(`单"离职时间"应只填结束时间: ${endOnly.value}`);
  if (resSingle.filled !== 2) throw new Error('单开始/单结束应各写入 1 项: ' + JSON.stringify(resSingle));

  // —— 一端已有值：开始端已填 → 只收集结束端，填 endDate 且不动已填端 ——
  const domHalf = buildFakeDom();
  const hooksHalf = loadContentHooks(domHalf.doc);
  const rowHalf = domHalf.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  const halfStart = domHalf.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '开始时间' }, value: '2024-01' });
  const halfEnd = domHalf.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '结束时间' } });
  rowHalf.appendChild(halfStart);
  rowHalf.appendChild(halfEnd);
  domHalf.body.appendChild(rowHalf);
  const collectedHalf = hooksHalf.collectRegionFields({ left: -10, top: 0, right: 400, bottom: 400 });
  if (collectedHalf.refs.length !== 1 || collectedHalf.refs[0].el !== halfEnd) throw new Error('已有值的开始端未被跳过');
  if (collectedHalf.skippedHasValue !== 1) throw new Error('已有值跳过计数错误: ' + collectedHalf.skippedHasValue);
  const resHalf = await hooksHalf.regionFillApply(collectedHalf.refs, collectedHalf.skippedHasValue, 'workExperience', entry, { aiEnabled: false });
  if (halfEnd.value !== '2025-09') throw new Error('剩余结束端应填 endDate: ' + halfEnd.value);
  if (halfStart.value !== '2024-01') throw new Error('已填的开始端被改动: ' + halfStart.value);
  if (resHalf.filled !== 1) throw new Error('一端已有值场景应只写 1 项: ' + JSON.stringify(resHalf));

  // —— 反序显式 label：离职在前、入职在后，起止不随 DOM 顺序颠倒 ——
  const domRev = buildFakeDom();
  const hooksRev = loadContentHooks(domRev.doc);
  const rowRev = domRev.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  const revQuit = domRev.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '离职时间' } });
  const revJoin = domRev.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '入职时间' } });
  rowRev.appendChild(revQuit);
  rowRev.appendChild(revJoin);
  domRev.body.appendChild(rowRev);
  const resRev = await hooksRev.regionFillApply(
    hooksRev.collectRegionFields({ left: -10, top: 0, right: 400, bottom: 400 }).refs,
    0, 'workExperience', entry, { aiEnabled: false }
  );
  if (revQuit.value !== '2025-09') throw new Error(`DOM 在前的"离职时间"应填结束: ${revQuit.value}`);
  if (revJoin.value !== '2025-06') throw new Error(`DOM 在后的"入职时间"应填开始: ${revJoin.value}`);
  if (resRev.filled !== 2) throw new Error('反序显式 label 应写入 2 项: ' + JSON.stringify(resRev));
  ok('选区填入 起止时间单框/双框分流');
} catch (e) {
  fail('选区填入 起止时间分流', e.message);
}

try {
  // —— 区域收集：几何命中 + 安全过滤 + 已有值跳过计数 ——
  const domCol = buildFakeDom();
  const hooksCol = loadContentHooks(domCol.doc);
  const inA = domCol.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '公司名称' }, rect: { left: 10, top: 10, right: 90, bottom: 50, width: 80, height: 40 } });
  const outB = domCol.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '备注' }, rect: { left: 300, top: 10, right: 380, bottom: 50, width: 80, height: 40 } });
  const halfC = domCol.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '半个' }, rect: { left: -50, top: 0, right: 50, bottom: 40, width: 100, height: 40 } });
  const filledD = domCol.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '已有值' }, value: '旧值', rect: { left: 10, top: 60, right: 90, bottom: 100, width: 80, height: 40 } });
  const noClue = domCol.make({ tag: 'input', attrs: { type: 'text' }, rect: { left: 10, top: 110, right: 90, bottom: 150, width: 80, height: 40 } });
  const pw = domCol.make({ tag: 'input', attrs: { type: 'password', 'aria-label': '密码' }, rect: { left: 10, top: 160, right: 90, bottom: 200, width: 80, height: 40 } });
  domCol.body.appendChild(inA); domCol.body.appendChild(outB); domCol.body.appendChild(halfC);
  domCol.body.appendChild(filledD); domCol.body.appendChild(noClue); domCol.body.appendChild(pw);
  const collected = hooksCol.collectRegionFields({ left: 0, top: 0, right: 200, bottom: 200 });
  if (collected.refs.length !== 1 || collected.refs[0].el !== inA) throw new Error('框内命中应为 inA: ' + collected.refs.length);
  if (collected.skippedHasValue !== 1) throw new Error('已有值跳过数错误: ' + collected.skippedHasValue);
  if (collected.skippedNoClue !== 1) throw new Error('无线索跳过数错误: ' + collected.skippedNoClue);
  if (!collected.refs[0].signature || collected.refs[0].position === undefined) throw new Error('收集引用缺少签名/位置');
  ok('选区填入 区域内字段收集与跳过计数');
} catch (e) {
  fail('选区填入 区域收集', e.message);
}

try {
  // —— 选区模式进入/退出：overlay DOM 与 document 监听无残留 ——
  const domMode = buildFakeDom();
  const listenerAdded = [];
  const listenerRemoved = [];
  domMode.doc.addEventListener = (type, fn, opts) => listenerAdded.push({ type, fn, opts });
  domMode.doc.removeEventListener = (type, fn, opts) => listenerRemoved.push({ type, fn, opts });
  const hooksMode = loadContentHooks(domMode.doc);
  hooksMode.enterRegionSelectMode({ basicInfo: { fullName: '张子涵' } });
  if (!domMode.doc.getElementById('job-autofill-region-overlay')) throw new Error('进入后 overlay 不存在');
  if (!hooksMode.isRegionFillActive()) throw new Error('进入后状态未激活');
  const keydown = listenerAdded.filter((l) => l.type === 'keydown');
  if (keydown.length !== 1 || keydown[0].opts !== true) throw new Error('应注册 1 个捕获态 keydown 监听: ' + keydown.length);
  hooksMode.enterRegionSelectMode({ basicInfo: { fullName: '张子涵' } }); // 重复进入走互斥单例
  if (domMode.doc.querySelectorAll('#job-autofill-region-overlay').length !== 1) throw new Error('重复进入应复用单例而非叠加 overlay');
  hooksMode.exitRegionFillMode();
  if (domMode.doc.getElementById('job-autofill-region-overlay')) throw new Error('退出后 overlay 残留');
  if (hooksMode.isRegionFillActive()) throw new Error('退出后状态未清空');
  if (!listenerRemoved.some((l) => l.type === 'keydown' && l.fn === keydown[0].fn)) throw new Error('keydown 监听未解绑');
  hooksMode.exitRegionFillMode(); // 幂等：重复退出不应再产生解绑动作
  const keydownAdds = listenerAdded.filter((l) => l.type === 'keydown').length;
  const keydownRemoves = listenerRemoved.filter((l) => l.type === 'keydown').length;
  if (keydownAdds !== keydownRemoves) throw new Error(`keydown 监听未全部解绑: ${keydownAdds} 注册 / ${keydownRemoves} 解绑`);
  ok('选区填入 模式进入退出 DOM 与监听清理');
} catch (e) {
  fail('选区填入 模式清理', e.message);
}

try {
  // —— 面板分类模型：仅显示资料中实际有条目的分类 ——
  const hooksPn = loadContentHooks(buildFakeDom().doc);
  const profilePn = {
    basicInfo: { fullName: '张子涵' },
    education: [{ school: '', major: '' }],
    workExperience: [{ company: '字节跳动', position: '后端开发实习生' }, { company: '', position: '' }],
    projects: [{ name: '智能简历解析助手', role: '独立开发' }],
    awards: [{ name: '', level: '' }],
    familyMembers: [{ name: '张父', relation: '父亲' }]
  };
  const cats = hooksPn.regionPanelCategories(profilePn);
  const catKeys = cats.map((c) => c.key);
  if (catKeys.join(',') !== 'basicInfo,workExperience,projects,familyMembers') throw new Error('空条目分类未被排除: ' + catKeys.join(','));
  const workCat = cats.find((c) => c.key === 'workExperience');
  if (workCat.items.length !== 1 || workCat.items[0].summary !== '字节跳动·后端开发实习生') throw new Error('工作条目数/摘要错误: ' + JSON.stringify(workCat.items));
  const basicCat = cats.find((c) => c.key === 'basicInfo');
  if (!basicCat.single || basicCat.items[0].summary !== '张子涵') throw new Error('基本信息应为单条目');
  const projCat = cats.find((c) => c.key === 'projects');
  if (projCat.items[0].summary !== '智能简历解析助手·独立开发') throw new Error('项目摘要错误: ' + projCat.items[0].summary);
  if (hooksPn.regionPanelCategories({ basicInfo: {}, education: [{}], workExperience: [{}] }).length !== 0) throw new Error('全空资料应无分类');
  ok('选区填入 面板分类仅显示有条目的分类');
} catch (e) {
  fail('选区填入 面板分类模型', e.message);
}

try {
  // —— 端到端：规则层写入 + 未识别计数与完成通知（未配置 AI）——
  const domE2e = buildFakeDom();
  const hooksE2e = loadContentHooks(domE2e.doc);
  const rowE2e = domE2e.make({ tag: 'div', attrs: { 'class': 'form-item' } });
  const companyIn = domE2e.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '公司名称' } });
  const positionIn = domE2e.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '担任职位' } });
  const descTa = domE2e.make({ tag: 'textarea', attrs: { 'aria-label': '工作描述' } });
  const oddIn = domE2e.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '游戏账号' } });
  rowE2e.appendChild(companyIn);
  rowE2e.appendChild(positionIn);
  domE2e.body.appendChild(rowE2e);
  domE2e.body.appendChild(descTa);
  domE2e.body.appendChild(oddIn);
  const selE2e = { left: -10, top: 0, right: 300, bottom: 400 };
  const collectedE2e = hooksE2e.collectRegionFields(selE2e);
  if (collectedE2e.refs.length !== 4) throw new Error('端到端收集数量异常: ' + collectedE2e.refs.length);
  const resE2e = await hooksE2e.regionFillApply(collectedE2e.refs, 2, 'workExperience', {
    company: '字节跳动', position: '后端开发实习生', startDate: '2025-06', endDate: '2025-09', description: '负责推荐服务'
  }, { aiEnabled: false });
  if (resE2e.filled !== 3 || resE2e.total !== 4 || resE2e.unmatched !== 1) throw new Error('端到端计数错误: ' + JSON.stringify(resE2e));
  if (companyIn.value !== '字节跳动') throw new Error('公司未写入: ' + companyIn.value);
  if (positionIn.value !== '后端开发实习生') throw new Error('职位未写入: ' + positionIn.value);
  if (descTa.value !== '负责推荐服务') throw new Error('描述未写入: ' + descTa.value);
  if (oddIn.value !== '') throw new Error('规则未命中的字段不应被写入');
  const msgE2e = lastNotificationText(domE2e.doc);
  if (!msgE2e.includes('选区填入完成：3/4') || !msgE2e.includes('跳过已有值 2 个') || !msgE2e.includes('1 个字段未能识别')) {
    throw new Error('完成通知文案异常: ' + msgE2e);
  }
  ok('选区填入 规则层端到端写入与完成反馈');
} catch (e) {
  fail('选区填入 端到端规则层', e.message);
}

try {
  // —— 无字段时整体退出并提示；真实 Shadow DOM 资料选择由浏览器回归覆盖 ——
  const domFin = buildFakeDom();
  const hooksFin = loadContentHooks(domFin.doc);
  hooksFin.enterRegionSelectMode({ basicInfo: { fullName: '张子涵' } });
  hooksFin.finishRegionSelect({ left: 1000, top: 1000, right: 1100, bottom: 1100 });
  if (hooksFin.isRegionFillActive()) throw new Error('无字段时不应停留在选区态');
  if (domFin.doc.getElementById('job-autofill-region-panel')) throw new Error('不应创建旧的独立面板');
  const msgFin = lastNotificationText(domFin.doc);
  if (!msgFin.includes('未在框选区域内发现可填字段')) throw new Error('无字段提示异常: ' + msgFin);
  ok('选区填入 无字段退出且不再创建旧独立面板');
} catch (e) {
  fail('选区填入 无字段退出', e.message);
}

try {
  // —— AI 层兜底：规则未命中字段交给 AI 匹配写入（走共享校验管道）——
  const domAi = buildFakeDom();
  const compAi = domAi.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '公司名称' } });
  const gameAi = domAi.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '特殊爱好' } });
  domAi.body.appendChild(compAi);
  domAi.body.appendChild(gameAi);
  const refsAi = loadContentHooks(domAi.doc).collectRegionFields({ left: -10, top: 0, right: 400, bottom: 400 }).refs;
  const entryAi = { company: '字节跳动', city: '北京', startDate: '2025-06', endDate: '2025-09' };
  // AI 只应收到规则未命中的字段（特殊爱好），且资料是选定条目本身
  let capturedAi = '';
  const hooksAiRun = loadContentHooks(domAi.doc, makeAiChromeMock(
    JSON.stringify([{ position: refsAi.find((r) => r.label === '特殊爱好').position, value: '北京' }]),
    (p) => { capturedAi = p.prompt || ''; }
  ));
  const resAi = await hooksAiRun.regionFillApply(refsAi, 0, 'workExperience', entryAi, { aiEnabled: true, aiApiKey: 'k' });
  if (resAi.filled !== 2) throw new Error('规则+AI 应写入 2 项: ' + JSON.stringify(resAi));
  if (compAi.value !== '字节跳动') throw new Error('规则层公司未写入: ' + compAi.value);
  if (gameAi.value !== '北京') throw new Error('AI 层城市未写入: ' + gameAi.value);
  if (!capturedAi.includes('特殊爱好') || capturedAi.includes('公司名称')) throw new Error('AI 不应收到规则已命中字段');
  if (!capturedAi.includes('字节跳动') || !capturedAi.includes('选定条目资料')) throw new Error('AI 提示缺少条目资料');
  if (resAi.unmatched !== 0) throw new Error('应无未识别字段: ' + JSON.stringify(resAi));
  ok('选区填入 AI 层兜底匹配写入');
} catch (e) {
  fail('选区填入 AI 层兜底', e.message);
}

try {
  // —— P2-2：aiSmartFill 开关关闭时不调用 AI，完成通知注明未启用 ——
  const domSw = buildFakeDom();
  const compSw = domSw.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '公司名称' } });
  const oddSw = domSw.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '游戏账号' } });
  domSw.body.appendChild(compSw);
  domSw.body.appendChild(oddSw);
  let capturedSw = '';
  const hooksSw = loadContentHooks(domSw.doc, makeAiChromeMock(
    JSON.stringify([{ position: 0, value: '不该出现的值' }]),
    (p) => { capturedSw = p.prompt || ''; }
  ));
  const refsSw = hooksSw.collectRegionFields({ left: -10, top: 0, right: 400, bottom: 400 }).refs;
  if (refsSw.length !== 2) throw new Error('开关测试收集数量异常: ' + refsSw.length);
  const resSw = await hooksSw.regionFillApply(refsSw, 0, 'workExperience', { company: '字节跳动' }, { aiEnabled: true, aiApiKey: 'k', aiSmartFill: false });
  if (resSw.filled !== 1 || resSw.unmatched !== 1) throw new Error('开关关闭时只应走规则层: ' + JSON.stringify(resSw));
  if (compSw.value !== '字节跳动') throw new Error('规则层公司未写入: ' + compSw.value);
  if (oddSw.value !== '') throw new Error('开关关闭时规则未命中字段不应被填入: ' + oddSw.value);
  if (capturedSw) throw new Error('aiSmartFill 关闭时不应调用 AI');
  const msgSw = lastNotificationText(domSw.doc);
  if (!msgSw.includes('选区填入完成：1/2') || !msgSw.includes('未启用 AI 智能匹配')) throw new Error('开关关闭通知文案异常: ' + msgSw);
  ok('选区填入 aiSmartFill 开关关闭时不调 AI 并注明原因');
} catch (e) {
  fail('选区填入 aiSmartFill 开关', e.message);
}

try {
  // —— P1-4：执行锁——设置读取期间禁止选区重入与 AI 助填并发，完成后解锁 ——
  const domLk = buildFakeDom();
  let releaseSettings = null;
  const chromeLk = {
    runtime: {
      lastError: null,
      getURL: (p) => p,
      sendMessage(payload, cb) {
        if (payload.action === 'getSettings') {
          releaseSettings = () => cb({ success: true, settings: { aiEnabled: false } });
          return;
        }
        Promise.resolve().then(() => cb({ success: false }));
      },
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} }
    },
    storage: { local: { get() {}, set() {}, remove() {}, getBytesInUse() {} }, onChanged: { addListener() {} } },
    tabs: { query: async () => [], sendMessage() {}, create() {} },
    scripting: { executeScript: async () => {} }
  };
  const hooksLk = loadContentHooks(domLk.doc, chromeLk);
  const compLk = domLk.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '公司名称' } });
  domLk.body.appendChild(compLk);
  const refsLk = hooksLk.collectRegionFields({ left: -10, top: 0, right: 400, bottom: 400 }).refs;
  const pendingLk = hooksLk.runRegionFill(refsLk, 0, 'workExperience', { company: '字节跳动', position: '后端' });
  if (!hooksLk.isRegionFillRunning()) throw new Error('执行锁未在读取设置前置位');
  hooksLk.startRegionFillFlow(); // 执行期间选区入口禁用
  if (lastNotificationText(domLk.doc) !== '选区填入正在进行中，请稍候') throw new Error('执行期间选区入口应禁用: ' + lastNotificationText(domLk.doc));
  if (domLk.doc.getElementById('job-autofill-region-overlay')) throw new Error('执行期间不应进入框选模式');
  const resAiLk = await hooksLk.aiStepByStepFill({ basicInfo: { fullName: '张子涵' } });
  if (resAiLk.count !== 0) throw new Error('执行期间 AI 助填应被互斥拒绝');
  const doubleLk = hooksLk.runRegionFill(refsLk, 0, 'workExperience', { company: '重复' }); // 防重入兜底：直接返回
  await doubleLk;
  if (compLk.value !== '') throw new Error('重入调用不应执行填入');

  releaseSettings();
  await pendingLk;
  if (hooksLk.isRegionFillRunning()) throw new Error('完成后锁未复位');
  if (compLk.value !== '字节跳动') throw new Error('锁释放后填入未完成: ' + compLk.value);
  ok('选区填入 执行锁防重入与 AI 助填互斥');
} catch (e) {
  fail('选区填入 执行锁', e.message);
}

try {
  loadScript('popup/popup.js', {
    document: {
      readyState: 'complete',
      documentElement: { getAttribute: () => 'dark', setAttribute() {} },
      addEventListener() {},
      getElementById: () => ({
        addEventListener() {}, value: '', innerHTML: '', style: {},
        textContent: '', classList: { add() {}, remove() {} },
        querySelector: () => null, querySelectorAll: () => []
      }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, addEventListener() {} }),
      body: { appendChild() {} }
    },
    window: {
      matchMedia: () => ({ matches: false, addEventListener() {} })
    }
  });
  ok('popup.js 可加载');
} catch (e) {
  fail('popup.js 加载', e.message);
}

// ---------------------------------------------------------------------------
section('yanyu 填充可靠性与多选区');
try {
  const dom = buildFakeDom();
  const bad = dom.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '姓名' } });
  const email = dom.make({ tag: 'input', attrs: { type: 'email', 'aria-label': '电子邮箱' } });
  dom.body.appendChild(bad); dom.body.appendChild(email);
  Object.defineProperty(bad, 'value', { configurable: true, get() { throw new Error('模拟单字段读取异常'); }, set() {} });
  const hooks = loadContentHooks(dom.doc);
  const result = await hooks.fillForm({ basicInfo: { fullName: '张子涵', email: 'test@example.com' } });
  if (email.value !== 'test@example.com') throw new Error('异常字段后的邮箱未继续填入');
  if (!result.results.some(item => item.status === 'failed' && item.reason.includes('模拟单字段读取异常'))) throw new Error('缺少逐字段失败结果');
  ok('单字段异常不中断后续字段');
} catch (e) { fail('单字段异常隔离', e.stack); }

try {
  const dom = buildFakeDom();
  const name = dom.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '姓名' }, value: '手工姓名' });
  const email = dom.make({ tag: 'input', attrs: { type: 'email', 'aria-label': '电子邮箱' } });
  dom.body.appendChild(name); dom.body.appendChild(email);
  const hooks = loadContentHooks(dom.doc);
  const result = await hooks.fillForm({ basicInfo: { fullName: '张子涵', email: 'test@example.com' } }, { mode: 'incremental' });
  if (name.value !== '手工姓名' || email.value !== 'test@example.com') throw new Error('增量覆盖旧值或未补空白');
  if (result.mode !== 'incremental') throw new Error('增量模式未透传');
  ok('增量模式保留已有值并只补空白');
} catch (e) { fail('增量模式', e.stack); }

try {
  const dom = buildFakeDom();
  const a = dom.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '公司名称' }, rect: { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 } });
  const b = dom.make({ tag: 'input', attrs: { type: 'text', 'aria-label': '职位名称' }, rect: { left: 10, top: 110, right: 110, bottom: 140, width: 100, height: 30 } });
  dom.body.appendChild(a); dom.body.appendChild(b);
  const hooks = loadContentHooks(dom.doc);
  const regions = [
    { left: 0, top: 0, right: 150, bottom: 80 },
    { left: 0, top: 0, right: 150, bottom: 80 },
    { left: 0, top: 90, right: 150, bottom: 160 }
  ];
  const collected = hooks.collectYanyuRegionFields(regions);
  if (collected.refs.length !== 2) throw new Error(`多区域字段未去重: ${collected.refs.length}`);
  if (collected.skippedHasValue !== 0) throw new Error('空字段跳过计数异常');
  ok('多区域字段扫描去重且计数稳定');
} catch (e) { fail('多区域去重', e.stack); }

// ---------------------------------------------------------------------------
section('扩展资料与附件事务');

try {
  const { storageManager: sm, profileLanguageScores, languageEntryExam } = loadScript('scripts/storage.js');
  const legacy = {
    languageSkills: { cet4: '408', cet6: '562分', ielts: '7.5分', otherLanguages: '日语 N3、德语 B2' },
    languageCertificates: [
      { id: 'cet6-detail', name: '大学英语六级（CET-6）', score: '610', obtainedDate: '2024-12-15' },
      { id: 'ielts-detail', name: '雅思（IELTS）', score: '7.5', obtainedDate: '2025-03' }
    ]
  };
  const migrated = sm.normalizeProfile(structuredClone(legacy));
  const scores = profileLanguageScores(migrated);
  if (migrated.languageCertificates.length !== 5 || scores.cet4 !== '408' || scores.cet6 ||
      scores.ielts !== '7.5' || scores.otherLanguages !== legacy.languageSkills.otherLanguages) {
    throw Error('旧成绩、重复成绩或小语种备注迁移错误');
  }
  if (migrated.languageCertificates.find(item => item.id === 'cet6-detail')?.obtainedDate !== '2024-12-15') {
    throw Error('证书日期丢失');
  }
  if (migrated.languageCertificates.find(item => item.id === 'legacy-language-cet4')?.id !==
      sm.normalizeProfile(structuredClone(legacy)).languageCertificates[2].id) throw Error('迁移 ID 不稳定');
  migrated.languageCertificates.find(item => item.id === 'cet6-detail').preferred = '是';
  migrated.languageCertificates = migrated.languageCertificates.filter(item => languageEntryExam(item) !== 'cet4');
  const reloaded = sm.normalizeProfile(migrated);
  if (profileLanguageScores(reloaded).cet4 || profileLanguageScores(reloaded).cet6 !== '610') {
    throw Error('删除后旧数据复现，或默认成绩未生效');
  }
  ok('外语旧成绩迁移、重复保留、默认选择及删除');
} catch (e) {
  fail('外语旧成绩迁移', e.message);
}
try {
  const { storageManager: sm, familyResidence, mergeProfile } = loadScript('scripts/storage.js');
  const original = sm.normalizeProfile({ basicInfo: {
    homeProvince: '广东省', homeCity: '深圳市', homeDistrict: '南山区', homeAddress: '示例路 1 号', gaokaoScore: '600'
  }});
  if (original.basicInfo.homeAddress !== '广东省深圳市南山区示例路 1 号' || Object.hasOwn(original.basicInfo, 'gaokaoScore')) {
    throw Error('旧家庭地址未合并或仍暴露高考字段');
  }
  const updated = sm.normalizeProfile(mergeProfile(original, { basicInfo: { homeAddress: '浙江省杭州市西湖区示例路 2 号' } }));
  const parsed = familyResidence(updated.basicInfo);
  if (parsed.homeProvince !== '浙江省' || parsed.homeCity !== '杭州市' || parsed.homeDistrict !== '西湖区') throw Error('仍使用旧省市区');
  const cleared = sm.normalizeProfile(mergeProfile(original, { basicInfo: { homeAddress: '' } }));
  if (familyResidence(cleared.basicInfo).homeAddress || cleared.basicInfo.homeProvince) throw Error('清空后旧地址回填');
  ok('家庭地址兼容旧资料，编辑和清空后不会回填旧省市区');
} catch (error) { fail('家庭地址合并', error.stack); }
try {
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  const files = new Map();
  ctx.attachmentStore.put = async file => { files.set(file.id, file); };
  ctx.attachmentStore.get = async id => files.get(id);
  ctx.attachmentStore.remove = async id => files.delete(id);
  await sm.initialize();
  const { id } = await sm.getActiveProfile();
  await sm.updateProfile(id, { basicInfo: { fullName: '测试姓名' }, projects: [{ id: 'source-project', name: '测试项目' }] });
  await sm.saveAttachment(id, 'resume', { name: 'resume.txt', type: 'text/plain', dataUrl: 'data:text/plain;base64,YWJj' });
  const original = await sm.getActiveProfile();
  const copyId = await sm.addProfile('简历副本', id);
  const copy = await sm.getActiveProfile();
  if (copy.id !== copyId || copy.id === id || copy.name !== '简历副本') throw Error('副本身份或激活状态错误');
  if (copy.basicInfo.fullName !== '测试姓名' || copy.projects[0].name !== '测试项目' || copy.projects[0].id === original.projects[0].id) throw Error('复制经历失败');
  if (!copy.attachments.resume || copy.attachments.resume.id === original.attachments.resume.id) throw Error('副本复用了附件 ID');
  await sm.deleteProfile(copyId);
  if (!files.has(original.attachments.resume.id)) throw Error('删除副本影响原附件');
  const previousSave = sm.saveAll.bind(sm);
  sm.saveAll = async () => { throw Error('模拟保存失败'); };
  let rolledBack = false;
  try { await sm.addProfile('无法保存的副本', id); } catch { rolledBack = files.size === 1; }
  sm.saveAll = previousSave;
  if (!rolledBack) throw Error('副本写入失败后未清理附件');
  await sm.addProfile('空白简历');
  const empty = await sm.getActiveProfile();
  if (empty.basicInfo.fullName || empty.attachments.resume || empty.projects.some(project => project.name)) throw Error('空简历带入了原数据');
  ok('创建空简历与复制简历，附件独立、失败回滚');
} catch (error) { fail('新建与复制简历', error.stack); }
try {
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  const files = new Map();
  ctx.attachmentStore.put = async file => { files.set(file.id, file); };
  ctx.attachmentStore.get = async id => files.get(id);
  ctx.attachmentStore.remove = async id => files.delete(id);
  await sm.initialize();
  const initial = await sm.getActiveProfile();
  const eduId = initial.education[0].id;
  await sm.updateProfile(initial.id, { basicInfo: { hometown: '旧籍贯', customLegacy: '保留' },
    education: [{ id: eduId, degree: '本科', startDate: '2020-09', customLegacy: '旧字段' }] });
  await sm.updateProfile(initial.id, { basicInfo: { fullName: '独立测试' }, education: [{ id: eduId, major: '测试专业' }] });
  const p = await sm.getActiveProfile();
  if (p.basicInfo.customLegacy !== '保留' || p.basicInfo.sourcePlace || p.basicInfo.registeredAddress ||
      p.education[0].academicDegree || p.education[0].startDate !== '2020-09' || p.education[0].customLegacy !== '旧字段') throw new Error('旧字段/日期精度/地址独立性被破坏');
  const file = { name: 'sample.txt', dataUrl: 'data:text/plain;base64,YWJj', size: 3, type: 'text/plain' };
  await sm.saveAttachment(p.id, 'resume', file);
  const original = (await sm.getActiveProfile()).attachments.resume;
  const save = sm.saveAll.bind(sm);
  sm.saveAll = async () => { throw new Error('模拟存储写入失败'); };
  let rejected = false;
  try { await sm.saveAttachment(p.id, 'resume', { ...file, name: 'replacement.txt' }); } catch { rejected = true; }
  sm.saveAll = save;
  if (!rejected || !(await sm.getAttachment(p.id, original.id)).dataUrl.endsWith('YWJj')) throw new Error('保存失败丢失原附件');
  const backup = await sm.exportData();
  const bad = JSON.parse(backup); bad.attachmentContents[original.id].size = 99;
  rejected = false;
  try { await sm.importData(JSON.stringify(bad)); } catch { rejected = true; }
  if (!rejected || (await sm.getActiveProfile()).attachments.resume.id !== original.id) throw new Error('无效导入替换现有资料');
  await sm.importData(backup);
  const restored = await sm.getActiveProfile();
  if ((await sm.getAttachment(restored.id, restored.attachments.resume.id)).dataUrl !== file.dataUrl) throw new Error('附件导出导入不一致');
  await sm.updateProfile(p.id, { resumeFile: file.dataUrl, resumeFileName: 'legacy.txt' });
  const legacy = await sm.loadAll();
  sm.saveAll = async () => { throw new Error('迁移保存失败'); };
  await sm.migrateAttachments(legacy);
  sm.saveAll = save;
  if (legacy.profiles[0].resumeFile !== file.dataUrl) throw new Error('迁移失败未保留内联文件');
  await sm.migrateAttachments(legacy);
  if ((await sm.getActiveProfile()).resumeFile) throw new Error('成功迁移未移除内联文件');
  ok('旧资料合并、日期/学位/地址隔离、附件迁移与失败原子性、完整备份往返');
} catch (error) { fail('扩展资料与附件事务', error.stack); }

try {
  const ctx = loadScript('scripts/resume-parser.js');
  const clean = ctx.resumeParser.validateAndCleanData({ education: [{ school: '测试高中', degree: '高中', startDate: '2020-09' }], papers: [{ name: '测试论文', date: '2024-01-12' }], commonAnswers: { programmingLanguages: ['JS', 'Python'] } });
  if (clean.education[0].academicDegree || clean.education[0].startDate !== '2020-09' || clean.papers[0].date !== '2024-01-12' || clean.commonAnswers.programmingLanguages.join() !== 'JS,Python') throw new Error('AI 清洗丢失新增字段或补造事实');
  const repeated = ctx.resumeParser.validateAndCleanData({ education: [{ school: '同校', degree: '本科', academicDegree: '学士' }, { school: '同校', degree: '硕士', academicDegree: '硕士学位' }] });
  if (repeated.education[1].academicDegree !== '硕士学位') throw new Error('同校不同经历串用学位');
  const safe = ctx.profileWithoutFiles({ basicInfo: { fullName: '测试' }, resumeFile: 'BINARY', attachments: { resume: { dataUrl: 'BINARY' } } });
  if (JSON.stringify(safe).includes('BINARY')) throw new Error('普通 AI 上下文包含附件');
  ok('AI 扩展字段、日期精度与附件二进制隔离');
} catch (error) { fail('AI 扩展结构', error.stack); }

try {
  const p = loadScript('scripts/resume-parser.js').resumeParser;
  const settings = { aiEnabled: true, aiApiKey: 'test', aiProvider: 'doubao', aiModel: 'ep-custom', ocrApiKey: 'test' };
  const file = new File(['image'], 'resume.png', { type: 'image/png' });
  const calls = [];
  p.parseDirectFile = async () => { calls.push('direct'); return { basicInfo: {} }; };
  p.ocrFile = async () => { calls.push('ocr'); return '这是一份仅用于测试的简历，包含足够长度的真实格式占位文字。'; };
  p.parseWithAI = async () => { calls.push('text'); return { basicInfo: {} }; };
  await p.parseFileWithAI(file, settings);
  if (calls.join() !== 'direct') throw Error('多模态成功仍调用 OCR');
  calls.length = 0;
  p.parseDirectFile = async () => { calls.push('direct'); throw Object.assign(new Error('This model does not support image input'), { status: 400 }); };
  const text = '这是一份仅用于测试的简历，包含足够长度的真实格式占位文字。';
  await p.parseFileWithAI(file, settings, { fallbackText: text });
  if (calls.join() !== 'direct,text') throw Error('不支持图像时未回退至已提供的文字');
  calls.length = 0;
  try { await p.parseFileWithAI(file, settings); throw Error('图片无文字时应提示改用视觉模型'); }
  catch (error) { if (!error.message.includes('视觉输入')) throw error; }
  if (calls.join() !== 'direct') throw Error('旧 OCR Key 触发了额外请求');
  for (const status of [401, 429, 503]) {
    calls.length = 0;
    p.parseDirectFile = async () => { throw Object.assign(new Error('request failed'), { status }); };
    try { await p.parseFileWithAI(file, settings); throw Error('应保留 API 错误'); }
    catch (error) { if (error.status !== status) throw error; }
    if (calls.length) throw Error('普通 API 错误触发了 OCR');
  }
  ok('多模态优先、能力不支持回退及 API 错误隔离');
} catch (error) { fail('多模态路由', error.stack); }

try {
  const p = loadScript('scripts/resume-parser.js').resumeParser;
  const file = new File(['pdf'], 'resume.pdf', { type: 'application/pdf' });
  const settings = { aiProvider: 'openai', aiModel: 'gpt-4o' };
  if (!p.canSendFileDirect(settings, file)) throw Error('视觉模型未优先读取 PDF');
  p.renderPdfPagesToPng = async () => [{ mime: 'image/png', base64: 'PAGE_ONE' }, { mime: 'image/png', base64: 'PAGE_TWO' }];
  p.callOpenAICompatible = async (_settings, _provider, messages) => {
    const content = messages[1].content;
    if (content[1].image_url.url !== 'data:image/png;base64,PAGE_ONE' || content[2].image_url.url !== 'data:image/png;base64,PAGE_TWO') throw Error('PDF 页顺序或图像格式错误');
    return '{"basicInfo":{}}';
  };
  await p.parseDirectFile(file, settings);
  const cleaned = p.validateAndCleanData({ basicInfo: { fullName: '欧阳某某' } });
  if (cleaned.basicInfo.lastName || cleaned.basicInfo.firstName) throw Error('仍在自动猜测姓名拆分');
  ok('PDF 多页直接视觉提取与姓名不推断');
} catch (error) { fail('PDF 视觉与提取约束', error.stack); }

try {
  const p = loadScript('scripts/resume-parser.js').resumeParser;
  const sm = loadScript('scripts/storage.js').storageManager;
  const old = sm.normalizeProfile({ basicInfo: { politicalJoinDate: '2016-09' } });
  if (old.basicInfo.politicalJoinDate !== '2016-09' || old.basicInfo.leagueJoinDate || old.basicInfo.partyJoinDate) throw Error('旧日期丢失或被自动归类');
  const parsed = p.validateAndCleanData({ basicInfo: { leagueJoinDate: '2016-09', partyJoinDate: '2022-06-15' } });
  if (parsed.basicInfo.leagueJoinDate !== '2016-09' || parsed.basicInfo.partyJoinDate !== '2022-06-15') throw Error('独立日期或精度丢失');
  const saved = sm.normalizeProfile({ ...old, basicInfo: { ...old.basicInfo, ...parsed.basicInfo } });
  if (saved.basicInfo.politicalJoinDate !== '2016-09' || saved.basicInfo.leagueJoinDate !== '2016-09' || saved.basicInfo.partyJoinDate !== '2022-06-15') throw Error('新旧日期未独立保留');
  ok('入团与入党日期独立保存，旧合并日期不推断');
} catch (error) { fail('政治身份日期拆分', error.stack); }

try {
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  const files = new Map();
  ctx.attachmentStore.put = async file => { files.set(file.id, file); };
  ctx.attachmentStore.get = async id => files.get(id);
  ctx.attachmentStore.remove = async id => { files.delete(id); };
  await sm.initialize();
  const data = await sm.loadAll();
  const profile = data.profiles[0];
  function fill(value, prefix = '') {
    if (Array.isArray(value)) return value.map((v, i) => fill(v, `${prefix}${i}`));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
      ['id', 'createdAt', 'updatedAt'].includes(k) ? v : fill(v, `${prefix}.${k}`)]));
    return typeof value === 'string' ? `测试${prefix}` : value;
  }
  Object.assign(profile, fill(profile));
  profile.attachments = { resume: null, idPhoto: null, lifePhoto: null, works: [] };
  Object.assign(profile.basicInfo, { birthDate: '2000-02-29', leagueJoinDate: '2016-09', partyJoinDate: '2022-06-15', politicalJoinDate: '旧日期', extraLegacy: '原字段' });
  for (const key of ['papers', 'patents', 'openSource', 'customAnswers', 'declarations']) profile[key] = [{ id: `record-${key}`, name: `测试-${key}`, date: '2024-09', extraLegacy: '保留' }];
  profile.commonAnswers.programmingLanguages = ['JS', 'Python'];
  profile.introTemplates.custom = [{ name: '自定义模板', content: '保留内容' }];
  profile.skills = ['测试技能'];
  data.profiles.push({ ...structuredClone(profile), id: 'second-profile', name: '第二份资料' });
  data.settings.extraSetting = '保留';
  data.submissions = [{ id: 'submission', company: '测试企业' }];
  data.logs = [{ id: 'log', message: '测试日志' }];
  await sm.saveAll(data);
  for (const [kind, name, type] of [['resume', 'resume.txt', 'text/plain'], ['idPhoto', 'id.png', 'image/png'], ['lifePhoto', 'life.png', 'image/png'], ['works', 'work1.txt', 'text/plain'], ['works', 'work2.txt', 'text/plain']]) {
    await sm.saveAttachment(profile.id, kind, { name, type, size: 3, dataUrl: `data:${type};base64,YWJj` });
  }
  const backup = await sm.exportData();
  await sm.importData(backup);
  const restored = await sm.exportData();
  function canonical(json) {
    const data = JSON.parse(json);
    const contents = data.attachmentContents;
    delete data.attachmentContents; delete data.updatedAt; delete data.activeProfileId;
    for (const p of data.profiles) {
      // 导入会为避免冲突生成新的资料/附件 ID；比较内容与结构，不比较内部身份标识。
      delete p.id;
      for (const ref of [p.attachments.resume, p.attachments.idPhoto, p.attachments.lifePhoto, ...p.attachments.works].filter(Boolean)) {
        ref.dataUrl = contents[ref.id].dataUrl; delete ref.id;
      }
    }
    return JSON.stringify(data);
  }
  if (canonical(backup) !== canonical(restored)) throw Error('资料/设置/记录/模板/附件内容往返不一致');
  const beforeFailure = canonical(restored);
  const save = sm.saveAll.bind(sm);
  sm.saveAll = async () => { throw Error('模拟导入最后写入失败'); };
  let rejected = false;
  try { await sm.importData(backup); } catch { rejected = true; }
  sm.saveAll = save;
  if (!rejected || canonical(await sm.exportData()) !== beforeFailure) throw Error('导入写入失败损坏旧数据');
  ok('完整备份往返保留多资料、全部字段、模板、设置、投递记录及五份附件，失败不覆盖');
} catch (error) { fail('完整备份往返', error.stack); }

// ---------------------------------------------------------------------------
section('塔塔对齐新增 basicInfo 字段');

const NEW_BASIC_INFO_KEYS = [
  'englishName', 'wechat', 'qq', 'idCardType', 'bloodType', 'registeredAddressType', 'religion',
  'honor', 'specialSkills', 'openToWork', 'permanentResidencePermit', 'jobSources',
  'foreignCitizenship', 'relativesEmployed', 'yearsOfWork',
  'lastNamePinyin', 'firstNamePinyin', 'namePinyinFull', 'personalPromise'
];

try {
  // —— 存储：默认空资料含 19 个新键；旧资料经 fixData 归一化回填空串 ——
  const ctx = loadScript('scripts/storage.js');
  const sm = ctx.storageManager;
  const empty = sm.getEmptyProfile();
  for (const key of NEW_BASIC_INFO_KEYS) {
    if (!(key in empty.basicInfo)) throw new Error(`getEmptyProfile 缺少 ${key}`);
    if (empty.basicInfo[key] !== '') throw new Error(`${key} 默认值应为空串`);
  }
  const legacy = sm.fixData({ profiles: [{ id: 'p1', name: '旧资料', basicInfo: { fullName: '张三' } }], settings: {} });
  for (const key of NEW_BASIC_INFO_KEYS) {
    if (legacy.profiles[0].basicInfo[key] !== '') throw new Error(`fixData 未回填 ${key}`);
  }
  if (legacy.profiles[0].basicInfo.fullName !== '张三') throw new Error('fixData 破坏旧字段');
  // profile-schema 与存储键一致（编辑器/解析器/复制抽屉共用；schema 是 const，从源码文本断言）
  const schemaJsTt = read('scripts/profile-schema.js');
  const schemaBasicBlock = schemaJsTt.slice(schemaJsTt.indexOf('basicInfo: {'), schemaJsTt.indexOf('jobIntention: {'));
  const missingSchema = NEW_BASIC_INFO_KEYS.filter((key) => !new RegExp(`${key}: '[^']+'`).test(schemaBasicBlock));
  if (missingSchema.length) throw new Error('profileSchema.basicInfo 缺少: ' + missingSchema.join(', '));
  ok('新增 19 键默认值、旧资料回填与 schema 一致');
} catch (e) {
  fail('新增字段存储与 schema', e.message);
}

try {
  // —— 填充引擎：FIELD_PATTERNS 识别（matchFieldType 真链路，aria-label 作为 label）——
  const domTt = buildFakeDom();
  const hooksTt = loadContentHooks(domTt.doc);
  const labelToType = (label) => {
    const el = domTt.make({ tag: 'input', attrs: { type: 'text', 'aria-label': label } });
    domTt.body.appendChild(el);
    return hooksTt.matchFieldType(el);
  };
  const cases = [
    ['英文名', 'englishName'], ['English Name', 'englishName'],
    ['微信号', 'wechat'], ['微信', 'wechat'], ['WeChat', 'wechat'],
    ['QQ', 'qq'], ['QQ号', 'qq'],
    ['证件类型', 'idCardType'], ['证件种类', 'idCardType'],
    ['血型', 'bloodType'],
    ['户籍类型', 'registeredAddressType'], ['户口性质', 'registeredAddressType'],
    ['宗教信仰', 'religion'], ['宗教', 'religion'],
    ['荣誉奖励', 'honor'], ['荣誉称号', 'honor'],
    ['特长', 'specialSkills'], ['特殊技能', 'specialSkills'],
    ['求职状态', 'openToWork'], ['在职状态', 'openToWork'],
    ['居住证号', 'permanentResidencePermit'], ['居住证', 'permanentResidencePermit'],
    ['招聘来源', 'jobSources'], ['是否取得外国国籍', 'foreignCitizenship'], ['外国居留权', 'foreignCitizenship'],
    ['亲属回避', 'relativesEmployed'],
    ['工作年限', 'yearsOfWork'], ['工作年数', 'yearsOfWork'],
    ['姓拼音', 'lastNamePinyin'], ['姓氏拼音', 'lastNamePinyin'],
    ['名拼音', 'firstNamePinyin'], ['名字拼音', 'firstNamePinyin'],
    ['姓名全拼', 'namePinyinFull'], ['姓名拼音', 'namePinyinFull'], ['全拼', 'namePinyinFull'],
    ['Personal Promise', 'personalPromise'],
    ['年龄', 'age'], ['周岁', 'age'], ['Age', 'age']
  ];
  for (const [label, expected] of cases) {
    const got = labelToType(label);
    if (got !== expected) throw new Error(`label "${label}" 识别为 ${got}，应为 ${expected}`);
  }
  ok(`新增字段 FIELD_PATTERNS 识别（${cases.length} 个 label 变体含 age）`);
} catch (e) {
  fail('新增字段 FIELD_PATTERNS 识别', e.message);
}

try {
  // —— 负向与既有优先级：泛化词不被新字段抢占、新字段不误命中近似 label ——
  const domNg = buildFakeDom();
  const hooksNg = loadContentHooks(domNg.doc);
  const labelToType = (label) => {
    const el = domNg.make({ tag: 'input', attrs: { type: 'text', 'aria-label': label } });
    domNg.body.appendChild(el);
    return hooksNg.matchFieldType(el);
  };
  const negatives = [
    ['电子邮箱', 'email'],            // 微信号模糊词不得命中电子邮箱
    ['证件号码', 'idCard'],           // 证件类型模式不得命中证件号码
    ['信息来源', 'recruitSource'],    // 既有别名优先保留
    ['荣誉', 'awards'],               // 荣誉奖励具体词不抢占泛化"荣誉"
    ['技能', 'skills'], ['专业技能', 'skills'],  // 特长字段不抢占技能类 label
    ['姓名', 'fullName'], ['紧急联系人姓名', 'emergencyContact'],
    ['出生日期', 'birthDate'],        // 年龄词不抢占出生日期
    ['语言能力', null]                // \bage\b 不误命中 language
  ];
  for (const [label, expected] of negatives) {
    const got = labelToType(label);
    if (got !== expected) throw new Error(`label "${label}" 识别为 ${got}，应为 ${expected}`);
  }
  ok('新增字段负向：电子邮箱/证件号码/泛化词优先级不受影响');
} catch (e) {
  fail('新增字段负向匹配', e.message);
}

try {
  // —— 年龄动态计算：未过生日减 1，已过/当天不减，缺料不填 ——
  const domAge = buildFakeDom();
  const hooksAge = loadContentHooks(domAge.doc);
  const { computeAgeFromBirthDate: ageOf } = hooksAge;
  if (ageOf('2003-05-05', new Date('2026-04-10T10:00:00')) !== '22') throw new Error('未过生日应减 1');
  if (ageOf('2003-05-05', new Date('2026-05-06T10:00:00')) !== '23') throw new Error('已过生日应为 23');
  if (ageOf('2003-05-05', new Date('2026-05-05T10:00:00')) !== '23') throw new Error('生日当天应为 23');
  if (ageOf('2003-05-05', new Date('2003-05-04T10:00:00')) !== '-1' && ageOf('2003-05-05', new Date('2003-05-04T10:00:00')) !== '') throw new Error('出生前异常输入应返回空串');
  if (ageOf('', new Date()) !== '') throw new Error('birthDate 缺失应返回空串');
  if (ageOf('not-a-date', new Date()) !== '') throw new Error('无法解析应返回空串');
  if (ageOf('2003-05', new Date('2026-04-10T10:00:00')) !== '22') throw new Error('YYYY-MM 月份粒度应可用');
  if (ageOf('2003年5月5日', new Date('2026-05-06T10:00:00')) !== '23') throw new Error('中文日期应可用');
  ok('年龄按出生日期动态计算（未过/已过生日、缺料不填）');
} catch (e) {
  fail('年龄动态计算', e.message);
}

try {
  // —— 速查抽屉：有值显示、无值不显示，且不被动态探测重复补一行 ——
  const domCp = buildFakeDom();
  const hooksCp = loadContentHooks(domCp.doc);
  const profileCp = { basicInfo: { fullName: '张子涵', wechat: 'wxid_abc123', idCardType: '身份证' } };
  const itemsCp = hooksCp.getCopyItemsForCategory(profileCp, 'basic');
  const labelsCp = itemsCp.map((item) => item.label);
  if (!labelsCp.includes('微信号') || itemsCp[labelsCp.indexOf('微信号')].val !== 'wxid_abc123') throw new Error('微信号速查行缺失');
  if (!labelsCp.includes('证件类型')) throw new Error('证件类型速查行缺失');
  if (labelsCp.includes('QQ号') || labelsCp.includes('血型') || labelsCp.includes('英文名')) throw new Error('无值字段不应显示');
  if (labelsCp.filter((label) => label === '微信号').length !== 1) throw new Error('微信号行重复（knownBasicKeys 漏加）');
  const emptyItemsCp = hooksCp.getCopyItemsForCategory({ basicInfo: {} }, 'basic');
  if (emptyItemsCp.some((item) => ['微信号', '证件类型', '个人声明/承诺'].includes(item.label))) throw new Error('空资料不应出现新增速查行');
  ok('速查抽屉新增条目有值才显示且不重复');
} catch (e) {
  fail('速查抽屉新增条目', e.message);
}

try {
  // —— 选区填入映射：证件类型→idCardType 而非 idCard；拼音三兄弟与泛化姓名的优先级 ——
  const domRgTt = buildFakeDom();
  const hooksRgTt = loadContentHooks(domRgTt.doc);
  const entryTt = {
    idCard: '110101200301011234', idCardType: '身份证', registeredAddress: '山东青岛', registeredAddressType: '居民户',
    fullName: '张子涵', lastNamePinyin: 'zhang', firstNamePinyin: 'zihan', namePinyinFull: 'zhangzihan'
  };
  const fieldsTt = hooksRgTt.regionFieldizeEntry('basicInfo', entryTt);
  const matchKeyTt = (label) => {
    const hit = hooksRgTt.regionMatchRuleField(label, fieldsTt);
    return hit ? hit.field.key : null;
  };
  if (matchKeyTt('证件类型') !== 'idCardType') throw new Error('证件类型应命中 idCardType 而非 idCard');
  if (matchKeyTt('证件号码') !== 'idCard') throw new Error('证件号码仍应命中 idCard');
  if (matchKeyTt('户籍类型') !== 'registeredAddressType') throw new Error('户籍类型应先于户籍地泛匹配');
  if (matchKeyTt('户籍所在地') !== 'registeredAddress') throw new Error('户籍地泛匹配应保留');
  if (matchKeyTt('姓名拼音') !== 'namePinyinFull') throw new Error('姓名拼音应命中全拼而非名拼音子串');
  if (matchKeyTt('姓氏拼音') !== 'lastNamePinyin') throw new Error('姓氏拼音应命中姓拼音');
  if (matchKeyTt('名拼音') !== 'firstNamePinyin') throw new Error('名拼音应命中名拼音');
  if (matchKeyTt('姓名') !== 'fullName') throw new Error('泛化姓名匹配应保留');
  if (matchKeyTt('微信号') !== null || matchKeyTt('工作年限') !== null) throw new Error('资料未提供的字段不应命中');
  const entryWechat = { wechat: 'wxid_abc', qq: '123456789' };
  const fieldsWc = hooksRgTt.regionFieldizeEntry('basicInfo', entryWechat);
  const hitWc = hooksRgTt.regionMatchRuleField('微信', fieldsWc);
  if (!hitWc || hitWc.field.key !== 'wechat' || hitWc.field.value !== 'wxid_abc') throw new Error('微信选区映射失败');
  ok('选区填入 basicInfo 映射补 19 项且优先级正确');
} catch (e) {
  fail('选区填入新增映射', e.message);
}

try {
  // —— AI 摘要：新字段有值进摘要，无值不占位 ——
  const domDg = buildFakeDom();
  const hooksDg = loadContentHooks(domDg.doc);
  const digestTt = JSON.parse(hooksDg.buildSmartFillProfileDigest({
    basicInfo: { fullName: '张子涵', wechat: 'wxid_abc', yearsOfWork: '3', personalPromise: '是' },
    education: []
  }));
  if (digestTt.basicInfo.wechat !== 'wxid_abc' || digestTt.basicInfo.yearsOfWork !== '3' || digestTt.basicInfo.personalPromise !== '是') throw new Error('新字段未进 AI 摘要');
  if ('qq' in digestTt.basicInfo || 'honor' in digestTt.basicInfo) throw new Error('空新字段应被剔除');
  ok('AI 摘要包含新增字段（有值进、无值不进）');
} catch (e) {
  fail('AI 摘要新增字段', e.message);
}

try {
  // —— 解析 prompt：basicInfo 空值模板包含 19 个新键（schema 含义与清洗走动态链路）——
  const parserJsTt = read('scripts/resume-parser.js');
  const templateStart = parserJsTt.indexOf('"basicInfo": {');
  const templateEnd = parserJsTt.indexOf('"jobIntention": {');
  if (templateStart < 0 || templateEnd < 0) throw new Error('未找到解析 prompt 的 basicInfo 模板');
  const templateTt = parserJsTt.slice(templateStart, templateEnd);
  const missingTt = NEW_BASIC_INFO_KEYS.filter((key) => !new RegExp(`"${key}": ""`).test(templateTt));
  if (missingTt.length) throw new Error('prompt 模板缺少: ' + missingTt.join(', '));
  ok('AI 简历解析 prompt 模板补 19 键');
} catch (e) {
  fail('解析 prompt 新增键', e.message);
}

try {
  // —— 配置页：保留有效旧字段入口，重复/声明显式隐藏但 schema 与存储继续兼容 ——
  const optionsJsTt = read('options/options.js');
  const orderStart = optionsJsTt.indexOf("basicInfo: [");
  const orderEnd = optionsJsTt.indexOf('],', orderStart);
  if (orderStart < 0) throw new Error('未找到 EXTENDED_FIELD_ORDER.basicInfo');
  const orderTt = optionsJsTt.slice(orderStart, orderEnd);
  const hidden = ['honor', 'specialSkills', 'jobSources', 'foreignCitizenship', 'relativesEmployed', 'personalPromise'];
  const visibleLegacy = NEW_BASIC_INFO_KEYS.filter((key) => !hidden.includes(key));
  const missingOrder = visibleLegacy.filter((key) => !orderTt.includes(`'${key}'`));
  if (missingOrder.length) throw new Error('基础高级字段缺少: ' + missingOrder.join(', '));
  const stillVisible = hidden.filter((key) => orderTt.includes(`'${key}'`));
  if (stillVisible.length) throw new Error('重复/声明旧字段仍显示: ' + stillVisible.join(', '));
  ok('配置页旧字段去重，隐藏入口但保留存储兼容');
} catch (e) {
  fail('配置页旧字段去重', e.message);
}

try {
  // —— 竞品语义并集：新字段精确识别，不被旧泛化规则抢占 ——
  const domUnion = buildFakeDom();
  const hooksUnion = loadContentHooks(domUnion.doc);
  const cases = [
    ['期望行业', 'extended:jobIntention:expectedIndustry'],
    ['人事档案所在单位', 'extended:basicInfo:archiveOrganization'],
    ['专业分类', 'extended:education:majorCategory'],
    ['证明人', 'extended:workExperience:referenceName'],
    ['奖项级别', 'extended:awards:level'],
    ['证书等级', 'extended:certificates:level'],
    ['组织/社团名称', 'extended:campusPositions:organization'],
    ['培训名称', 'extended:trainings:name']
  ];
  for (const [label, expected] of cases) {
    const input = domUnion.make({ tag: 'input', attrs: { type: 'text', 'aria-label': label } });
    domUnion.body.appendChild(input);
    const actual = hooksUnion.detectField(input)?.fieldType;
    if (actual !== expected) throw new Error(`${label} 识别为 ${actual}，应为 ${expected}`);
  }
  const workFields = hooksUnion.regionFieldizeEntry('workExperience', {
    company: '测试公司', industry: '金融', referenceName: '测试证明人', city: '深圳'
  }).map(field => field.key);
  for (const key of ['company', 'industry', 'referenceName', 'city']) {
    if (!workFields.includes(key)) throw new Error(`选区工作字段缺少 ${key}`);
  }
  ok('OfferLink/塔塔新增字段精确识别与选区映射');
} catch (e) {
  fail('竞品字段并集映射', e.message);
}

try {
  // —— 家庭成员与培训分区：共享 label 不得误用本人或其他模块资料 ——
  const domSections = buildFakeDom();
  const hooksSections = loadContentHooks(domSections.doc);
  const makeSectionInput = (title, label) => {
    const section = domSections.make({ tag: 'section' });
    const heading = domSections.make({ tag: 'h2' });
    heading.textContent = title;
    const input = domSections.make({ tag: 'input', attrs: { type: 'text', 'aria-label': label } });
    section.appendChild(heading);
    section.appendChild(input);
    domSections.body.appendChild(section);
    return input;
  };
  for (const [label, expected] of [
    ['出生日期', 'extended:familyMembers:birthDate'],
    ['政治面貌', 'extended:familyMembers:politicalStatus'],
    ['家庭所在地', 'extended:familyMembers:homeAddress']
  ]) {
    const input = makeSectionInput('家庭成员', label);
    const actual = hooksSections.detectField(input)?.fieldType;
    if (actual !== expected) throw new Error(`家庭成员 ${label} 识别为 ${actual}`);
  }
  for (const [label, expected] of [
    ['培训名称', 'extended:trainings:name'],
    ['开始时间', 'extended:trainings:startDate'],
    ['结束时间', 'extended:trainings:endDate']
  ]) {
    const input = makeSectionInput('培训经历', label);
    const actual = hooksSections.detectField(input)?.fieldType;
    if (actual !== expected) throw new Error(`培训 ${label} 识别为 ${actual}`);
  }
  ok('家庭成员与培训分区字段精确隔离');
} catch (e) {
  fail('家庭成员与培训分区识别', e.message);
}

try {
  // —— AI 清洗：先过滤基础空条目也不得让扩展字段前移 ——
  const cleanedUnion = parser.validateAndCleanData({
    workExperience: [
      { company: '', position: '', referenceName: '空条目证明人', industry: '' },
      { company: '甲公司', position: '实习', referenceName: '甲证明人', industry: '金融' },
      { company: '乙公司', position: '全职', referenceName: '乙证明人', industry: '互联网' }
    ],
    education: [
      { school: '', major: '', studentId: '空学号' },
      { school: '甲大学', major: '软工', studentId: 'EDU-A' },
      { school: '乙大学', major: '金融', studentId: 'EDU-B' }
    ]
  });
  const workA = cleanedUnion.workExperience[0];
  const workB = cleanedUnion.workExperience[1];
  if (workA.referenceName !== '甲证明人' || workA.industry !== '金融' || workB.referenceName !== '乙证明人' || workB.industry !== '互联网') {
    throw new Error('工作扩展字段发生前移: ' + JSON.stringify(cleanedUnion.workExperience));
  }
  if (cleanedUnion.education[0].studentId !== 'EDU-A' || cleanedUnion.education[1].studentId !== 'EDU-B') {
    throw new Error('教育扩展字段发生前移: ' + JSON.stringify(cleanedUnion.education));
  }
  if (JSON.stringify(cleanedUnion).includes('__sourceIndex')) throw new Error('内部索引不应进入保存结果');
  ok('AI 清洗按原始索引合并扩展字段，空占位不导致前移');
} catch (e) {
  fail('AI 扩展字段原始索引合并', e.message);
}

try {
  // —— 存储兼容：新模块有默认值，隐藏旧键在规范化后仍不丢失 ——
  const ctxUnion = loadScript('scripts/storage.js');
  const smUnion = ctxUnion.storageManager;
  const profileUnion = smUnion.getEmptyProfile();
  profileUnion.basicInfo.honor = '旧荣誉文本';
  profileUnion.basicInfo.specialSkills = '旧特长文本';
  profileUnion.basicInfo.jobSources = '旧招聘来源';
  profileUnion.basicInfo.foreignCitizenship = '否';
  profileUnion.basicInfo.relativesEmployed = '否';
  profileUnion.basicInfo.personalPromise = '是';
  profileUnion.basicInfo.archiveOrganization = '测试档案单位';
  profileUnion.jobIntention.expectedIndustry = '金融';
  profileUnion.education[0].studentId = '20260001';
  profileUnion.workExperience[0].referenceName = '证明人';
  profileUnion.campusPositions = [{ organization: '学生会', title: '部长' }];
  profileUnion.trainings = [{ name: '数据分析培训', institution: '测试机构' }];
  const normalizedUnion = smUnion.normalizeProfile(JSON.parse(JSON.stringify(profileUnion)));
  for (const [key, value] of Object.entries(profileUnion.basicInfo)) {
    if (normalizedUnion.basicInfo[key] !== value) throw new Error(`基础字段兼容丢失 ${key}`);
  }
  if (normalizedUnion.jobIntention.expectedIndustry !== '金融' || normalizedUnion.education[0].studentId !== '20260001' || normalizedUnion.workExperience[0].referenceName !== '证明人') {
    throw new Error('新增字段规范化后丢失');
  }
  if (normalizedUnion.campusPositions[0].organization !== '学生会' || normalizedUnion.trainings[0].name !== '数据分析培训') {
    throw new Error('可选模块规范化后丢失');
  }
  ok('新增字段默认值、可选模块与隐藏旧键存储兼容');
} catch (e) {
  fail('字段并集存储兼容', e.message);
}

try {
  // —— AI 来源校验：只比较终端资料值，拒绝字段名/日期碎片，保留受控学历别名 ——
  const hooksSource = loadContentHooks(buildFakeDom().doc);
  const sourceRef = { label: '成绩', tagName: 'INPUT', type: 'text', sourceText: JSON.stringify({ score: '612', obtainedDate: '2023-12-16' }) };
  for (const bad of ['3', 'score']) {
    const check = hooksSource.validateSmartFillValue(sourceRef, bad);
    if (check.ok) throw new Error(`错误来源值不应通过: ${bad}`);
  }
  if (!hooksSource.validateSmartFillValue(sourceRef, '612').ok) throw new Error('正确成绩应通过');
  const degreeRef = {
    label: '学历', tagName: 'INPUT', type: 'text', options: ['硕士研究生'],
    sourceText: JSON.stringify({ degree: '硕士' })
  };
  if (!hooksSource.validateSmartFillValue(degreeRef, '硕士研究生').ok) throw new Error('受控学历别名应通过');
  if (!hooksSource.validateSmartFillValue(degreeRef, '硕士').ok) throw new Error('原始学历值应通过选项匹配');
  ok('AI 来源按终端值完整比较，拒绝字段名/日期碎片并支持受控别名');
} catch (e) {
  fail('AI 来源终端值校验', e.message);
}

section('汇总');
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} 通过, ${failed} 失败`);
if (failed) {
  console.log('\n失败项:');
  for (const r of results.filter((x) => !x.pass)) console.log(` - ${r.name}: ${r.detail}`);
  process.exit(1);
}
console.log('全部通过，可以再导入浏览器扩展做一次真机点选。');
