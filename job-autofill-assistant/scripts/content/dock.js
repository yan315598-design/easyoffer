// ============================================================================
// Capybara 网申助手 content script —— dock.js
// 悬浮 Dock 与抽屉：速查/点选填入、AI Copilot、日志面板、主题与拖动
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';
// ========================================================================
// 悬浮挂件与高阶功能 (自由拖动 · 快捷速查 · AI助手 · 字段高亮 · 资料切换)
// ========================================================================

var  isHighlightingFields = false;
var  currentActiveProfile = null;
var  allProfilesCache = [];

var  ICONS = {
  sun: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/><path d="M18.5 2.5v3M20 4h-3" stroke-width="1.5"/></svg>`,
  fill: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12.8 2.2c-.3-.5-1-.3-1.1.2L8.2 12.3c-.1.3.1.6.4.6h3.8l-1.9 8.7c-.2.7.7 1.1 1.1.5l7.2-9.9c.3-.4 0-.9-.5-.9h-3.8l2.5-8.6c.1-.2 0-.5-.2-.7z"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 2.5a.6.6 0 0 1 .5.3l1.8 3.9a3.8 3.8 0 0 0 2 2l3.9 1.8a.6.6 0 0 1 0 1l-3.9 1.8a3.8 3.8 0 0 0-2 2L10.5 21a.6.6 0 0 1-1 0l-1.8-3.9a3.8 3.8 0 0 0-2-2L1.8 13.3a.6.6 0 0 1 0-1l3.9-1.8a3.8 3.8 0 0 0 2-2L9.5 2.8a.6.6 0 0 1 .5-.3zm9.5 12a.5.5 0 0 1 .4.2l.9 1.9a1.9 1.9 0 0 0 1 1l1.9.9a.5.5 0 0 1 0 .8l-1.9.9a1.9 1.9 0 0 0-1 1l-.9 1.9a.5.5 0 0 1-.8 0l-.9-1.9a1.9 1.9 0 0 0-1-1l-1.9-.9a.5.5 0 0 1 0-.8l1.9-.9a1.9 1.9 0 0 0 1-1l.9-1.9a.5.5 0 0 1 .4-.2z"/></svg>`,
  profile: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="11" r="2.5"/><path d="M15 9h3M15 13h3M5.5 16.5c0-1.6 1.6-2.5 3.5-2.5s3.5.9 3.5 2.5"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="13" rx="3"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-6A2.5 2.5 0 0 0 5 5.5v9A2.5 2.5 0 0 0 7.5 17H8"/></svg>`,
  region: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="4 3"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3c5.2 0 9.5 3.6 9.5 8s-4.3 8-9.5 8c-1.1 0-2.2-.2-3.2-.5L4 20.5a.6.6 0 0 1-.8-.8l1.3-3.6C3.4 14.8 2.5 13 2.5 11c0-4.4 4.3-8 9.5-8z"/></svg>`,
  scan: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5.5A2.5 2.5 0 0 1 6.5 3H9M15 3h2.5A2.5 2.5 0 0 1 20 5.5V8M20 16v2.5a2.5 2.5 0 0 1-2.5 2.5H15M9 21H6.5A2.5 2.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3.2"/></svg>`,
  log: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3.5"/><path d="M7 9h.01M11 9h6M7 13h.01M11 13h6M7 17h.01M11 17h6"/></svg>`,
  minus: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  spinner: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor"/><path d="M12 22a10 10 0 0 1-10-10" opacity="0.25" stroke="currentColor"/></svg>`
};

function preferredTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyFloatTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  ['job-autofill-dock', 'job-autofill-mini-ball', 'job-autofill-toolbar', 'job-autofill-profile-menu', 'job-autofill-copy-panel', 'job-autofill-ai-panel', 'job-autofill-log-panel', 'job-autofill-region-overlay', 'job-autofill-region-panel'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('data-theme', mode);
  });
  const themeIcon = document.getElementById('job-autofill-theme-icon');
  if (themeIcon) {
    themeIcon.innerHTML = mode === 'light' ? ICONS.sun : ICONS.moon;
  }
}

function showNotification(message, type = 'success') {
  const oldNotif = document.getElementById('job-autofill-notification');
  if (oldNotif) oldNotif.remove();

  const notification = document.createElement('div');
  notification.id = 'job-autofill-notification';
  notification.className = type;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 2800);
}

// 1. 表单字段智能探测与高亮
function toggleFieldHighlights() {
  const badges = document.querySelectorAll('.job-autofill-field-badge');
  const highlighted = document.querySelectorAll('.job-autofill-field-highlight');

  if (isHighlightingFields) {
    badges.forEach(b => b.remove());
    highlighted.forEach(el => el.classList.remove('job-autofill-field-highlight'));
    isHighlightingFields = false;
    const btn = document.getElementById('job-autofill-btn-scan');
    if (btn) btn.classList.remove('active');
    showNotification('已关闭字段高亮探测', 'info');
    return;
  }

  const inputs = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], ' +
    'input[type="number"], input[type="date"], input:not([type]), ' +
    'textarea, select'
  );

  let matchCount = 0;
  inputs.forEach((input) => {
    if (input.disabled || input.readOnly || input.offsetParent === null) return;
    if (isIgnoredInput(input)) return;
    const fieldType = matchFieldType(input);
    if (!fieldType) return;

    matchCount++;
    input.classList.add('job-autofill-field-highlight');

    const labelText = FIELD_LABELS[fieldType] || fieldType;
    const badge = document.createElement('div');
    badge.className = 'job-autofill-field-badge';
    badge.textContent = `🎯 ${labelText}`;

    const rect = input.getBoundingClientRect();
    badge.style.top = `${rect.top + window.scrollY - 18}px`;
    badge.style.left = `${Math.max(6, rect.left + window.scrollX + 4)}px`;
    document.body.appendChild(badge);
  });

  isHighlightingFields = true;
  const btn = document.getElementById('job-autofill-btn-scan');
  if (btn) btn.classList.add('active');

  if (matchCount > 0) {
    showNotification(`🎯 已成功识别并标记 ${matchCount} 个网申表单项`, 'success');
  } else {
    const chatInput = findChatInputElement();
    if (chatInput) {
      showNotification('🎯 检测到 HR 沟通聊天框，可直接点击「⚡ 填充」填入打招呼语', 'info');
    } else {
      showNotification('当前页面未检测到网申表单或 HR 沟通框（已忽略页面搜索框）', 'warning');
    }
  }
}

