// ============================================================================
// Capybara 网申助手 content script —— smart-fill.js
// AI 智能补填公共层：候选收集/快照重定位/校验/级联与批次写入（aiSmartFill 与选区填入共用）
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';
function isOpenQuestionField(el) {
  if (isProtectedQuestion(getClosestLabelText(el)) || /是否|国籍|身份|籍贯|生源|户籍|婚姻|政治|健康|家庭|亲属|薪资|调剂|县级|意愿|偏好|游戏经历|编程语言|爱好|特长/.test(getClosestLabelText(el))) return false;
  if (isBeisenForm() || isXhsForm()) return false; // 此类表单包含个人声明；仅使用资料的确定性分区映射。
  if (isSelectWidget(el) || isYearControl(el) || isMonthControl(el)) return false;
  if (el.closest('.ant-select, .el-select, .rc-select')) return false;
  const type = matchFieldType(el);
  if (type && !LONG_FIELD_TYPES.has(type)) return false;
  const label = getClosestLabelText(el);
  if (SHORT_LABEL_RE.test(label) && !OPEN_LABEL_RE.test(label)) return false;
  const maxLen = parseInt(el.getAttribute('maxlength') || '0', 10);
  if (maxLen > 0 && maxLen <= 40) return false;
  const height = el.getBoundingClientRect().height;
  const multiline = el.tagName === 'TEXTAREA' || el.isContentEditable;
  if (OPEN_LABEL_RE.test(label) && (multiline || height >= 48)) return true;
  if (type && LONG_FIELD_TYPES.has(type)) return true;
  if (multiline && (maxLen === 0 || maxLen > 40)) return true;
  return false;
}

function listAiQuestionFields(emptyOnly) {
  return [...document.querySelectorAll(AI_FIELD_SELECTOR)].filter((el) => {
    if (isIgnoredInput(el)) return false;
    if (!el.isConnected || !isElementTrulyVisible(el)) return false;
    if (emptyOnly && fieldHasValue(el)) return false;
    return isOpenQuestionField(el);
  });
}

function aiFieldSignature(el) {
  return [
    el.tagName.toLowerCase(),
    el.getAttribute('type') || '',
    getClosestLabelText(el),
    el.getAttribute('placeholder') || '',
    el.getAttribute('maxlength') || '',
    nearestSectionKind(el)
  ].join('|');
}

function structuredSectionKind(fieldType, el) {
  if (PROJECT_LONG_FIELD_TYPES.has(fieldType)) return 'project';
  if (WORK_LONG_FIELD_TYPES.has(fieldType)) return 'work';
  return '';
}

function experienceIndexForField(el, kind) {
  const markerType = kind === 'project' ? 'projectName' : kind === 'work' ? 'company' : '';
  if (!markerType) return 0;

  const controls = document.querySelectorAll('input, textarea, select, [role="combobox"]');
  let index = -1;
  for (const control of controls) {
    if (isIgnoredInput(control)) continue;
    if (matchFieldType(control) === markerType) index++;
    if (control === el) return Math.max(index, 0);
  }
  return Math.max(index, 0);
}

function snapshotAiQuestionFields() {
  const fields = listAiQuestionFields(false);
  const signatureCounts = new Map();
  const nameCounts = new Map();

  return fields.map((el, position) => {
    const fieldType = matchFieldType(el);
    const sectionKind = structuredSectionKind(fieldType, el);
    const signature = aiFieldSignature(el);
    const ordinal = signatureCounts.get(signature) || 0;
    signatureCounts.set(signature, ordinal + 1);

    const name = el.getAttribute('name') || '';
    const nameKey = `${el.tagName}|${name}`;
    const nameOrdinal = nameCounts.get(nameKey) || 0;
    nameCounts.set(nameKey, nameOrdinal + 1);

    if (fieldHasValue(el)) return null;

    return {
      id: el.id || '',
      name,
      nameOrdinal,
      signature,
      ordinal,
      position,
      tagName: el.tagName,
      fieldType,
      sectionKind,
      experienceIndex: experienceIndexForField(el, sectionKind),
      label: getClosestLabelText(el) || el.placeholder || '开放问答题',
      placeholder: el.placeholder || '',
      maxLength: el.getAttribute('maxlength') || ''
    };
  }).filter(Boolean);
}

function resolveAiQuestionField(ref) {
  const isUsable = (el) => el && el.isConnected && isElementTrulyVisible(el) && isOpenQuestionField(el);

  if (ref.id) {
    const byId = document.getElementById(ref.id);
    if (isUsable(byId)) return byId;
  }

  const fields = listAiQuestionFields(false);
  if (ref.name) {
    const named = fields.filter((el) => el.tagName === ref.tagName && el.getAttribute('name') === ref.name);
    if (named[ref.nameOrdinal]) return named[ref.nameOrdinal];
  }

  const matching = fields.filter((el) => aiFieldSignature(el) === ref.signature);
  if (matching[ref.ordinal]) return matching[ref.ordinal];

  const positional = fields[ref.position];
  return positional && positional.tagName === ref.tagName ? positional : null;
}

function readFieldValue(el) {
  if (!el) return '';
  if (el.isContentEditable) return (el.textContent || '').trim();
  return String(el.value || '').trim();
}

function normalizeIdentity(value) {
  return String(value || '').toLowerCase().replace(/[\s·_\-—–|（）()【】\[\]]+/g, '');
}

