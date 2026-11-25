// ============================================================================
// Capybara 网申助手 content script —— site.js
// 站点适配：北森(phoenix)/小红书(ant)/Moka(sd-*) 专用填充、声明确认、扩展字段与附件选择
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';

var DUOYI_FAMILY_COLUMNS = new Map([
  ['姓名', 'familyName'], ['与自己关系', 'familyRelation'], ['年龄', 'familyAge'],
  ['职业', 'familyOccupation'], ['职位', 'familyPosition'], ['工作单位', 'familyEmployer']
]);
var DUOYI_SKILL_COLUMNS = new Map([
  ['个人特长', 'duoyiSkill'], ['熟练程度', 'duoyiSkillProficiency']
]);

function duoyiTableField(input) {
  const cell = input.closest('td');
  const row = cell?.parentElement;
  if (!row?.matches('tr.main-list')) return null;
  const labels = Array.from(cell.closest('table').rows[0].cells, cell => cleanLabel(cell.textContent));
  const columns = [DUOYI_FAMILY_COLUMNS, DUOYI_SKILL_COLUMNS].find(columns =>
    [...columns.keys()].every((label, index) => labels[index] === label));
  const label = labels[cell.cellIndex];
  const type = columns?.get(label);
  return type ? { row, label, type } : null;
}

function familyRelationKey(value) {
  const relation = String(value || '').trim();
  if (/^(父|父亲|爸爸|父子|父女)$/.test(relation)) return '父亲';
  if (/^(母|母亲|妈妈|母子|母女)$/.test(relation)) return '母亲';
  return relation;
}

function collectDuoyiFamilyEntries(fields, entries) {
  const rows = new Map();
  const used = new Set();
  for (const { input, detection } of fields) {
    const field = duoyiTableField(input);
    if (!field || !field.type.startsWith('family')) continue;
    if (!rows.has(field.row)) rows.set(field.row, {});
    const row = rows.get(field.row);
    if (detection.fieldType === 'familyName') row.name = input.value.trim();
    if (detection.fieldType === 'familyRelation') row.relation = familyRelationKey(widgetSelectCurrentValue(input));
  }
  for (const row of rows.values()) {
    if (!row.name && !row.relation) continue;
    const matches = entries.filter(entry =>
      (!row.name || row.name === String(entry.name || '').trim()) &&
      (!row.relation || row.relation === familyRelationKey(entry.relation)));
    if (matches.length === 1 && !used.has(matches[0])) {
      row.entry = matches[0];
      used.add(row.entry);
    }
  }
  const remaining = entries.filter(entry => !used.has(entry));
  for (const row of rows.values()) {
    if (!row.name && !row.relation) row.entry = remaining.shift();
  }
  return rows;
}

// 查找页面上的 HR 沟通/聊天输入框（如 BOSS直聘、智联、猎聘、牛客聊天框）
function findChatInputElement() {
  const selectors = [
    'div.chat-input[contenteditable]',
    'div[contenteditable].chat-editor',
    'div[contenteditable].chat-message-input',
    'div[contenteditable].boss-chat-editor',
    'div[contenteditable].input-area',
    'div[contenteditable][class*="chat"]',
    'div[contenteditable][class*="editor"]',
    'div[contenteditable][class*="message"]',
    '.chat-conversation textarea',
    '.chat-input textarea',
    '.chat-box textarea',
    '.chat-editor textarea',
    'textarea.chat-input',
    'textarea.chat-editor',
    'textarea[class*="chatInput"]',
    'textarea[class*="chat-message"]'
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null && !el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) {
      return el;
    }
  }
  return null;
}

// 往聊天框填入文本（兼容 contenteditable 与 textarea）
function setChatInputValue(element, text) {
  if (!element || !text) return false;
  element.focus();

  if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
    setValue(element, text);
  } else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const success = document.execCommand && document.execCommand('insertText', false, text);
    if (!success) {
      element.textContent = text;
    }
    dispatchInputEvents(element, text);
  }
  return true;
}

// 生成个性化打招呼语
function generateDefaultGreeting(profile, positionName, companyName) {
  const b = profile.basicInfo || {};
  const edu = (profile.education && profile.education[0]) || {};
  const name = b.fullName || '求职者';
  const school = edu.school ? `${edu.school}` : '';
  const major = edu.major ? `${edu.major}专业` : '';
  const pos = positionName || '贵司岗位';
  const comp = companyName || '贵公司';

  if (school && major) {
    return `您好！我是${name}，来自${school}${major}。看到${comp}正在招聘「${pos}」，我的背景与该岗位方向很契合，期待能与您沟通交流，谢谢！`;
  }
  return `您好！我是${name}，对${comp}的「${pos}」岗位非常感兴趣，期待能与您进一步沟通交流，谢谢！`;
}

// ========================================================================
// 表单扫描与填充 (智能多段经历映射 · 智能字段解耦)
// ========================================================================

function isXhsForm() {
  return !!document.querySelector('#form_item_name') && !!document.querySelector('#form_item_gender, #form_item_birthday, .ant-form-item .ant-select');
}

async function jumpAntCalendarYear(popup, year, options) {
  const wait = test => waitFor(test, { timeoutMs: 200, signal: options.signal, task: options.task, observe: document.body });
  const yearPanel = () => popup()?.querySelector('.ant-picker-year-panel');
  if (!await clickFillControl(popup()?.querySelector('.ant-picker-year-btn'), options) || !await wait(yearPanel)) return false;
  for (let step = 0; step < 18; step++) {
    const panel = yearPanel();
    const cells = [...(panel?.querySelectorAll('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)') || [])];
    const years = cells.map(cell => Number.parseInt(cell.title || cell.textContent, 10));
    if (!years.length || years.some(n => !Number.isFinite(n))) return false;
    const cell = cells[years.indexOf(year)];
    if (cell) {
      if (!await clickFillControl(cell.querySelector('.ant-picker-cell-inner') || cell, options)) return false;
      return !!await wait(() => !yearPanel());
    }
    const direction = year < Math.min(...years) ? 'prev' : year > Math.max(...years) ? 'next' : '';
    const arrow = direction && panel.querySelector(`.ant-picker-header-super-${direction}-btn`);
    if (!arrow || !await clickFillControl(arrow, options)) return false;
    if (!await wait(() => {
      const first = yearPanel()?.querySelector('.ant-picker-cell-in-view');
      return first && Number.parseInt(first.title || first.textContent, 10) !== years[0];
    })) return false;
  }
  return false;
}

async function fillAntCalendar(input, value, options = {}) {
  const picker = input.closest('.ant-picker');
  if (picker) {
    const parts = elementDateParts(value);
    if (!parts?.[1]) return false;
    const normalized = parts.filter(Boolean).map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
    if (!options.continueRange) {
      document.activeElement?.blur();
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      input.focus();
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      input.click();
    }
    const popup = () => {
      const owned = input.getAttribute('aria-controls');
      const panels = [...document.querySelectorAll('.ant-picker-dropdown')].filter(el => isElementTrulyVisible(el) && !/hidden|leave/.test(el.className));
      return owned ? panels.find(panel => panel.id === owned || panel.contains(document.getElementById(owned))) : panels.length === 1 ? panels[0] : null;
    };
    await waitFor(popup, { timeoutMs: options.openTimeoutMs || 750, signal: options.signal, task: options.task, observe: document.body });
    const monthPanel = !!popup()?.querySelector('.ant-picker-month-panel');
    const target = monthPanel ? normalized.slice(0, 7) : normalized;
    if (!monthPanel && /^\d{4}-\d{2}$/.test(target)) markManual(input, '请确认具体日期');
    let picked = false;
    let triedYearPanel = false;
    if (monthPanel || /^\d{4}-\d{2}-\d{2}$/.test(target)) {
      for (let step = 0; step < 120; step++) {
        await waitForFillCheckpoint(options.task);
        if (options.signal?.aborted) return false;
        const panel = popup();
        if (!panel) break;
        const cells = [...panel.querySelectorAll('td[title]:not(.ant-picker-cell-disabled)')].filter(el => el.title === target);
        const cell = cells.find(el => el.classList.contains('ant-picker-cell-in-view')) || cells[0];
        if (cell && await clickFillControl(cell.querySelector('.ant-picker-cell-inner') || cell, options)) { picked = true; break; }
        const calendarYear = () => parseInt(popup()?.querySelector('.ant-picker-year-btn')?.textContent, 10);
        const calendarMonth = () => parseInt(popup()?.querySelector('.ant-picker-month-btn')?.textContent, 10);
        const year = calendarYear();
        const month = calendarMonth();
        if (!year) break;
        const targetYear = Number(target.slice(0, 4)), targetMonth = Number(target.slice(5, 7));
        if (!triedYearPanel && Math.abs(targetYear - year) > 2) {
          triedYearPanel = true;
          if (await jumpAntCalendarYear(popup, targetYear, options)) {
            // A day picker may expose the month grid after the user selects a year.
            if (!monthPanel) {
              const monthGrid = popup()?.querySelector('.ant-picker-month-panel');
              if (monthGrid) {
                const monthCell = monthGrid.querySelector(`td[title="${target.slice(0, 7)}"]:not(.ant-picker-cell-disabled)`);
                if (!await clickFillControl(monthCell?.querySelector('.ant-picker-cell-inner') || monthCell, options)) break;
                await waitFor(() => popup()?.querySelector('.ant-picker-date-panel'), { timeoutMs: 200, signal: options.signal, task: options.task });
              }
            }
            continue;
          }
          if (popup()?.querySelector('.ant-picker-year-panel')) break;
        }
        const direction = year !== targetYear ? (targetYear < year ? 'super-prev' : 'super-next')
          : (!monthPanel && month ? (targetMonth < month ? 'prev' : 'next') : '');
        if (!direction) break;
        const arrow = [...panel.querySelectorAll(`.ant-picker-header-${direction}-btn`)]
          .find(button => !button.disabled && isElementTrulyVisible(button));
        if (!await clickFillControl(arrow, options)) break;
        const moved = await waitFor(() => calendarYear() !== year || Number.isFinite(month) && calendarMonth() !== month,
          { timeoutMs: 180, signal: options.signal, task: options.task });
        if (!moved) break;
      }
    }
    if (picked && options.stageRange) return true;
    input.blur();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return picked && !!await waitFor(() => antDateCommitted(input, target),
      { timeoutMs: 500, signal: options.signal, task: options.task });
  }
  return false;
}

