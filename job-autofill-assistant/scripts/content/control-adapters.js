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
  const exact = opts.filter((opt) =>
    opt.value === valStr ||
    opt.text.trim() === valStr ||
    opt.value.toLowerCase() === valStr.toLowerCase() ||
    opt.text.trim().toLowerCase() === valStr.toLowerCase()
  );
  if (exact.length > 1) return null;
  let matched = exact[0];
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
  if (!matched) {
    const label = getClosestLabelText(select);
    const candidates = opts.filter(opt => fieldOptionEquals(label, opt.text, valStr));
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

function fieldOptionEquals(label, text, value) {
  if (optionTextEquals(text, value)) return true;
  const shown = String(text || '').replace(/\s+/g, '');
  const wanted = String(value || '').replace(/\s+/g, '');
  if (!shown || !wanted) return false;
  if (label === '血型') {
    const bloodType = text => /^(AB|A|B|O)(?:型血|型|血)?$/i.exec(text)?.[1].toUpperCase();
    const type = bloodType(wanted);
    if (/^(不明|不详|未知)$/.test(wanted)) return /^(不明|不详|未知)$/.test(shown);
    return !!type && type === bloodType(shown);
  }
  if (label === '民族') return shown.replace(/族$/, '') === wanted.replace(/族$/, '');
  if (/^(IT\s*)?技能(?:类别|名称)$/i.test(label)) {
    const aliases = { photoshop: 'ps', r: 'r语言', activx: 'activex', ciojure: 'clojure', deamweaver: 'dreamweaver', 'msoffice': 'office' };
    const key = value => aliases[value.toLowerCase()] || value.toLowerCase();
    return key(shown) === key(wanted);
  }
  if (/^(证件(?:号码?|类型)|身份证件|证件类别)$/.test(label)) {
    const mainlandId = text => /^(?:中国大陆|内地|大陆|中华人民共和国)?(?:居民)?身份证$/.test(text);
    return mainlandId(shown) && mainlandId(wanted);
  }
  if (label === '政治面貌') {
    const party = text => /^(?:中共党员|中国共产党党员|共产党员)$/.test(text);
    const youth = text => /^(?:(?:中国)?共青团(?:团员|员)?|(?:中国)?共产主义青年团(?:团员)?|团员)$/.test(text);
    return (party(shown) && party(wanted)) || (youth(shown) && youth(wanted));
  }
  if (/^(国家(?:[/／]?地区)?|国籍|country(?:\/region)?)$/i.test(label)) {
    const mainland = value => /^(?:中国|中华人民共和国|中国大陆|中国内地|china|mainlandchina|cn)$/i.test(value);
    return mainland(shown) && mainland(wanted);
  }
  return label === '宗教信仰' && /^无(?:宗教(?:信仰)?)?$/.test(shown) && /^无(?:宗教(?:信仰)?)?$/.test(wanted);
}

function educationRankOptionValue(label, value) {
  const parts = String(value).normalize('NFKC').split(/[;、\n]/);
  const ranks = parts.map(part => /^\s*(专业|班级)?(?:排名)?\s*[:：]?\s*前\s*(\d{1,3}(?:\.\d+)?)\s*%\s*$/.exec(part));
  if (ranks.some(rank => !rank || Number(rank[2]) <= 0 || Number(rank[2]) > 100)) return value;
  const scope = /专业|班级/.exec(label)?.[0];
  const scoped = scope ? ranks.filter(rank => !rank[1] || rank[1] === scope) : ranks;
  const percentages = new Set(scoped.map(rank => Number(rank[2])));
  return percentages.size === 1 ? `前${[...percentages][0]}%` : value;
}

function isSelectWidget(el) {
  if (!el) return false;
  if (el.matches('.tec-select__input')) return true;
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
    // Ant virtualizes the visual rows and points aria-controls at a separate zero-sized list.
    const panel = el.closest('.ant-select') && owned?.closest('.ant-select-dropdown') || owned;
    if (panel && isElementTrulyVisible(panel) &&
        !panel.matches('.ant-select-dropdown-hidden, .is-hidden, [aria-hidden="true"]') && claimDropdownPanel(panel, el)) return panel;
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

function dropdownOptions(el, root = visibleDropdownRoot(el), expected, equals = optionTextEquals) {
  if (!root) return [];
  const matchesValue = option => expected === undefined || equals(option.textContent, expected);
  const antOptions = root.matches('.ant-select-dropdown') ? root.querySelectorAll('.ant-select-item-option') : [];
  if (antOptions.length) return [...antOptions].filter(option => matchesValue(option) && selectableDropdownOption(option));
  // 主流组件库的选项节点优先；命中即返回，避免误伤
  const primary = [...root.querySelectorAll('[role="option"], .ant-select-item-option, .el-select-dropdown__item, .semi-select-option, .arco-select-option, .tec-select-dropdown__item')];
  if (primary.length) return primary.filter(option => matchesValue(option) && selectableDropdownOption(option));
  // 自研组件兜底启发式：选项 class 含 option/Option；嵌套命中时取最深节点（点击事件会冒泡到挂 onClick 的行容器）
  const heuristic = [...root.querySelectorAll('[class*="option"], [class*="Option"]')]
    .filter(option => matchesValue(option) && selectableDropdownOption(option) && (option.textContent || '').trim() && isHeuristicOptionCandidate(option));
  const deepest = heuristic.filter((node) => !heuristic.some((other) => other !== node && node.contains(other)));
  return [...new Set(deepest)];
}

function tecSelectedLabel(el) {
  const selected = el.closest('.tec-select__trigger--has-select, .tec-cascade__trigger--has-select');
  return selected ? String(el.placeholder || '').trim() : '';
}

function tecDropdownPanel(el, selector, previous) {
  const open = panel => isElementTrulyVisible(panel) &&
    panel.getAttribute('aria-hidden') !== 'true' && !/\S+-leave-(?:active|to)\b/.test(panel.className);
  const reference = document.getElementById(el.getAttribute('aria-controls') || '');
  if (reference?.matches(selector) && open(reference)) return reference;
  const visible = [...document.querySelectorAll(selector)].filter(open);
  const candidates = previous ? visible.filter(panel => !previous.has(panel)) : visible;
  return candidates.length === 1 && claimDropdownPanel(candidates[0], el) ? candidates[0] : null;
}

async function findAntVirtualOption(holder, findHit, isCurrent, opts) {
  const signature = () => {
    const items = holder.querySelectorAll('.ant-select-item-option');
    return `${items[0]?.textContent}|${items[items.length - 1]?.textContent}`;
  };
  const end = holder.scrollHeight - holder.clientHeight;
  const step = Math.max(1, Math.floor(holder.clientHeight * 0.85));
  let hit = findHit();
  for (let offset = 0, pass = 0; !hit && pass < 12 && offset <= end; pass++) {
    await waitForFillCheckpoint(opts.task);
    if (opts.signal?.aborted || !isCurrent() || !holder.isConnected) return null;
    if (Math.abs(holder.scrollTop - offset) >= 1) {
      const before = signature();
      holder.scrollTop = offset;
      holder.dispatchEvent(new Event('scroll'));
      await waitFor(() => !isCurrent() || signature() !== before || findHit(),
        { timeoutMs: 140, observe: holder, signal: opts.signal, task: opts.task });
      hit = findHit();
    }
    if (offset === end) break;
    offset = Math.min(offset + step, end);
  }
  return hit;
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
  const tecTrigger = el.closest('.tec-select__trigger');
  const wait = (condition, timeoutMs = openTimeoutMs) =>
    waitFor(condition, { timeoutMs, signal, task: opts.task, observe: tecTrigger || el.closest('.el-select') ? document.body : null });
  if (el.disabled) {
    const enabled = await wait(() => !el.disabled && el.isConnected);
    if (!enabled) return false;
  }
  if (el.tagName === 'SELECT') return setValue(el, valStr);
  if (el.closest('[class*="sd-Select-container-"]')) return fillMokaSelect(el, valStr, options);
  const session = beginWidgetDropdownSession();

  // 已知组件库容器优先，自研组件（select/dropdown/combo + container/wrapper/trigger）其次
  const wrap = el.closest('.ant-select, .el-select, .rc-select, .semi-select, .arco-select') ||
    tecTrigger || smartWidgetHeuristicShell(el) || el;
  const elementSelect = wrap.matches('.el-select');
  const label = getClosestLabelText(el);
  const equals = (text, value) => fieldOptionEquals(label, text, value);
  const selectedMatches = () => equals(widgetSelectCurrentValue(el), valStr);
  if (selectedMatches()) return true;
  const tecOpen = tecTrigger?.classList.contains('tec-select__trigger--focus');
  const tecPrevious = tecTrigger && !tecOpen
    ? new Set([...document.querySelectorAll('.tec-select__popper')].filter(isElementTrulyVisible)) : null;
  const search = wrap.querySelector('input') || (el.tagName === 'INPUT' ? el : null);
  const canSearch = search && !search.readOnly && !search.disabled && isSmartFillWritableInnerInput(search);
  const initialSearch = canSearch ? search.value : '';
  const findHit = () => {
    if (!session.isCurrent()) return null;
    const panel = tecTrigger ? tecDropdownPanel(el, '.tec-select__popper', tecPrevious) : visibleDropdownRoot(el);
    const exact = dropdownOptions(el, panel, valStr);
    if (exact.length) return exact.length === 1 ? exact[0] : null;
    const equivalent = dropdownOptions(el, panel, valStr, equals);
    return equivalent.length === 1 ? equivalent[0] : null;
  };
  let searched = false;
  let confirmed = false;
  let searchTimeoutMs = openTimeoutMs;

  try {
    if (!tecOpen && el.getAttribute('aria-expanded') !== 'true') {
      const trigger = tecTrigger || wrap.querySelector('.el-select__wrapper, .ant-select-selector, .el-input, .rc-select-selector, [class*="selector"], [class*="trigger"]') || el;
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trigger.click();
    }

    let hit;
    if (elementSelect) {
      const panel = await wait(() => visibleDropdownRoot(el));
      if (!panel) return false;
      hit = findHit();
      if (!hit && !canSearch && panel.querySelector('[role="option"], .el-select-dropdown__item')) return false;
    } else if (canSearch) {
      const panel = await wait(() => tecTrigger ? tecDropdownPanel(el, '.tec-select__popper', tecPrevious) : visibleDropdownRoot(el));
      if (!panel) return false;
      hit = findHit();
      if (wrap.matches('.ant-select') && !dropdownOptions(el, panel).length) searchTimeoutMs *= 2;
    } else {
      const holder = wrap.matches('.ant-select') &&
        (await wait(() => visibleDropdownRoot(el)))?.querySelector('.rc-virtual-list-holder');
      hit = holder?.clientHeight && holder.scrollHeight > holder.clientHeight
        ? await findAntVirtualOption(holder, findHit, session.isCurrent, opts) : await wait(findHit);
      if (!hit) return false;
    }
    if (!hit && canSearch) {
      await waitForFillCheckpoint(opts.task);
      if (signal?.aborted || !session.isCurrent()) return false;
      search.focus({ preventScroll: true });
      nativeSet(search, HTMLInputElement.prototype, valStr);
      search.dispatchEvent(new InputEvent('input', { bubbles: true, data: valStr }));
      searched = true;
    }
    hit ||= await wait(findHit, searchTimeoutMs);
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

function radioGroup(el) {
  const container = el.closest('.tec-radio-group, .el-radio-group, .ant-radio-group, [role="radiogroup"]');
  if (container) return [...container.querySelectorAll('input[type="radio"]')];
  return el.name ? [...(el.form || el.getRootNode()).querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
    .filter(radio => radio.form === el.form) : [el];
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
  const group = radioGroup(el).filter(radio => !radio.disabled);
  const hit = group.find((r) => {
    const cap = choiceCaption(r);
    return (cap && (cap === val || cap.split(/[，,、]/)[0] === val)) || String(r.value) === val;
  }) || group.find(radio =>
    (/^(是|有)$/.test(val) && /^(是|有)$/.test(choiceCaption(radio))) ||
    (/^(否|无)$/.test(val) && /^(否|无)$/.test(choiceCaption(radio))));
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
    .replace(/([\u3400-\u9fff])[-－](?=[\u3400-\u9fff])/g, '$1')
    .replace(/[\s/／,，、>＞|]+/g, '');
}

async function fillElementCascader(el, value, opts = {}) {
  const tec = el.matches('.tec-cascade__input');
  const widget = el.closest(tec ? '.tec-cascade__trigger' : '.el-cascader');
  const target = normalizeRegionPath(value);
  if (!widget || !target || el.disabled) return false;
  let panel;
  const wait = test => waitFor(test, { timeoutMs: opts.openTimeoutMs || 1200, signal: opts.signal, task: opts.task, observe: panel || document.body });
  const isExpanded = () => tec ? widget.classList.contains('tec-cascade__trigger--focus') :
    el.getAttribute('aria-expanded') === 'true' || widget.getAttribute('aria-expanded') === 'true';
  const wasExpanded = isExpanded();
  const previous = tec && !wasExpanded
    ? new Set([...document.querySelectorAll('.tec-cascade__popper')].filter(isElementTrulyVisible)) : null;
  const getPanel = () => {
    if (tec) return tecDropdownPanel(el, '.tec-cascade__popper', previous);
    const id = el.getAttribute('aria-controls') || widget.getAttribute('aria-controls') || widget.getAttribute('aria-describedby');
    const associated = id && document.getElementById(id);
    if (!associated || !isElementTrulyVisible(associated)) return null;
    return associated.matches('.el-cascader__dropdown') ? associated : associated.querySelector('.el-cascader__dropdown');
  };
  const menuSelector = tec ? '.tec-cascade-menu' : '.el-cascader-menu__list';
  const nodeSelector = tec ? '.tec-cascade-node' : '.el-cascader-node';
  const labelSelector = tec ? '.tec-cascade-node__label' : '.el-cascader-node__label';
  const click = node => clickFillControl(node, opts);
  const selectedPath = () => normalizeRegionPath(tec ? tecSelectedLabel(el) : el.value);
  const confirm = (path, name) => !isExpanded() && [path, name].includes(selectedPath());
  let searchValue;
  let confirmed = false;
  try {
    if (!wasExpanded && !await click(tec ? widget : el)) return false;
    panel = await wait(getPanel);
    if (!panel) return false;
    let remaining = target;
    const matchedPath = [];
    for (let depth = 0; depth < 6; depth++) {
      const nodes = await wait(() => {
        const menu = panel.querySelectorAll(menuSelector)[depth];
        const items = [...(menu?.querySelectorAll(nodeSelector) || [])].filter(selectableDropdownOption);
        return items.length && items;
      });
      if (!nodes) return false;
      const nameOf = node => normalizeRegionPath(node.querySelector(labelSelector)?.textContent);
      let matches = nodes.filter(node => nameOf(node) && remaining.startsWith(nameOf(node)))
        .sort((a, b) => nameOf(b).length - nameOf(a).length);
      if (!matches.length && remaining === '潮安县' && matchedPath.join('').endsWith('广东潮州')) {
        matches = nodes.filter(node => nameOf(node) === '潮安区');
      }
      if (matches.length > 1 && nameOf(matches[0]) === nameOf(matches[1])) return false;
      const inferredCountry = !matches.length && depth === 0 && /[\u3400-\u9fff]/.test(remaining);
      const node = matches[0] || (inferredCountry && nodes.find(item => nameOf(item) === '中国'));
      if (!node && tec && depth === 0 && !el.readOnly && /^[\u3400-\u9fff]{2,8}市?$/.test(String(value).trim())) {
        searchValue = el.value;
        el.focus({ preventScroll: true });
        nativeSet(el, HTMLInputElement.prototype, String(value).trim());
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value).trim() }));
        const hit = await wait(() => {
          const matches = [...panel.querySelectorAll('.tec-cascade-node__navigation .tec-cascade-node__label, .tec-cascade-node__navigation.tec-cascade-node__label')]
            .filter(selectableDropdownOption).map(label => {
              const parts = String(label.title || label.textContent).split(/[-－/／>＞]/);
              return { label, path: normalizeRegionPath(parts.join('')), name: normalizeRegionPath(parts.at(-1)) };
            }).filter(item => item.name === target);
          return matches.length === 1 && matches[0];
        });
        if (!hit || !await click(hit.label)) return false;
        confirmed = !!await wait(() => confirm(hit.path, hit.name));
        return confirmed;
      }
      if (!node) return false;
      const name = nameOf(node);
      matchedPath.push(name);
      if (!inferredCountry) remaining = remaining.slice(name.length);
      const hasChildren = tec ? !!node.querySelector('.tec-cascade-node__icon:not(.tec-cascade-node__icon-tooltip)') :
        node.getAttribute('aria-haspopup') === 'true';
      const endsAtCity = tec && !hasChildren && /市\s*$/.test(node.querySelector(labelSelector)?.textContent || '') &&
        depth > 0 && /^[\u3400-\u9fff]{1,10}(?:自治县|新区|区|县|旗)$/.test(remaining);
      if (!remaining || endsAtCity) {
        const radio = node.querySelector('input[type="radio"]:not(:disabled)');
        if (!radio && hasChildren) return false;
        if (!await click(radio?.closest('label') || radio || node)) return false;
        const path = matchedPath.join('');
        return !!await wait(() => {
          const selected = radio?.checked || node.matches('.is-checked, [aria-checked="true"]');
          if (!selected && isExpanded() && getPanel()) return false;
          const shown = selectedPath();
          return shown && (shown === path || shown === target || shown === name);
        });
      }
      if (!hasChildren || !await click(node.querySelector(labelSelector) || node)) return false;
    }
    return false;
  } finally {
    if (!confirmed && searchValue !== undefined && el.isConnected) {
      nativeSet(el, HTMLInputElement.prototype, searchValue);
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    if (isExpanded() || getPanel()) dismissOpenDropdownPanels();
    el.blur();
  }
}

async function writeCompetitionName(input, value, options) {
  const group = input.closest('.ant-form-item');
  const previous = input.value;
  const lengthLimit = () => input.maxLength > 0 ? input.maxLength : Number(
    group?.querySelector('.ant-form-item-explain-error')?.textContent.match(/(?:最大长度为|最多(?:输入)?|不能超过)\s*(\d+)/)?.[1] || 0
  );
  const shortened = compactCompetitionName(value);
  const fit = limit => !limit || value.length <= limit ? value :
    shortened.length > 0 && shortened.length <= limit ? shortened : '';
  const reject = attempted => {
    if (attempted && input.isConnected && input.value === attempted) setValue(input, previous);
    input.setAttribute('data-easyoffer-write-reason', 'validation_failed');
    return false;
  };
  let limit = lengthLimit();
  let candidate = fit(limit);
  if (!candidate) return reject();
  if (!setValue(input, candidate)) return false;
  if (group && candidate.length > 25 && !limit) {
    const wait = (test, timeoutMs) =>
      waitFor(test, { timeoutMs, observe: group, signal: options?.signal, task: options?.task });
    limit = await wait(lengthLimit, 230);
    if (limit && candidate.length > limit) {
      const attempted = candidate;
      candidate = fit(limit);
      if (!candidate) return reject(attempted);
      if (!setValue(input, candidate)) return false;
      await wait(() => input.getAttribute('aria-invalid') !== 'true' && !group.classList.contains('ant-form-item-has-error'), 230);
    }
  }
  return input.value === candidate;
}

// 写入单个控件。options.signal（AbortSignal）用于任务/字段级取消，组件下拉路径全程可中断。
async function fillField(el, value, options) {
  const target = writableBox(el) || el;
  if (!target) return false;
  target.removeAttribute('data-easyoffer-write-reason');
  const written = await writeFieldControl(el, value, options);
  if (!written) return false;
  if (target === document.activeElement) target.blur();
  if (!verifyFieldWrite(target, value, options?.forceWidget)) return false;
  if (!isWidgetSelectTrigger(target) && !options?.forceWidget) return true;
  if (options?.deferVerification) {
    options.deferVerification(target, Date.now() + 120);
    return true;
  }
  await sleep(120);
  await waitForFillCheckpoint(options?.task);
  if (options?.signal?.aborted) return false;
  return verifyFieldWrite(target, value, options?.forceWidget);
}

function verifyFieldWrite(target, value, forceWidget = false) {
  if (!target.isConnected) {
    target.setAttribute('data-easyoffer-write-reason', 'value_reset');
    return false;
  }
  if (isWidgetSelectTrigger(target) || forceWidget) {
    const selected = widgetSelectCurrentValue(target) || (target.closest('.el-cascader') ? target.value : '');
    if (!String(selected || '').trim()) {
      target.setAttribute('data-easyoffer-write-reason', 'value_reset');
      return false;
    }
    if (isSelectWidget(target) && !fieldOptionEquals(getClosestLabelText(target), selected, value)) {
      target.setAttribute('data-easyoffer-write-reason', 'value_reset');
      return false;
    }
  }
  if (target.getAttribute('aria-invalid') === 'true' || target.validity?.valid === false ||
      target.closest('.ant-form-item-has-error, .el-form-item.is-error, .tec-form-item.is-error')) {
    target.setAttribute('data-easyoffer-write-reason', 'validation_failed');
    return false;
  }
  return true;
}

async function writeFieldControl(el, value, options) {
  if (!el || value === undefined || value === null || String(value).trim() === '') return false;
  const target = writableBox(el) || el;
  // 写入前对真实目标复查：外层容器通过的安全检查不代表内层控件安全（如 combobox 内藏密码框）
  if (isIgnoredInput(target)) return false;
  if (target !== el && !isSmartFillWritableInnerInput(target)) return false;
  if (target.closest('.el-date-editor')) return fillElementDate(target, value, options);
  if (target.closest('.el-cascader') || target.matches('.tec-cascade__input')) return fillElementCascader(target, value, options);
  if (target.closest('.ant-picker')) return fillAntCalendar(target, value, options);
  if (target.closest('.tec-date-picker')) return false;
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

  const valueToFill = String(value);
  if (options?.forceWidget || isSelectWidget(target) || isYearControl(target) || isMonthControl(target)) {
    return fillSelectWidget(target, valueToFill, options);
  }
  if (target.readOnly || target.disabled) return false;
  if (target.tagName === 'INPUT' && getClosestLabelText(target) === '竞赛名称') {
    return writeCompetitionName(target, valueToFill, options);
  }
  if (target.maxLength > 0 && valueToFill.length > target.maxLength) {
    target.setAttribute('data-easyoffer-write-reason', 'validation_failed');
    return false;
  }
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
  if (el.matches('.tec-select__input, .tec-cascade__input')) return true;
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
  if (el.matches('.tec-select__input, .tec-cascade__input')) return tecSelectedLabel(el);
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
  if (wrap.matches('.ant-select:not(.ant-select-auto-complete), .rc-select:not(.rc-select-auto-complete)')) return '';
  if (wrap.matches('.el-select') && !el.readOnly) return '';
  const value = String(el?.value || '').trim();
  if (value && !SMART_FILL_PLACEHOLDER_OPTION_RE.test(value)) return value;
  return '';
}