function localExperienceIdentity(el, kind) {
  const markerType = kind === 'project' ? 'projectName' : 'company';
  const secondaryType = kind === 'work' ? 'position' : 'projectRole';
  let node = el?.parentElement;

  for (let depth = 0; depth < 8 && node; depth++, node = node.parentElement) {
    const controls = [...node.querySelectorAll('input, textarea, select, [role="combobox"]')];
    const markers = controls.filter((control) => matchFieldType(control) === markerType);
    if (markers.length !== 1) continue;
    const marker = markers[0];
    const secondary = controls.find((control) => matchFieldType(control) === secondaryType);
    return {
      primary: readFieldValue(writableBox(marker) || marker),
      secondary: readFieldValue(writableBox(secondary) || secondary)
    };
  }
  return { primary: '', secondary: '' };
}

function resolveStructuredResumeContext(profile, ref, liveField) {
  const kind = ref.sectionKind;
  if (kind !== 'project' && kind !== 'work') return { required: false, item: null };

  const items = kind === 'project'
    ? (profile.projects || []).filter((item) => item && [item.name, item.description, item.responsibilities, item.achievements].some((value) => String(value || '').trim()))
    : (profile.workExperience || []).filter((item) => item && [item.company, item.position, item.description, item.achievements].some((value) => String(value || '').trim()));
  const identity = localExperienceIdentity(liveField, kind);
  const primary = normalizeIdentity(identity.primary);
  const matched = primary
    ? items.find((item) => {
        const itemPrimary = normalizeIdentity(kind === 'project' ? item.name : item.company);
        return itemPrimary && (itemPrimary.includes(primary) || primary.includes(itemPrimary));
      })
    : null;
  const item = matched || items[ref.experienceIndex] || null;
  if (!item) return { required: true, item: null, reason: `简历中没有第 ${ref.experienceIndex + 1} 段${kind === 'project' ? '项目' : '工作/实习'}经历` };

  const parts = kind === 'project' ? smartExtractProjectParts(item) : smartExtractWorkParts(item);
  let sourceText = '';
  if (ref.fieldType === 'projectResponsibilities') sourceText = parts.responsibilities;
  else if (ref.fieldType === 'projectDescription') sourceText = parts.description;
  else if (ref.fieldType === 'projectAchievements') sourceText = parts.achievements;
  else if (ref.fieldType === 'workDescription') sourceText = parts.description;
  else if (ref.fieldType === 'workAchievements') sourceText = parts.achievements;

  if (!String(sourceText || '').trim()) {
    return {
      required: true,
      item: null,
      reason: `对应${kind === 'project' ? '项目' : '工作/实习'}经历没有填写该项原始内容`
    };
  }

  return {
    required: true,
    item,
    kind,
    title: kind === 'project' ? item.name : [item.company, item.position].filter(Boolean).join(' / '),
    context: kind === 'project'
      ? { name: item.name, role: item.role, description: parts.description, responsibilities: parts.responsibilities, achievements: parts.achievements, techStack: parts.techStack }
      : { company: item.company, position: item.position, description: parts.description, achievements: parts.achievements }
  };
}

async function writeAndVerifyAiAnswer(ref, answer) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const liveField = resolveAiQuestionField(ref);
    if (!liveField) return { success: false, reason: '字段已被页面重建且无法重新定位' };
    if (attempt === 0 && fieldHasValue(liveField)) {
      return { success: false, reason: '字段在 AI 生成期间已被填写' };
    }

    const box = writableBox(liveField) || liveField;
    const ok = await fillField(box, answer);
    if (ok) {
      try { box.blur(); } catch {}
    }
    await sleep(400);

    const currentField = resolveAiQuestionField(ref);
    const currentBox = writableBox(currentField) || currentField;
    const writtenValue = readFieldValue(currentBox);
    if (writtenValue) return { success: true, field: currentBox, value: writtenValue };
  }

  return { success: false, reason: '页面更新后字段值未保留' };
}

function checkAnswerQuality(answer, fieldType, labelText) {
  const warnings = [];
  const text = String(answer || '').trim();

  if (text.length < 30) {
    warnings.push('内容过短');
  }

  // 检查是否是职责类字段
  const isResponsibilityField = fieldType === 'projectResponsibilities' ||
                                 fieldType === 'workDescription' ||
                                 /职责|负责|工作内容/i.test(labelText);

  if (isResponsibilityField) {
    // 检查是否有分点
    const hasBulletPoints = /^[●•\-*]\s/m.test(text) || /^\d+[\.\)]\s/m.test(text);
    if (!hasBulletPoints && text.length > 80) {
      warnings.push('职责类字段建议分点列出');
    }

    // 检查是否包含量化数据
    const hasQuantification = /\d+%|\d+\+|准确率|QPS|TPS|毫秒|万条|亿|降低|提升|优化|达到/i.test(text);
    if (!hasQuantification) {
      warnings.push('缺少量化指标（建议补充准确率、性能数据等）');
    }

    // 检查是否包含技术栈
    const hasTechStack = /[A-Z][a-z]+|BERT|GPT|API|SQL|LLM|Agent|RAG|模型|微调|框架/i.test(text);
    if (!hasTechStack) {
      warnings.push('建议明确提及使用的技术栈');
    }
  }

  // 检查空洞词汇
  const fluffWords = ['负责', '参与', '协助', '配合', '学习', '了解', '熟悉'];
  const fluffCount = fluffWords.filter(word => text.includes(word)).length;
  if (fluffCount > 2 && !/具体|实现|构建|开发|设计/i.test(text)) {
    warnings.push('表述较空洞，建议增加具体工作内容');
  }

  return {
    isGood: warnings.length === 0,
    warnings: warnings,
    score: Math.max(0, 100 - warnings.length * 25)
  };
}

