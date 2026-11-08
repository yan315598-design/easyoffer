// ============================================================================
// 页面助手连通性编排（popup 使用；与 chrome API 解耦以便 Node 端测试）
// ----------------------------------------------------------------------------
// 流程：受限 URL 检查 → 短超时 contentPing → 仅对"明确无接收端"错误按 manifest
// content_scripts 完整有序列表补注（insertCSS 先于 executeScript）→ 有界重试 ping。
// 只负责连通性；业务任务由调用方在就绪后发送且仅发送一次（runTabTask 保证）。
// 浏览器经 <script> 引入后挂到全局 ContentReady（不进入 content manifest）。
// ============================================================================

(function (global) {
  'use strict';

  // contentPing 短超时：脚本就位时应立即应答，久等视为页面不可达
  var PING_TIMEOUT_MS = 1200;
  // 补注后有界重试 ping 的次数与间隔（脚本注入到监听器生效有延迟）
  var INJECT_RETRY_ATTEMPTS = 4;
  var INJECT_RETRY_DELAY_MS = 300;

  /** 浏览器内置页与扩展商店不允许注入；商店规则使用真实主机名而非历史前缀。 */
  function isRestrictedUrl(url) {
    var u = String(url || '');
    if (u.startsWith('chrome://') || u.startsWith('edge://') || u.startsWith('about:') ||
      u.startsWith('chrome-extension://') || u.startsWith('chrome-web-store')) return true;
    return /^https?:\/\/chromewebstore\.google\.com(?:[\/?#:]|$)/i.test(u) ||
      /^https?:\/\/chrome\.google\.com\/webstore(?:[\/?#:]|$)/i.test(u);
  }

  /**
   * 只有“确无接收端”才允许补注。message port closed 也可能是旧版监听器仍在，
   * 此时补注会让旧、新两个监听器同时执行填入，因此必须交由用户刷新恢复。
   */
  function isMissingReceiverError(err) {
    var msg = err && err.message ? err.message : String(err || '');
    return msg.indexOf('Receiving end') !== -1 ||
      msg.indexOf('Could not establish connection') !== -1;
  }

  /**
   * 从 manifest 中提取补注计划：所有 content_scripts 组的 CSS 与 JS 按声明顺序合并。
   * CSS 先于 JS 注入由调用方保证（insertCSS → executeScript）。
   * @returns {{cssFiles: string[], jsFiles: string[]}}
   */
  function buildScriptPlan(manifest) {
    var cssFiles = [];
    var jsFiles = [];
    var groups = (manifest && manifest.content_scripts) || [];
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i] || {};
      if (Array.isArray(group.css)) cssFiles = cssFiles.concat(group.css);
      if (Array.isArray(group.js)) jsFiles = jsFiles.concat(group.js);
    }
    return { cssFiles: cssFiles, jsFiles: jsFiles };
  }

  function errText(err) {
    return err && err.message ? err.message : String(err || '');
  }

  function injectFailureMessage(err) {
    var msg = errText(err);
    if (/cannot access|Cannot access|not permitted|Permission/i.test(msg)) {
      return '无权限向该页面注入助手脚本（受限站点或扩展站点权限被收回），请在扩展详情中检查网站访问权限，或刷新网页后重试';
    }
    return '向页面注入助手脚本失败：' + msg;
  }

  function fail(reason, message, detail) {
    return { ok: false, reason: reason, message: message, detail: detail || '' };
  }

  var defaultDelay = function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  };

  /**
   * 确保目标标签页上的助手脚本可用。
   * @param {object} ctx
   *   ctx.url {string} 标签页 URL（受限页直接失败，不注入）
   *   ctx.sendPing {() => Promise<object>} 发送 contentPing（短超时由调用方实现）
   *   ctx.inject {() => Promise<void>} 按 manifest 完整顺序补注 CSS + JS
   *   ctx.delay {(ms: number) => Promise} [可选] 重试间隔（测试可注入假时钟）
   *   ctx.onEvent {(evt: string, data?: object) => void} [可选] checking/recovering 事件
   * @returns {Promise<{ok: true, recovered: boolean, version?: string}|
   *   {ok: false, reason: 'restricted'|'unreachable'|'inject-failed'|'inject-not-ready', message: string, detail: string}>}
   */
  async function ensureContentReady(ctx) {
    ctx = ctx || {};
    var emit = typeof ctx.onEvent === 'function' ? ctx.onEvent : function () {};
    var delay = ctx.delay || defaultDelay;

    if (isRestrictedUrl(ctx.url)) {
      return fail('restricted', '浏览器保护此页面。请从资料速查复制内容，再粘贴到目标输入框。');
    }

    emit('checking');
    var pingError = null;
    try {
      var first = await ctx.sendPing();
      if (first && first.success && first.ready) {
        return { ok: true, recovered: false, version: first.version };
      }
      pingError = new Error('contentPing 返回无效响应');
    } catch (err) {
      pingError = err;
    }

    if (!isMissingReceiverError(pingError)) {
      // 超时 / 其他通道错误：页面可能有脚本但无响应，不做盲注入
      return fail('unreachable', '与页面的消息通道无响应（页面可能仍在加载或已卡住），请刷新网页（F5）后重试', errText(pingError));
    }

    emit('recovering');
    try {
      await ctx.inject();
    } catch (err) {
      return fail('inject-failed', injectFailureMessage(err), errText(err));
    }

    for (var attempt = 1; attempt <= INJECT_RETRY_ATTEMPTS; attempt++) {
      await delay(INJECT_RETRY_DELAY_MS);
      try {
        var retry = await ctx.sendPing();
        if (retry && retry.success && retry.ready) {
          return { ok: true, recovered: true, version: retry.version };
        }
      } catch (err) {
        // 仍有接收端缺失类错误或超时：继续有界重试
      }
    }
    return fail('inject-not-ready', '已尝试向页面重新注入助手脚本，但页面仍无响应；请刷新网页（F5）后重试');
  }

  /**
   * 就绪检查 + 业务任务一次性发送的组合入口。
   * 保证：任务仅在连通后发送且只发送一次；任何失败都不会自动重发任务。
   * @param {object} ctx 同 ensureContentReady，另需 ctx.sendTask {() => Promise<object>}
   * @returns {Promise<{ok: true, response: object}|{ok: false, reason: string, message: string, detail: string}>}
   */
  async function runTabTask(ctx) {
    var ready = await ensureContentReady(ctx);
    if (!ready.ok) {
      return ready;
    }
    try {
      var response = await ctx.sendTask();
      return { ok: true, response: response };
    } catch (err) {
      return fail('task-channel-error', '任务执行中与页面的连接中断，请刷新网页（F5）后重试', errText(err));
    }
  }

  var api = {
    isRestrictedUrl: isRestrictedUrl,
    isMissingReceiverError: isMissingReceiverError,
    buildScriptPlan: buildScriptPlan,
    ensureContentReady: ensureContentReady,
    runTabTask: runTabTask,
    PING_TIMEOUT_MS: PING_TIMEOUT_MS,
    INJECT_RETRY_ATTEMPTS: INJECT_RETRY_ATTEMPTS,
    INJECT_RETRY_DELAY_MS: INJECT_RETRY_DELAY_MS
  };

  global.ContentReady = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