function antDateCommitted(input, value) {
  const parts = elementDateParts(value);
  if (!parts?.[1]) return false;
  const normalized = parts.filter(Boolean).map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');
  const shown = input.value.replace(/\//g, '-');
  return input.isConnected && (shown === normalized || shown.length === 7 && shown === normalized.slice(0, 7));
}

async function fillAntDateRange(fields, values, options) {
  if (fields.some(fieldHasValue) || !values.every(value => elementDateParts(value))) return false;
  try {
    const staged = await fillAntCalendar(fields[0], values[0], { ...options, stageRange: true });
    if (!staged || !await fillAntCalendar(fields[1], values[1], { ...options, continueRange: true })) return false;
    return fields.every((input, index) => antDateCommitted(input, values[index]) &&
      !input.closest('.ant-form-item-has-error') && input.getAttribute('aria-invalid') !== 'true');
  } finally {
    fields.forEach(input => input.blur());
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }
}

async function fillXhsControl(input, value, options) {
  if (input.closest('.ant-picker')) return fillAntCalendar(input, value, options);
  if (input.closest('.ant-select-auto-complete') && !input.readOnly && !input.disabled) {
    const ok = setValue(input, value);
    input.blur();
    await Promise.resolve();
    return ok && input.value === String(value) && input.getAttribute('aria-invalid') !== 'true';
  }
  return fillField(input, value, options);
}

var XHS_SECTIONS = {
  education: ['学校', 'school', '添加教育经历'],
  workExperience: ['公司', 'company', '添加实习经历'],
  projects: ['项目名称', 'name', '添加项目经历'],
  awards: ['竞赛/奖项名称', 'name', '添加竞赛/奖项'],
  papers: ['论文名称', 'name', '添加论文'],
  patents: ['专利名称', 'name', '添加专利'],
  certificates: ['证书名称', 'name', '添加证书']
};

function xhsLabel(item) {
  return cleanLabel(item.querySelector('.ant-form-item-label')?.textContent).replace(/[:：]$/, '').trim();
}

function xhsRecord(input) {
  const match = input?.id.match(/resume(Education|Employment|Project|Award|Competition|Paper|Patent|Certificate)(?:Experience)?Info_(\d+)_/i);
  if (match) {
    const section = {education:'education', employment:'workExperience', project:'projects', award:'awards',
      competition:'awards', paper:'papers', patent:'patents', certificate:'certificates'}[match[1].toLowerCase()];
    return { section, key: Number(match[2]) };
  }
  const card = input?.closest('.rounded-md');
  if (!card) return null;
  const labels = [...card.querySelectorAll('.ant-form-item')].filter(item => item.closest('.rounded-md') === card).map(xhsLabel);
  const section = Object.keys(XHS_SECTIONS).find(key => labels.includes(XHS_SECTIONS[key][0]));
  return section ? { section, key: card } : null;
}

function xhsBindings(items, profile) {
  const records = new Map();
  const rowsBySection = {};
  for (const item of items) {
    const input = item.querySelector('input,textarea,select');
    const record = xhsRecord(input);
    if (!record) continue;
    // Prefer the same card key for its indexed and unindexed controls.
    const card = input.closest('.rounded-md');
    if (card && [...card.querySelectorAll('.ant-form-item')].filter(i => xhsLabel(i) === XHS_SECTIONS[record.section][0]).length === 1) record.key = card;
    const rows = rowsBySection[record.section] ||= new Map();
    if (!rows.has(record.key)) rows.set(record.key, {section: record.section, identity: ''});
    const row = rows.get(record.key);
    if (xhsLabel(item) === XHS_SECTIONS[record.section][0]) {
      row.identity = (widgetSelectCurrentValue(input) || input.value || '').trim();
    }
    records.set(item, row);
  }
  for (const [section, rows] of Object.entries(rowsBySection)) {
    const entries = profile[section] || [];
    const used = new Set();
    for (const row of rows.values()) {
      if (!row.identity) continue;
      const key = XHS_SECTIONS[section][1];
      const matches = entries.filter(entry => String(entry?.[key] || '').trim() === row.identity);
      if (matches.length === 1 && !used.has(matches[0])) { row.entry = matches[0]; used.add(row.entry); }
    }
    const remaining = entries.filter(entry => !used.has(entry));
    for (const row of rows.values()) if (!row.identity) row.entry = remaining.shift();
  }
  return records;
}

function siteFieldClaim(options, input, label) {
  options.attemptedFields?.add(input);
  options.onField?.(input, label);
}

async function fillXhsForm(profile, options = {}) {
  const items = () => [...document.querySelectorAll('.ant-form-item')].filter(isElementTrulyVisible);
  if (options.mode !== 'incremental' || options.completeRows) {
    for (const [section, [anchor, , buttonText]] of Object.entries(XHS_SECTIONS)) {
      const n = (profile[section] || []).filter(entry => typeof entry === 'object' && entry && Object.keys(entry).some(key => key !== 'id' && entry[key])).length;
      const count = () => items().filter(item => xhsLabel(item) === anchor).length;
      for (let current = count(); current < n; current = count()) {
        await waitForFillCheckpoint(options.task);
        const button = [...document.querySelectorAll('button,span')].find(el => el.textContent.trim().replace(/^[+＋]\s*/, '') === buttonText && isElementTrulyVisible(el));
        if (!button || button.closest('[disabled],[aria-disabled="true"]')) break;
        button.click();
        if (!await waitFor(() => count() > current, { timeoutMs: 1000, task: options.task, signal: options.signal, observe: document.body })) break;
      }
    }
  }
  const fields = items();
  const records = xhsBindings(fields, profile);
  const basic = profile.basicInfo || {};
  const documentType = basic.idCardType || (/^(?:\d{15}|\d{17}[\dXx])$/.test(basic.idCard || '') ? '身份证' : '');
  const intro = profile.introTemplates?.default || '';
  const stars = [...intro.matchAll(/(\d+)\s*Stars\b/gi)].map(m => Number(m[1]));
  const githubLinks = [...new Set([basic.github, ...(profile.projects || []).map(p => p.projectUrl),
    ...(intro.match(/https:\/\/github\.com\/[A-Za-z0-9_.\/-]+/g) || [])].filter(Boolean))];
  const basics = { '姓名': basic.fullName, '邮箱': basic.email, '性别': basic.gender, '出生年月': basic.birthDate,
    '出生日期': basic.birthDate, '手机号': basic.phone, '手机号码': basic.phone, '意向工作城市': profile.jobIntention?.expectedCity,
    'github 链接': profile.openSource?.map(p => p.url).filter(Boolean).join('\n') || githubLinks.join('\n'),
    'github 星级': profile.openSource?.[0]?.stars ?? (stars.length ? Math.max(...stars) : '') };
  const fieldResults = [], manualFields = [];
  let filledCount = 0;
  for (const item of fields) {
    await waitForFillCheckpoint(options.task);
    const label = xhsLabel(item);
    const inputs = [...item.querySelectorAll('input:not([type="file"]):not([type="checkbox"]):not([type="hidden"]),textarea,select')]
      .filter(el => el.closest('.ant-form-item') === item && !isIgnoredInput(el));
    if (!inputs.length) continue;
    const record = records.get(item);
    const entry = record?.entry || {};
    const section = record?.section;
    const range = label === '起止时间' && ['education', 'projects', 'workExperience'].includes(section);
    const doc = !section && /^证件号码?(?:[（(].*?[）)])?$/.test(label);
    const typeInput = doc && inputs.find(el => el.tagName === 'SELECT' || el.closest('.ant-select'));
    const numberInput = doc && inputs.find(el => el !== typeInput && !el.closest('.ant-select'));
    let values;
    if (range) values = [entry.startDate, entry.endDate];
    else if (doc) values = inputs.map(el => el === typeInput ? documentType : el === numberInput ? basic.idCard : undefined);
    else if (section) {
      const rankPercent = Number(String(entry.rank || '').match(/^(?:专业)?(?:排名)?(?:前|TOP)\s*(\d+(?:\.\d+)?)\s*%$/i)?.[1]);
      const bucket = rankPercent > 0 && [5, 10, 20, 25, 50].find(n => rankPercent <= n);
      const siteKeys = {
        education: { '学校': entry.school, '专业': entry.major, '院系': entry.college, '学历': ({硕士:'硕士研究生',博士:'博士研究生'})[entry.degree] || entry.degree,
          '成绩排名': bucket ? 'TOP' + bucket + '%' : entry.rank, 'gpa': entry.gpa, '绩点': entry.gpa },
        workExperience: { '公司': entry.company, '部门': entry.department, '职位': entry.position,
          '工作性质': entry.workType, '工作描述': [entry.description, entry.achievements].filter(Boolean).join('\n') },
        projects: { '项目名称': entry.name, '项目描述': entry.description, '项目职责': entry.responsibilities, '项目成果': entry.achievements,
          '项目角色': entry.role, '项目链接': entry.projectUrl, '职责及业绩': [entry.responsibilities, entry.achievements].filter(Boolean).join('\n') },
        awards: { '竞赛/奖项名称': entry.name, '获奖名次': entry.rank || entry.grade,
          '获奖情况描述/链接': [entry.description, entry.url].filter(Boolean).join('\n') }
      };
      if (Object.hasOwn(siteKeys[section] || {}, label)) values = [siteKeys[section][label]];
      else if (EXTENDED_MAPPINGS[section]?.[label] && EXTENDED_MAPPINGS[section][label] !== '__combined') values = [entry[EXTENDED_MAPPINGS[section][label]]];
    } else if (Object.hasOwn(basics, label)) values = [basics[label]];
    if (!values) continue;
    // Country prefixes and certificate types are separate controls from their adjacent text fields.
    const phone = /^(手机号|手机号码)$/.test(label) && inputs.length > 1;
    const targets = phone ? [inputs.find(el => el.tagName === 'INPUT' && !el.closest('.ant-select'))] : inputs;
    if (phone) inputs.filter(el => el !== targets[0]).forEach(el => options.attemptedFields?.add(el));
    const radios = inputs.filter(el => el.type === 'radio');
    if (radios.length) radios.forEach(el => options.attemptedFields?.add(el));
    let rangeWritten;
    for (let i = 0; i < values.length; i++) {
      const input = targets[i], value = values[i];
      if (!input) continue;
      await waitForFillCheckpoint(options.task);
      siteFieldClaim(options, input, label);
      let status = 'needs_review', reason = 'no_profile_value', actual = value;
      try {
        if (rangeWritten === true) { status = 'filled'; reason = ''; filledCount++; }
        else if (fieldHasValue(input)) { status = 'skipped_has_value'; reason = ''; }
        else if (value != null && String(value).trim()) {
          let ok = false;
          if (doc && input === numberInput && typeInput &&
              !fieldOptionEquals('证件类型', typeInput.tagName === 'SELECT' ? typeInput.selectedOptions[0]?.text : widgetSelectCurrentValue(typeInput), documentType)) {
            reason = 'document_type_mismatch';
          } else {
            if (range && inputs.length === 2 && inputs[0].closest('.ant-picker-range')?.contains(inputs[1])) {
              rangeWritten ??= await fillAntDateRange(inputs, values, options);
              ok = rangeWritten;
            } else if (label === '意向工作城市' && isSelectWidget(input)) {
              const cities = String(value).split(/[、，,;；/／|]/).map(city => city.trim()).filter(Boolean);
              for (const city of cities) {
                if (await fillXhsControl(input, city, options)) { ok = true; actual = city; break; }
              }
            } else ok = await fillXhsControl(input, value, options);
            reason = ok ? '' : 'xhs_control_mismatch';
          }
          if (ok) { status = 'filled'; filledCount++; clearManualHint(input); input.style.backgroundColor = '#e8f5e9'; }
          else { const note = label + '：' + (doc ? '请核对证件类型和号码' : value); manualFields.push(note); markManual(input, note); }
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        status = 'failed'; reason = err?.message || String(err);
        manualFields.push(label); markManual(input, label);
      }
      fieldResults.push({ ...fillResultEntry(input, { fieldType: label }, status, reason, actual), label });
    }
  }
  return { filledCount, manualFields, results: fieldResults, fieldResults, isForm: true };
}

function isBeisenForm() {
  return !!document.querySelector('.ux-standard-form, form.form--phoenix, .form-item--phoenix');
}

// 每个 ux-standard-form 是一段独立经历，不能用页面上同名字段的顺序推断归属。
function beisenKind(form) {
  const labels = [...form.querySelectorAll('.form-item--phoenix')].map(beisenLabel);
  if (labels.includes('文章名、书名')) return 'paper';
  if (labels.includes('论文名称')) return 'paper';
  if (labels.includes('专利名称')) return 'patent';
  if (labels.includes('证书名称')) return 'certificate';
  if (labels.includes('称谓')) return 'family';
  if (labels.includes('学校')) return 'education';
  if (labels.includes('单位名称')) return 'work';
  if (labels.includes('项目名称')) return 'project';
  if (labels.includes('奖项名称')) return 'award';
  if (labels.includes('电子邮箱')) return 'basic';
  if (labels.includes('外语语种')) return 'language';
  if (labels.includes('期望工作城市')) return 'intention';
  if (labels.includes('技能类别')) return 'skills';
  if (labels.includes('自我评价及求职目标')) return 'intro';
  if (labels.includes('本人承诺') && labels.includes('填表人签名')) return 'attestation';
  return '';
}

function beisenLabel(item) {
  return cleanLabel((item.querySelector('.form-item__text') || item.querySelector('.form-item__title'))?.textContent?.normalize('NFKC'));
}

function beisenPartyStatus(form) {
  const field = [...(form?.querySelectorAll('.form-item--phoenix') || [])].find(item => /^(党派|政治面貌)$/.test(beisenLabel(item)));
  if (!field) return null;
  const widget = field.querySelector('.phoenix-select');
  if (widget) return beisenSelectCurrentValue(widget);
  const native = field.querySelector('select');
  if (native) return native.value ? native.selectedOptions[0]?.text.trim() || '' : '';
  const checked = field.querySelector('.phoenix-radio--checked,[aria-checked=true]');
  if (checked) return checked.textContent.trim();
  const radio = field.querySelector('input[type=radio]:checked');
  return radio ? choiceCaption(radio) : field.querySelector('input:not([type=radio])')?.value || '';
}

var BEISEN_SECTIONS = { education: 'education', work: 'workExperience', project: 'projects',
  family: 'familyMembers', award: 'awards', paper: 'papers', patent: 'patents', certificate: 'certificates', language: 'languageCertificates' };

function beisenCertificateCategory(entry) {
  if (entry?.category) return entry.category;
  const name = String(entry?.name || '').normalize('NFKC').replace(/\s+/g, '');
  if (/^(?:基金|证券|期货)从业(?:人员)?资格(?:考试)?(?:证书|证|合格证)?$/.test(name)) return '投资与财务';
  if (/^(?:(?:全国)?计算机等级考试|计算机技术与软件专业技术资格|微软认证|思科认证|NCRE\b)/i.test(name) ||
      /^(?:(?:WPS|MS)(?:Office)?)?计算机[一二三四]级(?:考试|证书)?(?:[-·(]?(?:WPS|MS)(?:Office)?\)?)?$/i.test(name)) return '信息技术';
  return '';
}

function beisenLists(profile) {
  const lists = Object.fromEntries(Object.entries(BEISEN_SECTIONS).map(([kind, key]) => [kind, profile[key] || []]));
  lists.language = profileLanguageEntries(profile);
  lists.certificate = lists.certificate.map(entry => typeof entry === 'string' ? { name: entry } : entry);
  for (const kind of Object.keys(lists)) lists[kind] = lists[kind].filter(entry =>
    entry && Object.entries(entry).some(([key, value]) => key !== 'id' && value != null && String(value).trim()));
  return lists;
}

// The first field identifies a record. Additional fields distinguish entries with the same name.
var BEISEN_ROW_KEYS = {
  education: {学校:'school', 学院:'college', 院系:'college', 专业名称:'major', 学历:'degree', 开始时间:'startDate', 结束时间:'endDate'},
  project: {项目名称:'name', 开始时间:'startDate', 结束时间:'endDate', 担当角色:'role'},
  work: {单位名称:'company', 开始时间:'startDate', 结束时间:'endDate', 职位名称:'position', 所在部门:'department'},
  family: {姓名:'name', 称谓:'relation', 出生日期:'birthDate'},
  award: {奖项名称:'name', 获奖时间:'date', 颁奖单位:'issuer'},
  certificate: {证书名称:'name', 获得时间:'date', 证书编号:'code', 颁发机构:'issuer', 颁发单位:'issuer', 具有资格证书:'category', 证书等级:'level'},
  paper: {'文章名、书名':'name', 论文名称:'name', 日期:'date', '刊物、出版社':'publisher'},
  patent: {专利名称:'name', 专利号:'code', 取得时间:'date'},
  language: {外语语种:'language', 语言等级:'exam'}
};

function beisenRowValue(item) {
  const picker = item.querySelector('.phoenix-select');
  if (picker) return beisenSelectCurrentValue(picker);
  const control = item.querySelector('input:not([type=hidden]), textarea, select');
  if (control?.tagName === 'SELECT') return control.value ? control.selectedOptions[0]?.text.trim() || '' : '';
  if (item.querySelector('.phoenix-radio')) {
    const checked = item.querySelector('.phoenix-radio--checked,[aria-checked=true],.phoenix-radio input:checked');
    return checked?.closest('.phoenix-radio')?.textContent.trim() || '';
  }
  if (control?.matches('[type=radio],[type=checkbox]')) return item.querySelector('input:checked')?.value || '';
  return control?.value.trim() || '';
}

function beisenRecordText(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function beisenRecordDateEqual(a, b, monthOnly = false) {
  const left = elementDateParts(a), right = elementDateParts(b);
  if (!left?.[1] || !right?.[1]) return false;
  return left[0] === right[0] && left[1] === right[1] && (monthOnly || !left[2] || !right[2] || left[2] === right[2]);
}

function beisenRecordFieldEqual(label, key, shown, entry) {
  if (key === 'exam') return [entry.name, entry.level].some(value => fieldOptionEquals(label, shown, value));
  if (key === 'degree') return fieldOptionEquals(label, shown, entry.degree);
  if (key === 'category' && label === '具有资格证书') return beisenRecordText(shown) === beisenRecordText(beisenCertificateCategory(entry));
  if (key === 'relation') return familyRelationKey(shown) === familyRelationKey(entry.relation);
  if (/date$/i.test(key)) return beisenRecordDateEqual(shown, entry[key]);
  return beisenRecordText(shown) === beisenRecordText(entry[key]);
}

function beisenQualifiedProjectTitle(left, right) {
  const compact = text => text.replace(/\s/g, '');
  const [title, qualified] = [left, right].map(beisenRecordText).sort((a, b) => compact(a).length - compact(b).length);
  const whole = compact(title);
  if (whole.length < 8 || compact(qualified).length <= whole.length) return false;
  // A recorded project can include an event or series prefix. Require the whole title at a visible boundary.
  for (const delimiter of qualified.matchAll(/[\s·•:：—–\-／/]+/g)) {
    if (compact(qualified.slice(delimiter.index + delimiter[0].length)) === whole) return true;
  }
  return false;
}

function beisenRowPlan(kind, forms, entries) {
  const keys = BEISEN_ROW_KEYS[kind];
  const anchor = Object.values(keys)[0];
  const assigned = new Map();
  const candidates = new Map();
  const unnamedFamily = new Set();
  const interchangeable = new Map();
  const represented = new Set();
  const blanks = [];
  for (const form of forms) {
    const values = new Map(), formKeys = new Set();
    for (const item of form.querySelectorAll('.form-item--phoenix')) {
      const label = beisenLabel(item);
      if (keys[label]) formKeys.add(keys[label]);
      const value = beisenRowValue(item);
      if (value) values.set(label, value);
    }
    if (!values.size) { blanks.push(form); continue; }
    const fields = [...values].filter(([label]) => keys[label]);
    const name = fields.find(([label]) => keys[label] === anchor)?.[1];
    const exam = kind === 'language' && values.get('语言等级');
    let matches = name ? entries.filter(entry => beisenRecordText(name) === beisenRecordText(entry[anchor])) : [];
    if (kind === 'family' && !name && values.has('称谓') && elementDateParts(values.get('出生日期'))?.[2]) {
      unnamedFamily.add(form);
      matches = entries.filter(entry => elementDateParts(entry.birthDate)?.[2] &&
        familyRelationKey(values.get('称谓')) === familyRelationKey(entry.relation) &&
        beisenRecordDateEqual(values.get('出生日期'), entry.birthDate));
    }
    if (exam) matches = (name ? matches : entries).filter(entry => beisenRecordFieldEqual('语言等级', 'exam', exam, entry));
    if (kind === 'project' && name && !matches.length) {
      matches = entries.filter(entry => beisenQualifiedProjectTitle(name, entry.name) &&
        beisenRecordDateEqual(values.get('开始时间'), entry.startDate, true));
    }
    if (matches.length > 1 && !unnamedFamily.has(form)) {
      let narrowed = matches.filter(entry => fields.every(([label, shown]) =>
        keys[label] === anchor || beisenRecordFieldEqual(label, keys[label], shown, entry)));
      // Sites and resumes may record different major wording or graduation days for the same enrolment.
      if (!narrowed.length && kind === 'education' && values.has('学历') && values.has('开始时间')) {
        narrowed = matches.filter(entry => fieldOptionEquals('学历', values.get('学历'), entry.degree) &&
          beisenRecordDateEqual(values.get('开始时间'), entry.startDate));
      }
      // Conflicting/incomplete details cannot establish which same-name records are missing.
      if (narrowed.length) matches = narrowed;
      else { matches.forEach(entry => represented.add(entry)); matches = []; }
    }
    if (kind === 'certificate' && matches.length > 1 &&
        [...formKeys].every(key => matches.every(entry => beisenRecordText(entry[key]) === beisenRecordText(matches[0][key])))) {
      // Two real certificates can have the same name, issuer and date but different serials.
      // Count occupied slots; expose only values common to the candidates on these saved rows.
      const signature = matches.map(entry => entries.indexOf(entry)).join(',');
      if (!interchangeable.has(signature)) interchangeable.set(signature, { entries: matches, forms: [] });
      interchangeable.get(signature).forms.push(form);
      assigned.set(form, null);
      continue;
    }
    candidates.set(form, matches);
    matches.forEach(entry => represented.add(entry));
    assigned.set(form, null);
  }
  const singleClaims = new Map();
  for (const matches of candidates.values()) {
    if (matches.length === 1) singleClaims.set(matches[0], (singleClaims.get(matches[0]) || 0) + 1);
  }
  for (const [form, matches] of candidates) {
    if (unnamedFamily.has(form) && matches.length === 1 &&
        [...candidates.values()].some(other => other !== matches && other.includes(matches[0]))) continue;
    if (matches.length === 1 && singleClaims.get(matches[0]) === 1) assigned.set(form, matches[0]);
  }
  for (const group of interchangeable.values()) {
    const available = group.entries.filter(entry => !represented.has(entry));
    available.slice(0, group.forms.length).forEach(entry => represented.add(entry));
    if (group.forms.length > available.length) continue;
    const common = Object.fromEntries(Object.entries(group.entries[0]).filter(([key, value]) =>
      key !== 'id' && group.entries.every(entry => entry[key] === value)));
    for (const form of group.forms) assigned.set(form, common);
  }
  const remaining = entries.filter(entry => !represented.has(entry));
  for (const form of blanks) assigned.set(form, remaining.shift());
  return { assigned, missing: remaining.filter(entry => beisenRecordText(entry[anchor])) };
}

function beisenRowEntries(forms, lists) {
  const assigned = new Map();
  for (const [kind, entries] of Object.entries(lists)) {
    const rows = forms.filter(form => beisenKind(form) === kind);
    for (const [form, entry] of beisenRowPlan(kind, rows, entries).assigned) assigned.set(form, entry);
  }
  return assigned;
}

function beisenSelectCurrentValue(wrap) {
  const chips = [...wrap.querySelectorAll('.phoenix-select__content > li:not(.phoenix-select__inputWrapper)')]
    .map(chip => chip.textContent.trim()).filter(Boolean);
  const value = chips.join('、') || wrap.querySelector('.phoenix-select__tipEle')?.textContent.trim() || '';
  return SMART_FILL_PLACEHOLDER_OPTION_RE.test(value) ? '' : value;
}

// Keep the actual committed display and the original records in this isolated world only.
// The site may rebuild every .ux-standard-form when it finishes parsing an attachment.
var beisenResultProofs = globalThis.__easyofferBeisenProofs ||= new WeakMap();

function beisenFormWitness(form) {
  const kind = beisenKind(form);
  const keys = BEISEN_ROW_KEYS[kind] || {};
  const fields = new Map();
  for (const item of form.querySelectorAll('.form-item--phoenix')) {
    const label = beisenLabel(item);
    if (fields.has(label)) fields.set(label, null);
    else fields.set(label, item);
  }
  const values = new Map();
  for (const [label, key] of Object.entries(keys)) {
    const item = fields.get(label);
    const value = item && beisenRowValue(item);
    if (value) values.set(key, beisenRecordText(value));
  }
  return {form, kind, values, fields};
}

function beisenCaptureForms(forms, byForm) {
  const sources = forms.map(beisenFormWitness);
  for (const source of sources) {
    source.peers = sources;
    byForm.set(source.form, source);
    for (const item of source.fields.values()) if (item) byForm.set(item, source);
  }
}

function beisenCommittedResultValue(item, label) {
  const multi = item.querySelector('select[multiple]');
  if (multi) return [...multi.selectedOptions].map(option => option.value).sort().join('\u001f');
  if (item.querySelector('input[type=checkbox]')) {
    return [...item.querySelectorAll('input[type=checkbox]:checked')].map(el => choiceCaption(el) || el.value).sort().join('\u001f');
  }
  const text = beisenRowValue(item);
  if (/(日期|年月|时间|生日)$/.test(label)) {
    const parts = elementDateParts(text);
    if (parts) return parts.join('-');
  }
  return text;
}

function beisenRememberResult(row, byForm, item = row.element?.closest?.('.form-item--phoenix')) {
  if (!item) return row;
  const form = byForm?.get(item)?.form || item.closest('.ux-standard-form');
  if (!form) return row;
  byForm ||= new WeakMap();
  if (!byForm.has(form)) {
    const forms = [...document.querySelectorAll('.ux-standard-form')];
    if (!forms.includes(form)) forms.push(form);
    beisenCaptureForms(forms, byForm);
  }
  const source = byForm.get(item) || byForm.get(form);
  const label = beisenLabel(item);
  const proof = {source, item, element: row.element, label, expected: null};
  // A picker may remove its trigger, or the entire original field, on commit.
  const observed = row.status === 'filled' && !beisenRowValue(item) && (!item.isConnected || !item.contains(row.element))
    ? beisenCurrentItem(proof, {}) || item : item;
  const value = beisenRowValue(observed);
  const key = BEISEN_ROW_KEYS[source.kind]?.[label];
  if (key && value && row.status === 'filled') source.values.set(key, beisenRecordText(value));
  proof.expected = row.status === 'filled'
    ? isBeisenPlainText(row.element) && row.value != null && !/(日期|年月|时间|生日)$/.test(label)
      ? String(row.value).trim() : beisenCommittedResultValue(observed, label)
    : null;
  beisenResultProofs.set(row, proof);
  return row;
}

function beisenSameRecordAnchor(source, target) {
  if (source.kind !== target.kind) return false;
  const keys = BEISEN_ROW_KEYS[source.kind];
  if (!keys) return ['basic', 'intention', 'intro', 'skills'].includes(source.kind);
  const anchor = Object.values(keys)[0];
  const oldName = source.values.get(anchor), newName = target.values.get(anchor);
  if (oldName && newName) return oldName === newName;
  if (source.kind !== 'family') return false;
  const oldBirth = source.values.get('birthDate'), newBirth = target.values.get('birthDate');
  const relation = source.values.get('relation');
  return !!(relation && target.values.get('relation') && elementDateParts(oldBirth)?.[2] && elementDateParts(newBirth)?.[2] &&
    familyRelationKey(relation) === familyRelationKey(target.values.get('relation')) && beisenRecordDateEqual(oldBirth, newBirth));
}

function beisenCompatibleDetails(source, target) {
  return [...source.values].every(([key, value]) => !target.values.has(key) || target.values.get(key) === value ||
    /date$/i.test(key) && beisenRecordDateEqual(target.values.get(key), value));
}

function beisenCurrentItem(proof, cache) {
  const {source, label, item} = proof;
  cache.witnesses ||= new WeakMap();
  const witness = form => {
    if (!cache.witnesses.has(form)) cache.witnesses.set(form, beisenFormWitness(form));
    return cache.witnesses.get(form);
  };
  if (source.form.isConnected && source.form.contains(item) && beisenLabel(item) === label &&
      item.contains(proof.element) && source.kind === witness(source.form).kind &&
      beisenCompatibleDetails(source, witness(source.form))) return item;
  if (!cache.forms) cache.forms = [...document.querySelectorAll('.ux-standard-form')].map(witness);
  if (!cache.targets) cache.targets = new Map();
  if (!cache.targets.has(source)) {
    const candidates = cache.forms.filter(row => beisenSameRecordAnchor(source, row));
    const peers = source.peers.filter(row => beisenSameRecordAnchor(row, source));
    let target = null;
    if (candidates.length === 1 && peers.length === 1) target = candidates[0];
    else {
      const matches = candidates.filter(row => beisenCompatibleDetails(source, row));
      if (matches.length === 1 && peers.filter(row => beisenCompatibleDetails(row, matches[0])).length === 1) target = matches[0];
    }
    cache.targets.set(source, target);
  }
  const candidate = cache.targets.get(source)?.fields.get(label);
  if (!candidate) return null;
  const controls = [...candidate.querySelectorAll('input:not([type=hidden]):not([type=file]),textarea,select,.phoenix-select,.phoenix-radio')];
  const singleGroup = controls.every(el => el.matches('.phoenix-radio,input[type=radio]'));
  const topLevel = controls.filter(control => !controls.some(other => other !== control && other.contains(control)));
  return controls.length && (singleGroup || topLevel.length === 1) ? candidate : null;
}

function beisenResultStatus(proof, item) {
  if (!item) return 'control_replaced';
  if (!proof.expected || beisenCommittedResultValue(item, proof.label) !== proof.expected) return 'value_reset';
  const input = item.querySelector('input:not([type=hidden]),textarea,select');
  if (item.querySelector('[aria-invalid=true]') || input?.validity?.valid === false ||
      item.querySelector('.form-item__error')?.textContent.trim()) return 'validation_failed';
  return '';
}

function beisenResultRank(row) {
  if (row.status === 'filled') return 3;
  if ((row.proof || beisenResultProofs.get(row))?.expected != null) return 2;
  return row.status === 'skipped_has_value' ? 1 : 0;
}

async function scanBeisenVirtualList(panel, matches, options) {
  const holder = panel.querySelector('.phoenix-selectList__virtualList-holder');
  if (!holder?.clientHeight || holder.scrollHeight <= holder.clientHeight + 1) return matches();
  const scroll = async top => {
    if (Math.abs(top - holder.scrollTop) < 1) return;
    holder.scrollTop = top;
    // Virtual rows are recycled after scroll handlers run, on the next paint.
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 100);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
    });
  };
  const initial = holder.scrollTop;
  const position = row => Math.round(row.getBoundingClientRect().top - holder.getBoundingClientRect().top + holder.scrollTop);
  let hit = null;
  try {
    await scroll(0);
    for (let page = 0; page < 100; page++) {
      await waitForFillCheckpoint(options.task);
      if (options.signal?.aborted || !panel.isConnected) return [];
      for (const row of matches()) {
        const key = position(row);
        if (hit && hit.key !== key) return [hit.row, row];
        if (!hit) hit = { key, row, top: holder.scrollTop };
      }
      const last = holder.scrollHeight - holder.clientHeight;
      if (holder.scrollTop >= last - 1) {
        if (!hit) return [];
        await scroll(hit.top);
        return matches().filter(row => position(row) === hit.key);
      }
      const previous = holder.scrollTop;
      await scroll(Math.min(last, previous + holder.clientHeight));
      if (holder.scrollTop <= previous) return [];
    }
    return []; // An incomplete or unbounded list cannot prove a unique match.
  } finally {
    if (!hit && holder.isConnected) holder.scrollTop = initial;
  }
}

