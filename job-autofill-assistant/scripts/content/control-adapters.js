// ============================================================================
// Capybara 网申助手 content script —— control-adapters.js
// 控件适配层：原生 input/textarea/select、单选复选、组件下拉（antd/Element/rc/semi/arco/自研）的有界等待写入
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';
function matchSelectOption(select, value) {
  const valStr = String(value).trim();
  if (!valStr) return null;
  const opts = Array.from(select.options).filter((opt) => !opt.disabled && !opt.parentElement?.disabled);
  let matched = opts.find((opt) =>
    opt.value === valStr ||
    opt.text.trim() === valStr ||
    opt.value.toLowerCase() === valStr.toLowerCase() ||
    opt.text.trim().toLowerCase() === valStr.toLowerCase()
  );
  if (!matched && /^\d+$/.test(valStr)) {
    const num = parseInt(valStr, 10);
    matched = opts.find((opt) => [opt.value, opt.text.trim()].some((text) =>
      /^\d+[年月日]?$/.test(text) && parseInt(text, 10) === num));
  }
  if (!matched) {
    const candidates = opts.filter((opt) => {
      const t = opt.text.trim();
      return t === `${valStr}月` || t === `${valStr}年` || ({ 硕士: '硕士研究生', 博士: '博士研究生' })[valStr] === t;
    });
    if (candidates.length === 1) matched = candidates[0];
  }
  if (!matched && languageExamKey(valStr)) {
    const candidates = opts.filter(opt => optionTextEquals(opt.text, valStr));
    if (candidates.length === 1) matched = candidates[0];
  }
  return matched;
}

function setValue(element, value) {
  if (!element || !element.isConnected || value === undefined || value === null) return false;
  const valStr = String(value);
  const tagName = element.tagName.toLowerCase();

  if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
    element.focus({ preventScroll: true });
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    const ok = document.execCommand && document.execCommand('insertText', false, valStr);
    if (!ok || !(element.textContent || '').length) element.textContent = valStr;
    dispatchInputEvents(element, valStr);
    return true;
  }

  if (tagName === 'select') {
    const matchedOpt = matchSelectOption(element, valStr);
    if (matchedOpt) {
      element.selectedIndex = matchedOpt.index;
      matchedOpt.selected = true;
      nativeSet(element, HTMLSelectElement.prototype, matchedOpt.value);
    } else return false;
    dispatchInputEvents(element, matchedOpt.value);
    return element.value === matchedOpt.value;
  }

  const proto = tagName === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  nativeSet(element, proto, valStr);
  dispatchInputEvents(element, valStr);
  return element.value === valStr;
}

function optionTextEquals(text, value) {
  const t = String(text || '').replace(/\s+/g, '').trim();
  const v = String(value || '').replace(/\s+/g, '').trim();
  if (!t || !v) return false;
  if (t === v || t === `${v}年` || t === `${v}月` || t === `${v}日` || t.toLowerCase() === v.toLowerCase()) return true;
  const aliases = {
    硕士: ['硕士研究生'], 硕士研究生: ['硕士'], 博士: ['博士研究生'], 博士研究生: ['博士'],
    本科: ['大学本科'], 大学本科: ['本科'], 大专: ['大学专科', '专科'], 大学专科: ['大专', '专科'], 专科: ['大专', '大学专科'],
    身份证: ['居民身份证', '中华人民共和国居民身份证'],
    中共党员: ['中国共产党党员'], 中共预备党员: ['中国共产党预备党员'], 共青团员: ['中国共产主义青年团团员', '共青团团员']
  };
  if ((aliases[v] || []).includes(t)) return true;
  const exam = languageExamKey(value);
  if (exam && LANGUAGE_EXAMS[exam].name.toLowerCase() === v.toLowerCase() && languageExamKey(text) === exam) return true;
  if (/^\d+$/.test(v) && /^\d+[年月日]?$/.test(t) && parseInt(t, 10) === parseInt(v, 10)) return true;
  return false;
}

function isSelectWidget(el) {
  if (!el) return false;
  if (el.closest('.phoenix-select, [class*="sd-Select-container-"]')) return true;
  if (el.tagName === 'SELECT') return true;
  if (el.getAttribute('role') === 'combobox') return true;
  if (el.getAttribute('aria-haspopup') === 'listbox') return true;
  const wrap = el.closest('.ant-select, .el-select, .rc-select, .semi-select, .arco-select');
  return !!wrap;
}