function slimResumeContext(profile) {
  return {
    name: profile.basicInfo?.fullName,
    school: profile.education?.[0]?.school,
    major: profile.education?.[0]?.major,
    degree: profile.education?.[0]?.degree,
    skills: profile.skills?.skills || profile.skills,
    advantage: profile.skillAdvantage || profile.skills?.advantage,
    intro: profile.introTemplates?.default || profile.skills?.intro,
    projects: (profile.projects || []).slice(0, 3).map((p) => ({
      name: p.name,
      role: p.role,
      techStack: p.techStack,
      description: (p.description || '').slice(0, 500),
      responsibilities: (p.responsibilities || '').slice(0, 600),
      achievements: (p.achievements || '').slice(0, 300)
    })),
    workExperience: (profile.workExperience || []).slice(0, 2).map((w) => ({
      company: w.company,
      position: w.position,
      description: (w.description || '').slice(0, 500),
      achievements: (w.achievements || '').slice(0, 300)
    })),
    awards: profile.awards
  };
}

// 归一化文本用于模糊比对：去所有空白、全角转半角、统一小写
function normalizeSmartFillText(text) {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .toLowerCase();
}

// 纯函数：在下拉选项原文中找与 value 精确或前缀匹配的项（忽略空白与全半角差异），找不到返回 null
function smartFillMatchOptionText(optionTexts, value) {
  if (!Array.isArray(optionTexts) || optionTexts.length === 0) return null;
  const target = normalizeSmartFillText(value);
  if (!target) return null;
  const normalized = optionTexts.map((text) => normalizeSmartFillText(text));
  let index = normalized.findIndex((text) => text === target);
  if (index < 0) {
    index = normalized.findIndex((text) => text && (text.startsWith(target) || target.startsWith(text)));
  }
  return index >= 0 ? optionTexts[index] : null;
}

// 收集原生 select 的选项原文（剔除“请选择”类占位项），没有可用选项返回 null
function smartFillSelectOptions(el) {
  if (!el || el.tagName !== 'SELECT' || !el.options || el.options.length === 0) return null;
  const texts = [...el.options]
    .map((option) => (option.text || '').trim())
    .filter((text) => text && !SMART_FILL_PLACEHOLDER_OPTION_RE.test(text));
  return texts.length > 0 ? texts : null;
}

// 节点是否仍是合格的补填目标：必须在候选选择器内（或为组件下拉触发器）、非忽略名单（密码/验证码/登录/搜索）、
// 未禁用、非只读（组件下拉触发器例外：其 input 只读但靠点击展开选择）、仍连接在文档中且可见。
// 所有解析路径（原节点/id/name/position）都必须复查。
function isEligibleSmartFillControl(el) {
  if (!el || !el.tagName) return false;
  const widgetTrigger = isWidgetSelectTrigger(el);
  if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT' && !widgetTrigger) return false;
  try {
    if (!el.matches(SMART_FILL_FIELD_SELECTOR) && !widgetTrigger) return false;
  } catch {
    return false;
  }
  if (isIgnoredInput(el)) return false; // 密码/隐藏/验证码/登录框/全站搜索框（P0 红线，组件下拉同样适用）
  if (el.disabled) return false;
  if (el.readOnly && !widgetTrigger) return false;
  if (!el.isConnected || !isElementTrulyVisible(el)) return false;
  return true;
}

// 页面上可见、可写、非忽略名单的候选控件（与 fillForm 同一套排除规则）
function listSmartFillFields() {
  return [...document.querySelectorAll(SMART_FILL_FIELD_SELECTOR)].filter(isEligibleSmartFillControl);
}

// 收集未填字段：排除已有值、开放题（留给开放题阶段）、字典可识别（基础填充已处理）的。
// 组件下拉触发器（readonly input 等）放行进入候选；同一行内 2-3 个组件下拉标成级联组，
// 组件下拉+文本输入的组合控件拆成「xxx·类型」「xxx·内容」两个候选。
function collectSmartFillFields() {
  const nameOrdinals = new Map();
  const collected = [];

  listSmartFillFields().forEach((el, position) => {
    const name = el.getAttribute('name') || '';
    // nameOrdinal 必须在任何过滤之前、基于完整候选列表计算，解析时才能用同一口径取回
    const nameKey = `${el.tagName}|${name}`;
    const nameOrdinal = nameOrdinals.get(nameKey) || 0;
    nameOrdinals.set(nameKey, nameOrdinal + 1);

    // 多益表格需要按行对齐，已识别的 Tec 下拉也只使用确定来源。
    if (duoyiTableField(el) || (el.matches('.tec-select__input, .tec-cascade__input') && matchFieldType(el))) return;
    if (fieldHasValue(el)) return;
    if (isOpenQuestionField(el)) return;

    const widget = el.tagName !== 'SELECT' && isWidgetSelectTrigger(el);
    if (widget && widgetSelectCurrentValue(el)) return; // 组件下拉已有选中值，视为已填
    // P0：非 input 的触发容器（div[role=combobox] 等）钻取到的内层控件若是密码/文件等敏感输入，整组拒绝进入候选
    if (widget && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      const inner = writableBox(el);
      if (inner && inner !== el && !isSmartFillWritableInnerInput(inner)) return;
    }

    const placeholder = el.placeholder || el.getAttribute('placeholder') || '';
    const domLabel = getClosestLabelText(el);
    const label = domLabel || placeholder;
    if (!label && !placeholder && !name) return; // 完全无线索，AI 无法判断

    const maxLengthAttr = parseInt(el.getAttribute('maxlength') || '0', 10);
    const options = smartFillSelectOptions(el);
    if (el.tagName === 'SELECT' && !options) return; // 下拉框没有可识别选项，既不能给 AI 也无法校验

    // 字典可识别的文本字段交给基础填充（保持原有行为）；组件下拉是第二机会：
    // 走到这里说明基础填充后仍为空，交给 AI 匹配选项原文更可靠
    let dictDeferred = false;
    if (matchFieldType(el) && !widget) {
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return; // 原生 select 等仍按原规则交给基础填充
      dictDeferred = true; // 暂存：若所在行被判定为组合控件则保留，否则在分组判定后移除
    }

    const ref = {
      el,
      signature: smartFillFieldSignature(el),
      id: el.id || '',
      name,
      nameOrdinal,
      position,
      tagName: el.tagName,
      type: (el.getAttribute('type') || '').toLowerCase(),
      domLabel,
      label,
      placeholder,
      maxLength: maxLengthAttr > 0 ? maxLengthAttr : 0,
      options,
      sectionKind: nearestSectionKind(el),
      entryIndex: Number(el.closest('[data-entry-index]')?.dataset.entryIndex),
      dictDeferred
    };
    if (widget) ref.kind = 'widget-select';
    collected.push(ref);
  });

  tagSmartFillFieldGroups(collected);
  // 字典可识别且未并入组合控件的文本字段移除：基础填充已处理，保持原有行为不变
  return collected.filter((ref) => !ref.dictDeferred || ref.comboPartner);
}