async function fillBeisenSelect(input, value, options = {}) {
  const wrap = input.closest('.phoenix-select');
  if (!wrap || input.disabled || !input.isConnected) return false;
  const label = getClosestLabelText(input);
  const selected = () => fieldOptionEquals(label, beisenSelectCurrentValue(wrap), value);
  if (selected()) return true;
  const wait = test => waitFor(test, { timeoutMs: options.openTimeoutMs || 1100,
    observe: document.body, signal: options.signal, task: options.task });
  const panels = () => [...document.querySelectorAll('.phoenix-selectList, .constant-main-selector-container')]
    .filter(isElementTrulyVisible);
  const outside = () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  outside();
  document.body.click();
  const before = new Set(panels());
  if (!await clickFillControl(wrap, options)) return false;
  const panel = await wait(() => {
    const ids = [input, wrap].flatMap(node => ['aria-controls', 'aria-owns'].flatMap(attr =>
      (node.getAttribute(attr) || '').split(/\s+/).filter(Boolean)));
    const candidates = panels().filter(node => ids.length
      ? ids.some(id => { const link = document.getElementById(id); return link && (link.contains(node) || node.contains(link)); })
      : wrap.contains(node) || !before.has(node));
    return candidates.length === 1 && candidates[0];
  });
  if (!panel) {
    outside();
    document.body.click();
    return false;
  }
  let triggerQuery = null;
  try {
    const constant = panel.matches('.constant-main-selector-container');
    const rowSelector = constant ? '.left-container .list-item-container' : '.phoenix-selectList__listItem';
    const rowText = node => (node.querySelector('.item-text-label, .phoenix-selectList__singleLabel') || node).textContent.trim();
    const matches = () => {
      const rows = [...panel.querySelectorAll(rowSelector)].filter(row => selectableDropdownOption(row) && !/disabled/i.test(row.className));
      if (/^(?:语言|外语|英语)等级$/.test(label) && languageExamKey(value)) {
        return rows.filter(row => fieldOptionEquals(label, rowText(row), value));
      }
      const exact = rows.filter(row => optionTextEquals(rowText(row), value));
      return exact.length ? exact : rows.filter(row => fieldOptionEquals(label, rowText(row), value));
    };
    if (constant && !await wait(() => panel.querySelector('.select-data-num-limit')?.textContent.trim() === '1')) return false;
    let found = matches();
    const holder = panel.querySelector('.phoenix-selectList__virtualList-holder');
    if (!found.length || holder && holder.scrollHeight > holder.clientHeight + 1) {
      const search = panel.querySelector('.phoenix-search input') ||
        (!constant && wrap.matches('.phoenix-select--editable') && wrap.querySelector('.phoenix-select__input:not(.phoenix-select__input--unText)'));
      const exam = languageExamKey(value);
      const searchTerm = { cet4: '四级', cet6: '六级', tem4: '四级', tem8: '八级' }[exam];
      const terms = search && !search.readOnly && !search.disabled ? [...new Set([searchTerm, value].filter(Boolean))] : [null];
      for (const term of terms) {
        if (term !== null) {
          const previousRows = [...panel.querySelectorAll(rowSelector)].map(rowText).join('\n');
          if (wrap.contains(search)) triggerQuery = { input: search, original: triggerQuery?.original ?? search.value, term };
          setValue(search, term);
          await wait(() => {
            const displayed = [...panel.querySelectorAll(rowSelector)].map(rowText).join('\n');
            return displayed !== previousRows && (displayed || panel.querySelector('.phoenix-selectList__empty'));
          });
        } else if (!panel.querySelector(rowSelector)) await wait(() => panel.querySelector(rowSelector));
        found = await scanBeisenVirtualList(panel, matches, options);
        if (found.length || options.signal?.aborted) break;
      }
    }
    if (found.length !== 1) return false;
    if (constant) {
      const liveRadio = () => {
        if (!panel.isConnected) return null;
        const rows = matches();
        if (rows.length !== 1) return null;
        const visible = [...rows[0].querySelectorAll('.icon-container svg.RadioUnchecked')].filter(svg => {
          const rect = svg.getBoundingClientRect();
          return svg.isConnected && rect.width > 0 && rect.height > 0 && isElementTrulyVisible(svg) &&
            (!svg.checkVisibility || svg.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
        });
        return visible.length === 1 ? visible[0] : null;
      };
      let clicked = false;
      for (let attempt = 0; attempt < 2 && !clicked; attempt++) {
        const radio = await wait(liveRadio);
        if (!radio || options.signal?.aborted) return false;
        clicked = await clickFillControl(radio, options, node => liveRadio() === node);
      }
      if (!clicked) return false;
      // This picker stages its choice; commit only a verified single item in its own footer.
      const pending = await wait(() => {
        const count = panel.querySelector('.select-data-num-text')?.textContent.trim();
        const selectedArea = panel.querySelector('.right-container .select-data-container');
        const labels = selectedArea?.querySelectorAll('.select-text-label');
        return /^1\s*\//.test(count || '') && labels?.length === 1 &&
          fieldOptionEquals(label, labels[0].textContent, value);
      });
      if (!pending) return false;
      const confirm = [...panel.querySelectorAll('.selector-footer-button .phoenix-button__content')].filter(el => el.textContent.trim() === '确定');
      if (confirm.length !== 1 || !await clickFillControl(confirm[0], options)) return false;
    } else if (!await clickFillControl(found[0], options)) return false;
    const committed = Boolean(await wait(selected));
    if (committed && options.deferVerification) options.deferVerification(input, Date.now() + 120);
    return committed;
  } finally {
    if (triggerQuery?.input.isConnected && triggerQuery.input.value === triggerQuery.term && !selected()) {
      setValue(triggerQuery.input, triggerQuery.original);
    }
    if (panel.isConnected && isElementTrulyVisible(panel)) {
      outside();
      document.body.click();
    }
    input.blur();
  }
}

function isBeisenDocumentInput(input) {
  const item = input?.closest?.('.form-item--phoenix');
  return !!item && input.tagName === 'INPUT' && beisenLabel(item) === '证件号码' && !!item.querySelector('.mobile-type-button');
}

function insertBeisenDocumentNumber(input, number, options) {
  // Use the browser's text edit so the composite editor receives its normal input event.
  // Avoid inserting a second copy if an input handler has already changed the field.
  if (input.value || !input.isConnected || options.signal?.aborted) return false;
  let edited = false;
  let beforeEdit;
  const noteEdit = () => { edited = true; };
  const noteBeforeEdit = event => { beforeEdit = event; };
  input.addEventListener('beforeinput', noteBeforeEdit, true);
  input.addEventListener('input', noteEdit, true);
  try {
    if (document.activeElement === input && document.hasFocus()) document.execCommand('insertText', false, number);
  } catch { /* Use the input setter when browser text editing is unavailable. */ }
  finally {
    input.removeEventListener('beforeinput', noteBeforeEdit, true);
    input.removeEventListener('input', noteEdit, true);
  }
  if (input.value === number) recordFillTextWrite(input, '', number);
  else if (!edited && !beforeEdit?.defaultPrevented && !input.value && !input.readOnly && !input.disabled && !options.signal?.aborted) {
    setValue(input, number);
  }
}

async function writeBeisenDocumentNumber(input, value, options = {}) {
  const item = input.closest('.form-item--phoenix');
  const number = String(value).trim();
  if (input.readOnly || input.disabled || !input.isConnected || !number || options.signal?.aborted) return false;
  if (input.value && input.value !== number) return false;
  if (!input.value) {
    input.focus({ preventScroll: true });
    insertBeisenDocumentNumber(input, number, options);
  }
  // Phoenix commits this composite field to the parent form on blur. With focus in the
  // browser side panel, Chromium can change activeElement without delivering either event.
  const blurEvents = new Set();
  const noteBlur = event => blurEvents.add(event.type);
  input.addEventListener('blur', noteBlur);
  input.addEventListener('focusout', noteBlur);
  try {
    input.blur();
    for (const type of ['blur', 'focusout']) {
      if (!blurEvents.has(type) && input.isConnected && input.value === number && !options.signal?.aborted) {
        input.dispatchEvent(new FocusEvent(type, {bubbles: type === 'focusout', composed: true}));
      }
    }
  } finally {
    input.removeEventListener('blur', noteBlur);
    input.removeEventListener('focusout', noteBlur);
  }
  // Phoenix reflects its committed model into the value attribute on rerender.
  const accepted = () => input.isConnected && input.value === number &&
    (!input.hasAttribute('value') || input.defaultValue === number) &&
    !item.querySelector('.form-item__error')?.textContent.trim();
  if (await waitFor(accepted, { timeoutMs: 1100, observe: item, task: options.task, signal: options.signal })) return true;
  input.setAttribute('data-easyoffer-write-reason', input.value === number && item.querySelector('.form-item__error')?.textContent.trim()
    ? 'validation_failed' : 'value_reset');
  return false;
}

async function fillBeisenForm(profile, options = {}) {
  const incremental = options?.mode === 'incremental';
  const lists = beisenLists(profile);
  const addLabels = {education: '添加教育经历', work: '添加工作/实习经历',
    project: '添加参与科研项目', award: '添加学习/工作获奖情况', family: '添加家庭成员及重要社会关系',
    paper: ['添加专业论著','添加发表文章、著作情况'], patent: '添加专利', certificate: ['添加专业资格','添加证书'], language: '添加语言能力'};
  const forms = kind => [...document.querySelectorAll('.ux-standard-form')].filter(f => beisenKind(f) === kind);
  // incremental 模式不新增经历条目，只补当前已有控件的空白
  if (!incremental || options?.completeRows) {
    for (const [kind, entries] of Object.entries(lists)) {
      if (!entries.length) continue;
      let current = forms(kind);
      let missing = beisenRowPlan(kind, current, entries).missing.length;
      while (missing > 0) {
        await waitForFillCheckpoint(options?.task);
        const choices = [...document.querySelectorAll('span,button,[role=button]')].filter(el =>
          [addLabels[kind]].flat().includes(el.textContent.trim().replace(/\*$/, '').trim()) &&
          !el.closest('[disabled],[aria-disabled=true]') && isElementTrulyVisible(el));
        const buttons = new Set(choices.filter(el => !choices.some(other => other !== el && el.contains(other)))
          .map(el => el.closest('button,[role=button]') || el));
        if (buttons.size !== 1) break;
        const count = current.length;
        [...buttons][0].click();
        current = await waitFor(() => { const next = forms(kind); return next.length > count && next; },
          { timeoutMs: 1000, observe: document.body, signal: options?.signal, task: options?.task });
        if (!current) break;
        const nextMissing = beisenRowPlan(kind, current, entries).missing.length;
        if (nextMissing >= missing) break;
        missing = nextMissing;
      }
    }
  }
  let filledCount = 0;
  const manualFields = [];
  const fieldResults = [];
  const allForms = [...document.querySelectorAll('.ux-standard-form')];
  const proofForms = new WeakMap();
  beisenCaptureForms(allForms, proofForms);
  if (options.task) options.task.beisenProofForms = proofForms;
  const rows = beisenRowEntries(allForms, lists);
  const conflictingHighest = lists.education.filter(e => e?.highestFullTime === '是').length > 1;
  const join = (...values) => values.filter(Boolean).join('\n');
  const basic = profile.basicInfo || {};
  const job = profile.jobIntention || {};
  const salaryUnitMatches = /^(人民币|CNY|RMB)$/i.test(job.salaryCurrency) && job.salaryUnit === '万元' && job.salaryPeriod === '年薪';
  const intent = {'期望工作城市': job.expectedCity, '是否服从调剂': job.acceptAdjustment, '是否愿意去县级公司工作': job.acceptCounty,
    '期望待遇(万元/年)': salaryUnitMatches ? job.expectedSalary : ''};
  const partyDate = basic[membershipDateKey(basic.politicalStatus)];
  for (const form of allForms) {
    await waitForFillCheckpoint(options?.task);
    const kind = beisenKind(form);
    const entry = rows.get(form) || {};
    const exam = languageEntryExam(entry);
    const examValue = exam ? LANGUAGE_EXAMS[exam].name : entry.level || entry.name;
    const selected = label => {
      const wrap = [...form.querySelectorAll('.form-item--phoenix')].find(item => beisenLabel(item) === label)?.querySelector('.phoenix-select');
      return wrap ? beisenSelectCurrentValue(wrap) : '';
    };
    const maps = {
      basic: {...intent, '姓名': basic.fullName, '电子邮箱': basic.email, '移动电话': basic.phone,
        '证件号码': basic.idCard, '性别': basic.gender, '出生年月': basic.birthDate,
        '党派': basic.politicalStatus, '加入党派时间': partyDate, '婚姻状况': basic.maritalStatus,
        '身高(cm)': basic.height, '体重(公斤)': basic.weight, '健康状况': basic.health,
        '紧急联系人': basic.emergencyContact, '紧急联系方式': basic.emergencyPhone,
        '籍贯': basic.hometown, '生源地(高考时户口所在地)': basic.sourcePlace, '现居住地': basic.currentCity,
        '民族': basic.ethnicity, '国籍': basic.nationality, '通信地址': basic.address,
        '是否获得过奖学金': (profile.awards || []).some(a => /奖学金/.test(a.name)) ? '是' : '',
        '是否为学生干部': (profile.education || []).some(e => /班长|学习委员|学生干部/.test(e.description || '')) ? '是' : ''},
      intention: intent,
      education: {'学校': entry.school, '专业名称': entry.major, '第二专业': entry.secondMajor, '学位': entry.academicDegree,
        '是否全日制': entry.fullTime, '是否最高全日制学历': entry.highestFullTime,
        '是否主修': ({主修:'是',辅修:'否'})[entry.majorStatus] || entry.majorStatus,
        '学历': ({硕士:'硕士研究生',博士:'博士研究生'})[entry.degree] || entry.degree,
        '开始时间': entry.startDate, '结束时间': entry.endDate},
      work: {'单位名称': entry.company, '所在部门': entry.department, '职位名称': entry.position,
        '用工形式': entry.workType, '工作描述': join(entry.description, entry.achievements),
        '开始时间': entry.startDate, '结束时间': entry.endDate},
      project: {'项目名称': entry.name, '担当角色': entry.role, '项目级别': entry.projectLevel,
        '主要工作内容': join(entry.description, entry.techStack, entry.responsibilities, entry.achievements),
        '开始时间': entry.startDate, '结束时间': entry.endDate},
      award: {'奖项名称': entry.name, '获奖级别': entry.level, '获奖时间': entry.date, '颁奖单位': entry.issuer,
        '担当角色': entry.role, '其他补充': entry.description},
      family: {'称谓': entry.relation, '姓名': entry.name, '出生日期': entry.birthDate, '政治面貌': entry.politicalStatus,
        '工作单位': entry.employer, '所属职务': entry.position, '联系电话': entry.phone, '手机号码': entry.phone},
      language: {'外语语种': entry.language, '语言等级': examValue, '得分': entry.score},
      certificate: {'证书名称': entry.name, '获得时间': entry.date, '具有资格证书': beisenCertificateCategory(entry)},
      paper: {'文章名、书名': entry.name, '论文名称': entry.name, '日期': entry.date, '刊物、出版社': entry.publisher,
        '担任角色': entry.role, '内容摘要': entry.abstract},
      skills: {'技能类别': form.querySelector('input[placeholder*="有证书认证的计算机技能"]')
        ? [...new Set(lists.certificate.filter(c => beisenCertificateCategory(c) === '信息技术').map(c => c.name).filter(Boolean))].join('、')
        : profileSkillText(profile, ', ')},
      intro: {'爱好及特长': profile.commonAnswers?.hobbies || join(...new Set([basic.interests, basic.specialSkills])),
        '优势与不足': profile.commonAnswers?.strengthsWeaknesses,
        '其他': (profile.customAnswers || []).find(answer => exactQuestion(answer.question) === '其他')?.answer,
        '自我评价及求职目标': join(profile.commonAnswers?.selfEvaluation, profile.commonAnswers?.careerGoal) || profile.introTemplates?.default}
    };
    for (const item of form.querySelectorAll('.form-item--phoenix')) {
      await waitForFillCheckpoint(options?.task);
      const label = beisenLabel(item);
      const mapped = Object.hasOwn(maps[kind] || {}, label);
      const manualConfirmation = !mapped && ((isProtectedQuestion(label) && item.querySelector('.phoenix-radio') && !item.querySelector('input')) ||
        (kind === 'attestation' && ['本人承诺','填表人签名','填表日期'].includes(label)));
      if (!mapped && !manualConfirmation && kind !== 'family' && (!rows.has(form) || rows.get(form))) continue;
      const radios = [...item.querySelectorAll('.phoenix-radio')];
      const input = item.querySelector('input:not([type="file"]):not([type="hidden"]), textarea, select');
      const control = input || radios[0];
      if (!control) continue;
      const plainText = !radios.length && isBeisenPlainText(input);
      siteFieldClaim(options, control, label);
      item.querySelectorAll('input[type=radio]').forEach(el => options.attemptedFields?.add(el));
      const value = maps[kind]?.[label];
      const record = (status, reason = '') => fieldResults.push(beisenRememberResult(
        {element: control, fieldType: label, label, status, reason, value}, proofForms, item));
      const checked = el => el.classList.contains('phoenix-radio--checked') || el.getAttribute('aria-checked') === 'true' || el.querySelector('input:checked');
      clearManualHint(control);
      item.removeAttribute('data-job-autofill-manual');
      item.querySelectorAll('.job-autofill-manual-hint').forEach(el => el.remove());
      const verifyExistingDocument = options.deferDocumentNumber && isBeisenDocumentInput(input) &&
        input.value && input.value === String(value ?? '').trim();
      if (!verifyExistingDocument && (radios.length ? radios.some(checked) : fieldHasValue(input))) {
        record('skipped_has_value');
        continue;
      }
      if (rows.get(form) === null || (label === '是否最高全日制学历' && value === '是' && conflictingHighest)) {
        record('needs_review', rows.get(form) === null ? 'record_ambiguous' : 'conflicting_highest_education');
        continue;
      }
      if (value == null || String(value).trim() === '') {
        const salaryNeedsUnits = label === '期望待遇(万元/年)' && (job.expectedSalary || job.expectedAnnualSalary) && !value;
        record('needs_review', manualConfirmation ? 'manual_confirmation_required' : salaryNeedsUnits ? 'salary_unit_unconfirmed'
          : mapped ? 'no_profile_value' : 'unrecognized_field');
        continue;
      }
      if (kind === 'basic' && label === '加入党派时间') {
        const selectedParty = beisenPartyStatus(form);
        if (selectedParty !== null && !fieldOptionEquals('党派', selectedParty, basic.politicalStatus)) {
          record('needs_review', 'political_status_unconfirmed');
          continue;
        }
      }
      if (kind === 'language' && label !== '外语语种' && (!fieldOptionEquals('外语语种', selected('外语语种'), entry.language) ||
          label === '得分' && (!examValue || !fieldOptionEquals('语言等级', selected('语言等级'), examValue)))) {
        record('needs_review', 'dependent_option_unconfirmed');
        continue;
      }
      const isDate = /时间|日期|年月/.test(label);
      try {
        let success;
        if (label === '证件号码') {
          const type = item.querySelector('.mobile-type-button .phoenix-button__content')?.textContent.trim();
          const sourceType = basic.idCardType || (/^\d{17}[\dX]$/i.test(value) ? '身份证' : '');
          if (type && (!sourceType || !fieldOptionEquals('证件类型', type, sourceType))) {
            record('needs_review', 'document_type_mismatch');
            continue;
          }
          if (options.deferDocumentNumber && isBeisenDocumentInput(input)) {
            options.deferDocumentNumber({ source: proofForms.get(form), item, element: input, label, value, type });
            continue;
          }
        }
        if (radios.length) {
          const adjustment = label === '是否服从调剂' && ({'是':'接受','否':'不接受'})[value];
          const choices = radios.filter(el => [String(value), adjustment].includes(el.textContent.trim()) &&
            !el.matches('.phoenix-radio--disabled,[aria-disabled="true"]'));
          success = choices.length === 1 && await clickFillControl(choices[0], options) && await waitFor(() => checked(choices[0]),
            { timeoutMs: 500, observe: item, signal: options.signal, task: options.task });
        } else if (isDate) success = await fillBeisenDate(input, value, options);
        else if (isBeisenRegionInput(input, label)) success = await fillBeisenRegion(input, value, options);
        else if (input.closest('.phoenix-select')) success = await fillBeisenSelect(input, value, options);
        else {
          // The composite ID/phone editor commits its draft on blur only after focus.
          if (!input.disabled && !input.readOnly) input.focus({ preventScroll: true });
          success = await fillField(input, value, options);
          if (success && plainText) options.deferVerification?.(input, Date.now() + 320);
        }
        if (success) {
          filledCount++;
          record('filled');
        } else if (plainText) {
          const reason = control.getAttribute('data-easyoffer-write-reason') ||
            (options.task?.undo?.has(control) ? 'value_reset' : 'beisen_text_unconfirmed');
          record('needs_review', reason);
        } else {
          const reason = (isDate || isBeisenRegionInput(input, label)) && input.getAttribute('data-easyoffer-write-reason') ||
            (isDate ? 'write_failed_or_option_not_found' : 'beisen_control_mismatch');
          const instruction = reason === 'region_district_unavailable' ? `网站的区县列表没有与「${value}」对应的选项，请核对现行区县`
            : !isDate ? '请手动选择' : reason === 'date_precision_required' ? '网站需要具体日期'
            : reason === 'validation_failed' ? '日期无效，请核对简历'
            : reason === 'value_reset' ? '网页未保留所选日期' : '网页日期控件未确认，请手动选择';
          const note = `${label}（${instruction}）`;
          item.setAttribute('data-job-autofill-manual', note);
          let hint = item.querySelector('.job-autofill-manual-hint');
          if (!hint) {
            hint = document.createElement('small');
            hint.className = 'job-autofill-manual-hint';
            item.appendChild(hint);
          }
          hint.textContent = note;
          hint.style.color = '#a65b00';
          manualFields.push(note);
          record('needs_review', reason);
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        const note = `${label}：（填充异常 ${err?.message || err}）`;
        item.setAttribute('data-job-autofill-manual', note);
        manualFields.push(note);
        record('failed', err?.message || String(err));
      } finally {
        dismissOpenDropdownPanels();
      }
    }
  }
  return { filledCount, manualFields, results: fieldResults, fieldResults, isForm: true };
}

function isMokaForm() {
  return !!document.querySelector('[data-nav-id^="block-"], .moka-form, [class*="sd-Select-container-"]');
}

// Moka 下拉：sd-Dropdown-container 与 sd-Select-container 是同一下拉组件的两种外壳
// （isSelectWidget 按 sd-Select-container 路由进来），二者都要能定位；
// 选项出现/过滤刷新用有界等待，超时按失败返回并进入待人工。
async function fillMokaSelect(el, value, options) {
  const wrap = el.closest('[class*="sd-Dropdown-container-"]') || el.closest('[class*="sd-Select-container-"]');
  if (!wrap) return false;
  const opts = options || {};
  const signal = opts.signal || null;
  const openTimeoutMs = typeof opts.openTimeoutMs === 'number' ? opts.openTimeoutMs : 1800;
  const session = beginWidgetDropdownSession();
  el.scrollIntoView({ block: 'center' });
  el.click();
  const findOption = () => [...wrap.querySelectorAll('[class*="sd-Select-menu-"] [class*="sd-Menu-container-"]')]
    .filter(option => isElementTrulyVisible(option) && !/disabled/i.test(option.className))
    .find(option => optionTextEquals(option.querySelector('[class*="sd-Menu-content-item-"]')?.firstElementChild?.textContent || option.textContent, value));
  try {
    let option = await waitFor(() => (session.isCurrent() ? (findOption() || null) : null), { timeoutMs: 350, pollMs: 40, signal });
    if (!option && !el.readOnly) {
      nativeSet(el, HTMLInputElement.prototype, value);
      dispatchInputEvents(el, value);
      option = await waitFor(() => (session.isCurrent() ? (findOption() || null) : null), { timeoutMs: openTimeoutMs, pollMs: 60, signal });
    }
    if (option) (option.querySelector('[class*="sd-Menu-container-"]') || option).click();
    else document.body.click();
    el.blur();
    // 选中回读有界等待：组件回填显示值可能是异步的
    const success = !option ? false : !!(await waitFor(() => {
      const selected = wrap.querySelector('[class*="sd-Input-display-value-"]')?.textContent || '';
      return optionTextEquals(selected, value) ? true : null;
    }, { timeoutMs: 800, pollMs: 40, signal }));
    if (success) el.removeAttribute('data-job-autofill-manual');
    else el.setAttribute('data-job-autofill-manual', getClosestLabelText(el) || el.placeholder || '下拉框');
    return success;
  } catch {
    return false;
  } finally {
    if (session.isCurrent()) dismissOpenDropdownPanels();
  }
}

function mokaExperienceGroups(profile) {
  return [
    ['educationInfo', (profile.education || []).filter(e => e.school || e.major)],
    ['practiceInfo', (profile.workExperience || []).filter(e => e.company || e.position)],
    ['projectInfo', (profile.projects || []).filter(e => e.name)]
  ];
}

async function ensureMokaEntries(profile, options) {
  if (!isMokaForm()) return;
  for (const [key, items] of mokaExperienceGroups(profile)) {
    const block = document.querySelector(`[data-nav-id="block-${key}"]`);
    if (!block) continue;
    const rows = () => [...block.children].filter(e => e.matches('[class*="apply-fields-"]'));
    while (rows().length < items.length) {
      await waitForFillCheckpoint(options?.task);
      const add = [...block.querySelectorAll('button')].find(b => b.textContent.trim() === '添加');
      if (!add || add.disabled) break;
      const count = rows().length;
      add.scrollIntoView({ block: 'center' });
      add.click();
      for (let i = 0; i < 15 && rows().length === count; i++) await sleep(100);
      if (rows().length === count) break;
    }
  }
}

// 年月控件的安全写入包装：单控件异常（节点失效/组件抛错）按失败返回，不阻断同组其余控件
async function safeFillField(el, value, options) {
  try {
    return await fillField(el, value, options);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return false;
  }
}

async function fillMokaDates(profile, options) {
  let count = 0;
  async function fillDateControls(container, dates) {
    const controls = [...container.querySelectorAll('.month-range-select input[type="text"]')];
    // Moka 选择年份时会自动补成 1 月；只保护本轮开始前已有的值。
    const hadValues = controls.map(fieldHasValue);
    const values = dates.flatMap(date => { const d = parseYearMonth(date); return [d.year, d.month]; });
    for (let i = 0; i < controls.length; i++) {
      await waitForFillCheckpoint(options?.task);
      if (values[i] && !hadValues[i] && await safeFillField(controls[i], values[i], options)) count++;
    }
  }
  for (const [key, items] of mokaExperienceGroups(profile)) {
    const rows = document.querySelectorAll(`[data-nav-id="block-${key}"] > [class*="apply-fields-"]`);
    for (let i = 0; i < Math.min(rows.length, items.length); i++) {
      await fillDateControls(rows[i], [items[i].startDate, items[i].endDate]);
    }
  }
  const graduation = [...document.querySelectorAll('[class*="apply-field-"]')]
    .find(e => e.querySelector('[class^="title-"]')?.textContent.trim() === '毕业时间');
  if (graduation) await fillDateControls(graduation, [profile.basicInfo?.graduationDate]);
  return count;
}

async function fillYearMonthWidgets(profile, options) {
  if (isMokaForm()) return fillMokaDates(profile, options);
  const controls = [...document.querySelectorAll(
    'select, [role="combobox"], input[placeholder="年"], input[placeholder="月"], input[placeholder="年份"], input[placeholder="月份"]'
  )].filter((el) => {
    if (isIgnoredInput(el) || !isElementTrulyVisible(el)) return false;
    if (el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) return false;
    return isYearControl(el) || isMonthControl(el);
  });
  if (!controls.length) return 0;

  const edu = profile.education || [];
  const work = profile.workExperience || [];
  const proj = profile.projects || [];
  const counters = { edu: 0, work: 0, project: 0 };
  let filled = 0;
  let i = 0;

  while (i < controls.length) {
    await waitForFillCheckpoint(options?.task);
    const el = controls[i];
    const kind = nearestSectionKind(el) || 'edu';
    let source = null;
    if (kind === 'birth') {
      source = parseYearMonth(profile.basicInfo?.birthDate);
      if (isYearControl(el) && source.year) {
        if (!fieldHasValue(el) && await safeFillField(el, source.year, options)) filled++;
      } else if (isMonthControl(el) && source.month) {
        if (!fieldHasValue(el) && await safeFillField(el, source.month, options)) filled++;
      }
      i++;
      continue;
    }

    const list = kind === 'work' ? work : kind === 'project' ? proj : edu;
    const idx = counters[kind] || 0;
    const item = list[idx];
    if (!item) {
      i++;
      continue;
    }
    const start = parseYearMonth(item.startDate);
    const end = parseYearMonth(item.endDate);

    const group = [el];
    const elTop = el.getBoundingClientRect().top;
    while (i + group.length < controls.length) {
      const next = controls[i + group.length];
      if (nearestSectionKind(next) !== nearestSectionKind(el)) break;
      if (Math.abs(next.getBoundingClientRect().top - elTop) > 28) break;
      group.push(next);
      if (group.length >= 4) break;
    }

    const seq = group.length >= 4
      ? [start.year, start.month, end.year, end.month]
      : [start.year, start.month];
    for (let g = 0; g < group.length && g < seq.length; g++) {
      await waitForFillCheckpoint(options?.task);
      if (seq[g] && !fieldHasValue(group[g]) && await safeFillField(group[g], seq[g], options)) filled++;
    }
    counters[kind] = idx + 1;
    i += group.length;
  }

  return filled;
}

var  activeDeclarationQuestions = new Set();
function isProtectedQuestion(label) {
  if (activeDeclarationQuestions.has(exactQuestion(label))) return true;
  if (/personal[-_\s]?promise/i.test(label)) return true;
  return /亲属.*(任职|退休|工作)|亲友.*在公司就职|境外.*(身份|居留|就业|定居)|外国公民|香港.*台湾|国（境）外|国籍.*(其他|外国)|违法|违纪|犯罪|处分|失信|利益冲突|声明|承诺|签名|签字|本人确认|本人同意|真实性/.test(label);
}

function questionAnswered(root) {
  return !!root.querySelector('input:checked, .phoenix-radio--checked, .ant-radio-wrapper-checked, [aria-checked="true"]') ||
    [...root.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]),textarea,select')].some(fieldHasValue);
}

// 声明确认对话框：默认 120s 无操作按“取消”收尾，绝不无限期阻塞整个填充流程；
// options.declarationTimeoutMs 可注入更短超时（测试/自动化用）。
async function confirmDeclarations(items, options) {
  const timeoutMs = typeof options?.declarationTimeoutMs === 'number' ? options.declarationTimeoutMs : 120000;
  return new Promise(resolve => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { dialog.close(); } catch {}
      dialog.remove();
      resolve(result);
    };
    const dialog = document.createElement('dialog');
    dialog.id = 'job-autofill-declaration-confirm';
    dialog.style.cssText = 'max-width:640px;max-height:80vh;overflow:auto;padding:24px;border:1px solid #ddd;border-radius:14px;background:white;color:#222;';
    const title = document.createElement('h3'); title.textContent = '确认本次个人声明'; dialog.append(title);
    for (const item of items) {
      const text = document.createElement('p');
      text.textContent = `当前问题：${item.question}\n保存答案：${item.saved.answer}${item.saved.explanation ? '；' + item.saved.explanation : ''}\n适用企业：${item.saved.company}`;
      text.style.whiteSpace = 'pre-wrap'; dialog.append(text);
    }
    for (const [text, result] of [['取消', false], ['确认填写以上答案', true]]) {
      const button = document.createElement('button'); button.textContent = text; button.style.margin = '8px';
      button.onclick = () => finish(result); dialog.append(button);
    }
    dialog.addEventListener('cancel', () => finish(false));
    const timer = setTimeout(() => finish(false), timeoutMs); // 无超时的等待会卡死整个填充任务
    document.body.append(dialog);
    try { dialog.showModal(); } catch { finish(false); }
  });
}

