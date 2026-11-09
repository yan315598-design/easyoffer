// ============================================================================
// 表单结构准备：展开明确折叠控件、按资料数准备空白条目、再次展开高级字段。
// 只操作页面结构；不保存、不提交、不删除。所有等待均有界并响应取消。
// ============================================================================

'use strict';

var STRUCTURE_EXPAND_TEXT = /展开|更多.*字段|高级.*字段|显示.*字段|additional.*fields|more.*fields/i;
var STRUCTURE_ADD_TEXT = /^添加(?:教育|实习|工作|项目|获奖|奖项|证书|家庭成员|论文|专利|语言|外语|培训|在校职务|校园)/;
var STRUCTURE_DANGEROUS_TEXT = /保存|提交|投递|确认|确定|删除|移除|清空|重置|取消|下一步|submit|save|send|delete|remove|clear|reset/i;
var STRUCTURE_PLUGIN_SELECTOR = '#job-autofill-dock,#job-autofill-region-overlay,#job-autofill-copy-panel,#job-autofill-ai-panel,#job-autofill-log-panel';
var STRUCTURE_DIALOG_SELECTOR = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"],.el-message-box';
var ENTRY_CONFIRMATION_TEXT = /逐条保存|(?:确认|保存)后.{0,24}(?:新增|添加)|(?:确认|确定).{0,8}(?:新增|添加)|(?:新增|添加).{0,12}(?:确认|确定)/;

var OFFERLINK_RESUME_SECTIONS = {
  education: ['education', 'edu'], internshipExperience: ['workExperience', 'work'],
  workExperience: ['workExperience', 'work'], projectExperience: ['projects', 'project'],
  awards: ['awards', 'award'], languageSkills: ['languageCertificates', 'language'],
  certificates: ['certificates', 'certificate'], familyMembers: ['familyMembers', 'family'],
  trainings: ['trainings', 'training'], trainingExperience: ['trainings', 'training'],
  campusPositions: ['campusPositions', 'campus'], campusLeadership: ['campusPositions', 'campus'],
  campusActivities: ['campusActivities', 'campusActivity'],
  basicInfo: [], jobIntention: []
};

function isOfferLinkResumeForm() {
  return !!document.querySelector('.form-section#basicInfo') &&
    !!document.querySelector('.form-section#education, .form-section#projectExperience, .form-section#internshipExperience');
}

var REPEAT_FORM_FIELDS = 'input:not([type=hidden]):not([type=file]):not([type=button]):not([type=submit]),textarea,select,[role="combobox"],[contenteditable="true"]';
var REPEAT_TITLE = 'h1,h2,h3,h4,h5,legend,[role="heading"],.section-title,.section-header,[class*="sectionTitle"],[class*="section-title"],[class*="module-title"]';
var REPEAT_ROW = 'tr,[data-entry-index],[data-record-id],.experience-item,.item-card,.repeat-row,.record-row,[class*="entry-row"],[class*="experience-item"],[class*="apply-fields-"]';
var REPEAT_KINDS = {
  edu: ['education', 'school', ['school','major','degree','startDate']], work: ['workExperience','company',['company','position','startDate']],
  project: ['projects','name',['name','startDate','role']], award: ['awards','name',['name','date','grade']],
  certificate: ['certificates','name',['name','code','date']], family: ['familyMembers','name',['name','relation','phone']],
  language: ['languageCertificates','language',['language','name','score']], skill: ['skills','name',['name']], paper: ['papers','name',['name','date','url']],
  patent: ['patents','name',['name','date']], campus: ['campusPositions','title',['title','organization','startDate']],
  campusActivity: ['campusActivities','name',['name','role','startDate']], training: ['trainings','name',['name','institution','startDate']]
};
var REPEAT_FIELD_KEYS = {
  education: { school:'school', major:'major', degree:'degree', college:'college', gpa:'gpa', rank:'rank', courses:'courses', eduStartDate:'startDate', eduEndDate:'endDate', eduDateRange:'__range', educationDescription:'description' },
  workExperience: { company:'company', position:'position', department:'department', workType:'workType', workCity:'city', workDescription:'description', workAchievements:'achievements', workStartDate:'startDate', workEndDate:'endDate', workDateRange:'__range' },
  projects: { projectName:'name', projectRole:'role', projectStartDate:'startDate', projectEndDate:'endDate', projectDateRange:'__range', projectDescription:'description', projectResponsibilities:'responsibilities', projectAchievements:'achievements', projectUrl:'projectUrl', techStack:'techStack' },
  certificates: { certificates:'name', certificateCode:'code', certificateIssuer:'issuer', certificateDate:'date', certificateExpiryDate:'expiryDate' },
  familyMembers: { familyName:'name', familyRelation:'relation', familyEmployer:'employer', familyPosition:'position', familyPhone:'phone', familyAge:'age', familyOccupation:'occupation' },
  papers: { paperName:'name', paperPublisher:'publisher', paperDate:'date', paperAuthorOrder:'authorOrder', paperRole:'role', paperAbstract:'abstract', paperUrl:'url' },
  patents: { patentName:'name', patentInventor:'inventor', patentDate:'date', patentDescription:'description', patentUrl:'url' },
  skills: { skillName:'name', skillProficiency:'proficiency', duoyiSkill:'name', duoyiSkillProficiency:'proficiency' }
};