// 2. 自由拖动实现 (120Hz/60Hz 零延迟极速跟手，带吸附与跨页记忆)
function initDockDragging(dock, miniBall, toolbar) {
  let isDragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
  let dockW = 0, dockH = 0;
  let winW = 0, winH = 0;
  let hasMoved = false;
  let justDragged = false;
  let rafId = null;
  let currentX = 0, currentY = 0;

  // 恢复位置与可见性记忆
  chrome.storage.local.get(['jobAutofillDockPos', 'jobAutofillDockCollapsed', 'jobAutofillDockHidden'], (res) => {
    if (res && res.jobAutofillDockHidden) {
      dock.style.display = 'none';
      return;
    }

    const isCollapsed = !!(res && res.jobAutofillDockCollapsed);
    if (isCollapsed) {
      toolbar.style.display = 'none';
      miniBall.style.display = 'flex';
    } else {
      toolbar.style.display = 'flex';
      miniBall.style.display = 'none';
    }

    const pos = res && res.jobAutofillDockPos;
    if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
      const winW = window.innerWidth || document.documentElement.clientWidth || 1024;
      const winH = window.innerHeight || document.documentElement.clientHeight || 768;
      const w = isCollapsed ? 42 : (toolbar.offsetWidth || 550);
      const h = isCollapsed ? 42 : (toolbar.offsetHeight || 38);
      const maxL = Math.max(8, winW - w - 8);
      const maxT = Math.max(8, winH - h - 8);
      const l = Math.min(Math.max(8, pos.left), maxL);
      const t = Math.min(Math.max(8, pos.top), maxT);
      dock.style.left = `${l}px`;
      dock.style.top = `${t}px`;
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
    }
  });

  function applyPosition() {
    const dx = currentX - startX;
    const dy = currentY - startY;
    const clampedL = Math.max(8, Math.min(winW - dockW - 8, startLeft + dx));
    const clampedT = Math.max(8, Math.min(winH - dockH - 8, startTop + dy));
    dock.style.left = `${clampedL}px`;
    dock.style.top = `${clampedT}px`;
    dock.style.right = 'auto';
    dock.style.bottom = 'auto';
    rafId = null;
  }

  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('.job-autofill-tool-btn') || e.target.closest('#job-autofill-profile-menu, #job-autofill-more-menu')) {
      return;
    }

    const rect = dock.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    dockW = rect.width;
    dockH = rect.height;
    winW = window.innerWidth;
    winH = window.innerHeight;
    hasMoved = false;
    currentX = e.clientX;
    currentY = e.clientY;

    const targetEl = e.target;
    if (targetEl && targetEl.setPointerCapture && e.pointerId !== undefined) {
      try { targetEl.setPointerCapture(e.pointerId); } catch (_) {}
    }

    function onPointerMove(ev) {
      currentX = ev.clientX;
      currentY = ev.clientY;
      const dx = currentX - startX;
      const dy = currentY - startY;

      if (!hasMoved) {
        if (Math.hypot(dx, dy) < 3) return;
        hasMoved = true;
        isDragging = true;
        dock.classList.add('is-dragging');
      }

      if (!rafId) {
        rafId = requestAnimationFrame(applyPosition);
      }
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (targetEl && targetEl.releasePointerCapture && e.pointerId !== undefined) {
        try { targetEl.releasePointerCapture(e.pointerId); } catch (_) {}
      }

      const dragged = isDragging || hasMoved;
      dock.classList.remove('is-dragging');
      isDragging = false;
      hasMoved = false;

      if (dragged) {
        applyPosition();
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 80);
        const finalRect = dock.getBoundingClientRect();
        chrome.storage.local.set({
          jobAutofillDockPos: { left: Math.round(finalRect.left), top: Math.round(finalRect.top) }
        });
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  dock.addEventListener('pointerdown', onPointerDown);
  return {
    wasDragging: () => isDragging || justDragged
  };
}

var  copyPayloads = [];

// —— 点选填入：追踪网页上最后聚焦的可填控件，点资料条目即写入 ——
var lastFillTarget = null;