function visibleDropdownRoot(el) {
  // aria-controls/aria-owns 指向的 body/portal 弹层优先；面板归属其他控件的跳过（残留/迟到弹层隔离）
  const ids = `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const owned = document.getElementById(id);
    if (owned && isElementTrulyVisible(owned) && !owned.matches('.is-hidden, [aria-hidden="true"]') && claimDropdownPanel(owned, el)) return owned;
  }
  if (ids.length && el.closest('.el-select')) return null;
  const nodes = [...document.querySelectorAll(
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden), .el-select-dropdown, .rc-select-dropdown, .semi-select-option-list, .arco-select-popup, [role="listbox"], [class*="select-dropdown"], [class*="Select-Dropdown"]'
  )].filter((d) => isElementTrulyVisible(d) && claimDropdownPanel(d, el) && !d.matches('.is-hidden, [aria-hidden="true"]'));
  // 启发式选择器会同时命中面板与其子项（如 *select-dropdown* 也匹配选项 class），只保留最外层的可见面板
  const visible = nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  if (visible.length === 1) return visible[0];
  if (visible.length > 1) {
    const focused = visible.find((d) => d.contains(document.activeElement));
    if (focused) return focused;
    const elRect = el.getBoundingClientRect();
    const scored = visible.map((d) => {
      const dRect = d.getBoundingClientRect();
      const horizOverlap = Math.max(0, Math.min(elRect.right, dRect.right) - Math.max(elRect.left, dRect.left));
      const vertDist = Math.max(0, Math.max(elRect.top - dRect.bottom, dRect.top - elRect.bottom));
      const z = parseInt(window.getComputedStyle(d).zIndex, 10) || 0;
      return { d, score: (horizOverlap > 0 ? 1000 : 0) + z - vertDist };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].d;
  }
  return null;
}

// 下拉面板里的可点选项：可见且未禁用
function selectableDropdownOption(option) {
  return isElementTrulyVisible(option) && option.getAttribute('aria-disabled') !== 'true' &&
    !option.matches('.is-disabled, [disabled], [class*="option-disabled"]');
}

// 兜底启发式的候选排除：面板里的操作按钮（清除/删除/重置等）与交互控件不能当选项点击，副作用无法撤销
function isHeuristicOptionCandidate(node) {
  if (node.matches('button, a, input, [role="button"], [class*="clear"], [class*="delete"], [class*="remove"], [class*="reset"], [class*="close"]')) return false;
  const identity = `${node.getAttribute('class') || ''} ${node.getAttribute('id') || ''}`;
  if (/(clear|delete|remove|reset|close)/i.test(identity)) return false;
  const text = String(node.textContent || '').trim();
  if (/清除|删除|移除|重置|关闭/.test(text) || /\b(clear|delete|remove|reset|close)\b/i.test(text)) return false;
  return true;
}

function dropdownOptions(el, root = visibleDropdownRoot(el), expected) {
  if (!root) return [];
  const matchesValue = option => expected === undefined || optionTextEquals(option.textContent, expected);
  // 主流组件库的选项节点优先；命中即返回，避免误伤
  const primary = [...root.querySelectorAll('[role="option"], .ant-select-item-option, .el-select-dropdown__item, .semi-select-option, .arco-select-option')];
  if (primary.length) return primary.filter(option => matchesValue(option) && selectableDropdownOption(option));
  // 自研组件兜底启发式：选项 class 含 option/Option；嵌套命中时取最深节点（点击事件会冒泡到挂 onClick 的行容器）
  const heuristic = [...root.querySelectorAll('[class*="option"], [class*="Option"]')]
    .filter(option => matchesValue(option) && selectableDropdownOption(option) && (option.textContent || '').trim() && isHeuristicOptionCandidate(option));
  const deepest = heuristic.filter((node) => !heuristic.some((other) => other !== node && node.contains(other)));
  return [...new Set(deepest)];
}

// 组件下拉写入：有界等待代替固定 180/60ms 盲等。
// 打开 → 选项出现 → 点击 → 选中回读，各段均有 deadline；超时/取消按失败返回并继续后续字段。
// finally 关闭残留弹层并登记为旧代，旧操作的迟到弹层不会被本会话之后的写入选中。
async function fillSelectWidget(el, value, options) {
  const valStr = String(value ?? '').trim();
  if (!el || !valStr) return false;

  const opts = options || {};
  const signal = opts.signal || null;
  const openTimeoutMs = typeof opts.openTimeoutMs === 'number' ? opts.openTimeoutMs : 1200;
  const wait = (condition, timeoutMs = openTimeoutMs) =>
    waitFor(condition, { timeoutMs, signal, task: opts.task, observe: el.closest('.el-select') ? document.body : null });
  if (el.disabled) {
    const enabled = await wait(() => !el.disabled && el.isConnected);
    if (!enabled) return false;
  }
  if (el.tagName === 'SELECT') return setValue(el, valStr);
  if (el.closest('[class*="sd-Select-container-"]')) return fillMokaSelect(el, valStr, options);
  const session = beginWidgetDropdownSession();

  // 已知组件库容器优先，自研组件（select/dropdown/combo + container/wrapper/trigger）其次
  const wrap = el.closest('.ant-select, .el-select, .rc-select, .semi-select, .arco-select') ||
    smartWidgetHeuristicShell(el) || el;
  const elementSelect = wrap.matches('.el-select');
  const selectedMatches = () => optionTextEquals(widgetSelectCurrentValue(el), valStr);
  if (selectedMatches()) return true;
  const search = wrap.querySelector('input') || (el.tagName === 'INPUT' ? el : null);
  const canSearch = search && !search.readOnly && !search.disabled && isSmartFillWritableInnerInput(search);
  const initialSearch = canSearch ? search.value : '';
  const findHit = () => {
    if (!session.isCurrent()) return null;
    return dropdownOptions(el, undefined, valStr)[0] || null;
  };
  let searched = false;
  let confirmed = false;

  try {
    if (el.getAttribute('aria-expanded') !== 'true') {
      const trigger = wrap.querySelector('.el-select__wrapper, .ant-select-selector, .el-input, .rc-select-selector, [class*="selector"], [class*="trigger"]') || el;
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trigger.click();
    }

    let hit;
    if (elementSelect) {
      const panel = await wait(() => visibleDropdownRoot(el));
      if (!panel) return false;
      hit = findHit();
      if (!hit && !canSearch && panel.querySelector('[role="option"], .el-select-dropdown__item')) return false;
    } else {
      hit = await wait(findHit);
      if (!hit && !canSearch) return false;
    }
    if (!hit && canSearch) {
      await waitForFillCheckpoint(opts.task);
      if (signal?.aborted || !session.isCurrent()) return false;
      search.focus({ preventScroll: true });
      nativeSet(search, HTMLInputElement.prototype, valStr);
      search.dispatchEvent(new InputEvent('input', { bubbles: true, data: valStr }));
      searched = true;
    }
    hit ||= await wait(findHit);
    if (hit) {
      await waitForFillCheckpoint(opts.task);
      if (!signal?.aborted && session.isCurrent() && hit.isConnected) {
        hit.click();
        confirmed = !!await wait(() => session.isCurrent() && selectedMatches(), 650);
      }
    }
    return confirmed;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return false;
  } finally {
    if (session.isCurrent()) {
      if (!confirmed && searched && search.isConnected) {
        nativeSet(search, HTMLInputElement.prototype, initialSearch);
        search.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      dismissOpenDropdownPanels();
    }
  }
}

function choiceCaption(el) {
  const parent = el.closest('label');
  if (parent) {
    const clone = parent.cloneNode(true);
    clone.querySelectorAll('input, textarea, select, svg').forEach((n) => n.remove());
    const text = clone.textContent.replace(/\s+/g, '').trim();
    if (text) return text;
  }
  const next = el.nextElementSibling;
  if (next) {
    const text = next.textContent.replace(/\s+/g, '').trim().slice(0, 16);
    if (text) return text;
  }
  return String(el.value || '').trim();
}

async function fillChoice(el, value) {
  const val = String(value || '').trim();
  if (!val) return false;
  if (el.type === 'checkbox') {
    const on = !/^(否|无|false|0|n)$/i.test(val);
    el.checked = on;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  const name = el.name;
  const group = name
    ? [...(el.form || el.getRootNode()).querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)].filter((r) => r.form === el.form && !r.disabled)
    : [el];
  const hit = group.find((r) => {
    const cap = choiceCaption(r);
    return (cap && (cap === val || cap.split(/[，,、]/)[0] === val)) || String(r.value) === val;
  });
  if (!hit) return false;
  hit.click();
  return hit.checked;
}

function elementDateParts(value) {
  const parts = String(value ?? '').trim().match(/^(\d{4})(?:[-/.年]\s*(\d{1,2})(?:[-/.月]\s*(\d{1,2})日?)?月?)?$/);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2] || 1);
  const day = Number(parts[3] || 1);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;
  return [year, parts[2] ? month : 0, parts[3] ? day : 0];
}

async function clickFillControl(node, opts) {
  if (!node) return false;
  await waitForFillCheckpoint(opts.task);
  if (opts.signal?.aborted || !node.isConnected || !isElementTrulyVisible(node)) return false;
  node.click();
  return true;
}

async function fillElementDate(el, value, opts = {}) {
  const editor = el.closest('.el-date-editor');
  const precision = editor.matches('.el-date-editor--year') ? 1 : editor.matches('.el-date-editor--month') ? 2 : 3;
  const parts = elementDateParts(value);
  if (editor.matches('.el-range-editor')) return false;
  if (!parts?.[precision - 1]) {
    markManual(el, `${value}（请确认完整日期）`);
    return false;
  }
  const [year, month, day] = parts;
  const matchesDate = () => {
    const current = elementDateParts(el.value);
    return parts.slice(0, precision).every((part, index) => current?.[index] === part);
  };
  if (matchesDate()) return true;

  const ownerId = el.getAttribute('aria-controls') || editor.getAttribute('aria-controls');
  const visiblePanel = () => {
    const visible = ownerId ? [] : [...document.querySelectorAll('.el-picker-panel')].filter(isElementTrulyVisible);
    const root = ownerId ? document.getElementById(ownerId) : (visible.length === 1 ? visible[0] : null);
    const panel = root?.matches('.el-picker-panel') ? root : root?.querySelector('.el-picker-panel');
    return isElementTrulyVisible(panel) && panel;
  };
  let panel;
  const wait = (test, timeoutMs = 400) =>
    waitFor(test, { timeoutMs, signal: opts.signal, task: opts.task, observe: panel || document.body });
  const click = node => clickFillControl(node, opts);
  if (el.disabled && !await wait(() => !el.disabled && el.isConnected, opts.openTimeoutMs || 1200)) return false;
  try {
    panel = visiblePanel();
    if (!panel) {
      el.blur();
      el.focus({ preventScroll: true });
      if (editor.getAttribute('aria-expanded') !== 'true' && !visiblePanel()) {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        if (editor.getAttribute('aria-expanded') !== 'true') el.click();
      }
      panel = await wait(visiblePanel, opts.openTimeoutMs || 1200);
    }
    if (!panel) return false;

    const headers = () => panel.querySelectorAll('.el-date-picker__header-label');
    const yearCells = () => [...panel.querySelectorAll('.el-year-table td.available:not(.disabled)')].filter(isElementTrulyVisible);
    const monthCells = () => [...panel.querySelectorAll('.el-month-table td:not(.disabled)')].filter(isElementTrulyVisible);
    const headerYear = () => Number(headers()[0]?.textContent.match(/\d{4}/)?.[0]);

    if (precision === 1 || headerYear() !== year) {
      if (!yearCells().length && !await click(headers()[0])) return false;
      let years = await wait(() => yearCells().length && yearCells());
      for (let step = 0; years && step < 18; step++) {
        const hit = years.find(cell => Number(cell.textContent.trim()) === year);
        if (hit) {
          if (!await click(hit)) return false;
          break;
        }
        const first = Number(years[0].textContent.trim());
        const last = Number(years[years.length - 1].textContent.trim());
        if (year >= first && year <= last) return false;
        const arrow = panel.querySelector(year < first ? 'button.d-arrow-left' : 'button.d-arrow-right');
        if (!await click(arrow)) return false;
        years = await wait(() => {
          const next = yearCells();
          return next.length && Number(next[0].textContent.trim()) !== first && next;
        });
      }
    }
    if (precision > 1) {
      if (!await wait(() => headerYear() === year && !yearCells().length)) return false;
      const shownMonth = () => {
        const text = headers()[1]?.textContent.trim() || '';
        return Number(text.match(/\d{1,2}/)?.[0]) ||
          ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(text.slice(0, 3)) + 1;
      };
      if (precision === 2 || shownMonth() !== month || monthCells().length) {
        if (!monthCells().length && !await click(headers()[1])) return false;
        // Element Plus 的月份格按 1 到 12 排列，保留禁用格以维持索引。
        const monthCell = await wait(() => panel.querySelectorAll('.el-month-table td')[month - 1]);
        if (!monthCell || !selectableDropdownOption(monthCell) || monthCell.matches('.disabled') || !await click(monthCell)) return false;
      }
      if (precision === 3) {
        const dayCell = await wait(() => {
          if (headerYear() !== year || shownMonth() !== month) return null;
          return [...panel.querySelectorAll('.el-date-table td.available:not(.disabled):not(.prev-month):not(.next-month)')]
            .find(cell => selectableDropdownOption(cell) && Number(cell.textContent.trim()) === day);
        });
        if (!await click(dayCell)) return false;
      }
    }
    return !!await wait(() => el.isConnected && matchesDate() &&
      (editor.getAttribute('aria-expanded') === 'false' || !visiblePanel()), 650);
  } finally {
    if (visiblePanel()) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      dismissOpenDropdownPanels();
    }
    el.blur();
  }
}

function normalizeRegionPath(value) {
  return String(value ?? '').replace(/(维吾尔|壮族|回族)自治区|特别行政区|自治区|自治州|省|市/g, '')
    .replace(/[\s/／,，、>＞|]+/g, '');
}

async function fillElementCascader(el, value, opts = {}) {
  const widget = el.closest('.el-cascader');
  const target = normalizeRegionPath(value);
  if (!target || el.disabled) return false;
  let panel;
  const wait = test => waitFor(test, { timeoutMs: opts.openTimeoutMs || 1200, signal: opts.signal, task: opts.task, observe: panel || document.body });
  const getPanel = () => {
    const id = el.getAttribute('aria-controls') || widget.getAttribute('aria-controls') || widget.getAttribute('aria-describedby');
    const panel = id && document.getElementById(id);
    return panel?.matches('.el-cascader__dropdown') && isElementTrulyVisible(panel) && panel;
  };
  const wasExpanded = el.getAttribute('aria-expanded') === 'true';
  const click = node => clickFillControl(node, opts);
  try {
    if (!wasExpanded && !await click(el)) return false;
    panel = await wait(getPanel);
    if (!panel) return false;
    let remaining = target;
    const matchedPath = [];
    for (let depth = 0; depth < 6; depth++) {
      const nodes = await wait(() => {
        const menu = panel.querySelectorAll('.el-cascader-menu__list')[depth];
        const items = [...(menu?.querySelectorAll('.el-cascader-node') || [])].filter(selectableDropdownOption);
        return items.length && items;
      });
      if (!nodes) return false;
      const nameOf = node => normalizeRegionPath(node.querySelector('.el-cascader-node__label')?.textContent);
      const matches = nodes.filter(node => nameOf(node) && remaining.startsWith(nameOf(node)))
        .sort((a, b) => nameOf(b).length - nameOf(a).length);
      if (matches.length > 1 && nameOf(matches[0]) === nameOf(matches[1])) return false;
      const inferredCountry = !matches.length && depth === 0 && /[\u3400-\u9fff]/.test(remaining);
      const node = matches[0] || (inferredCountry && nodes.find(item => nameOf(item) === '中国'));
      if (!node) return false;
      const name = nameOf(node);
      matchedPath.push(name);
      if (!inferredCountry) remaining = remaining.slice(name.length);
      if (!remaining) {
        const radio = node.querySelector('input[type="radio"]:not(:disabled)');
        if (!radio && node.getAttribute('aria-haspopup') === 'true') return false;
        if (!await click(radio?.closest('label') || radio || node)) return false;
        const path = matchedPath.join('');
        return !!await wait(() => {
          const selected = radio?.checked || node.matches('.is-checked, [aria-checked="true"]');
          if (!selected && el.getAttribute('aria-expanded') === 'true' && getPanel()) return false;
          const shown = normalizeRegionPath(el.value);
          return shown && (shown === path || shown === target || shown === name);
        });
      }
      if (node.getAttribute('aria-haspopup') !== 'true' ||
          !await click(node.querySelector('.el-cascader-node__label') || node)) return false;
    }
    return false;
  } finally {
    if (el.getAttribute('aria-expanded') === 'true') dismissOpenDropdownPanels();
    el.blur();
  }
}

// 写入单个控件。options.signal（AbortSignal）用于任务/字段级取消，组件下拉路径全程可中断。
async function fillField(el, value, options) {
  if (!el || value === undefined || value === null || String(value).trim() === '') return false;
  const target = writableBox(el) || el;
  // 写入前对真实目标复查：外层容器通过的安全检查不代表内层控件安全（如 combobox 内藏密码框）
  if (isIgnoredInput(target)) return false;
  if (target !== el && !isSmartFillWritableInnerInput(target)) return false;
  if (target.closest('.el-date-editor')) return fillElementDate(target, value, options);
  if (target.closest('.el-cascader')) return fillElementCascader(target, value, options);
  if (target.type === 'date') {
    const parts = elementDateParts(value);
    if (!parts?.[2]) {
      markManual(target, `${value}（请确认具体日期）`);
      return false;
    }
    const normalized = parts.map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
    return setValue(target, normalized) && target.value === normalized;
  }
  if (target.type === 'month' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) value = String(value).slice(0, 7);
  if (target.type === 'radio' || target.type === 'checkbox') return fillChoice(target, value);

  const valueToFill = valueWithinFieldLimit(target, value);
  if (isSelectWidget(target) || isYearControl(target) || isMonthControl(target)) {
    return fillSelectWidget(target, valueToFill, options);
  }
  if (target.readOnly || target.disabled) return false;
  return setValue(target, valueToFill);
}

function isYearControl(el) {
  if (el.tagName === 'SELECT') {
    const years = [...el.options].filter((o) => /^(19|20)\d{2}/.test((o.value || o.text).trim()));
    return years.length >= 5;
  }
  const hint = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${getClosestLabelText(el)}`.trim();
  if (/^年$|年份/.test(hint)) return true;
  const wrap = el.closest('.ant-select, .el-select, .rc-select');
  const shown = wrap ? wrap.textContent.replace(/\s+/g, ' ').trim().slice(0, 8) : '';
  return /^(年|年份|(19|20)\d{2})$/.test(shown);
}