function repeatFieldKey(section, type) {
  const prefix = `extended:${section}:`;
  return type?.startsWith(prefix) ? type.slice(prefix.length) : REPEAT_FIELD_KEYS[section]?.[type];
}

function repeatFieldValue(entry, key) {
  if (!entry) return '';
  if (key === '__range') return [entry.startDate, entry.endDate].filter(Boolean).join(' 至 ');
  if (key === '__combined') return [entry.responsibilities || entry.description, entry.achievements].filter(Boolean).join('\n');
  return entry[key];
}

function formRepeatFields(root) {
  return [...new Set([...root.querySelectorAll(REPEAT_FORM_FIELDS)].map(writableBox))].filter(input => input && isElementTrulyVisible(input) && !isIgnoredInput(input));
}

function repeatModule(root, title) {
  const label = String(title || root.getAttribute('aria-label') || '').trim();
  const key = root.getAttribute('data-profile-section');
  const kind = Object.keys(REPEAT_KINDS).find(kind => REPEAT_KINDS[kind][0] === key) || classifySectionTitle(label);
  const definition = REPEAT_KINDS[kind];
  return definition && { root, label, kind, section: definition[0], anchor: definition[1], identity: definition[2] };
}

function repeatModules(page = document) {
  const modules = new Map();
  for (const root of page.querySelectorAll('[data-profile-section]')) {
    const module = repeatModule(root, root.querySelector(REPEAT_TITLE)?.textContent);
    if (module) modules.set(root, module);
  }
  for (const title of page.querySelectorAll(REPEAT_TITLE)) {
    const kind = classifySectionTitle(title.textContent);
    if (!REPEAT_KINDS[kind]) continue;
    let root = title.parentElement;
    for (let depth = 0; root && depth < 4 && !root.matches('main,form,body,html'); depth++, root = root.parentElement) {
      if ([...root.querySelectorAll(REPEAT_TITLE)].some(other => other !== title && !title.contains(other) &&
          !other.contains(title) && REPEAT_KINDS[classifySectionTitle(other.textContent)])) break;
      const module = repeatModule(root, title.textContent);
      if (!root.querySelector(REPEAT_FORM_FIELDS) && !repeatAddControl(module, [])) continue;
      if (!modules.has(root)) modules.set(root, module);
      break;
    }
  }
  return [...modules.values()].filter(module => ![...modules.keys()].some(root => root !== module.root && root.contains(module.root)));
}

