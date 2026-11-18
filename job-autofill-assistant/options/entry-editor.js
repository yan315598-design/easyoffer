// The visible editor lives outside the canonical lists collected by background autosave.
const ENTRY_MODULES = {
  education: { key: 'education', render: renderEducationList, read: collectEducationData, empty: emptyEducation, title: '.edu-school' },
  projects: { key: 'projects', render: renderProjectList, read: collectProjectData, empty: emptyProject, title: '.proj-name' },
  work: { key: 'workExperience', render: renderWorkList, read: collectWorkData, empty: emptyWork, title: '.work-company' }
};
ENTRY_MODULES.internship = ENTRY_MODULES.work;
const parsedEntrySections = new Set();
let entryDraft = null;
let entryWritePending = false;

function entryRow(module, id) {
  const section = document.querySelector(`#profileOverview .overview-card[data-module="${CSS.escape(module)}"]`);
  return section?.querySelector(`.experience-preview[data-entry-id="${CSS.escape(id)}"]`);
}

function entryDraftChanged() {
  if (!entryDraft) return false;
  return JSON.stringify(ENTRY_MODULES[entryDraft.module].read(entryDraft.form)[0]) !== entryDraft.initial;
}

function leaveResumeEntry() {
  if (entryWritePending) return false;
  if (!entryDraft) return true;
  if (entryDraftChanged() && !window.confirm('本条经历有未保存的修改。放弃修改并离开？')) return false;
  closeResumeEntry(false);
  return true;
}

function followEntry(row, control, previousTop) {
  if (!row || !control) return;
  control.focus({ preventScroll: true });
  const top = Math.min(Math.max(previousTop, 80), Math.max(80, innerHeight - 60));
  window.scrollBy({ top: control.getBoundingClientRect().top - top, behavior: 'instant' });
}

function closeResumeEntry(restoreFocus = true) {
  const draft = entryDraft;
  if (!draft) return;
  const previousTop = draft.form.getBoundingClientRect().top;
  entryDraft = null;
  document.body.classList.remove('editing-resume-entry');
  renderProfileOverview();
  if (!restoreFocus) return;
  const row = entryRow(draft.module, draft.id);
  if (row) followEntry(row, row.querySelector('[data-edit-entry]'), previousTop);
  else document.querySelector(`[data-add-entry="${draft.module}"]`)?.focus();
}

function mountResumeDraft() {
  if (!entryDraft) return;
  const { module, form, id, isNew, original } = entryDraft;
  const section = document.querySelector(`#profileOverview .overview-card[data-module="${module}"]`);
  if (!section) return;
  let row = entryRow(module, id);
  const placeholder = !isNew && !entryHasContent(original);
  if ((isNew || placeholder) && !row) {
    row = document.createElement('article');
    row.className = 'experience-preview';
    row.dataset.entryId = id;
    section.querySelector('.ov-empty')?.remove();
    section.querySelector('.overview-card-body').append(row);
  }
  if (!row) return;
  row.dataset.editing = '';
  row.append(form);
  const buttons = form.querySelector('.experience-order');
  if (isNew || placeholder) buttons.hidden = true;
  else {
    const summaryActions = row.querySelector(':scope > .experience-order');
    for (const button of buttons.querySelectorAll('[data-move-entry]')) {
      button.disabled = summaryActions.querySelector(`[data-move-entry="${button.dataset.moveEntry}"]`).disabled;
    }
  }
  const rows = [...section.querySelectorAll('.experience-preview')];
  form.querySelector('.item-index').textContent = String(rows.indexOf(row) + 1).padStart(2, '0');
}

function openResumeEntry(module, id) {
  if (!leaveResumeEntry()) return null;
  const config = ENTRY_MODULES[module];
  const original = id ? currentProfile?.[config.key]?.find(entry => entry.id === id) : config.empty();
  if (!original) return null;
  if (!id && module === 'internship') original.workType = '实习';
  const form = document.createElement('div');
  form.className = 'entry-draft';
  config.render([original], form);
  const card = form.querySelector('.item-card');
  card.querySelector('.item-collapse-btn').remove();
  card.querySelector('.btn-delete').remove();
  const footer = document.createElement('div');
  footer.className = 'entry-draft-actions';
  footer.innerHTML = '<button type="button" data-cancel-entry>取消</button><button type="button" data-save-entry>保存本条</button>';
  card.append(footer);
  entryDraft = { module, id: original.id, isNew: !id, original, initial: JSON.stringify(config.read(form)[0]), form };
  document.body.classList.add('editing-resume-entry');
  mountResumeDraft();
  window.YanyuDates?.refresh();
  card.scrollIntoView({ block: 'start', behavior: 'instant' });
  form.querySelector(config.title)?.focus({ preventScroll: true });
  return form;
}

