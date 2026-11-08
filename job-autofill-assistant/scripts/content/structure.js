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
  return location.hostname === 'offerlink.tech' && /^\/myResume\/?$/i.test(location.pathname);
}

function structureSafeControl(el) {
  if (!el || !el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest(STRUCTURE_PLUGIN_SELECTOR)) return false;
  if (el.matches('input,select,textarea,[role="combobox"],[aria-haspopup="listbox"]')) return false;
  if (el.tagName === 'A' || el.tagName === 'BUTTON' && el.type !== 'button') return false;
  if (STRUCTURE_DANGEROUS_TEXT.test(`${el.textContent || ''} ${el.className || ''} ${el.id || ''}`)) return false;
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