async function fillConfirmedDeclarations(profile, options) {
  if (!profile || !profile.declarations?.length) return;
  const compName = detectCompanyName() || '';
  const currentHost = location.hostname.toLowerCase();
  const items = [], seen = new Set();
  for (const input of document.querySelectorAll('input,select,textarea')) {
    if (input.disabled || (!isElementTrulyVisible(input) && !isElementTrulyVisible(input.closest('label.tec-radio')))) continue;
    const root = questionContainer(input);
    if (seen.has(root)) continue;
    seen.add(root);
    const question = getClosestLabelText(input);
    if (!question || /承诺|签名|签字|本人确认|本人同意|真实性|personal[-_\s]?promise/i.test(question) || questionAnswered(root)) continue;
    const saved = (profile.declarations || []).find((item) => {
      if (exactQuestion(item.question) !== exactQuestion(question)) return false;
      if (!['是', '否'].includes(item.answer)) return false;
      if (item.hostname && item.hostname.toLowerCase() !== currentHost && !currentHost.endsWith('.' + item.hostname.toLowerCase())) return false;
      if (item.company && compName && !compName.includes(item.company) && !item.company.includes(compName)) return false;
      return true;
    });
    if (saved) items.push({ input, root, question, saved });
  }
  if (!items.length || !await confirmDeclarations(items, options)) return;
  for (const { input, root, question, saved } of items) {
    // 单条声明异常不阻断其余声明与后续主流程
    try {
      if (!input.isConnected || questionAnswered(root) || exactQuestion(getClosestLabelText(input)) !== exactQuestion(question)) continue;
      const radios = [...root.querySelectorAll('.phoenix-radio, .ant-radio-wrapper, label')];
      const choice = radios.find(el => el.textContent.trim() === saved.answer && (el.querySelector('input[type=radio]') || el.matches('.phoenix-radio')));
      let success;
      if (choice) {
        choice.click(); await sleep(100);
        success = questionAnswered(root);
      } else if (input.type === 'radio' && input.closest('.tec-radio-group')) {
        success = await fillChoice(input, saved.answer);
      } else success = await fillSiteControl(input, saved.answer, options);
      if (!success || saved.explanation) markManual(input, `${saved.answer}${saved.explanation ? '；补充说明：' + saved.explanation : ''}`);
    } catch (err) {
      markManual(input, `${saved.answer}（自动填写失败：${err?.message || err}）`);
    }
  }
}