function repeatRows(module, detected) {
  const fields = (detected || formRepeatFields(module.root).map(input => ({ input, detection: detectField(input) })))
    .filter(({ input, detection }) => detection && module.root.contains(input))
    .map(item => ({ ...item, key: repeatFieldKey(module.section, item.detection.fieldType) }));
  const anchors = fields.filter(field => field.key === module.anchor);
  const rows = [];
  for (const anchor of anchors) {
    let root = anchor.input.closest(REPEAT_ROW);
    if (!root || root === module.root || !module.root.contains(root) || anchors.filter(item => root.contains(item.input)).length !== 1) {
      root = anchor.input.parentElement;
      while (root?.parentElement && root.parentElement !== module.root &&
        anchors.filter(item => root.parentElement.contains(item.input)).length === 1) root = root.parentElement;
      if (anchors.length === 1 && fields.some(item => !root?.contains(item.input))) root = module.root;
    }
    if (root) rows.push({ root, anchor: anchor.input, fields: fields.filter(item => root.contains(item.input)) });
  }
  return { rows, fields };
}

function repeatProfileEntries(module, profile) {
  let entries = module.section === 'skills' ? profileSkillEntries(profile) : module.section === 'languageCertificates'
    ? profileLanguageEntries(profile) : profile[module.section] || [];
  if (module.section === 'workExperience') {
    if (/实习|intern/i.test(module.label)) entries = entries.filter(isInternshipRecord);
    else if (/工作经历|工作经验|employment/i.test(module.label)) entries = entries.filter(item => !isInternshipRecord(item));
  }
  if (module.section === 'awards') {
    if (/竞赛|competition/i.test(module.label)) entries = entries.filter(item => awardCategory(item) === 'competition');
    if (/奖学金|scholarship/i.test(module.label)) entries = entries.filter(item => awardCategory(item) === 'scholarship');
    if (/其他荣誉|other honors/i.test(module.label)) entries = entries.filter(item => awardCategory(item) !== 'competition');
  }
  return entries.map(item => typeof item === 'string' ? { name: item } : item).filter(item => item && String(item[module.anchor] || '').trim());
}

function awardCategory(item) {
  const category = String(item?.category || '').trim();
  const text = category || String(item?.name || '');
  if (/竞赛|大赛|比赛|competition|contest/i.test(text)) return 'competition';
  if (/奖学金|scholarship/i.test(text)) return 'scholarship';
  return 'other';
}

function compactCompetitionName(value) {
  return String(value || '').trim()
    .replace(/^\d{4}年\s*/, '')
    .replace(/^第[零〇一二两三四五六七八九十百\d]+届\s*/, '')
    .replace(/\s*[（(]\s*(?:保底)?(?:国家级?|省级?|市级?|校级?|全国)?(?:特等|[一二三四五]等|金|银|铜|优秀|优胜)奖\s*[）)]\s*$/, '')
    .replace(/\s*(?:国家级?|省级?|市级?|校级?|全国)?(?:特等|[一二三四五]等|金|银|铜|优秀|优胜)奖\s*$/, '')
    .trim();
}

function repeatLanguageEntries(fields, entries) {
  if (fields.some(field => ['name', 'level', 'score', 'obtainedDate'].includes(field.key))) return entries;
  const languages = new Map();
  for (const entry of entries) {
    const key = String(entry.language).trim().toLowerCase();
    const group = languages.get(key) || [];
    group.push(entry);
    languages.set(key, group);
  }
  return [...languages.values()].map(group => {
    if (group.length === 1) return group[0];
    const result = { language: group[0].language };
    for (const key of ['proficiency', 'listeningSpeaking', 'readingWriting']) {
      const values = [...new Set(group.map(item => item[key]).filter(Boolean))];
      if (values.length === 1) result[key] = values[0];
    }
    return result;
  });
}

function repeatControlValue(input) {
  if (input.tagName === 'SELECT') return input.value ? input.selectedOptions?.[0]?.text || input.value : '';
  if (isWidgetSelectTrigger(input)) return widgetSelectCurrentValue(input);
  if (input.type === 'radio' || input.type === 'checkbox') return input.checked ? choiceCaption(input) : '';
  return String(input.value || input.textContent || '').trim();
}