function isMonthControl(el) {
  if (el.tagName === 'SELECT') {
    const months = [...el.options].filter((o) => {
      const n = parseInt(o.value || o.text, 10);
      return n >= 1 && n <= 12;
    });
    return months.length >= 12 && !isYearControl(el);
  }
  const hint = `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${getClosestLabelText(el)}`.trim();
  if (/^月$|月份/.test(hint)) return true;
  const wrap = el.closest('.ant-select, .el-select, .rc-select');
  const shown = wrap ? wrap.textContent.replace(/\s+/g, ' ').trim().slice(0, 6) : '';
  return /^(月|月份|\d{1,2}月?)$/.test(shown) && !isYearControl(el);
}

async function fillSiteControl(input, value, options) {
  if (input.closest('.ant-form-item') && isXhsForm()) return fillXhsControl(input, value, options);
  if (isBeisenForm() && /^\d{4}-\d{2}(?:-\d{2})?$/.test(String(value)) && /日期|时间|年月/.test(getClosestLabelText(input))) return fillBeisenDate(input, value, options);
  if (input.closest('.phoenix-select') && isBeisenForm()) return fillBeisenSelect(input, value, options);
  const datePicker = input.closest('.phoenix-datePicker, .phoenix-datepicker, [class*="date-picker"], [class*="datePicker"]');
  if (datePicker) return false; // 未知日期组件不能把文本写入当成控件提交。
  return fillField(input, value, options);
}