// 字段所在的"行"容器（label/单元格/表单项），组件分组只发生在同一行内
function smartFillRowContainer(el) {
  try {
    return el.closest(SMART_FILL_ROW_CONTAINER_SELECTOR);
  } catch {
    return null;
  }
}

// 行内全部组件下拉触发器（含已被跳过的），用于校验收集数与实际数一致、防止跨行误合并
function widgetTriggersIn(row) {
  let nodes = [];
  try {
    nodes = [...row.querySelectorAll('input, select, [role="combobox"], [aria-haspopup="listbox"]')];
  } catch {
    return [];
  }
  return nodes.filter(isWidgetSelectTrigger);
}

// 组件下拉的外壳节点：已知组件库容器优先，其次自研启发式外壳，最后是触发器自身
function smartWidgetShellOf(el) {
  try {
    const known = el.closest(SMART_FILL_WIDGET_CONTAINER_SELECTOR);
    if (known) return known;
  } catch { /* 继续启发式 */ }
  return smartWidgetHeuristicShell(el) || el;
}

// 两个节点是否落在同一行容器的相邻兄弟槽位上（各自允许再包多层外壳，以行容器直接子节点为槽位）
function domSiblingsAdjacent(a, b, row) {
  if (!a || !b || !row || !row.children) return false;
  const slotOf = (node) => {
    let cur = node;
    while (cur && cur.parentElement && cur.parentElement !== row) cur = cur.parentElement;
    return cur && cur.parentElement === row ? cur : null;
  };
  const slotA = slotOf(a);
  const slotB = slotOf(b);
  if (!slotA || !slotB || slotA === slotB) return false;
  const slots = [...row.children];
  const idxA = slots.indexOf(slotA);
  const idxB = slots.indexOf(slotB);
  return idxA >= 0 && idxB >= 0 && Math.abs(idxA - idxB) <= 1;
}

// 就地标注级联组与组合控件：
// - 级联：同一行容器内 2-3 个组件下拉（全部未填、与行内组件下拉总数一致），按 DOM 顺序标 cascadeGroupId/cascadeIndex
// - 组合：同一行容器内恰好 1 个组件下拉 + 恰好 1 个无独立 label 且与下拉相邻的文本输入，拆成「xxx·类型」「xxx·内容」
function tagSmartFillFieldGroups(collected) {
  const rows = new Map();
  for (const ref of collected) {
    const row = smartFillRowContainer(ref.el);
    if (!row) continue;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(ref);
  }

  let groupSeq = 0;
  for (const [row, refs] of rows) {
    const widgetRefs = refs.filter((ref) => ref.kind === 'widget-select');
    const triggers = widgetTriggersIn(row);

    if (widgetRefs.length >= 2) {
      // 级联组：行内组件下拉必须全部进入候选（有已选值的下拉会打断级联），且不超过 3 级
      if (triggers.length !== widgetRefs.length || widgetRefs.length > 3) continue;
      // 年/月等日期控件与文本含时间/日期的行不是级联（如 起止年月）；英文用完整词边界，避免 "Candidate" 内嵌 "date" 误伤
      if (widgetRefs.some((ref) => isYearControl(ref.el) || isMonthControl(ref.el))) continue;
      const labels = widgetRefs.map((ref) => `${ref.domLabel || ''} ${ref.label || ''}`);
      if (labels.some((text) => /时间|日期|起止|\bdate\b/i.test(text))) continue;
      groupSeq += 1;
      widgetRefs.forEach((ref, index) => {
        ref.cascadeGroupId = `g${groupSeq}`;
        ref.cascadeIndex = index;
        ref.cascadeLevels = widgetRefs.length;
      });
    } else if (widgetRefs.length === 1 && triggers.length === 1) {
      // 组合控件：类型下拉 + 紧邻文本框；文本框必须没有自己的独立 label 且恰好一个、与下拉相邻，
      // 否则各自独立候选不合并（避免"关系下拉+姓名+手机"被误拆出多个同名"·内容"）
      const widget = widgetRefs[0];
      if (isYearControl(widget.el) || isMonthControl(widget.el)) continue;
      const partners = refs.filter((ref) => ref !== widget && !ref.kind && (ref.tagName === 'INPUT' || ref.tagName === 'TEXTAREA') &&
        (!ref.domLabel || ref.domLabel === widget.domLabel));
      if (partners.length !== 1) continue;
      if (!domSiblingsAdjacent(smartWidgetShellOf(widget.el), partners[0].el, row)) continue;
      const baseLabel = widget.domLabel || partners[0].domLabel || widget.label;
      if (!baseLabel) continue;
      widget.label = `${baseLabel}·类型`;
      widget.comboPartner = true;
      partners[0].label = `${baseLabel}·内容`;
      partners[0].comboPartner = true;
    }
  }
}