// 解析候选填入目标：input/textarea/select（过安全过滤），或组件下拉触发器（div 等）。
// 密码/验证码/文件/提交类与抽屉/Dock 自身元素永不成为目标；返回目标信息或 null。
function resolveFillTarget(el) {
  if (!el || !el.tagName || !el.isConnected) return null;
  if (el.disabled) return null;
  try {
    if (el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel, #job-autofill-profile-menu, #job-autofill-mini-ball, #job-autofill-notification')) return null;
  } catch {
    return null;
  }
  const tag = el.tagName;
  let kind = '';
  let kindName = '';
  if (tag === 'SELECT') {
    if (isIgnoredInput(el)) return null;
    kind = 'field';
    kindName = '下拉框';
  } else if (tag === 'TEXTAREA') {
    if (isIgnoredInput(el)) return null;
    kind = 'field';
    kindName = '文本域';
  } else if (tag === 'INPUT' && (['date', 'month'].includes(el.type) ||
      (el.closest('.el-date-editor') && isSmartFillWritableInnerInput(el)))) {
    if (isIgnoredInput(el)) return null;
    kind = 'field';
    kindName = '日期';
  } else if (isWidgetSelectTrigger(el)) {
    // 组件下拉触发器（readonly input 或 div 外壳）：走点击展开匹配，而非直接写文本
    if (isIgnoredInput(el)) return null;
    if (tag === 'INPUT' && !isSmartFillWritableInnerInput(el)) return null; // 密码/文件等内层敏感输入
    const inner = writableBox(el);
    if (inner && inner !== el && !isSmartFillWritableInnerInput(inner)) return null;
    kind = 'widget';
    kindName = '组件下拉';
  } else if (tag === 'INPUT') {
    if (!isSmartFillWritableInnerInput(el)) return null; // 含 isIgnoredInput：密码/验证码/文件/登录/搜索框
    kind = 'field';
    kindName = '输入框';
  } else {
    return null;
  }
  const label = fillTargetLabelOf(el);
  return { el, label, kind, kindName };
}

// 填入目标的显示 label：就近 label → placeholder → name → 占位名
function fillTargetLabelOf(el) {
  return getClosestLabelText(el) || el.placeholder || el.getAttribute('placeholder') || el.getAttribute('name') || '未命名字段';
}

// focusin 时设置填入目标；不合格元素（含抽屉/Dock 自身）返回 false 且不打断既有目标
function setFillTargetFromElement(el) {
  const target = resolveFillTarget(el);
  if (!target) return false;
  if (lastFillTarget?.el === target.el && lastFillTarget.kind === target.kind &&
      lastFillTarget.label === target.label && lastFillTarget.url === location.href) return true;
  target.id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  target.url = location.href;
  lastFillTarget = target;
  updateFillTargetBar();
  if (typeof publishSidePanelTarget === 'function') publishSidePanelTarget();
  return true;
}

function getFillTarget() {
  return lastFillTarget;
}

// 刷新抽屉头部的填入目标提示条；label 每次实时重算（页面改写 aria-label/关联 label 后不显示旧字段名），
// 但只用于展示——快照 label 保留，供写入前的漂移检测使用
function updateFillTargetBar() {
  const bar = document.getElementById('job-autofill-fill-target-bar');
  if (!bar) return;
  if (lastFillTarget && lastFillTarget.el && lastFillTarget.el.isConnected) {
    const displayLabel = fillTargetLabelOf(lastFillTarget.el);
    bar.textContent = `🎯 填入目标：${displayLabel}（${lastFillTarget.kindName}）`;
    bar.classList.add('has-target');
  } else {
    if (lastFillTarget) lastFillTarget = null;
    bar.textContent = '🎯 先点击网页上的输入框，再点下方资料即可填入';
    bar.classList.remove('has-target');
  }
}

// label 是否显著漂移（互不包含的不同非空文本；"未命名字段"占位不算身份）：
// 页面改写字段身份（如换绑 aria-label/关联 label）时目标失效仅复制
function fillTargetLabelDrifted(oldLabel, newLabel) {
  const a = String(oldLabel || '').trim();
  const b = String(newLabel || '').trim();
  if (!a || !b || a === b || a === '未命名字段' || b === '未命名字段') return false;
  return !a.includes(b) && !b.includes(a);
}

// 把资料条目的值写入当前填入目标；目标失效或写入失败如实返回，绝不抛错
async function fillTargetWithCopyValue(text) {
  const value = String(text ?? '');
  if (!value.trim()) return { filled: false, reason: 'empty-value' };
  if (!lastFillTarget) return { filled: false, reason: 'no-target' };
  if (!lastFillTarget.el || !lastFillTarget.el.isConnected) {
    lastFillTarget = null; // 目标已从 DOM 移除，清除后仅复制
    updateFillTargetBar();
    return { filled: false, reason: 'target-removed' };
  }
  // 写入前重新安全解析：SPA 可能把已聚焦的控件改写为其他类型/外壳（如 text 变 checkbox），
  // 或 label 身份显著漂移；此时宁可清目标仅复制
  const previous = lastFillTarget;
  const recheck = resolveFillTarget(previous.el);
  if (!recheck || recheck.kind !== previous.kind || fillTargetLabelDrifted(previous.label, recheck.label)) {
    lastFillTarget = null;
    updateFillTargetBar();
    return { filled: false, label: recheck?.label || previous.label, reason: 'target-invalid' };
  }
  lastFillTarget = { ...previous, ...recheck };
  try {
    const written = recheck.kind === 'widget'
      ? await fillSelectWidget(recheck.el, value)
      : await fillField(recheck.el, value);
    if (written) return { filled: true, label: recheck.label };
    const needsDate = /^\d{4}-\d{2}$/.test(value) &&
      /请确认(?:具体|完整)日期/.test(recheck.el.getAttribute('data-job-autofill-manual') || '');
    return { filled: false, label: recheck.label, reason: needsDate ? 'needs-full-date' : 'write-fail' };
  } catch {
    return { filled: false, label: recheck.label, reason: 'write-error' };
  }
}

// 串行化整条"填入+复制"：快速连点时旧异步操作（fillSelectWidget 搜索框清理、剪贴板回写）
// 不得晚于新操作完成而污染组件值与剪贴板
var  copyApplyChain = Promise.resolve();

function applyCopyItem(text, label, chip) {
  const run = copyApplyChain.then(() => doApplyCopyItem(text, label, chip));
  copyApplyChain = run.then(() => undefined, () => undefined); // 单次失败不中断后续排队
  return run;
}

// 点资料条目：复制立即发起、不阻塞填入；两者结果互不吞并——
// 填入成功必闪绿+通知（复制失败时合并提示），复制失败不掩盖填入结果
async function doApplyCopyItem(text, label, chip) {
  let copyPromise;
  try {
    copyPromise = navigator.clipboard.writeText(text);
  } catch {
    copyPromise = Promise.reject(new Error('clipboard unavailable'));
  }
  const fillRes = await fillTargetWithCopyValue(text);
  let copyOk = false;
  try {
    await copyPromise;
    copyOk = true;
  } catch {
    copyOk = false;
  }
  if (fillRes.filled) {
    showNotification(copyOk ? `已填入：${label}` : `已填入：${label}（复制失败，可手动复制）`, 'success');
    if (chip && chip.classList) {
      chip.classList.add('is-filled');
      setTimeout(() => chip.classList.remove('is-filled'), 600);
    }
  } else if (fillRes.reason === 'write-fail' || fillRes.reason === 'write-error') {
    if (copyOk) showNotification('未能写入（可能是下拉选项不匹配），值已复制，可 Ctrl+V', 'info');
    else showNotification('未能写入，且复制失败，请重试', 'error');
  } else if (copyOk) {
    showNotification(`已复制 ${label}`, 'success');
  } else {
    showNotification('复制失败，请重试', 'error');
  }
  return fillRes;
}

function handleCopyChipClick(chip) {
  const idx = Number(chip.getAttribute('data-copy-idx'));
  const text = copyPayloads[idx] || '';
  const label = chip.querySelector('.chip-label')?.textContent || '内容';
  return applyCopyItem(text, label, chip);
}

// capture 监听全局聚焦：动态补注时同一隔离世界也只注册一次
if (!globalThis.__CAPYBARA_FILL_FOCUS_LISTENER_BOUND__) {
  globalThis.__CAPYBARA_FILL_FOCUS_LISTENER_BOUND__ = true;
  const track = event => {
    const connected = globalThis.__CAPYBARA_CONTENT_MAIN_STATE__?.sidePanelPorts?.size;
    if (connected && activeFillTask?.running) return;
    if (setFillTargetFromElement(event.target)) return;
    if (connected && event.target.matches?.('input, textarea, select, [contenteditable], [role="combobox"]')) {
      lastFillTarget = null;
      publishSidePanelTarget();
    }
  };
  document.addEventListener('focusin', track, true);
  document.addEventListener('click', event => { if (event.isTrusted) track(event); }, true);
}

function renderCopyRows(container, items) {
  copyPayloads = items.map((i) => i.val);
  container.innerHTML = items.map((item, idx) => `
    <div class="job-autofill-copy-chip ${item.block ? 'is-block' : ''}" data-copy-idx="${idx}">
      <div class="chip-head">
        <span class="chip-label">${escapeHtml(item.label)}</span>
        <span class="chip-icon">📋 复制</span>
      </div>
      <span class="chip-val">${escapeHtml(item.val)}</span>
    </div>
  `).join('');

  container.querySelectorAll('.job-autofill-copy-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      handleCopyChipClick(chip);
    });
  });
}