function beisenDateShown(input) {
  const wrap = input.closest('.phoenix-select');
  return wrap ? beisenSelectCurrentValue(wrap) : input.value || '';
}

function isBeisenDateInput(input) {
  const wrap = input.closest('.phoenix-select');
  if (!wrap) return false;
  const item = wrap.closest('.form-item--phoenix');
  return !!item && /(?:日期|年月|生日|(?:加入党派|开始|结束|起始|截止|毕业|入学|入职|离职|获奖|取得|获得|发表|授予|颁发)时间)$/.test(beisenLabel(item));
}

function beisenDateMatches(input, parts, precision) {
  const actual = elementDateParts(beisenDateShown(input));
  return input.isConnected && !!actual && !!parts[precision - 1] && !!actual[precision - 1] &&
    parts.slice(0, precision).every((part, index) => part === actual[index]);
}

function beisenCalendarMonth(text) {
  const label = String(text || '').trim();
  const number = /^(\d{1,2})(?:\s*月)?$/.exec(label);
  if (number && Number(number[1]) <= 12) return Number(number[1]);
  return ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'].indexOf(label) + 1;
}

function isBeisenRegionInput(input, label) {
  if (!input?.closest('.phoenix-select')) return false;
  const item = input.closest('.form-item--phoenix');
  return !!item && /^(籍贯|生源地(?:\(高考时户口所在地\))?|现居住地|期望工作城市)$/.test(label || beisenLabel(item));
}