// 快照签名：label/placeholder/name/类型/长度/是否组件下拉触发器组合，DOM 重建后签名不一致宁可跳过
function smartFillFieldSignature(el) {
  return [
    el.tagName.toLowerCase(),
    (el.getAttribute('type') || '').toLowerCase(),
    getClosestLabelText(el),
    el.getAttribute('placeholder') || '',
    el.getAttribute('name') || '',
    el.getAttribute('maxlength') || '',
    isWidgetSelectTrigger(el) ? 'widget' : ''
  ].join('|');
}

// 按快照引用重新定位页面上的目标字段（页面可能在 AI 生成期间重建）。
// 每条路径命中后都必须复查安全过滤 + 标签名 + 签名，任一不符直接放弃该字段。
function resolveSmartFillField(ref) {
  const accept = (el) => {
    if (!isEligibleSmartFillControl(el)) return null;
    if (el.tagName !== ref.tagName) return null;
    if (smartFillFieldSignature(el) !== ref.signature) return null;
    if (fieldHasValue(el)) return null;
    // AI 等待期间组件可能已被填上选中值（semi/arco 等不在 fieldHasValue 的组件分支覆盖内），已有值宁可跳过
    if (ref.kind === 'widget-select' && el.tagName !== 'SELECT' && widgetSelectCurrentValue(el)) return null;
    return el;
  };

  // 优先绑定收集时的原节点：仍在文档中且签名一致才直接用
  if (ref.el) {
    const original = accept(ref.el);
    if (original) return original;
  }

  if (ref.id) {
    const byId = accept(document.getElementById(ref.id));
    if (byId) return byId;
  }

  const fields = listSmartFillFields();
  if (ref.name) {
    const named = fields.filter((el) => el.tagName === ref.tagName && el.getAttribute('name') === ref.name);
    const byName = accept(named[ref.nameOrdinal]);
    if (byName) return byName;
  }

  return accept(fields[ref.position]);
}

// 发给 AI 的字段描述（下拉选项超过 40 个时截断并标注；组件下拉/级联组/组合控件附上标记）
function smartFillFieldPayload(ref) {
  const payload = { position: ref.position, label: ref.label, tagName: ref.tagName.toLowerCase() };
  if (ref.name) payload.name = ref.name;
  if (ref.type) payload.type = ref.type;
  if (ref.placeholder) payload.placeholder = ref.placeholder;
  if (ref.maxLength) payload.maxLength = ref.maxLength;
  if (ref.sectionKind) payload.sectionKind = ref.sectionKind;
  if (Number.isFinite(ref.entryIndex)) payload.entryIndex = ref.entryIndex;
  if (Array.isArray(ref.allowedSources)) payload.allowedSources = ref.allowedSources;
  if (Array.isArray(ref.options)) {
    payload.options = ref.options.slice(0, SMART_FILL_MAX_OPTIONS);
    if (ref.options.length > SMART_FILL_MAX_OPTIONS) payload.optionsTruncated = true;
  }
  if (ref.kind === 'widget-select') {
    payload.widgetSelect = true;
    if (ref.currentValue) payload.currentValue = ref.currentValue;
  }
  if (ref.cascadeGroupId) {
    payload.cascadeGroup = ref.cascadeGroupId;
    payload.level = ref.cascadeIndex + 1;
    if (ref.cascadeIndex === 0) payload.cascadeLevels = ref.cascadeLevels;
  }
  return payload;
}

var SMART_FILL_SECTION_SOURCES = {
  edu: ['education'], work: ['workExperience'], project: ['projects'], award: ['awards'],
  certificate: ['certificates'], family: ['familyMembers'], paper: ['papers'], patent: ['patents'],
  campus: ['campusPositions'], training: ['trainings'], language: ['languageCertificates', 'languageSkills'],
  basic: ['basicInfo'], birth: ['basicInfo'], intention: ['jobIntention']
};

function attachSmartFillSourceContext(ref, profile) {
  const allowed = SMART_FILL_SECTION_SOURCES[ref.sectionKind] || [];
  ref.allowedSources = allowed;
  let source = null;
  if (!allowed.length) {
    source = typeof profileWithoutFiles === 'function' ? profileWithoutFiles(profile) : profile;
  } else if (ref.sectionKind === 'language') {
    const type = detectField(ref.el)?.fieldType;
    if ([...LEGACY_LANGUAGE_SCORES, 'otherLanguages'].includes(type)) {
      const value = profileLanguageScores(profile)[type];
      if (value) source = { languageSkills: { [type]: value } };
    } else {
      const entry = extendedEntry(ref.el, profile).entry;
      if (entry) source = { languageCertificates: [entry] };
    }
  } else if (profileListKeys.includes(allowed[0])) {
    const entry = extendedEntry(ref.el, profile).entry;
    if (entry) source = { [allowed[0]]: [entry] };
  } else {
    source = { [allowed[0]]: profile?.[allowed[0]] };
  }
  ref.sourceText = source ? JSON.stringify(source) : '';
  return !!ref.sourceText;
}

function smartFillLeafValues(sourceText) {
  const values = [];
  const ignoredKeys = new Set(['id', 'profileId', 'createdAt', 'updatedAt', 'lastUsedAt']);
  const visit = (node, key) => {
    if (node === null || node === undefined || ignoredKeys.has(key)) return;
    if (Array.isArray(node)) {
      node.forEach(item => visit(item, ''));
      return;
    }
    if (typeof node === 'object') {
      Object.entries(node).forEach(([childKey, child]) => visit(child, childKey));
      return;
    }
    const text = String(node).trim();
    if (text) values.push(text);
  };
  try { visit(JSON.parse(sourceText), ''); } catch { return []; }
  return values;
}