// ========================================================================
// AI 智能补填（用 AI 匹配本地字典识别不了、但资料中有明确值的标准字段）
// ========================================================================

var  SMART_FILL_FIELD_SELECTOR = 'input[type="text"], input[type="email"], input[type="tel"], ' +
  'input[type="number"], input[type="date"], input[type="month"], input[type="url"], input:not([type]), ' +
  'textarea, select, [role="combobox"], [aria-haspopup="listbox"]';
var  SMART_FILL_BATCH_SIZE = 25;
var  SMART_FILL_MAX_OPTIONS = 40;
var  SMART_FILL_DIGEST_LIMIT = 3000;
var  SMART_FILL_PLACEHOLDER_OPTION_RE = /^(请选择.*|请输入.*|please\s*select.*|select(?:\s.*)?|[-—]+)$/i;
var  SMART_FILL_PHONE_LABEL_RE = /手机|电话|mobile|phone|(?:^|[^a-z])tel\b/i;
var  SMART_FILL_IDCARD_LABEL_RE = /身份证|idcard|identity/i;
// 组件下拉（antd/Element/rc/semi/arco/Moka）容器选择器
var  SMART_FILL_WIDGET_CONTAINER_SELECTOR = '.ant-select, .el-select, .rc-select, .semi-select, .arco-select, [class*="sd-Select-container-"]';
// 字段"行"容器：同一 label/单元格内的控件视为一组（级联/组合判定用）
var  SMART_FILL_ROW_CONTAINER_SELECTOR = 'label, td, th, fieldset, li, [class*="form-item"], [class*="formItem"], ' +
  '[class*="FormItem"], [class*="form-field"], [class*="field-item"], [class*="apply-field-"], [class*="apply-item"]';