function renderCopyChips(profile, category = 'basic', searchQuery = '') {
  const container = document.getElementById('job-autofill-copy-list');
  if (!container || !profile) return;

  const trimmedQuery = (searchQuery || '').trim().toLowerCase();
  let items = [];

  if (trimmedQuery) {
    const allItems = getCopyItemsForCategory(profile, 'all');
    items = allItems.filter((i) =>
      (i.label && i.label.toLowerCase().includes(trimmedQuery)) ||
      (i.val && i.val.toLowerCase().includes(trimmedQuery))
    );
  } else {
    items = getCopyItemsForCategory(profile, category);
  }

  if (!items.length) {
    copyPayloads = [];
    const emptyHint = trimmedQuery
      ? `未找到与「${escapeHtml(trimmedQuery)}」相关的资料条目`
      : '当前分类暂未填写数据，可在配置中心补充。';
    container.innerHTML = `<div style="text-align:center;padding:24px 10px;opacity:0.6;font-size:12px;">${emptyHint}</div>`;
    return;
  }
  renderCopyRows(container, items);
}

function initPanelDragging(panel, handleSelector = '.job-autofill-panel-head, .job-autofill-log-head') {
  let isDragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
  let panelW = 0, panelH = 0;
  let winW = 0, winH = 0;
  let hasMoved = false;
  let rafId = null;
  let currentX = 0, currentY = 0;

  const handle = panel.querySelector(handleSelector) || panel;

  function applyPosition() {
    const dx = currentX - startX;
    const dy = currentY - startY;
    const clampedL = Math.max(8, Math.min(winW - panelW - 8, startLeft + dx));
    const clampedT = Math.max(8, Math.min(winH - panelH - 8, startTop + dy));
    panel.style.left = `${clampedL}px`;
    panel.style.top = `${clampedT}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    rafId = null;
  }

  function onPointerDown(e) {
    if (e.button && e.button !== 0) return;
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;

    const rect = panel.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    panelW = rect.width;
    panelH = rect.height;
    winW = window.innerWidth;
    winH = window.innerHeight;
    hasMoved = false;
    currentX = e.clientX;
    currentY = e.clientY;

    if (handle.setPointerCapture && e.pointerId !== undefined) {
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    }

    function onPointerMove(ev) {
      currentX = ev.clientX;
      currentY = ev.clientY;
      const dx = currentX - startX;
      const dy = currentY - startY;

      if (!hasMoved) {
        if (Math.hypot(dx, dy) < 3) return;
        hasMoved = true;
        isDragging = true;
        panel.classList.add('is-dragging');
      }

      if (!rafId) {
        rafId = requestAnimationFrame(applyPosition);
      }
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (handle.releasePointerCapture && e.pointerId !== undefined) {
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      }

      if (isDragging || hasMoved) {
        applyPosition();
      }

      panel.classList.remove('is-dragging');
      isDragging = false;
      hasMoved = false;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  handle.addEventListener('pointerdown', onPointerDown);
}

function createCopyDrawer(theme) {
  if (document.getElementById('job-autofill-copy-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'job-autofill-copy-panel';
  panel.setAttribute('data-theme', theme);
  panel.innerHTML = `
    <div class="job-autofill-panel-head" title="按住标题栏可自由拖动位置">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:13px;display:inline-flex;align-items:center;">📋</span>
        <span>快捷资料速查 (点选填入)</span>
      </div>
      <button type="button" id="job-autofill-copy-close" class="job-autofill-tool-btn" style="height:26px;padding:0 8px;">✕</button>
    </div>
    <div id="job-autofill-fill-target-bar" class="job-autofill-fill-target">🎯 先点击网页上的输入框，再点下方资料即可填入</div>
    <div class="job-autofill-panel-tabs">
      <button type="button" class="job-autofill-tab-btn active" data-tab="basic">👤 基础与家属</button>
      <button type="button" class="job-autofill-tab-btn" data-tab="edu">🎓 教育与科研</button>
      <button type="button" class="job-autofill-tab-btn" data-tab="exp">💼 经历与实战</button>
      <button type="button" class="job-autofill-tab-btn" data-tab="qa">💬 问答与自述</button>
    </div>
    <div class="job-autofill-copy-search-wrap">
      <input type="text" id="job-autofill-copy-search-input" class="job-autofill-copy-search" placeholder="🔍 快速搜索所有字段 (输入导师、生源地、规划等)...">
    </div>
    <div id="job-autofill-copy-list" class="job-autofill-copy-content"></div>
  `;
  document.body.appendChild(panel);
  initPanelDragging(panel);
  updateFillTargetBar();

  const searchInput = panel.querySelector('#job-autofill-copy-search-input');

  panel.querySelector('#job-autofill-copy-close').addEventListener('click', () => {
    panel.style.display = 'none';
    document.getElementById('job-autofill-btn-copy')?.classList.remove('active');
  });

  panel.querySelectorAll('.job-autofill-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.job-autofill-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (searchInput) searchInput.value = '';
      renderCopyChips(currentActiveProfile, btn.getAttribute('data-tab'));
    });
  });

  searchInput?.addEventListener('input', () => {
    const activeTab = panel.querySelector('.job-autofill-tab-btn.active')?.getAttribute('data-tab') || 'basic';
    renderCopyChips(currentActiveProfile, activeTab, searchInput.value);
  });
}

// 4. AI 智能问答与打招呼语抽屉
function createAiCopilotDrawer(theme) {
  if (document.getElementById('job-autofill-ai-panel')) return;
  const panel = document.createElement('div');
  panel.id = 'job-autofill-ai-panel';
  panel.setAttribute('data-theme', theme);
  panel.innerHTML = `
    <div class="job-autofill-panel-head" title="按住标题栏可自由拖动位置">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:13px;display:inline-flex;align-items:center;">🤖</span>
        <span>AI 求职 Copilot</span>
      </div>
      <button type="button" id="job-autofill-ai-close" class="job-autofill-tool-btn" style="height:26px;padding:0 8px;">✕</button>
    </div>
    <div class="job-autofill-ai-body">
      <div style="font-size:11px;opacity:0.75;display:flex;align-items:center;gap:4px;">
        <span>🎯 检测目标岗位：</span>
        <strong id="job-autofill-detected-pos" style="color:#38bdf8;">...</strong>
      </div>
      <div class="job-autofill-ai-presets">
        <button type="button" class="job-autofill-preset-btn" data-type="greeting">✉️ HR 打招呼自荐语</button>
        <button type="button" class="job-autofill-preset-btn" data-type="why_us">💡 为什么申请该岗位</button>
        <button type="button" class="job-autofill-preset-btn" data-type="advantage">🌟 提炼核心岗位优势</button>
      </div>
      <textarea id="job-autofill-ai-prompt" class="job-autofill-ai-input" placeholder="可粘贴网申开放题（如：请谈谈你最有成就感的一件事）让 AI 结合简历生成..."></textarea>
      <button type="button" id="job-autofill-ai-submit" class="job-autofill-tool-btn job-autofill-btn-fill" style="justify-content:center;height:36px;border-radius:10px;">
        <span>✨ 结合简历智能生成</span>
      </button>
      <div id="job-autofill-ai-result-box" class="job-autofill-ai-output">
        <div id="job-autofill-ai-text"></div>
        <button type="button" id="job-autofill-ai-copy-btn" class="job-autofill-tool-btn" style="align-self:flex-end;height:26px;margin-top:4px;">
          <span>📋 一键复制结果</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  initPanelDragging(panel);

  const posEl = panel.querySelector('#job-autofill-detected-pos');
  const detectedPos = detectPositionName(currentActiveProfile, { allowProfileFallback: false }) || '网申职位';
  if (posEl) posEl.textContent = detectedPos;

  panel.querySelector('#job-autofill-ai-close').addEventListener('click', () => {
    panel.style.display = 'none';
    document.getElementById('job-autofill-btn-ai')?.classList.remove('active');
  });

  panel.querySelectorAll('.job-autofill-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-type');
      const input = panel.querySelector('#job-autofill-ai-prompt');
      const pos = detectPositionName(currentActiveProfile) || '应聘岗位';
      if (type === 'greeting') {
        input.value = `请为我生成一段得体、自信、高情商的 HR 打招呼自荐语（约 150-200 字，语句完整通顺切勿截断），应聘岗位为「${pos}」，结合我的专业和实习经历。`;
      } else if (type === 'why_us') {
        input.value = `请结合我的专业背景和项目经历，回答网申问题：「你为什么选择申请我们公司的「${pos}」岗位？你的个人优势是什么？」输出 200 字左右。`;
      } else if (type === 'advantage') {
        input.value = `请针对「${pos}」岗位要求，结合我的简历，提炼出 3 条最核心、最具说服力的个人求职优势，条理清晰。`;
      }
      panel.querySelector('#job-autofill-ai-submit').click();
    });
  });

  const submitBtn = panel.querySelector('#job-autofill-ai-submit');
  const resultBox = panel.querySelector('#job-autofill-ai-result-box');
  const resultText = panel.querySelector('#job-autofill-ai-text');

  submitBtn.addEventListener('click', () => {
    const prompt = panel.querySelector('#job-autofill-ai-prompt').value.trim();
    if (!prompt) {
      showNotification('请先输入或选择提示词', 'warning');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="tool-icon">⏳</span><span>AI 正在深度思考生成中...</span>';
    resultBox.style.display = 'none';

    const resumeBrief = JSON.stringify(slimResumeContext(currentActiveProfile || {}));
    const systemPrompt = `你是秋招求职顾问。根据简历回答，只输出正文，不要前缀。\n简历：${resumeBrief}`;

    chrome.runtime.sendMessage({
      action: 'aiGenerate',
      prompt,
      systemPrompt,
      maxTokens: 2000
    }, (res) => {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>✨ 结合简历智能生成</span>';

      if (chrome.runtime.lastError) {
        showNotification('通信失败：' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (res && res.success && res.text) {
        resultBox.style.display = 'flex';
        resultText.textContent = res.text.trim();
        showNotification('AI 回答已生成', 'success');
      } else {
        showNotification(res?.error || res?.message || '生成失败，请检查 AI API 配置', 'error');
      }
    });
  });

  panel.querySelector('#job-autofill-ai-copy-btn').addEventListener('click', () => {
    const text = resultText.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      showNotification('✅ AI 回答已复制到剪贴板', 'success');
    });
  });
}