function smartFillSourceEquivalent(source, target) {
  const a = String(source || '').trim();
  const b = String(target || '').trim();
  if (!a || !b) return false;
  if (normalizeSmartFillText(a) === normalizeSmartFillText(b)) return true;
  // 复用控件层受控别名（如 硕士 ↔ 硕士研究生），不开放任意子串匹配。
  return typeof optionTextEquals === 'function' && (optionTextEquals(a, b) || optionTextEquals(b, a));
}

function smartFillValueTraceable(ref, value) {
  if (!ref.sourceText) return false;
  const sources = smartFillLeafValues(ref.sourceText);
  const values = Array.isArray(value) ? value : [value];
  if (values.length > 1) {
    const combined = values.map(item => normalizeSmartFillText(item)).join('');
    if (sources.some(source => normalizeSmartFillText(source) === combined)) return true;
  }
  return values.every(item => sources.some(source => smartFillSourceEquivalent(source, item)));
}

// 纯函数：校验 AI 返回的单个结果项，畸形项返回 null
// （非对象/数组/position 非安全整数/value 非字符串或字符串数组/取值为空白）
function normalizeSmartFillAiItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return null;
  if (!Number.isSafeInteger(rawItem.position)) return null;
  const value = rawItem.value;
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
  } else if (Array.isArray(value)) {
    if (value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) return null;
  } else {
    return null;
  }
  return { position: rawItem.position, value };
}

// 写入前校验：下拉必须匹配选项原文、手机号 11 位、身份证 18 位、超长直接跳过（宁可跳过不截断）。
// 级联组只认第一级驱动的整组数组值，层数必须与组层数完全一致；
// 组件下拉（widget-select）中"非 input 的触发容器"的 value 是选项原文，不做格式预校验，
// 成功与否以 fillSelectWidget 的返回为准；input 自身（含启发式误命中的普通输入）仍走格式校验。
function validateSmartFillValue(ref, value) {
  if (ref.cascadeGroupId) {
    if (ref.cascadeIndex !== 0) return { ok: false, reason: '级联组只能由第一级字段返回整组取值' };
    if (!Array.isArray(value)) return { ok: false, reason: '级联字段必须返回数组值（每级一项）' };
    if (value.length !== ref.cascadeLevels) return { ok: false, reason: `级联取值应 ${ref.cascadeLevels} 层，实际 ${value.length} 层` };
    const levels = value.map((item) => String(item ?? '').trim().replace(/\s+/g, ' '));
    if (levels.some((item) => !item)) return { ok: false, reason: '级联取值存在空层级' };
    if (ref.sourceText && !smartFillValueTraceable(ref, levels)) return { ok: false, reason: '级联值不属于当前模块/条目资料' };
    return { ok: true, value: levels };
  }
  if (Array.isArray(value)) return { ok: false, reason: '该字段不是级联组，不接数组值' };

  let finalValue = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!finalValue) return { ok: false, reason: '空值' };

  if (Array.isArray(ref.options)) {
    const matched = smartFillMatchOptionText(ref.options, finalValue);
    if (!matched) return { ok: false, reason: '下拉选项无法匹配' };
    finalValue = matched;
  }

  const isWidgetShell = ref.kind === 'widget-select' && ref.tagName !== 'INPUT';
  if (!isWidgetShell) {
    if (SMART_FILL_PHONE_LABEL_RE.test(ref.label || '') || ref.type === 'tel') {
      finalValue = finalValue.replace(/[\s-]/g, '');
      if (!/^1\d{10}$/.test(finalValue)) return { ok: false, reason: '手机号不是 11 位' };
    }
    if (SMART_FILL_IDCARD_LABEL_RE.test(ref.label || '') && !/^\d{17}[\dXx]$/.test(finalValue)) {
      return { ok: false, reason: '身份证不是 18 位' };
    }

    if (ref.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(finalValue)) return { ok: false, reason: '日期格式不符' };
    if (ref.type === 'month' && !/^\d{4}(-\d{2})?$/.test(finalValue)) return { ok: false, reason: '年月格式不符' };
    if (ref.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalValue)) return { ok: false, reason: '邮箱格式不符' };
    if (ref.type === 'number' && !/^-?\d+(\.\d+)?$/.test(finalValue)) return { ok: false, reason: '数字格式不符' };
    if (ref.type === 'url' && !/^https?:\/\/\S+$/i.test(finalValue)) return { ok: false, reason: '链接格式不符' };

    if (ref.maxLength > 0 && finalValue.length > ref.maxLength) {
      return { ok: false, reason: `超出 maxlength ${ref.maxLength}` };
    }
  }

  if (ref.sourceText && !smartFillValueTraceable(ref, finalValue)) {
    return { ok: false, reason: '返回值不属于当前模块/条目资料' };
  }

  return { ok: true, value: finalValue };
}