function beisenRegionPrefix(target, label) {
  // Only drop a trailing administrative suffix. 市 within 沙市区 or 市中区
  // belongs to the district name and must stay intact.
  if (target.startsWith(label)) return label;
  const short = label.replace(/(?:维吾尔|壮族|回族)?自治区$|特别行政区$|自治州$|[省市]$/, '');
  return short.length >= 2 && target.startsWith(short) ? short : '';
}

async function findBeisenRegion(panel, value, wait, click, missingDistrict) {
  const labels = () => [...panel.querySelectorAll('.area-data-container .area-text-label')].filter(isElementTrulyVisible);
  const target = String(value).trim().replace(/[\s/／,，、>＞|-]+/g, '');
  const path = [];
  let remaining = target;
  for (let depth = 0; depth < 4; depth++) {
    const items = await wait(() => { const rows = labels(); return rows.length && rows; });
    if (!items) return null;
    const matches = items.map(label => ({ label, prefix: beisenRegionPrefix(remaining, label.textContent.trim()) }))
      .filter(({ label, prefix }) => {
        if (!prefix) return false;
        // “吉林市” names a city, whereas “吉林省” names its province. Search
        // an unqualified province abbreviation rather than guessing its level.
        return depth !== 0 || !label.textContent.trim().endsWith('省') || prefix === label.textContent.trim() ||
          (remaining !== prefix && remaining !== prefix + '市');
      }).sort((a, b) => b.prefix.length - a.prefix.length);
    if (!matches.length && depth === 0) {
      // Search exposes the parent path and a total count. A city name alone is
      // sufficient only if exactly one fully rendered option matches.
      const search = panel.querySelector('.area-search-input input');
      if (!search || search.readOnly) return null;
      const leaf = String(value).trim().split(/[\/／>＞\s]+|(?<=省|市|自治区)(?=.)/).filter(Boolean).at(-1);
      if (!leaf) return null;
      setValue(search, leaf);
      const found = await wait(() => {
        const count = panel.querySelector('.search-result')?.textContent.match(/(\d+)\s*个/)?.[1];
        const rows = labels();
        if (!Number(count) || rows.length !== Number(count)) return false;
        const hits = rows.flatMap(label => {
          const name = label.textContent.trim();
          const parent = label.closest('.area-item-container')?.querySelector('.area-item-path')?.textContent || '';
          const parts = parent.split(/[\s/／>＞\-]+/).filter(Boolean).concat(name);
          const matchesPath = parts.some((_, i) => {
            let rest = target;
            for (const part of parts.slice(i)) {
              const prefix = beisenRegionPrefix(rest, part);
              if (!prefix) return false;
              rest = rest.slice(prefix.length);
            }
            return !rest;
          });
          return matchesPath ? [{ label, name, full: parts.join('') }] : [];
        });
        // Phoenix renders a transient 0 results (or the preceding rows) while
        // its debounced search is still in flight.
        return hits.length && { hits };
      });
      return found?.hits.length === 1 ? found.hits[0] : null;
    }
    if (!matches.length) {
      if (depth > 0 && /^[\p{Script=Han}]{1,15}(?:区|县|市|旗)$/u.test(remaining)) missingDistrict?.();
      return null;
    }
    if (matches[0].prefix === matches[1]?.prefix) return null;
    const { label, prefix } = matches[0];
    const name = label.textContent.trim();
    path.push(name);
    remaining = remaining.slice(prefix.length);
    if (!remaining) return { label, name, full: path.join('') };
    if (label.classList.contains('no-hover') || !await click(label)) return null;
    if (!await wait(() => panel.querySelector('.phoenix-breadcrumb-item-current')?.textContent.trim() === name &&
        !labels().some(node => node === label && node.textContent.trim() === name))) return null;
  }
  return null;
}

async function fillBeisenRegion(input, value, options = {}) {
  input.removeAttribute('data-easyoffer-write-reason');
  const wrap = input.closest('.phoenix-select');
  const target = normalizeRegionPath(value);
  if (!wrap || !target || input.disabled) return false;
  const item = input.closest('.form-item--phoenix');
  if (!item) return false;
  const label = beisenLabel(item);
  const form = item.closest('.ux-standard-form, form.form--phoenix');
  const url = location.href;
  const displayed = () => {
    if (location.href !== url) return [];
    // Committing multiple chips can replace the input, its wrapper, or the
    // whole field. Read the current display in this form, also in read-only mode.
    let live = item;
    if (!live.isConnected || beisenLabel(live) !== label) {
      if (!form?.isConnected) return [];
      const candidates = [...form.querySelectorAll('.form-item--phoenix')].filter(node => beisenLabel(node) === label);
      if (candidates.length !== 1) return [];
      live = candidates[0];
    }
    return beisenSelectCurrentValue(live).split(/[、,，;；]/).map(normalizeRegionPath).filter(Boolean);
  };
  if (displayed().length) return false; // Preserve existing selections.
  const visiblePanels = () => [...document.querySelectorAll('.area-selector-container')].filter(isElementTrulyVisible);
  const previous = new Set(visiblePanels());
  const ownedId = input.getAttribute('aria-controls') || wrap.getAttribute('aria-controls');
  const wait = test => waitFor(test, { timeoutMs: options.openTimeoutMs || 1200,
    signal: options.signal, task: options.task, observe: document.body });
  const click = node => clickFillControl(node, options);
  let panel;
  try {
    // Picking a field for Quick Reference also opens the site's picker. Close
    // its empty draft, then reopen from this trigger to establish ownership.
    if (getFillTarget()?.el === input && previous.size === 1) {
      const open = [...previous][0];
      const cancel = [...open.querySelectorAll('.area-footer-button .phoenix-button__content')].find(node => node.textContent.trim() === '取消');
      if (cancel) {
        if (open.querySelector('.select-data-num-text')?.textContent.trim() !== '0') return false;
        if (!await click(cancel) || !await wait(() => !isElementTrulyVisible(open))) return false;
        previous.delete(open);
      }
    }
    if (!await click(wrap)) return false;
    panel = await wait(() => {
      const owned = ownedId && document.getElementById(ownedId);
      const candidates = visiblePanels().filter(node => ownedId ? owned && (owned.contains(node) || node.contains(owned)) : !previous.has(node));
      return candidates.length === 1 && candidates[0];
    });
    if (!panel) return false;
    const count = () => panel.querySelector('.select-data-num-text')?.textContent.trim();
    if (count() !== '0') return false;
    const limit = Number(panel.querySelector('.select-data-num-limit')?.textContent.match(/\d+/)?.[0]) || 1;
    const intendedCities = label === '期望工作城市';
    const rootNames = await wait(() => {
      const names = [...panel.querySelectorAll('.area-data-container .area-text-label')].map(node => node.textContent.trim());
      return names.length && names;
    });
    if (!rootNames) return false;
    const isProvince = text => rootNames.some(name => beisenRegionPrefix(text, name) === text);
    const requests = intendedCities ? String(value).split(/[,，、;；|\n]+/).flatMap(raw => {
      const parts = raw.split(/[/／]/).map(text => text.trim()).filter(Boolean);
      // “广东省/潮州市” is a path, “北京/上海” or “深圳/杭州” lists alternatives.
      const path = parts.length > 1 && ((isProvince(parts[0]) && !isProvince(parts[1])) || /(?:区|县|旗)$/.test(parts.at(-1)));
      return path ? [raw.trim()] : parts;
    }) : [String(value).trim()];
    if (!requests.length || requests.length > limit) return false;
    const chosen = [];
    const matches = actual => actual.length === chosen.length && chosen.every(region =>
      actual.filter(text => region.has(text)).length === 1) && actual.every(text => chosen.filter(region => region.has(text)).length === 1);
    for (const request of requests) {
      if (chosen.length) {
        const search = panel.querySelector('.area-search-input input');
        if (search?.value) {
          setValue(search, '');
          if (!await wait(() => !panel.querySelector('.search-result'))) return false;
        }
        const root = panel.querySelector('.phoenix-breadcrumb-item:not(.phoenix-breadcrumb-item-current) .phoenix-breadcrumb-link');
        if (root && (!await click(root) || !await wait(() =>
          panel.querySelector('.phoenix-breadcrumb-item-current')?.textContent.trim() === '全部省市'))) return false;
      }
      const hit = await findBeisenRegion(panel, request, wait, click, () =>
        input.setAttribute('data-easyoffer-write-reason', 'region_district_unavailable'));
      if (!hit) return false;
      const full = normalizeRegionPath(hit.full);
      if (chosen.some(region => region.has(full))) continue;
      if (!await click(hit.label.closest('.area-item-name')?.querySelector('.icon-container.visible svg'))) return false;
      chosen.push(new Set([normalizeRegionPath(hit.name), full]));
      if (!await wait(() => count() === String(chosen.length) && matches(
        [...panel.querySelectorAll('.right-container .select-area-text-label')].map(node => normalizeRegionPath(node.textContent))))) return false;
    }
    const buttons = [...panel.querySelectorAll('.area-footer-button .phoenix-button__content')];
    const confirm = buttons.find(node => node.textContent.trim() === '确定');
    if (!await click(confirm)) return false;
    if (!await wait(() => !isElementTrulyVisible(panel) && matches(displayed()))) return false;
    input.blur();
    // Phoenix updates its controlled chips on blur. Check the accepted leaf
    // again after that update, including when the profile used the full path.
    await sleep(120);
    await waitForFillCheckpoint(options.task);
    return !options.signal?.aborted && matches(displayed());
  } finally {
    if (panel?.isConnected && isElementTrulyVisible(panel)) {
      const cancel = [...panel.querySelectorAll('.area-footer-button .phoenix-button__content')].find(node => node.textContent.trim() === '取消');
      if (cancel) cancel.click();
      else dismissOpenDropdownPanels();
    }
    input.blur();
  }
}