function createFloatingButton() {
  if (document.getElementById('job-autofill-dock')) return;
  if (!document.body) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createFloatingButton, { once: true });
    }
    return;
  }
  const theme = preferredTheme();

  const dock = document.createElement('div');
  dock.id = 'job-autofill-dock';
  dock.setAttribute('data-theme', theme);

  // 折叠迷你圆球
  const miniBall = document.createElement('div');
  miniBall.id = 'job-autofill-mini-ball';
  miniBall.setAttribute('data-theme', theme);
  miniBall.title = '易offer网申填写助手（点击展开）';
  miniBall.innerHTML = `<img class="mini-ball-icon" src="${chrome.runtime.getURL('icons/icon48.png')}" alt="" width="28" height="28">`;

  // 展开工具条
  const toolbar = document.createElement('div');
  toolbar.id = 'job-autofill-toolbar';
  toolbar.setAttribute('data-theme', theme);
  toolbar.innerHTML = `
    <div class="job-autofill-drag-handle" title="按住可拖动悬浮窗">
      <span class="job-autofill-brand" title="点击收起 (按住可拖动)">
        <img class="brand-capy-icon" src="${chrome.runtime.getURL('icons/icon48.png')}" alt="" width="20" height="20">
        <span class="brand-text">易offer</span>
      </span>
      <svg class="job-autofill-drag-dots" viewBox="0 0 24 24" width="8" height="12" fill="currentColor">
        <circle cx="6" cy="4" r="1.8"/>
        <circle cx="6" cy="12" r="1.8"/>
        <circle cx="6" cy="20" r="1.8"/>
        <circle cx="16" cy="4" r="1.8"/>
        <circle cx="16" cy="12" r="1.8"/>
        <circle cx="16" cy="20" r="1.8"/>
      </svg>
    </div>

    <button type="button" id="job-autofill-btn-profile" class="job-autofill-tool-btn job-autofill-profile-capsule" title="点击切换当前简历配置">
      <span class="tool-icon">${ICONS.profile}</span>
      <span id="job-autofill-active-profile-name" class="job-autofill-profile-pill tool-text">默认资料</span>
      <span class="profile-arrow">▾</span>
    </button>

    <div class="job-autofill-divider"></div>

    <!-- 核心功能区 3 按钮 -->
    <button type="button" id="job-autofill-btn-fill" class="job-autofill-tool-btn job-autofill-btn-fill" title="一键识别并填充当前网页表单（毫秒级快填）">
      <span class="tool-icon btn-spin-icon">${ICONS.fill}</span>
      <span class="tool-text">填充</span>
    </button>

    <button type="button" id="job-autofill-btn-ai-step" class="job-autofill-tool-btn job-autofill-btn-ai-fill" title="AI 逐步深度解析与智能填表 (自动攻克开放性主观问答题与复杂字段)">
      <span class="tool-icon btn-spin-icon">${ICONS.ai}</span>
      <span class="tool-text">AI助填</span>
    </button>

    <button type="button" id="job-autofill-btn-region" class="job-autofill-tool-btn job-autofill-btn-region" title="框选页面一段经历区域，定向填入资料条目 (补填空白块)">
      <span class="tool-icon">${ICONS.region}</span>
      <span class="tool-text">选区</span>
    </button>


    <button type="button" id="job-autofill-btn-copy" class="job-autofill-tool-btn job-autofill-btn-copy" title="打开快捷资料速查抽屉 (一键复制)">
      <span class="tool-icon">${ICONS.copy}</span>
      <span class="tool-text">速查</span>
    </button>

    <div class="job-autofill-divider"></div>

    <!-- 沟通专区 -->
    <button type="button" id="job-autofill-btn-ai" class="job-autofill-tool-btn" title="AI 求职 Copilot / HR 招呼语与对话生成">
      <span class="tool-icon">${ICONS.chat}</span>
      <span class="tool-text">招呼</span>
    </button>

    <div class="job-autofill-divider"></div>

    <!-- 辅助工具区（平铺展开，不收起） -->
    <button type="button" id="job-autofill-btn-scan" class="job-autofill-tool-btn job-autofill-btn-icon" title="高亮标记页面上已识别的表单项">
      <span class="tool-icon">${ICONS.scan}</span>
    </button>

    <button type="button" id="job-autofill-btn-theme" class="job-autofill-tool-btn job-autofill-btn-icon" title="切换深色/浅色模式">
      <span id="job-autofill-theme-icon" class="tool-icon">${theme === 'light' ? ICONS.sun : ICONS.moon}</span>
    </button>

    <button type="button" id="job-autofill-btn-collapse" class="job-autofill-tool-btn job-autofill-btn-icon" title="收起为迷你小圆点">
      <span class="tool-icon">${ICONS.minus}</span>
    </button>

    <button type="button" id="job-autofill-btn-close" class="job-autofill-tool-btn job-autofill-btn-icon job-autofill-btn-close" title="完全关闭悬浮窗 (可在插件弹窗中随时恢复)">
      <span class="tool-icon">${ICONS.close}</span>
    </button>

    <div id="job-autofill-profile-menu" data-theme="${theme}"></div>
  `;

  dock.appendChild(miniBall);
  dock.appendChild(toolbar);
  document.body.appendChild(dock);

  // 初始化功能抽屉
  createCopyDrawer(theme);
  createAiCopilotDrawer(theme);

  // 绑定拖拽
  const dragCtl = initDockDragging(dock, miniBall, toolbar);

  const collapseDock = () => {
    toolbar.style.display = 'none';
    miniBall.style.display = 'flex';
    chrome.storage.local.set({ jobAutofillDockCollapsed: true });
  };

  const expandDock = () => {
    miniBall.style.display = 'none';
    toolbar.style.display = 'flex';
    // 检查展开后是否溢出屏幕右/下边缘，自动修正位置
    const rect = dock.getBoundingClientRect();
    const dockW = toolbar.offsetWidth || 560;
    const dockH = toolbar.offsetHeight || 42;
    let left = rect.left;
    let top = rect.top;
    let adjusted = false;
    if (left + dockW > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - dockW - 8);
      adjusted = true;
    }
    if (top + dockH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - dockH - 8);
      adjusted = true;
    }
    if (adjusted) {
      dock.style.left = `${left}px`;
      dock.style.top = `${top}px`;
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
      chrome.storage.local.set({
        jobAutofillDockPos: { left: Math.round(left), top: Math.round(top) }
      });
    }
    chrome.storage.local.set({ jobAutofillDockCollapsed: false, jobAutofillDockHidden: false });
  };

  // 点击迷你圆球展开
  miniBall.addEventListener('click', () => {
    if (dragCtl.wasDragging()) return;
    expandDock();
  });

  // 迷你圆球右键快速关闭
  miniBall.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    dock.style.display = 'none';
    chrome.storage.local.set({ jobAutofillDockHidden: true });
    showNotification('💡 已关闭悬浮窗。在浏览器插件弹窗中可随时重新开启！', 'info');
  });

  // 收起为迷你圆球 (右侧缩小按钮)
  toolbar.querySelector('#job-autofill-btn-collapse').addEventListener('click', (e) => {
    e.stopPropagation();
    collapseDock();
  });

  // 点击左侧卡皮巴拉/助手品牌收起
  const brandEl = toolbar.querySelector('.job-autofill-brand');
  if (brandEl) {
    brandEl.addEventListener('click', (e) => {
      if (dragCtl.wasDragging()) return;
      e.stopPropagation();
      collapseDock();
    });
  }

  // 完全关闭悬浮窗
  toolbar.querySelector('#job-autofill-btn-close').addEventListener('click', (e) => {
    e.stopPropagation();
    dock.style.display = 'none';
    chrome.storage.local.set({ jobAutofillDockHidden: true });
    showNotification('💡 已关闭悬浮窗。可在浏览器右上角插件弹窗中随时重新开启！', 'info');
  });

  // 1. 一键毫秒填充事件
  const fillBtn = toolbar.querySelector('#job-autofill-btn-fill');
  fillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dragCtl.wasDragging()) return;
    fillBtn.classList.add('is-busy');
    const iconEl = fillBtn.querySelector('.tool-icon');
    if (iconEl) iconEl.innerHTML = ICONS.spinner;

    runtimeSend({ action: 'getActiveProfile' }, 8000).then((response) => {
      if (response && response.success && response.profile) {
        currentActiveProfile = response.profile;
        return fillForm(response.profile).then((res) => {
          if (res && res.isChat) {
            showNotification('✅ 已将 HR 打招呼语自动填入沟通框，可核对发送！', 'success');
          } else if (res?.manualFields?.length) {
            showNotification(`已填充 ${res.filledCount} 个字段；${res.manualFields.length} 项需手动确认，请查看字段旁的提示`, 'warning');
          } else if (res && res.filledCount > 0) {
            showNotification(`✅ 已成功自动填充 ${res.filledCount} 个网申字段！`, 'success');
          } else if (res?.isForm) {
            showNotification('本轮没有新增填充；已填内容保持不变，缺少的资料请手动补充', 'info');
          } else {
            showNotification('💡 当前处于职位浏览/搜索页，未检测到网申表单。请点击职位「立即沟通」打开聊天框，或进入招聘详情网申页后再点击填充。', 'info');
          }
        });
      }
      showNotification(response?.error === 'timeout' ? '后台无响应，请再点一次填充' : '请先在插件配置资料', 'warning');
    }).catch((error) => {
      showNotification(error.message || '填充失败', 'error');
    }).finally(() => {
      fillBtn.classList.remove('is-busy');
      const iconEl = fillBtn.querySelector('.tool-icon');
      if (iconEl) iconEl.innerHTML = ICONS.fill;
    });
  });

  // 1.2 AI 逐步深度填充事件
  const aiStepBtn = toolbar.querySelector('#job-autofill-btn-ai-step');
  if (aiStepBtn) {
    aiStepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      if (aiFillRunning) {
        showNotification('AI 助填正在进行中', 'info');
        return;
      }
      aiStepBtn.classList.add('is-busy');
      aiStepBtn.innerHTML = `<span class="tool-icon btn-spin-icon">${ICONS.spinner}</span><span class="tool-text">分析中</span>`;

      runtimeSend({ action: 'getActiveProfile' }, 8000).then((response) => {
        if (response && response.success && response.profile) {
          currentActiveProfile = response.profile;
          return aiStepByStepFill(response.profile);
        }
        showNotification(response?.error === 'timeout' ? '后台无响应，请再点一次 AI 助填' : '请先在插件配置资料', 'warning');
      }).catch((err) => {
        console.error('[易offer] AI助填执行异常:', err);
        showNotification(err.message || 'AI 助填执行失败', 'error');
      }).finally(() => {
        aiStepBtn.classList.remove('is-busy');
        aiStepBtn.innerHTML = `<span class="tool-icon">${ICONS.ai}</span><span class="tool-text">AI助填</span>`;
      });
    });
  }

  // 1.3 选区填入事件（框选经历区域 → 选条目 → 定向填入）
  const regionBtn = toolbar.querySelector('#job-autofill-btn-region');
  if (regionBtn) {
    regionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragCtl.wasDragging()) return;
      startRegionFillFlow();
    });
  }

  // 2. 简历快速切换弹层
  const profileBtn = toolbar.querySelector('#job-autofill-btn-profile');
  const profileMenu = toolbar.querySelector('#job-autofill-profile-menu');
  const profileLabel = toolbar.querySelector('#job-autofill-active-profile-name');

  function refreshProfilesMenu() {
    chrome.runtime.sendMessage({ action: 'getAllProfiles' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.success) {
        allProfilesCache = res.profiles || [];
        const actId = res.activeProfileId;
        const activeP = allProfilesCache.find(p => p.id === actId) || allProfilesCache[0];
        if (activeP) {
          currentActiveProfile = activeP;
          profileLabel.textContent = activeP.name || '默认资料';
        }

        profileMenu.innerHTML = allProfilesCache.map(p => `
          <div class="job-autofill-profile-item ${p.id === actId ? 'active' : ''}" data-id="${p.id}">
            <span>${escapeHtml(p.name)}</span>
            ${p.id === actId ? '<span>✓</span>' : ''}
          </div>
        `).join('');

        profileMenu.querySelectorAll('.job-autofill-profile-item').forEach(item => {
          item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const pid = item.getAttribute('data-id');
            chrome.runtime.sendMessage({ action: 'setActiveProfile', profileId: pid }, (switchRes) => {
              if (chrome.runtime.lastError) return;
              if (switchRes && switchRes.success) {
                profileMenu.style.display = 'none';
                refreshProfilesMenu();
                showNotification(`已切换为「${item.querySelector('span').textContent}」资料`, 'success');
              }
            });
          });
        });
      }
    });
  }

  function positionProfileMenu() {
    const btnRect = profileBtn.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const leftOffset = btnRect.left - toolbarRect.left;
    profileMenu.style.left = `${Math.max(0, leftOffset)}px`;
    profileMenu.style.right = 'auto';

    const spaceBelow = window.innerHeight - btnRect.bottom;
    if (spaceBelow < 200 && btnRect.top > 200) {
      profileMenu.style.bottom = 'calc(100% + 6px)';
      profileMenu.style.top = 'auto';
    } else {
      profileMenu.style.top = 'calc(100% + 6px)';
      profileMenu.style.bottom = 'auto';
    }
  }

  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dragCtl.wasDragging()) return;
    const isOpen = profileMenu.style.display === 'flex';
    if (isOpen) {
      profileMenu.style.display = 'none';
    } else {
      positionProfileMenu();
      profileMenu.style.display = 'flex';
      refreshProfilesMenu();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#job-autofill-btn-profile') && !e.target.closest('#job-autofill-profile-menu')) {
      profileMenu.style.display = 'none';
    }
  });

  function showPanelAnimated(panel) {
    panel.style.display = 'flex';
    panel.classList.remove('job-autofill-panel-in');
    void panel.offsetWidth;
    panel.classList.add('job-autofill-panel-in');
    panel.addEventListener('animationend', () => {
      panel.classList.remove('job-autofill-panel-in');
    }, { once: true });
  }

  // 3. 资料速查抽屉切换
  const copyBtn = toolbar.querySelector('#job-autofill-btn-copy');
  const copyPanel = document.getElementById('job-autofill-copy-panel');
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dragCtl.wasDragging()) return;
    const isOpen = copyPanel.style.display === 'flex';
    if (isOpen) {
      copyPanel.style.display = 'none';
      copyPanel.classList.remove('job-autofill-panel-in');
    } else {
      showPanelAnimated(copyPanel);
    }
    copyBtn.classList.toggle('active', !isOpen);

    if (!isOpen) {
      // 关闭其他抽屉
      document.getElementById('job-autofill-ai-panel').style.display = 'none';
      document.getElementById('job-autofill-btn-ai').classList.remove('active');

      const searchInput = copyPanel.querySelector('#job-autofill-copy-search-input');
      if (searchInput) searchInput.value = '';
      copyPanel.querySelectorAll('.job-autofill-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      updateFillTargetBar();

      if (currentActiveProfile) {
        renderCopyChips(currentActiveProfile, 'basic');
      }
      chrome.runtime.sendMessage({ action: 'getActiveProfile' }, (r) => {
        if (chrome.runtime.lastError) return;
        if (r?.profile) {
          currentActiveProfile = r.profile;
          const kw = searchInput ? searchInput.value.trim() : '';
          if (kw) {
            renderSearchResults(currentActiveProfile, kw);
          } else {
            const activeTab = copyPanel.querySelector('.job-autofill-tab-btn.active')?.dataset.tab || 'basic';
            renderCopyChips(currentActiveProfile, activeTab);
          }
        }
      });
    }
  });

  // 4. AI 抽屉切换
  const aiBtn = toolbar.querySelector('#job-autofill-btn-ai');
  const aiPanel = document.getElementById('job-autofill-ai-panel');
  aiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dragCtl.wasDragging()) return;
    const isOpen = aiPanel.style.display === 'flex';
    if (isOpen) {
      aiPanel.style.display = 'none';
      aiPanel.classList.remove('job-autofill-panel-in');
    } else {
      showPanelAnimated(aiPanel);
    }
    aiBtn.classList.toggle('active', !isOpen);

    if (!isOpen) {
      // 关闭其他抽屉
      copyPanel.style.display = 'none';
      copyBtn.classList.remove('active');
    }
  });

  // 5. 字段高亮探测切换
  const scanBtn = toolbar.querySelector('#job-autofill-btn-scan');
  scanBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dragCtl.wasDragging()) return;
    toggleFieldHighlights();
  });

  // 7. 深色/浅色模式一键切换
  const themeBtn = toolbar.querySelector('#job-autofill-btn-theme');
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dragCtl.wasDragging()) return;
    const currentTheme = dock.getAttribute('data-theme') || preferredTheme();
    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyFloatTheme(nextTheme);

    chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: { uiTheme: nextTheme }
    }, () => { if (chrome.runtime.lastError) {} });
  });

  // 初始化数据
  refreshProfilesMenu();

  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (chrome.runtime.lastError) return;
    const saved = response && response.success ? response.settings?.uiTheme : '';
    applyFloatTheme(saved || theme);
  });
}
