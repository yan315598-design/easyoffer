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
  const select = input.closest('.ant-select');
  if (!select || select.classList.contains('ant-select-auto-complete')) {
    const ok = setValue(input, value);
    input.blur();
    await sleep(80);
    return ok && input.value === String(value);
  }
  document.activeElement?.blur();
  document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  document.body.click();
  await sleep(150);
  select.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
  let hit;
  for (let step = 0; step < 10 && !hit; step++) {
    await sleep(100);
    hit = [...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')]
      .find(el => isElementTrulyVisible(el) && !/leave|hidden/.test(el.closest('.ant-select-dropdown')?.className || '') && !el.classList.contains('ant-select-item-option-disabled') && optionTextEquals(el.textContent, value));
  }
  if (hit) hit.click();
  document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  input.blur();
  await sleep(100);
  return !!hit && optionTextEquals(select.querySelector('.ant-select-selection-item')?.textContent, value);
}

async function fillXhsForm(profile, options) {
  const incremental = options?.mode === 'incremental';
  const items = () => [...document.querySelectorAll('.ant-form-item')];
  const label = item => item.querySelector('.ant-form-item-label')?.textContent.trim();
  const byLabel = name => items().filter(item => label(item) === name);
  // incremental 模式不新增经历条目，只补当前已有控件的空白
  if (!incremental) {
    for (const [field, buttonText, entries] of [
      ['学校', '添加教育经历', profile.education || []],
      ['公司', '添加实习经历', profile.workExperience || []],
      ['竞赛/奖项名称', '添加竞赛/奖项', profile.awards || []],
      ['论文名称', '添加论文', profile.papers || []],
      ['专利名称', '添加专利', profile.patents || []],
      ['证书名称', '添加证书', (profile.certificates || []).filter(p => p.name)]
    ]) {
      while (byLabel(field).length < entries.length) {
        await waitForFillCheckpoint(options?.task);
        const button = [...document.querySelectorAll('button,span')].find(el => el.textContent.trim() === buttonText && isElementTrulyVisible(el));
        if (!button) break;
        const count = byLabel(field).length;
        button.click();
        for (let step = 0; step < 10 && byLabel(field).length === count; step++) await sleep(100);
        if (byLabel(field).length === count) break;
      }
    }
  }
  let filledCount = 0;
  const manualFields = [];
  const fieldResults = [];
  const occurrences = {};
  const intro = profile.introTemplates?.default || '';
  const githubStars = [...intro.matchAll(/(\d+)\s*Stars\b/gi)].map(m => Number(m[1]));
  const githubLinks = [...new Set([profile.basicInfo?.github, ...(profile.projects || []).map(p => p.projectUrl),
    ...(intro.match(/https:\/\/github\.com\/[A-Za-z0-9_.\/-]+/g) || [])].filter(Boolean))];
  for (const item of items()) {
    await waitForFillCheckpoint(options?.task);
    const name = label(item);
    const index = occurrences[name] || 0;
    occurrences[name] = index + 1;
    const inputs = [...item.querySelectorAll('input:not([type="file"]):not([type="checkbox"]):not([type="radio"]),textarea')];
    const input = inputs[0];
    if (!input) continue;
    const eduIndex = input.id.match(/resumeEducationInfo_(\d+)_/)?.[1];
    const workIndex = input.id.match(/resumeEmploymentInfo_(\d+)_/)?.[1];
    const edu = profile.education?.[eduIndex] || {};
    const work = profile.workExperience?.[workIndex] || {};
    const rankPercent = Number((edu.rank || '').match(/前\s*(\d+(?:\.\d+)?)\s*%/)?.[1]);
    const rankBucket = rankPercent > 0 && [5, 10, 20, 25, 50].find(n => rankPercent <= n);
    let values;
    if (eduIndex !== undefined) values = ({
      '起止时间': [edu.startDate, edu.endDate], '学校': [edu.school], '专业': [edu.major], '院系': [edu.college],
      '学历': [({硕士:'硕士研究生',博士:'博士研究生'})[edu.degree] || edu.degree], '成绩排名': [rankBucket ? `TOP${rankBucket}%` : edu.rank]
    })[name];
    else if (workIndex !== undefined) values = ({
      '起止时间': [work.startDate, work.endDate], '公司': [work.company], '部门': [work.department],
      '职位': [work.position], '工作性质': [work.workType], '工作描述': [[work.description, work.achievements].filter(Boolean).join('\n')]
    })[name];
    else values = ({
      '姓名': [profile.basicInfo?.fullName], '邮箱': [profile.basicInfo?.email],
      'Github 链接': [(profile.openSource?.map(p => p.url).filter(Boolean).join('\n')) || githubLinks.join('\n')],
      'Github 星级': [profile.openSource?.[0]?.stars || (githubStars.length ? String(Math.max(...githubStars)) : '')],
      '竞赛/奖项名称': [profile.awards?.[index]?.name]
    })[name];
    if (!values) continue;
    for (let i = 0; i < values.length; i++) {
      await waitForFillCheckpoint(options?.task);
      const value = values[i], el = inputs[i];
      if (!el || !value || fieldHasValue(el)) continue;
      // 单字段异常/失败结构化落账，不影响后续字段
      try {
        if (await fillXhsControl(el, value, options)) {
          filledCount++;
          el.style.backgroundColor = '#e8f5e9';
          el.removeAttribute('data-job-autofill-manual');
          fieldResults.push({ status: 'filled', fieldType: name, label: name, value });
        } else {
          const note = `${name}：${value}`;
          el.setAttribute('data-job-autofill-manual', note);
          el.title = `请手动选择 ${note}`;
          manualFields.push(note);
          fieldResults.push({ status: 'needs_review', fieldType: name, label: name, value, reason: 'xhs_control_mismatch' });
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        const note = `${name}：（填充异常 ${err?.message || err}）`;
        el.setAttribute('data-job-autofill-manual', note);
        manualFields.push(note);
        fieldResults.push({ status: 'failed', fieldType: name, label: name, value, reason: err?.message || String(err) });
      }
    }
  }
  filledCount += await fillExtendedFields(profile, options);
  if (!incremental) await handleResumeUpload(profile);
  showNotification(`已填充 ${filledCount} 个字段` + (manualFields.length ? `；请手动选择：${manualFields.join('、')}` : '；未知资料请自行补充'), 'warning');
  return {filledCount, manualFields, results: [], fieldResults, isForm: true};
}

function isBeisenForm() {
  return !!document.querySelector('.ux-standard-form, form.form--phoenix, .form-item--phoenix');
}

// 每个 ux-standard-form 是一段独立经历，不能用页面上同名字段的顺序推断归属。
function beisenKind(form) {
  const labels = [...form.querySelectorAll('.form-item__title')].map(el => el.textContent.trim());
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
  if (labels.includes('技能类别')) return 'skills';
  if (labels.includes('自我评价及求职目标')) return 'intro';
  return '';
}

async function fillBeisenSelect(input, value, options) {
  const wrap = input.closest('.phoenix-select');
  document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  document.body.click();
  await sleep(100);
  input.focus();
  wrap.click();
  let hit;
  for (let attempt = 0; attempt < 10 && !hit; attempt++) {
    await sleep(100);
    hit = [...document.querySelectorAll('.phoenix-selectList__listItem')].find(el =>
      isElementTrulyVisible(el) && optionTextEquals(el.textContent, value) &&
      !/disabled/i.test(el.className));
  }
  if (hit) hit.click();
  document.body.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
  document.body.click();
  input.blur();
  await sleep(100);
  return !!hit && optionTextEquals(wrap.querySelector('.phoenix-select__tipEle')?.textContent, value);
}

async function fillBeisenForm(profile, options) {
  const incremental = options?.mode === 'incremental';
  const lists = {
    education: profile.education || [], work: profile.workExperience || [],
    project: profile.projects || [], award: profile.awards || [], family: profile.familyMembers || [],
    paper: profile.papers || [], patent: profile.patents || [], certificate: profile.certificates || []
  };
  const addLabels = {education: '添加教育经历', work: '添加工作/实习经历',
    project: '添加参与科研项目', award: '添加学习/工作获奖情况', family: '添加家庭成员及重要社会关系', paper: '添加发表文章、著作情况', patent: '添加专利', certificate: '添加证书'};
  const forms = kind => [...document.querySelectorAll('.ux-standard-form')].filter(f => beisenKind(f) === kind);
  // incremental 模式不新增经历条目，只补当前已有控件的空白
  if (!incremental) {
  for (const [kind, entries] of Object.entries(lists)) {
    while (forms(kind).length && forms(kind).length < entries.length) {
      await waitForFillCheckpoint(options?.task);
      const button = [...document.querySelectorAll('span,button')].find(el =>
        el.textContent.trim().replace(/\*$/, '') === addLabels[kind] && isElementTrulyVisible(el));
      if (!button) break;
      const count = forms(kind).length;
      button.click();
      for (let attempt = 0; attempt < 10 && forms(kind).length === count; attempt++) await sleep(100);
      if (forms(kind).length === count) break;
    }
  }
  }
  let filledCount = 0;
  const manualFields = [];
  const fieldResults = [];
  const indices = {};
  const join = (...values) => values.filter(Boolean).join('\n');
  for (const form of document.querySelectorAll('.ux-standard-form')) {
    await waitForFillCheckpoint(options?.task);
    const kind = beisenKind(form);
    const index = indices[kind] || 0;
    indices[kind] = index + 1;
    const entry = lists[kind]?.[index] || {};
    const basic = profile.basicInfo || {};
    const maps = {
      basic: {'姓名': basic.fullName, '电子邮箱': basic.email, '移动电话': basic.phone,
        '民族': basic.ethnicity, '国籍': basic.nationality, '通信地址': basic.address,
        '是否获得过奖学金': (profile.awards || []).some(a => /奖学金/.test(a.name)) ? '是' : '',
        '是否为学生干部': (profile.education || []).some(e => /班长|学习委员|学生干部/.test(e.description || '')) ? '是' : ''},
      education: {'学校': entry.school, '专业名称': entry.major,
        '学历': ({硕士:'硕士研究生',博士:'博士研究生'})[entry.degree] || entry.degree,
        '开始时间': entry.startDate, '结束时间': entry.endDate},
      work: {'单位名称': entry.company, '所在部门': entry.department, '职位名称': entry.position,
        '用工形式': entry.workType, '工作描述': join(entry.description, entry.achievements),
        '开始时间': entry.startDate, '结束时间': entry.endDate},
      project: {'项目名称': entry.name, '担当角色': entry.role,
        '主要工作内容': join(entry.description, entry.techStack, entry.responsibilities, entry.achievements),
        '开始时间': entry.startDate, '结束时间': entry.endDate},
      award: {'奖项名称': entry.name, '获奖级别': entry.level === '校级' ? '院校级' : entry.level, '获奖时间': entry.date, '颁奖单位': entry.issuer},
      family: {'称谓': entry.relation, '姓名': entry.name, '工作单位': entry.employer, '所属职务': entry.position},
      skills: {'技能类别': profileSkillText(profile, ', ')},
      intro: {'自我评价及求职目标': [profile.commonAnswers?.selfEvaluation, profile.commonAnswers?.careerGoal].filter(Boolean).join('\n') || profile.introTemplates?.default}
    };
    for (const item of form.querySelectorAll('.form-item--phoenix')) {
      await waitForFillCheckpoint(options?.task);
      const label = item.querySelector('.form-item__title')?.textContent.trim();
      const value = maps[kind]?.[label];
      const input = item.querySelector('input:not([type="file"]), textarea, select');
      if (!value) continue;
      const radios = [...item.querySelectorAll('.phoenix-radio')];
      if (radios.length) {
        if (radios.some(el => el.classList.contains('phoenix-radio--checked'))) continue;
        const choice = radios.find(el => el.textContent.trim() === value);
        if (choice) {
          choice.click();
          await sleep(100);
          if (choice.classList.contains('phoenix-radio--checked')) filledCount++;
        }
        continue;
      }
      if (!input || fieldHasValue(input)) continue;
      // 本站日期精确到日，只有年月的简历不能擅自补成 1 日。
      // 单字段异常/失败结构化落账（try/catch/finally），不影响后续字段。
      const isDate = /时间|日期|年月/.test(label);
      try {
        const success = isDate ? await fillBeisenDate(input, value, options) : (input.closest('.phoenix-select')
          ? await fillBeisenSelect(input, value, options) : await fillField(input, value, options));
        if (success) {
          filledCount++;
          input.style.backgroundColor = '#e8f5e9';
          item.removeAttribute('data-job-autofill-manual');
          fieldResults.push({ status: 'filled', fieldType: label, label, value });
        } else {
          const note = `${label}：${value}（请手动${isDate ? '确认具体日期' : '选择'}）`;
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
          fieldResults.push({ status: 'needs_review', fieldType: label, label, value, reason: isDate ? 'date_precision' : 'beisen_control_mismatch' });
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        const note = `${label}：（填充异常 ${err?.message || err}）`;
        item.setAttribute('data-job-autofill-manual', note);
        manualFields.push(note);
        fieldResults.push({ status: 'failed', fieldType: label, label, value, reason: err?.message || String(err) });
      } finally {
        dismissOpenDropdownPanels();
      }
    }
  }
  filledCount += await fillExtendedFields(profile, options);
  if (!incremental) await handleResumeUpload(profile);
  showNotification(`已填充 ${filledCount} 个字段；${manualFields.length} 项需手动确认，未知资料请自行补充`, 'warning');
  return {filledCount, manualFields, results: [], fieldResults, isForm: true};
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
    if (!question || /承诺|签名|签字|本人确认|本人同意|真实性/.test(question) || questionAnswered(root)) continue;
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

async function fillBeisenDate(input, value, options) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  input.click();
  const panel = () => [...document.querySelectorAll('.phoenix-calendar')].find(isElementTrulyVisible);
  await sleep(100);
  let picked = false;
  for (let step = 0; step < 120; step++) {
    const calendar = panel();
    if (!calendar) break;
    const shownYear = parseInt(calendar.querySelector('.phoenix-calendar-year-select')?.textContent, 10);
    const shownMonth = parseInt(calendar.querySelector('.phoenix-calendar-month-select')?.textContent, 10);
    if (!shownYear || !shownMonth) break;
    if (shownYear === year && shownMonth === month) {
      const cell = [...calendar.querySelectorAll('.phoenix-calendar-cell:not(.phoenix-calendar-last-month-cell):not(.phoenix-calendar-next-month-btn-day) .phoenix-calendar-date')]
        .find(el => Number(el.textContent) === day && el.getAttribute('aria-disabled') !== 'true');
      if (cell) { cell.click(); picked = true; }
      break;
    }
    const direction = shownYear !== year ? (shownYear > year ? 'prev-year' : 'next-year') : (shownMonth > month ? 'prev-month' : 'next-month');
    const button = calendar.querySelector(`.phoenix-calendar-${direction}-btn`);
    if (!button) break;
    button.click(); await sleep(45);
  }
  document.body.click(); input.blur(); await sleep(80);
  const displayed = input.closest('.phoenix-select')?.querySelector('.phoenix-select__tipEle')?.textContent.trim() || input.value;
  return picked && displayed?.replace(/\//g, '-') === value;
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
    const section = { education: 'education', work: 'workExperience', project: 'projects', award: 'awards', family: 'familyMembers', paper: 'papers', patent: 'patents', certificate: 'certificates' }[kind];
    const index = [...document.querySelectorAll('.ux-standard-form')].filter(form => beisenKind(form) === kind).indexOf(phoenix);
    return { section, entry: profile[section]?.[index] };
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
    if (!value && label === '期望待遇（万元/年）') {
      const salary = profile.jobIntention || {};
      if (salary.expectedSalary && (!/^(人民币|CNY|RMB)$/.test(salary.salaryCurrency) || salary.salaryUnit !== '万元' || salary.salaryPeriod !== '年薪')) {
        markManual(input, `${salary.expectedSalary}（请确认币种、万元单位和年薪周期）`); continue;
      }
      value = salary.expectedSalary;
    }
    if (Array.isArray(value)) value = value.join('\n');
    if (!value) continue;
    if (/日期|时间/.test(label) && /^\d{4}-\d{2}$/.test(value) && (isBeisenForm() || input.type === 'date')) {
      markManual(input, `${value}（请确认具体日期）`); continue;
    }
    // 单字段异常不阻断其余扩展字段
    try {
      if (await fillSiteControl(input, value, options)) {
        count++;
        const previous = resultsByField.get(input);
        if (previous) Object.assign(previous, { status: 'filled', reason: '', value });
        else options?.results?.push(fillResultEntry(input, null, 'filled', '', value));
      } else markManual(input, value);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      markManual(input, `${value}（填充异常：${err?.message || err}）`);
    }
  }
  return count;
}

// 附件仅按明确用途选择，设置 input.files 不代表网站已接收。
async function handleResumeUpload(profile) {
  for (const input of document.querySelectorAll('input[type="file"]')) {
    if (input.disabled || input.files?.length || input.dataset.capybaraFileSelected) continue;
    const label = getClosestLabelText(input);
    const kinds = [
      ['resume', /简历附件|附件简历|上传简历|^简历$|\bresume\b|\bcv\b/i],
      ['idPhoto', /证件照|标准照/], ['lifePhoto', /生活照/], ['works', /作品附件|上传作品|作品集附件/]
    ].filter(([, pattern]) => pattern.test(label));
    if (kinds.length !== 1) continue;
    const kind = kinds[0][0];
    const refs = kind === 'works' ? profile.attachments?.works || [] : [profile.attachments?.[kind]].filter(Boolean);
    try {
      const candidates = [];
      for (const ref of refs) {
        const response = await runtimeSend({ action: 'getAttachment', profileId: profile.id, id: ref.id });
        if (!response?.success) throw new Error(response?.error || '附件读取失败');
        candidates.push(response.file);
      }
      if (kind === 'resume' && !candidates.length && profile.resumeFile) candidates.push({ name: profile.resumeFileName || 'resume.pdf', dataUrl: profile.resumeFile });
      const transfer = new DataTransfer();
      for (const candidate of candidates) {
        const blob = await (await fetch(candidate.dataUrl)).blob();
        const file = new File([blob], candidate.name, { type: blob.type });
        const accepted = input.accept.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (/Photo$/.test(kind) && !file.type.startsWith('image/')) continue;
        if (accepted.length && !accepted.some(type => type === file.type || (type.startsWith('.') && file.name.toLowerCase().endsWith(type)) || (type.endsWith('/*') && file.type.startsWith(type.slice(0, -1))))) continue;
        transfer.items.add(file);
        if (!input.multiple) break;
      }
      if (!transfer.files.length) continue;
      input.files = transfer.files;
      input.dataset.capybaraFileSelected = 'true';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      markManual(input, '已选择附件，请核对网站是否接收；重新上传请在网站手动操作');
    } catch (error) { markManual(input, error.message); }
  }
}