// 从 AI 回复中提取严格 JSON 数组（容忍代码块与 <think> 包裹），失败返回 null
function parseSmartFillAiJson(text) {
  const raw = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// 纯函数：把 profile 压缩成不超过 3000 字的紧凑 JSON 摘要（空值剔除，长文截断）
function buildSmartFillProfileDigest(profile, allowedSections) {
  const pick = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return null;
    const entries = keys
      .map((key) => [key, String(obj[key] ?? '').trim()])
      .filter(([, value]) => value);
    return entries.length ? Object.fromEntries(entries) : null;
  };

  const digest = {};
  const basicInfo = pick(profile?.basicInfo, [
    'fullName', 'firstName', 'lastName', 'phone', 'phoneType', 'email', 'gender', 'birthDate', 'idCard',
    'politicalStatus', 'ethnicity', 'hometown', 'sourcePlace', 'registeredAddress', 'nationality',
    'leagueJoinDate', 'partyJoinDate', 'height', 'weight', 'health', 'graduationDate',
    'emergencyContact', 'emergencyRelation', 'emergencyPhone',
    'address', 'street', 'city', 'state', 'country', 'zipCode', 'location',
    'linkedin', 'github', 'website', 'twitter', 'maritalStatus', 'currentCity',
    'englishName', 'wechat', 'qq', 'idCardType', 'bloodType', 'registeredAddressType', 'religion',
    'honor', 'specialSkills', 'openToWork', 'permanentResidencePermit', 'jobSources',
    'foreignCitizenship', 'relativesEmployed', 'yearsOfWork',
    'lastNamePinyin', 'firstNamePinyin', 'namePinyinFull', 'personalPromise',
    'homeAddress'
  ]);
  if (basicInfo) digest.basicInfo = basicInfo;

  const education = (profile?.education || []).map((item) => pick(item, [
    'school', 'college', 'major', 'degree', 'academicDegree', 'degreeType', 'schoolType',
    'startDate', 'endDate', 'gpa', 'rank', 'courses', 'schoolProvince', 'schoolCity', 'schoolDistrict'
  ])).filter(Boolean);
  if (education.length) digest.education = education;

  const workExperience = (profile?.workExperience || []).map((item) => ({
    ...(pick(item, ['company', 'department', 'position', 'workType', 'city', 'startDate', 'endDate']) || {}),
    description: String(item?.description || '').trim().slice(0, 100)
  })).filter((item) => Object.keys(item).length > 1).map((item) => ({
    ...item, description: item.description || undefined
  }));
  if (workExperience.length) digest.workExperience = workExperience;

  const projects = (profile?.projects || []).map((item) => ({
    ...(pick(item, ['name', 'role', 'projectType', 'techStack', 'startDate', 'endDate', 'projectUrl']) || {}),
    responsibilities: String(item?.responsibilities || '').trim().slice(0, 100)
  })).filter((item) => Object.keys(item).length > 1).map((item) => ({
    ...item, responsibilities: item.responsibilities || undefined
  }));
  if (projects.length) digest.projects = projects;

  const awards = (profile?.awards || []).map((item) => pick(item, ['name', 'level', 'issuer', 'date'])).filter(Boolean);
  if (awards.length) digest.awards = awards;

  const certificates = (profile?.certificates || []).map((item) =>
    typeof item === 'string' ? { name: item } : pick(item, ['name', 'code', 'issuer', 'date', 'expiryDate', 'level', 'description'])
  ).filter(Boolean);
  if (certificates.length) digest.certificates = certificates;

  const familyMembers = (profile?.familyMembers || []).map((item) =>
    pick(item, ['name', 'relation', 'employer', 'position', 'phone', 'birthDate', 'politicalStatus', 'homeAddress'])).filter(Boolean);
  if (familyMembers.length) digest.familyMembers = familyMembers;

  const languageSkills = pick(profileLanguageScores(profile), [...LEGACY_LANGUAGE_SCORES, 'otherLanguages']);
  if (languageSkills) digest.languageSkills = languageSkills;
  const languageCertificates = profileLanguageEntries(profile).map(item =>
    pick(item, Object.keys(profileSchema.languageCertificates))).filter(Boolean);
  if (languageCertificates.length) digest.languageCertificates = languageCertificates;

  const commonAnswers = {};
  for (const [key, value] of Object.entries(profile?.commonAnswers || {})) {
    const text = Array.isArray(value) ? value.filter(Boolean).join('、') : String(value ?? '').trim();
    if (text) commonAnswers[key] = text.slice(0, 120);
  }
  if (Object.keys(commonAnswers).length) digest.commonAnswers = commonAnswers;

  const jobIntention = pick(profile?.jobIntention, [
    'expectedCity', 'expectedPosition', 'expectedIndustry', 'expectedSalary', 'currentSalary', 'availableDate', 'referralCode',
    'recruitSource', 'willingToTravel', 'acceptAdjustment', 'acceptCounty',
    'salaryCurrency', 'salaryUnit', 'salaryPeriod'
  ]);
  if (jobIntention) digest.jobIntention = jobIntention;

  if (allowedSections && allowedSections.size) {
    for (const key of Object.keys(digest)) {
      if (!allowedSections.has(key)) delete digest[key];
    }
  }

  let text = JSON.stringify(digest);
  if (text.length > SMART_FILL_DIGEST_LIMIT) {
    // 超预算时按优先级从低到高丢弃区块，basicInfo/education 永不先丢
    const dropOrder = ['commonAnswers', 'awards', 'certificates', 'familyMembers', 'jobIntention', 'projects', 'workExperience', 'languageSkills'];
    for (const key of dropOrder) {
      delete digest[key];
      text = JSON.stringify(digest);
      if (text.length <= SMART_FILL_DIGEST_LIMIT) break;
    }
  }
  if (text.length > SMART_FILL_DIGEST_LIMIT) {
    // 仍超预算则逐轮压短剩余字段的字符串值（始终输出可解析的 JSON，绝不硬截断）
    for (const cap of [80, 40, 20, 10]) {
      truncateDigestStrings(digest, cap);
      text = JSON.stringify(digest);
      if (text.length <= SMART_FILL_DIGEST_LIMIT) break;
    }
  }
  if (text.length > SMART_FILL_DIGEST_LIMIT) {
    // 最后兜底：只保留 basicInfo（没有则空对象），值压到 10 字；理论不可达，仍保证合法 JSON
    const bare = digest.basicInfo ? truncateDigestStrings({ ...digest.basicInfo }, 10) : {};
    text = JSON.stringify(bare);
    if (text.length > SMART_FILL_DIGEST_LIMIT) text = '{}';
  }
  return text;
}