function repeatIdentityMatches(module, row, entries, minimumKeys = 1) {
  const identity = row.fields.filter(({input,key}) => module.identity.includes(key) && fieldHasValue(input))
    .map(({input,key}) => ({ input, key, actual: repeatControlValue(input) })).filter(field => field.actual);
  if (new Set(identity.map(field => field.key)).size < minimumKeys) return [];
  return entries.filter(entry => identity.every(({input,key,actual}) => {
    const expected = repeatFieldValue(entry, key);
    if (['startDate', 'endDate', 'date'].includes(key)) {
      const shown = elementDateParts(actual);
      const source = elementDateParts(expected);
      if (shown && source) return shown[0] === source[0] && shown[1] === source[1] && (!shown[2] || shown[2] === source[2]);
    }
    if (key === 'name' && /竞赛|competition/i.test(module.label) && module.section === 'awards' &&
        optionTextEquals(actual, compactCompetitionName(expected))) return true;
    return fieldOptionEquals(getClosestLabelText(input), actual, expected);
  }));
}

function matchRepeatRows(module, rows, entries) {
  const assignments = new Map();
  const used = new Set();
  const blanks = [];
  for (const row of rows) {
    const populated = row.fields.filter(field => fieldHasValue(field.input));
    if (!populated.length) { blanks.push(row); continue; }
    const matches = repeatIdentityMatches(module, row, entries);
    if (matches.length === 1 && !used.has(matches[0])) { assignments.set(row, matches[0]); used.add(matches[0]); }
  }
  const remaining = entries.filter(entry => !used.has(entry));
  for (const row of blanks) assignments.set(row, remaining.shift());
  return { assignments, remaining, ambiguous: rows.some(row => !assignments.has(row) && !blanks.includes(row)) };
}

function repeatAddControl(module, rows) {
  const options = [...module.root.querySelectorAll('button,[role="button"],[class*="add"]')]
    .filter(el => structureSafeControl(el) && /^(?:[+＋]\s*)?(?:添加|新增|add)(?:\s*(?:一条|一项|记录|条目|教育经历|实习经历|工作经历|项目经历|获奖|奖项|竞赛(?:获奖|奖励)?|证书|技能|外语|语言|家庭成员|论文|专利|培训))?$/i.test(el.textContent.trim()));
  const outer = options.filter(el => !options.some(other => other !== el && other.contains(el)));
  if (outer.length === 1) return outer[0];
  const last = rows.at(-1)?.root;
  return last && outer.filter(el => last.contains(el)).length === 1 && outer.every(el => rows.some(row => row.root.contains(el)))
    ? outer.find(el => last.contains(el)) : null;
}

async function* repeatFillFields(profile, detected, options) {
  const bindings = new WeakMap();
  const plans = [];
  const emitted = new WeakSet(detected.map(field => field.input));
  for (const module of repeatModules()) {
    // Keep the explicit field and collapse metadata of this older form layout.
    if (options.explicitCards && module.root.closest('.form-section[id]')) continue;
    const { rows, fields } = repeatRows(module, detected);
    const source = repeatProfileEntries(module, profile);
    const entries = module.section === 'languageCertificates' ? repeatLanguageEntries(fields, source) : source;
    const { assignments, remaining, ambiguous } = matchRepeatRows(module, rows, entries);
    for (const field of fields) bindings.set(field.input, {});
    for (const row of rows) {
      for (const field of row.fields) bindings.set(field.input, { entry: assignments.get(row), key: field.key, module, row });
    }
    if (rows.length || remaining.length) plans.push({ module, rows, assignments, remaining, ambiguous, entries });
  }
  for (const field of detected) yield { ...field, binding: bindings.get(field.input) };
  async function* followRow(module, anchor, entry) {
    for (let pass = 0; pass < 3; pass++) {
      const row = repeatRows(module).rows.find(candidate => candidate.anchor === anchor);
      const fields = row?.fields.filter(field => !emitted.has(field.input));
      if (!fields?.length) return;
      for (const field of fields) {
        emitted.add(field.input);
        yield { ...field, binding: { entry, key: field.key, module, row } };
      }
    }
  }
  for (const { module, rows, assignments, remaining, ambiguous, entries } of plans) {
    for (const [row, entry] of assignments) if (entry) yield* followRow(module, row.anchor, entry);
    if (!options.addRows || !remaining.length) continue;
    if (ambiguous || !rows.length && !repeatAddControl(module, rows)) {
      options.manual.push(`${module.label || module.section}：无法确认现有条目，请先在网页核对。`);
      continue;
    }
    let latest = rows;
    for (const entry of remaining) {
      await waitForFillCheckpoint(options.task);
      const confirmed = await Promise.all(latest.map(async row => {
        if (await options.verifyAnchor(row.anchor)) return true;
        if (!row.anchor.isConnected || fieldHasValue(row.anchor)) return false;
        // A lookup can be unavailable while other independently identifying fields are committed.
        const matches = repeatIdentityMatches(module, row, entries, 2);
        return matches.length === 1 && matches[0] === assignments.get(row);
      }));
      if (confirmed.some(value => !value)) {
        options.manual.push(`${module.label || module.section}：上一条记录未确认填写，剩余条目待补。`);
        break;
      }
      const row = await appendRepeatRow(module, options);
      if (!row) {
        options.manual.push(`${module.label || module.section}：网页未生成可确认的新条目，请手动检查。`);
        // A confirmation dialog may block every following section.
        if ([...document.querySelectorAll(STRUCTURE_DIALOG_SELECTOR)].some(isElementTrulyVisible)) return;
        break;
      }
      options.onAdded();
      assignments.set(row, entry);
      yield* followRow(module, row.anchor, entry);
      latest = [row];
    }
  }
}