async function fillBeisenDate(input, value, options = {}) {
  input.removeAttribute('data-easyoffer-write-reason');
  const fail = reason => { input.setAttribute('data-easyoffer-write-reason', reason); return false; };
  const parts = elementDateParts(value);
  if (!parts) return fail('validation_failed');
  const [year, month, day] = parts;
  const precision = dateControlPrecision(input);
  if (precision && !parts[precision - 1]) return fail('date_precision_required');
  if (input.disabled || options.signal?.aborted) return false;
  const existing = elementDateParts(beisenDateShown(input));
  if (existing) return beisenDateMatches(input, parts, precision || (existing[2] ? 3 : 2));
  if (input.type === 'date' || input.type === 'month') {
    return await fillField(input, value, options);
  }

  // A portal belongs to this field only if it is explicitly linked or opened by this click.
  const calendars = () => [...document.querySelectorAll('.phoenix-calendar')].filter(isElementTrulyVisible);
  const previous = new Set(calendars());
  const panel = () => {
    const owned = document.getElementById(input.getAttribute('aria-controls') || '');
    const visible = calendars();
    const linked = owned && visible.find(el => el === owned || el.contains(owned) || owned.contains(el));
    const opened = visible.filter(el => !previous.has(el));
    return linked || (opened.length === 1 ? opened[0] : null);
  };
  const wait = (test, timeoutMs = 350) => waitFor(test, { timeoutMs, task: options.task, signal: options.signal, observe: document.body });
  let picked = false;
  let requiredPrecision = 3;
  try {
    const trigger = input.closest('.phoenix-unmodeled-layer .phoenix-select') || input;
    if (!await clickFillControl(trigger, options)) return false;
    if (!await wait(panel, options.openTimeoutMs || 750)) return fail('write_failed_or_option_not_found');
    const monthGrid = () => panel()?.querySelector('.phoenix-calendar-month-panel');
    if (panel().matches('.phoenix-calendar-month-calendar') || monthGrid() && !panel().querySelector('.phoenix-calendar-date')) requiredPrecision = 2;
    if (!parts[requiredPrecision - 1]) return fail('date_precision_required');
    const period = () => [
      parseInt(panel()?.querySelector(requiredPrecision === 2
        ? '.phoenix-calendar-month-panel-year-select' : '.phoenix-calendar-year-select')?.textContent, 10),
      beisenCalendarMonth(panel()?.querySelector('.phoenix-calendar-month-select')?.textContent)
    ];
    for (let step = 0; step < 120 && !options.signal?.aborted; step++) {
      const calendar = panel();
      const [shownYear, shownMonth] = period();
      if (!calendar || !shownYear || requiredPrecision === 3 && !shownMonth) break;
      if (requiredPrecision === 2 && shownYear === year) {
        const months = [...(monthGrid()?.querySelectorAll('.phoenix-calendar-month-panel-month') || [])]
          .filter(el => beisenCalendarMonth(el.textContent) === month && !el.closest('[aria-disabled="true"],[disabled],.phoenix-calendar-month-panel-cell-disabled'));
        if (months.length === 1) picked = await clickFillControl(months[0], options);
        break;
      }
      if (requiredPrecision === 3 && shownYear === year && shownMonth === month) {
        const cells = [...calendar.querySelectorAll('.phoenix-calendar-cell .phoenix-calendar-date')]
          .filter(el => Number(el.textContent) === day &&
            !el.closest('[aria-disabled="true"],[disabled],.phoenix-calendar-disabled-cell,.phoenix-calendar-last-month-cell,.phoenix-calendar-next-month-btn-day'));
        if (cells.length === 1) picked = await clickFillControl(cells[0], options);
        break;
      }
      const direction = shownYear !== year ? (shownYear > year ? 'prev-year' : 'next-year') : (shownMonth > month ? 'prev-month' : 'next-month');
      const selectors = requiredPrecision === 2 ? ['.phoenix-calendar-month-panel-', '.phoenix-calendar-'] : ['.phoenix-calendar-'];
      const arrow = selectors.map(prefix => calendar.querySelector(prefix + direction + '-btn')).find(isElementTrulyVisible);
      if (!await clickFillControl(arrow, options)) break;
      if (!await wait(() => { const [y, m] = period(); return y && (shownYear !== y || m && shownMonth !== m); })) break;
    }
  } finally {
    if (panel()) dismissOpenDropdownPanels();
    input.blur();
  }
  if (!picked || options.signal?.aborted) return fail('write_failed_or_option_not_found');
  if (!await wait(() => beisenDateMatches(input, parts, requiredPrecision))) return fail('value_reset');
  // React controls may briefly display a draft and clear it on blur.
  await sleep(120);
  await waitForFillCheckpoint(options.task);
  return !options.signal?.aborted && (beisenDateMatches(input, parts, requiredPrecision) || fail('value_reset'));
}

var  EXTENDED_MAPPINGS = {
  basicInfo: { '身高':'height', '体重':'weight' },
  education: {
    '学位':'academicDegree', '第二专业':'secondMajor', '辅修专业':'secondMajor',
    '学校所在城市':'schoolCity', '导师':'advisor', '导师姓名':'advisor', '实验室':'laboratory',
    '研究方向':'researchArea', '是否全日制':'fullTime', '全日制':'fullTime',
    '是否最高全日制学历':'highestFullTime', '最高全日制学历':'highestFullTime',
    '主修状态':'majorStatus', '是否主修':'majorStatus', '教育形式':'degreeType', '录取批次':'enrollmentType',
    '院校类型':'schoolType', '学院名称':'college', '专业主要课程':'courses', '毕业论文':'thesis'
  },
  workExperience: {
    '行业类别':'industry', '所在行业':'industry', '实习工资':'salary', '工资':'salary',
    '离职原因':'resignationReason', '证明人':'referenceName', '证明人联系方式':'referencePhone',
    '证明人职务':'referencePosition', '证明人工作单位':'referenceCompany', '职责及业绩':'__combined',
    '证明人电话':'referencePhone', '证明人单位':'referenceCompany', '所在部门':'department',
    '详细内容':'description', '实习成果':'achievements'
  },
  campusPositions: {
    '组织名称':'organization', '社团名称':'organization', '学生组织':'organization', '职务名称':'title',
    '学生干部级别':'level', '职务描述':'description', '开始日期':'startDate', '结束日期':'endDate'
  },
  campusActivities: {
    '开始日期':'startDate', '结束日期':'endDate'
  },
  trainings: {
    '培训名称':'name', '培训课程':'name', '培训机构':'institution', '培训内容':'description',
    '开始日期':'startDate', '结束日期':'endDate'
  },
  projects: {
    '项目级别':'projectLevel', '项目类型':'projectType', '所在单位':'organization',
    '担任角色':'role', '职责及业绩':'__combined',
    '证明人':'referenceName', '证明人电话':'referencePhone', '证明人职务':'referencePosition', '证明人单位':'referenceCompany'
  },
  awards: {
    '奖项类别':'category', '奖励类别':'category', '奖项名称':'name', '竞赛名称':'name', '奖项级别':'level', '获奖级别':'level', '奖励级别':'level',
    '奖项等级':'grade', '奖励等级':'grade', '奖励原因':'reason',
    '颁奖单位':'issuer', '颁奖机构':'issuer', '名次':'rank', '获奖名次':'rank', '说明':'description',
    '奖项描述':'description', '获奖说明':'description', '其他补充':'description', '链接':'url', '担当角色':'role',
    '获奖时间':'date', '获奖日期':'date'
  },
  familyMembers: {
    '出生日期':'birthDate', '出生年月':'birthDate', '政治面貌':'politicalStatus',
    '家庭所在地':'homeAddress', '家庭住址':'homeAddress', '家庭地址':'homeAddress'
  },
  papers: {
    '论文名称':'name', '文章名、书名':'name', '名称':'name', '论文题目':'name', '学术论文':'name',
    '发表日期':'date', '发表时间':'date', '日期':'date', '期刊/会议或出版社':'publisher',
    '期刊名称':'publisher', '出版社':'publisher', '发布渠道':'publisher', '刊物、出版社':'publisher',
    '发表期刊':'publisher', '发表刊物':'publisher', '作者顺序':'authorOrder', '作者排名':'authorOrder',
    '担当角色':'role', '担任角色':'role', '摘要':'abstract', '论文摘要':'abstract', '内容摘要':'abstract',
    '链接':'url', '论文链接':'url'
  },
  patents: {
    '专利名称':'name', '名称':'name', '发明名称':'name', '实用新型名称':'name',
    '专利人':'inventor', '发明人':'inventor', '第一发明人':'inventor',
    '取得日期':'date', '获得时间':'date', '申请日期':'date', '授权日期':'date',
    '说明':'description', '专利说明':'description', '专利描述':'description',
    '链接':'url', '专利链接':'url'
  },
  certificates: {
    '证书名称':'name', '证书编号':'code', '颁发机构':'issuer', '授予单位':'issuer', '发证机构':'issuer',
    '证书等级':'level', '证书描述':'description', '取得日期':'date', '有效期至':'expiryDate', '获得时间':'date'
  },
  languageCertificates: {
    '语种':'language', '语言':'language', '外语种类':'language', '外语语种':'language', '语言/考试名称':'name', '语言考试名称':'name',
    '听说能力':'listeningSpeaking', '读写能力':'readingWriting', '掌握程度':'proficiency', '熟练程度':'proficiency',
    '证书名称（技能名称）':'name', '证书名称(技能名称)':'name', '技能名称':'name', '证书名称':'name',
    '水平':'level', '等级/水平':'level', '语言水平':'level', '取得日期':'obtainedDate',
    '证书获取时间':'obtainedDate', '获得时间':'obtainedDate'
  }
};

// 新增字段先按 schema 的精确 label 建立通用映射；个别别名仍在上方显式维护。
// 这样编辑器、AI 解析与网页扩展填写始终使用同一个 key，不增加平行存储。
for (const [section, fields] of Object.entries(profileSchema)) {
  if (!profileListKeys.includes(section) && !['basicInfo', 'jobIntention'].includes(section)) continue;
  if (!EXTENDED_MAPPINGS[section]) EXTENDED_MAPPINGS[section] = {};
  for (const [key, label] of Object.entries(fields)) {
    if (section === 'languageCertificates' && key === 'notes') continue;
    if (!EXTENDED_MAPPINGS[section][label]) EXTENDED_MAPPINGS[section][label] = key;
  }
}

var EXTENDED_ENTRY_ANCHOR_KEYS = {
  education: ['school', 'major', 'degree'], workExperience: ['company', 'position', 'description', 'achievements'],
  projects: ['name', 'description', 'responsibilities', 'achievements'], awards: ['name'],
  familyMembers: ['name', 'relation', 'employer', 'position', 'phone'], certificates: ['name', 'code', 'issuer'],
  languageCertificates: ['language', 'name', 'level', 'score', 'obtainedDate', 'proficiency', 'listeningSpeaking', 'readingWriting'],
  papers: ['name', 'publisher', 'date', 'url', 'abstract'], patents: ['name', 'inventor', 'date', 'description', 'url'],
  campusPositions: ['organization', 'title', 'description'], campusActivities: ['name', 'role', 'description'],
  trainings: ['name', 'institution', 'description']
};
var EXTENDED_ENTRY_ANCHOR_TYPES = {
  education: ['school', 'major'], workExperience: ['company', 'position'], projects: ['projectName'],
  awards: ['awards', 'extended:awards:name'], familyMembers: ['familyName'], certificates: ['certificates'],
  papers: ['paperName'], patents: ['patentName'], languageCertificates: ['extended:languageCertificates:name'],
  campusPositions: ['extended:campusPositions:organization', 'extended:campusPositions:title'],
  campusActivities: ['extended:campusActivities:name'],
  trainings: ['extended:trainings:name']
};

// 与主填充循环一致地忽略空占位条目，防止第二张网页卡片读到第一份有效资料之外的值。
function validExtendedEntries(profile, section) {
  const keys = EXTENDED_ENTRY_ANCHOR_KEYS[section] || [];
  const list = section === 'languageCertificates' ? profileLanguageEntries(profile) :
    Array.isArray(profile?.[section]) ? profile[section] : [];
  return list.map(item => section === 'certificates' && typeof item === 'string' ? { name: item } : item)
    .filter(item => item && keys.some(key => String(item[key] || '').trim()));
}

function collectOfferLinkCardEntries(profile, detectedFields) {
  const cards = new WeakMap();
  if (!isOfferLinkResumeForm()) return cards;
  const identityFields = {
    education: ['school', 'school'], workExperience: ['company', 'company'], projects: ['projectName', 'name'],
    awards: ['extended:awards:name', 'name'], certificates: ['extended:certificates:name', 'name'],
    languageCertificates: ['extended:languageCertificates:name', 'name'],
    campusPositions: ['extended:campusPositions:title', 'title'],
    campusActivities: ['extended:campusActivities:name', 'name']
  };
  const populated = new WeakMap();
  for (const { input, detection } of detectedFields) {
    const card = input.closest('.experience-item');
    const id = card?.closest('.form-section[id]')?.id;
    const section = OFFERLINK_RESUME_SECTIONS[id]?.[0];
    if (detection.fieldType === identityFields[section]?.[0] && input.value?.trim()) populated.set(card, input.value.trim());
    if (section === 'languageCertificates' && detection.fieldType === 'extended:languageCertificates:level' &&
        (input.tagName === 'SELECT' || isSelectWidget(input))) {
      const selected = input.tagName === 'SELECT' ? (input.value && input.selectedOptions[0]?.text) : widgetSelectCurrentValue(input);
      if (selected) populated.set(card, selected);
    }
  }
  for (const root of document.querySelectorAll('.form-section[id]')) {
    const section = OFFERLINK_RESUME_SECTIONS[root.id]?.[0];
    if (!section) continue;
    const entries = offerLinkSectionEntries(profile, section, root.id);
    const rows = [...root.querySelectorAll('.experience-item')];
    const used = new Set();
    const identityKey = identityFields[section]?.[1];
    for (const card of rows) {
      const value = populated.get(card);
      if (!value) continue;
      const exam = section === 'languageCertificates' ? languageExamKey(value) : '';
      const matches = entries.filter(entry => exam ? languageEntryExam(entry) === exam : String(entry[identityKey] || '').trim() === value);
      const entry = matches.length === 1 && !used.has(matches[0]) ? matches[0] : undefined;
      if (entry) used.add(entry);
      cards.set(card, { section, entry });
    }
    const remaining = entries.filter(entry => !used.has(entry));
    for (const card of rows) {
      if (!cards.has(card)) cards.set(card, { section, entry: remaining.shift() });
    }
  }
  return cards;
}

function offerLinkCardEntry(input, cards) {
  return cards?.get(input.closest('.experience-item'));
}

function extendedAnchorType(section) {
  const types = EXTENDED_ENTRY_ANCHOR_TYPES[section] || [];
  return input => types.includes(detectField(input)?.fieldType || '');
}

// 普通网站没有统一条目标记：在最近重复卡片中按同类主字段定位索引；无法确定多段索引时留空。
function genericExtendedEntry(input, profile, section) {
  const entries = validExtendedEntries(profile, section);
  if (!entries.length) return undefined;
  const hasAnchor = extendedAnchorType(section);
  let node = input;
  for (let depth = 0; node && depth < 10; depth++) {
    const parent = node.parentElement;
    if (!parent) break;
    const siblings = [...parent.children].filter(candidate =>
      candidate.tagName === node.tagName && String(candidate.className || '') === String(node.className || ''));
    const cards = siblings.filter(card => {
      if (!card.querySelector) return false;
      return [...card.querySelectorAll('input,textarea,select,[role="combobox"],[contenteditable="true"]')].some(hasAnchor);
    });
    const index = cards.indexOf(node);
    if (index >= 0 && (cards.length > 1 || entries.length === 1)) return entries[index];
    node = parent;
  }
  return entries.length === 1 ? entries[0] : undefined;
}