// 自研组件外壳兜底：3 层祖先内 class token 命中 select/dropdown/combo + container/wrapper/trigger 的组合
// （如 "custom-select-wrapper"、"select-trigger"、"dropdown-container"）。
// 用词边界匹配，"selection-container" 这类普通容器不算，避免误判为组件下拉
function smartWidgetHeuristicShell(el) {
  let node = el;
  for (let i = 0; i < 3 && node; i++) {
    const cls = String(node.getAttribute('class') || '');
    if (/\b(select|dropdown|combo)[-_]?(container|wrapper|trigger)\b/i.test(cls)) return node;
    node = node.parentElement;
  }
  return null;
}

// 判断 el 是否是组件型下拉框的触发器（el 自身或最近的组件容器命中特征）。
// 典型形态：readonly 的搜索 input（antd/el-select）、role=combobox 的节点、自研组件外壳内的 input。
function isWidgetSelectTrigger(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === 'SELECT') return false; // 原生 select 走既有路径
  if (el.getAttribute('role') === 'combobox') return true;
  if (el.getAttribute('aria-haspopup') === 'listbox') return true;
  try {
    if (el.closest(SMART_FILL_WIDGET_CONTAINER_SELECTOR)) return true;
  } catch {
    return false;
  }
  return !!smartWidgetHeuristicShell(el);
}

// 组件下拉当前选中的值：取组件内 selection-item/所选文本，其次触发 input 的 value；占位符不算值
function widgetSelectCurrentValue(el) {
  const wrap = el.closest?.(SMART_FILL_WIDGET_CONTAINER_SELECTOR) || smartWidgetHeuristicShell(el) || el;
  let item = null;
  try {
    item = [...wrap.querySelectorAll(
      '.ant-select-selection-item, .el-select__selected-item, .rc-select-selection-item, ' +
      '.semi-select-selection-text, .arco-select-view-value, [class*="sd-Input-display-value-"]'
    )].find(node => !node.matches('.el-select__input-wrapper, .is-transparent') && node.textContent.trim());
  } catch {
    item = null;
  }
  const text = String(item?.textContent || '').trim();
  if (text && !SMART_FILL_PLACEHOLDER_OPTION_RE.test(text)) return text;
  if (wrap.matches('.el-select') && !el.readOnly) return '';
  const value = String(el?.value || '').trim();
  if (value && !SMART_FILL_PLACEHOLDER_OPTION_RE.test(value)) return value;
  return '';
}