async function appendRepeatRow(module, options) {
  const before = repeatRows(module).rows;
  const button = repeatAddControl(module, before);
  const previous = new Set(before.map(row => row.anchor));
  const visibleDialog = () => [...document.querySelectorAll(STRUCTURE_DIALOG_SELECTOR)].some(isElementTrulyVisible);
  if (!button || visibleDialog() || !await clickFillControl(button, options)) return null;
  const result = await waitFor(() => {
    if (visibleDialog()) return { dialog: true };
    if (!module.root.isConnected) return { detached: true };
    const rows = repeatRows(module).rows;
    const added = rows.filter(row => !previous.has(row.anchor));
    if (rows.length === before.length + 1 && added.length === 1 && !added[0].fields.some(field => fieldHasValue(field.input))) return { row: added[0] };
    return null;
  }, { timeoutMs: 1200, signal: options.signal, task: options.task, observe: module.root });
  return result?.row || null;
}

function structureSafeControl(el) {
  if (!el || !el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest(STRUCTURE_PLUGIN_SELECTOR)) return false;
  if (el.matches('input,select,textarea,[role="combobox"],[aria-haspopup="listbox"]')) return false;
  if (el.tagName === 'A' || el.tagName === 'BUTTON' && el.type !== 'button') return false;
  if (STRUCTURE_DANGEROUS_TEXT.test(`${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.className || ''} ${el.id || ''}`)) return false;
  return isElementTrulyVisible(el);
}

function structureVisibleFieldCount(root) {
  if (!root) return 0;
  return [...root.querySelectorAll('input,textarea,select,[role="combobox"],[contenteditable="true"]')]
    .filter(el => !isIgnoredInput(el) && isElementTrulyVisible(el)).length;
}

function structureControlledVisible(el) {
  const id = el.getAttribute('aria-controls') || el.getAttribute('data-target') || '';
  const controlled = id ? document.getElementById(id) : null;
  if (controlled && !controlled.hidden && isElementTrulyVisible(controlled)) return true;
  if (el.getAttribute('aria-expanded') === 'false') return false;
  // 某些组件不更新 aria-expanded；下一兄弟区域已可见时也视为已展开。
  const next = el.nextElementSibling;
  return !!(next && !next.matches('button,[hidden]') && isElementTrulyVisible(next));
}