// 只按当前条目容器取值；无法确定多段条目时留空，不默认第一条。
function extendedEntry(input, profile) {
  const phoenix = input.closest('.ux-standard-form');
  if (phoenix && isBeisenForm()) {
    const kind = beisenKind(phoenix);
    const forms = [...document.querySelectorAll('.ux-standard-form')];
    return { section: BEISEN_SECTIONS[kind], entry: beisenRowEntries(forms, beisenLists(profile)).get(phoenix) };
  }
  if (isXhsForm()) {
    const card = input.closest('.rounded-md');
    const anchors = { '论文名称': 'papers', '竞赛/奖项名称': 'awards', '专利名称': 'patents', '证书名称': 'certificates' };
    const anchor = Object.keys(anchors).find(name => [...(card?.querySelectorAll('.ant-form-item-label') || [])].some(label => label.textContent.trim() === name));
    if (anchor) {
      const cards = [...document.querySelectorAll('.rounded-md')].filter(row => [...row.querySelectorAll('.ant-form-item-label')].some(label => label.textContent.trim() === anchor));
      const section = anchors[anchor];
      return { section, entry: profile[section]?.[cards.indexOf(card)] };
    }
    const match = input.id.match(/(resumeEducationInfo|resumeEmploymentInfo)_(\d+)_/);
    if (match) { const section = {resumeEducationInfo:'education',resumeEmploymentInfo:'workExperience',resumeAwardInfo:'awards',resumePaperInfo:'papers',resumePatentInfo:'patents'}[match[1]]; return { section, entry: profile[section]?.[Number(match[2])] }; }
  }
  if (isMokaForm()) {
    const block = input.closest('[data-nav-id]');
    const section = { 'block-educationInfo': 'education', 'block-projectInfo': 'projects', 'block-familyInfo': 'familyMembers', 'block-awardInfo': 'awards', 'block-paperInfo': 'papers', 'block-patentInfo': 'patents' }[block?.dataset.navId];
    const row = input.closest('[class*="apply-fields-"]');
    if (section && row) return { section, entry: profile[section]?.[[...block.children].filter(child => child.matches('[class*="apply-fields-"]')).indexOf(row)] };
  }
  const row = input.closest('[data-profile-section][data-entry-index]');
  if (row) {
    const section = row.dataset.profileSection;
    return { section, entry: validExtendedEntries(profile, section)[Number(row.dataset.entryIndex)] };
  }

  // 通用无卡片容器 fallback
  const label = getClosestLabelText(input);
  const sectionKind = nearestSectionKind(input);
  const kindMap = { edu: 'education', work: 'workExperience', project: 'projects', family: 'familyMembers', certificate: 'certificates', paper: 'papers', patent: 'patents', award: 'awards', campus: 'campusPositions', campusActivity: 'campusActivities', training: 'trainings', language: 'languageCertificates' };
  if (sectionKind && kindMap[sectionKind]) {
    const sec = kindMap[sectionKind];
    return { section: sec, entry: genericExtendedEntry(input, profile, sec) };
  }
  if (label) {
    for (const [sec, map] of Object.entries(EXTENDED_MAPPINGS)) {
      if (map[label]) return { section: sec, entry: genericExtendedEntry(input, profile, sec) };
    }
    if (/论文/.test(label)) return { section: 'papers', entry: genericExtendedEntry(input, profile, 'papers') };
    if (/专利/.test(label)) return { section: 'patents', entry: genericExtendedEntry(input, profile, 'patents') };
    if (/证书|获证/.test(label)) return { section: 'certificates', entry: genericExtendedEntry(input, profile, 'certificates') };
    if (/获奖|奖项|竞赛/.test(label)) return { section: 'awards', entry: genericExtendedEntry(input, profile, 'awards') };
  }
  return {};
}

async function fillExtendedFields(profile, options) {
  if (!profile) return 0;
  const mappings = EXTENDED_MAPPINGS;
  const basic = {
    '国籍':'nationality', '生源地':'sourcePlace', '生源地(高考时户口所在地)':'sourcePlace', '生源地（高考时户口所在地）':'sourcePlace',
    '户籍':'registeredAddress', '户籍地':'registeredAddress', '户籍所在地':'registeredAddress',
    '入党团时间':'politicalJoinDate', '入团时间':'leagueJoinDate', '入团日期':'leagueJoinDate', '加入共青团时间':'leagueJoinDate',
    '入党时间':'partyJoinDate', '入党日期':'partyJoinDate', '加入中国共产党时间':'partyJoinDate',
    '身高':'height', '身高(cm)':'height', '身高（cm）':'height',
    '体重':'weight', '体重(公斤)':'weight', '体重（kg）':'weight', '健康状况':'health',
    '人事档案所在单位':'archiveOrganization', '档案所在单位':'archiveOrganization', '专业技术职称':'professionalTitle'
  };
  const job = {
    '期望行业':'expectedIndustry', '意向行业':'expectedIndustry', '当前薪资':'currentSalary', '目前薪资':'currentSalary',
    '是否服从调剂':'acceptAdjustment', '是否接受调剂':'acceptAdjustment', '服从调剂':'acceptAdjustment',
    '是否接受县级公司工作':'acceptCounty', '是否愿意去县级公司工作':'acceptCounty', '接受县级工作':'acceptCounty',
    '币种':'salaryCurrency', '薪资币种':'salaryCurrency', '金额单位':'salaryUnit', '薪资周期':'salaryPeriod'
  };
  const answers = {
    '游戏经历':'gameExperience', '编程语言':'programmingLanguages',
    '请列出你最擅长的3门编程语言，并按熟悉程度从高到低排序。':'programmingLanguages',
    'ai工具使用经历':'aiTools', 'ai 工具使用经历':'aiTools', '爱好特长':'hobbies',
    '爱好及特长':'hobbies', '优势不足':'strengthsWeaknesses', '优势与不足':'strengthsWeaknesses',
    '自我评价':'selfEvaluation', '求职目标':'careerGoal'
  };
  const resultsByField = new Map((options?.results || []).map(row => [row.element, row]));
  const custom = new Map((profile.customAnswers || []).filter(item => item && !isProtectedQuestion(item.question))
    .map(item => [exactQuestion(item.question), item.answer]));
  const mappedLabels = new Set(Object.values(mappings).flatMap(mapping => Object.keys(mapping)));
  let count = 0;
  for (const input of document.querySelectorAll('input:not([type=file]):not([type=hidden]):not([type=checkbox]),textarea,select')) {
    await waitForFillCheckpoint(options?.task);
    if (options?.attemptedFields?.has(input)) continue;
    if (isIgnoredInput(input) || !isElementTrulyVisible(input) || fieldHasValue(input)) continue;
    const label = getClosestLabelText(input);
    if (!label || isProtectedQuestion(label)) continue;
    const { section, entry } = offerLinkCardEntry(input, options?.offerLinkEntries) ||
      (mappedLabels.has(label) ? extendedEntry(input, profile) : {});
    const mappedKey = section && mappings[section]?.[label];
    let value;
    if (mappedKey === '__combined') value = '';
    else if (section === 'basicInfo' && mappedKey) value = profile.basicInfo?.[mappedKey];
    else if (section === 'jobIntention' && mappedKey) value = profile.jobIntention?.[mappedKey];
    else if (section && mappedKey) value = entry?.[mappedKey];
    else value = profile.basicInfo?.[basic[label]] || profile.jobIntention?.[job[label]] || profile.commonAnswers?.[answers[label]];
    if (!value) {
      value = custom.get(exactQuestion(label));
    }
    if (section === 'workExperience' && label === '职责及业绩') value = [entry?.description, entry?.achievements].filter(Boolean).join('\n');
    if (section === 'awards' && label === '获奖情况描述/链接') value = [entry?.description, entry?.url].filter(Boolean).join('\n');
    if (section === 'patents' && label === '专利描述/链接') value = [entry?.description, entry?.url].filter(Boolean).join('\n');
    if (!value && label === '自我评价及求职目标') value = [profile.commonAnswers?.selfEvaluation, profile.commonAnswers?.careerGoal].filter(Boolean).join('\n') || profile.introTemplates?.default;
    if (!value && label.normalize('NFKC') === '期望待遇(万元/年)') {
      const salary = profile.jobIntention || {};
      if (salary.expectedSalary && (!/^(人民币|CNY|RMB)$/.test(salary.salaryCurrency) || salary.salaryUnit !== '万元' || salary.salaryPeriod !== '年薪')) {
        markManual(input, `${salary.expectedSalary}（请确认币种、万元单位和年薪周期）`); continue;
      }
      value = salary.expectedSalary;
    }
    if (Array.isArray(value)) value = value.join('\n');
    if (!value) continue;
    if (/日期|时间/.test(label) && /^\d{4}-\d{2}$/.test(value) && input.type === 'date') {
      markManual(input, `${value}（请确认具体日期）`); continue;
    }
    // 单字段异常不阻断其余扩展字段
    try {
      if (await fillSiteControl(input, value, options)) {
        count++;
        const previous = resultsByField.get(input);
        if (previous) {
          Object.assign(previous, { status: 'filled', reason: '', value });
          beisenRememberResult(previous, options?.task?.beisenProofForms);
        }
        else options?.results?.push(fillResultEntry(input, null, 'filled', '', value));
      } else markManual(input, value);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      markManual(input, `${value}（填充异常：${err?.message || err}）`);
    }
  }
  return count;
}

var attachmentSelections = globalThis.__EASYOFFER_ATTACHMENT_SELECTIONS__ ||= new WeakMap();

function attachmentSlot(input) {
  const field = input.closest('.form-item--phoenix, .ant-form-item, .el-form-item, .form-group');
  const phoenix = !!field?.matches('.form-item--phoenix');
  const uploader = input.closest('.file-uploader__wrapper, .ant-upload-wrapper, .el-upload');
  const label = phoenix ? beisenLabel(field) : getClosestLabelText(input);
  const kinds = [
    ['resume', /简历附件|附件简历|上传简历|^简历$|\bresume\b|\bcv\b/i],
    ['idPhoto', /证件照|标准照/], ['lifePhoto', /生活照/], ['works', /作品附件|上传作品|作品集附件/]
  ].filter(([, pattern]) => pattern.test(label));
  if (kinds.length !== 1) return null;
  const kind = kinds[0][0];
  // The China Life header uploads into a parser which rebuilds the entire form.
  // Its generated classes and button labels change after a file is present.
  if (isBeisenForm() || /(?:^|\.)zhiye\.com$/i.test(location.hostname)) {
    if (!phoenix || !field.closest('.ux-standard-form, form.form--phoenix')) return null;
    if (kind === 'resume' && !/^(?:简历附件|附件简历)$/.test(label)) return null;
  }
  const container = (field?.querySelectorAll('input[type="file"]').length === 1 && field) || uploader || input.closest('label') ||
    (input.parentElement?.matches('div, span, section') && input.parentElement.querySelectorAll('input[type="file"]').length === 1
      ? input.parentElement : input);
  if (kind === 'resume') {
    const description = (input.getAttribute('aria-describedby') || '').split(/\s+/)
      .map(id => id && document.getElementById(id)?.textContent).filter(Boolean).join(' ');
    const purpose = [label, input.name, input.id, input.title, description, container.innerText].join(' ');
    if (/(?:解析|导入|提取)(?:本地|现有|上传的)?简历|简历.{0,8}(?:解析|导入|提取)|自动(?:解析|填充|填写)|(?:parse|import|extract)[-_\s]*(?:your\s+)?(?:resume|cv)|(?:resume|cv)[-_\s]*(?:pars|import|extract)/i.test(purpose)) return null;
  }
  return { input, field, container, label, kind };
}

function attachmentAlreadyPresent({ input, container }) {
  return input.files?.length > 0 || !!input.value || Boolean(input.dataset.capybaraFileSelected) ||
    /重新上传|重新选择文件|替换文件|上传中|正在上传|上传成功/.test(container.innerText || '') ||
    Boolean(container.querySelector('.ant-upload-list-item, .el-upload-list__item, [data-file-name]:not([data-file-name=""])'));
}

// A controlled uploader can replace or clear its native input immediately after
// change. Remember that slot in the current form as well as reading the site's file list.
async function handleResumeUpload(profile, options = {}) {
  const notes = [];
  const ordinals = new Map();
  for (const input of document.querySelectorAll('input[type="file"]')) {
    await waitForFillCheckpoint(options.task);
    throwIfFillCancelled(options.signal);
    const slot = attachmentSlot(input);
    if (!slot) continue;
    const { kind, label, field, container } = slot;
    const owner = input.form || field?.closest('.ux-standard-form') || field || container;
    const siblings = ordinals.get(owner) || new Map();
    ordinals.set(owner, siblings);
    const index = siblings.get(label) || 0;
    siblings.set(label, index + 1);
    const key = label + ':' + index;
    const url = location.href;
    const attempts = attachmentSelections.get(owner) || new Map();
    attachmentSelections.set(owner, attempts);
    const unavailable = () => !input.isConnected || input.matches(':disabled') || location.href !== url ||
      attempts.get(key) === url || attachmentAlreadyPresent(slot);
    if (unavailable()) continue;
    const refs = kind === 'works' ? profile.attachments?.works || [] : [profile.attachments?.[kind]].filter(Boolean);
    if (!refs.length && !(kind === 'resume' && profile.resumeFile)) continue;
    const note = (text, reason) => {
      const message = label + '：' + text;
      notes.push(message);
      options.results?.push({ element: input, fieldType: kind, label, status: 'needs_review', reason });
      if (input.isConnected) markManual(input, message);
    };
    try {
      const candidates = [];
      for (const ref of refs) {
        throwIfFillCancelled(options.signal);
        const response = await runtimeSend({ action: 'getAttachment', profileId: profile.id, id: ref.id });
        if (!response?.success) throw new Error(response?.error || '附件读取失败');
        candidates.push(response.file);
      }
      if (kind === 'resume' && !candidates.length && profile.resumeFile) candidates.push({ name: profile.resumeFileName || 'resume.pdf', dataUrl: profile.resumeFile });
      const transfer = new DataTransfer();
      for (const candidate of candidates) {
        if (!candidate?.dataUrl?.startsWith('data:')) throw new Error('附件内容无法读取');
        const blob = await (await fetch(candidate.dataUrl)).blob();
        const file = new File([blob], candidate.name, { type: blob.type });
        const accepted = input.accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (/Photo$/.test(kind) && !file.type.startsWith('image/')) continue;
        if (accepted.length && !accepted.some(type => type === file.type || (type.startsWith('.') && file.name.toLowerCase().endsWith(type)) || (type.endsWith('/*') && file.type.startsWith(type.slice(0, -1))))) continue;
        transfer.items.add(file);
        if (!input.multiple) break;
      }
      await waitForFillCheckpoint(options.task);
      throwIfFillCancelled(options.signal);
      if (unavailable()) continue;
      // Site code may reuse this node for a different uploader while the files load.
      const current = attachmentSlot(input);
      if (current?.kind !== kind || current.label !== label || current.container !== container) continue;
      if (!transfer.files.length) { note('文件类型与网页要求不符，请手动核对', 'attachment_type_mismatch'); continue; }
      input.files = transfer.files;
      if (input.files.length !== transfer.files.length) { note('网页未接受所选文件', 'attachment_not_selected'); continue; }
      attempts.set(key, url);
      input.dataset.capybaraFileSelected = 'true';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (input.multiple && transfer.files.length < candidates.length) {
        note(`已选择 ${transfer.files.length} 个文件，其余文件类型与网页要求不符，请核对`, 'attachment_partially_selected');
      } else {
        note('已选择文件，请核对网站是否接收', 'attachment_selected');
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      note(error.message || '附件读取失败', 'attachment_read_failed');
    }
  }
  return notes;
}