// All mutations are resolved against the latest stored list in the background queue.
async function writeResumeEntry(module, mutation) {
  if (entryWritePending) return false;
  entryWritePending = true;
  const config = ENTRY_MODULES[module];
  const form = entryDraft?.form;
  if (form) form.inert = true;
  try {
    if (!await flushProfileSave()) return false;
    const result = await sendMessage({ action: 'editResumeEntry', profileId: activeProfileId, section: config.key, ...mutation });
    if (!result?.success || !Array.isArray(result.entries)) throw new Error(result?.error || '经历保存失败，请重试');
    currentProfile[config.key] = result.entries;
    config.render(result.entries);
    refreshSidebarModules();
    return true;
  } catch (error) {
    showToast(error.message, 'error');
    return false;
  } finally {
    if (form) form.inert = false;
    entryWritePending = false;
  }
}

async function commitResumeEntry() {
  const draft = entryDraft;
  if (!draft || entryWritePending) return;
  const config = ENTRY_MODULES[draft.module];
  const titleInput = draft.form.querySelector(config.title);
  if (!titleInput.value.trim()) {
    titleInput.focus();
    showToast('请填写' + titleInput.closest('.form-group').querySelector('label').textContent.replace('*', '').trim(), 'warning');
    return;
  }
  if (!window.YanyuDates.validate(draft.form)) {
    showToast(window.YanyuDates.error, 'error');
    return;
  }
  const value = config.read(draft.form)[0];
  const baseline = JSON.parse(draft.initial);
  const fields = Object.fromEntries(Object.entries(value).filter(([k,v]) => k !== 'id' && (draft.isNew || baseline[k] !== v)));
  const previous = Object.fromEntries(Object.keys(fields).map(k => [k, draft.original[k] ?? '']));
  if (!draft.isNew && !Object.keys(fields).length) { closeResumeEntry(); return; }
  if (!await writeResumeEntry(draft.module, { operation: draft.isNew ? 'add' : 'edit', entryId: draft.id, fields, previous })) return;
  // Changing the employment type may move the saved entry into the other module.
  const destination = config.key === 'workExperience' ? (isInternshipRecord(value) ? 'internship' : 'work') : draft.module;
  closeResumeEntry(destination === draft.module);
  if (workspaceModule !== 'overview' && destination !== draft.module) navigateWorkspace(destination);
  if (destination !== draft.module) entryRow(destination, draft.id)?.querySelector('[data-edit-entry]')?.focus();
  showToast('本条经历已保存', 'success');
}

async function deleteResumeEntry(module, id) {
  if (entryWritePending) return;
  const row = entryRow(module, id);
  const title = row?.querySelector('h4')?.textContent.trim();
  const ok = await showAppleConfirm({ title: '删除本条经历', subtitle: `确定删除「${title}」？`, confirmText: '删除', isDanger: true });
  if (!ok || !await writeResumeEntry(module, { operation: 'delete', entryId: id })) return;
  renderProfileOverview();
  showToast('已删除本条经历', 'success');
}

async function moveResumeEntry(module, button) {
  if (entryWritePending) return;
  const row = button.closest('.experience-preview');
  const direction = button.dataset.moveEntry;
  const adjacent = direction === 'up' ? row.previousElementSibling : row.nextElementSibling;
  if (!adjacent?.matches('.experience-preview') || (entryDraft?.isNew && adjacent.dataset.entryId === entryDraft.id)) return;
  const previousTop = button.getBoundingClientRect().top;
  const id = row.dataset.entryId;
  const expanded = [...document.querySelectorAll('#profileOverview details[open]')].map(details => {
    const owner = details.closest('.experience-preview');
    return owner && { module: owner.closest('.overview-card').dataset.module, id: owner.dataset.entryId, index: [...owner.querySelectorAll('details')].indexOf(details) };
  }).filter(Boolean);
  if (!await writeResumeEntry(module, { operation: 'move', entryId: id, neighborId: adjacent.dataset.entryId, direction })) return;
  renderProfileOverview();
  for (const item of expanded) {
    const detail = entryRow(item.module, item.id)?.querySelectorAll('details')[item.index];
    if (detail) detail.open = true;
  }
  const moved = entryRow(module, id);
  const actions = moved?.querySelector(moved.hasAttribute('data-editing') ? '.entry-draft .experience-order' : ':scope > .experience-order');
  const control = actions?.querySelector(`[data-move-entry="${direction}"]:enabled`) || actions?.querySelector('[data-move-entry]:enabled');
  followEntry(moved, control, previousTop);
  const rows = [...moved.parentElement.children].filter(node => node.matches('.experience-preview'));
  showToast(`已移至第 ${rows.indexOf(moved) + 1} / ${rows.length} 条`, 'success');
}