async function expandStructureControl(el, signal, task) {
  if (!structureSafeControl(el)) return false;
  const section = el.closest('.form-section,details,[data-profile-section],.section,.sub-card') || el.parentElement;
  const tracksExpanded = el.hasAttribute('aria-expanded');
  const before = tracksExpanded ? 0 : structureVisibleFieldCount(section);
  const wasCollapsed = !!section?.classList.contains('is-collapsed');
  const wasExpanded = el.getAttribute('aria-expanded') === 'true' || el.closest('details')?.open;
  if (wasExpanded || structureControlledVisible(el)) return false;
  if (el.matches('.section-header') && !wasCollapsed && before > 0) return false;
  await waitForFillCheckpoint(task);
  el.click();
  return waitFor(() => {
    if (!el.isConnected) return true;
    if (el.getAttribute('aria-expanded') === 'true' || el.closest('details')?.open) return true;
    if (wasCollapsed && section && !section.classList.contains('is-collapsed')) return true;
    return !tracksExpanded && structureVisibleFieldCount(section) > before;
  }, { timeoutMs: 700, pollMs: 35, signal, task, observe: section }).then(Boolean).catch(() => false);
}

async function expandFormSections(options) {
  const opts = options || {};
  const signal = opts.signal;
  let clicks = 0;
  const seen = opts.seen || new WeakSet();
  const deadline = Date.now() + 3500;

  for (let round = 0; round < 2 && Date.now() < deadline; round++) {
    const controls = [];
    document.querySelectorAll('details:not([open]) > summary,.more-fields-toggle[aria-expanded="false"],button[aria-expanded="false"][aria-controls]')
      .forEach(el => {
        if (el.matches('button[aria-controls]') && !STRUCTURE_EXPAND_TEXT.test(el.textContent || '')) return;
        if (!seen.has(el)) controls.push(el);
      });

    if (isOfferLinkResumeForm()) {
      document.querySelectorAll('.form-section.is-collapsed > .section-header').forEach(el => {
        if (el.closest('#resume-parse,#module-management')) return;
        if (!seen.has(el)) controls.push(el);
      });
    }

    let changed = false;
    for (const el of controls) {
      if (signal?.aborted || Date.now() >= deadline) return { clicks, cancelled: !!signal?.aborted };
      seen.add(el);
      if (await expandStructureControl(el, signal, opts.task)) {
        clicks++;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { clicks, cancelled: !!signal?.aborted };
}

function offerLinkWorkEntries(profile, sectionId) {
  const entries = validExtendedEntries(profile, 'workExperience');
  const isInternship = item => /实习|\bintern(?:ship)?\b/i.test(item.workType || item.position || '');
  if (sectionId === 'internshipExperience') return entries.filter(isInternship);
  if (sectionId === 'workExperience') return entries.filter(item => !isInternship(item));
  return entries;
}

function offerLinkSectionEntries(profile, sectionKey, sectionId) {
  if (sectionKey === 'workExperience') return offerLinkWorkEntries(profile, sectionId);
  const entries = validExtendedEntries(profile, sectionKey);
  if (sectionKey !== 'languageCertificates') return entries;
  return entries.filter(item => item.language ? /^(英语|english)$/i.test(item.language) : Boolean(languageEntryExam(item)));
}

function offerLinkEntryPlan(profile, section) {
  const sectionId = section.id;
  const sectionKey = OFFERLINK_RESUME_SECTIONS[sectionId]?.[0];
  if (!sectionKey) return null;
  const items = [...section.querySelectorAll('.experience-item')];
  const entries = offerLinkSectionEntries(profile, sectionKey, sectionId);
  const button = [...section.querySelectorAll('button.add-btn[type="button"]')]
    .find(el => STRUCTURE_ADD_TEXT.test((el.textContent || '').trim()) && structureSafeControl(el));
  if (!button || !entries.length) return null;
  return { section, sectionKey, items, entries, button };
}

async function addOfferLinkEntry(plan, signal, task) {
  await waitForFillCheckpoint(task);
  if (!structureSafeControl(plan.button)) return false;
  const before = plan.section.querySelectorAll('.experience-item').length;
  const openDialogs = new Set([...document.querySelectorAll(STRUCTURE_DIALOG_SELECTOR)].filter(isElementTrulyVisible));
  plan.button.click();
  const outcome = await waitFor(() => {
    const items = plan.section.querySelectorAll('.experience-item');
    if (items.length > before && structureVisibleFieldCount(items[items.length - 1]) > 0) return 'added';
    const confirmation = [...document.querySelectorAll(STRUCTURE_DIALOG_SELECTOR)].some(dialog =>
      !openDialogs.has(dialog) && !dialog.closest(STRUCTURE_PLUGIN_SELECTOR) &&
      isElementTrulyVisible(dialog) && ENTRY_CONFIRMATION_TEXT.test(dialog.textContent || ''));
    return confirmation ? 'confirmation' : null;
  }, { timeoutMs: 1100, pollMs: 35, signal, task, observe: plan.section });
  return outcome === 'added';
}

async function prepareOfferLinkEntries(profile, options) {
  const opts = options || {};
  const signal = opts.signal;
  const result = { added: 0, manual: [], failed: 0 };
  const plans = [...document.querySelectorAll('.form-section[id]')].map(section => offerLinkEntryPlan(profile, section)).filter(Boolean);

  for (const plan of plans) {
    const target = plan.entries.length;
    let current = plan.section.querySelectorAll('.experience-item').length;
    const missing = Math.max(0, target - current);
    for (let index = 0; index < missing; index++) {
      if (signal?.aborted) return { ...result, cancelled: true };
      const live = offerLinkEntryPlan(profile, plan.section);
      current = live?.section.querySelectorAll('.experience-item').length || 0;
      if (!live || current >= target) break;
      const added = await addOfferLinkEntry(live, signal, opts.task);
      if (!added) {
        result.failed++;
        const title = live.section.querySelector('.section-title')?.textContent.trim() || live.sectionKey;
        result.manual.push(`${title}（${live.sectionKey}）新增受限。先核对已填入的现有条目，按页面要求确认后再一键填入`);
        break;
      }
      result.added++;
    }
  }
  return result;
}

async function expandOfferLinkCards(options) {
  let count = 0;
  const cards = document.querySelectorAll('.form-section[id] .experience-item.is-collapsed-item');
  for (const card of cards) {
    const section = card.closest('.form-section[id]');
    if (!OFFERLINK_RESUME_SECTIONS[section?.id]?.length) continue;
    const toggle = card.querySelector(':scope > .experience-item-header button.collapse-btn[type="button"]');
    if (!structureSafeControl(toggle) || !card.classList.contains('is-collapsed-item')) continue;
    await waitForFillCheckpoint(options.task);
    toggle.click();
    const opened = await waitFor(() => !card.classList.contains('is-collapsed-item'), {
      timeoutMs: 400, signal: options.signal, task: options.task, observe: card
    });
    if (opened) count++;
  }
  return count;
}

async function prepareFormStructure(profile, options) {
  const opts = options || {};
  const signal = opts.signal;
  const started = Date.now();
  const seen = new WeakSet();
  const expandStarted = Date.now();
  const expanded = await expandFormSections({ signal, seen, task: opts.task });
  let expandMs = Date.now() - expandStarted;
  let entries = { added: 0, manual: [], failed: 0 };
  const addStarted = Date.now();
  if (opts.mode !== 'incremental' && isOfferLinkResumeForm()) {
    entries = await prepareOfferLinkEntries(profile, { signal, task: opts.task });
  }
  const addMs = Date.now() - addStarted;
  const itemExpandStarted = Date.now();
  const expandedCards = isOfferLinkResumeForm() && !signal?.aborted ? await expandOfferLinkCards(opts) : 0;
  const expandedItems = await expandFormSections({ signal, seen, task: opts.task });
  expandMs += Date.now() - itemExpandStarted;
  const result = {
    expanded: expanded.clicks + expandedCards + expandedItems.clicks,
    added: entries.added,
    manual: entries.manual,
    failed: entries.failed,
    cancelled: !!(expanded.cancelled || expandedItems.cancelled || entries.cancelled),
    expandMs,
    addMs,
    totalMs: Date.now() - started
  };
  return result;
}