// 就地截断 digest 内所有超过 cap 的字符串值（digest 是全新构建的对象，可安全变更）
function truncateDigestStrings(node, cap) {
  if (Array.isArray(node)) {
    for (const item of node) truncateDigestStrings(item, cap);
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === 'string') {
        if (value.length > cap) node[key] = value.slice(0, cap);
      } else {
        truncateDigestStrings(value, cap);
      }
    }
  }
  return node;
}

// 级联组写入：按层级依次展开选择，层间等待下级选项加载，任一层失败即停止该组。
// 返回完成的层数（0 表示整组未写入）。aiSmartFill 与选区填入共用，logTag 为日志前缀。
async function fillSmartFillCascadeGroup(ref, values, allRefs, logTag, options) {
  const opts = options || {};
  const signal = opts.signal || null;
  const groupRefs = allRefs
    .filter((field) => field.cascadeGroupId === ref.cascadeGroupId)
    .sort((a, b) => a.cascadeIndex - b.cascadeIndex);
  let doneLevels = 0;
  for (let level = 0; level < groupRefs.length && level < values.length; level++) {
    await waitForFillCheckpoint(opts.task || null);
    if (signal?.aborted) break;
    // 上一级选择后，下一级可能先 disabled、再由框架异步启用并注入选项。
    const levelLive = await waitFor(() => {
      const live = resolveSmartFillField(groupRefs[level]);
      return live && !live.disabled ? live : null;
    }, { timeoutMs: opts.cascadeTimeoutMs || 2500, pollMs: 45, signal });
    if (!levelLive) {
      if (typeof appLog !== 'undefined') {
        appLog.warn('content', `${logTag}_cascade`, `级联组 ${ref.label} 第 ${level + 1} 层定位/启用超时，已完成 ${doneLevels} 层`);
      }
      break;
    }
    const levelOk = await fillSelectWidget(levelLive, values[level], {
      signal,
      openTimeoutMs: opts.openTimeoutMs || 2200
    });
    if (!levelOk) {
      if (typeof appLog !== 'undefined') {
        appLog.warn('content', `${logTag}_cascade`, `级联组 ${ref.label} 第 ${level + 1} 层写入失败，已完成 ${doneLevels} 层`, { value: String(values[level]).slice(0, 60) });
      }
      break;
    }
    levelLive.classList.add('job-autofill-ai-filled');
    doneLevels++;
  }
  return doneLevels;
}

// 处理一批 AI 返回的结果项：畸形隔离 → 快照定位 → 校验 → 写入（级联整组 / 组件下拉 / 普通控件）。
// 返回 { count, labels }；aiSmartFill 与选区填入共用，logTag 为日志前缀。
async function applySmartFillAiItems(items, batchRefs, allRefs, logTag, options) {
  const opts = options || {};
  let count = 0;
  const labels = [];
  const refByPosition = new Map(batchRefs.map((ref) => [ref.position, ref]));

  for (const rawItem of items) {
    await waitForFillCheckpoint(opts.task || null);
    // 单项异常隔离：畸形项记 warn 后跳过，绝不中断本批后续字段
    try {
      const item = normalizeSmartFillAiItem(rawItem);
      if (!item) {
        if (typeof appLog !== 'undefined') {
          appLog.warn('content', `${logTag}_item`, '忽略畸形结果项', { item: JSON.stringify(rawItem).slice(0, 120) });
        }
      } else {
        const ref = refByPosition.get(item.position);
        if (!ref) {
          if (typeof appLog !== 'undefined') appLog.warn('content', `${logTag}_item`, `结果项 position 不在本批: ${item.position}`);
        } else {
          const live = resolveSmartFillField(ref);
          if (live) {
            const check = validateSmartFillValue(ref, item.value);
            if (!check.ok) {
              if (typeof appLog !== 'undefined') {
                if (ref.cascadeGroupId) appLog.warn('content', `${logTag}_skip`, `跳过级联组: ${ref.label}`, { reason: check.reason, cascadeGroup: ref.cascadeGroupId });
                else appLog.info('content', `${logTag}_skip`, `跳过字段: ${ref.label}`, { reason: check.reason });
              }
            } else if (Array.isArray(check.value)) {
              // 级联组：value 为数组，按层级依次展开选择；层间等待下级选项加载，任一层失败即停止该组
              const doneLevels = await fillSmartFillCascadeGroup(ref, check.value, allRefs, logTag, opts);
              if (doneLevels > 0) {
                count += doneLevels;
                labels.push(`${ref.label}（级联${doneLevels}层）`);
              }
            } else {
              // 组件下拉候选强制走 fillSelectWidget（自研外壳也走点击展开匹配），禁止退化为普通文本写入
              const written = ref.kind === 'widget-select'
                ? await fillSelectWidget(live, check.value, opts)
                : await fillField(live, check.value, opts);
              if (written) {
                live.classList.add('job-autofill-ai-filled');
                count++;
                labels.push(ref.label);
              } else if (typeof appLog !== 'undefined') {
                appLog.warn('content', `${logTag}_write_miss`, `未能写入字段: ${ref.label}`, { value: String(check.value).slice(0, 100) });
              }
            }
          }
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (typeof appLog !== 'undefined') {
        appLog.error('content', `${logTag}_item_error`, '处理结果项异常，已跳过', err?.message || String(err));
      }
    }
    if (opts.signal?.aborted) break;
  }
  return { count, labels };
}
