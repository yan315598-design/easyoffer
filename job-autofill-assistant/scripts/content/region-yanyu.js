// yanyu 选区填入增强：Pointer Events、多区域、二级资料菜单与更多简历模块。
// 在 region.js 之后加载，保留原规则匹配、AI 兜底和测试钩子。

'use strict';

REGION_CATEGORY_META = [
  { key: 'basicInfo', name: '基本信息', single: true },
  { key: 'jobIntention', name: '求职意向', single: true },
  { key: 'languageCertificates', name: '外语能力' },
  { key: 'education', name: '教育经历' },
  { key: 'workExperience', name: '实习与工作经历' },
  { key: 'projects', name: '项目经历' },
  { key: 'campusPositions', name: '在校职务' },
  { key: 'trainings', name: '培训经历' },
  { key: 'awards', name: '奖项荣誉' },
  { key: 'certificates', name: '资格证书' },
  { key: 'familyMembers', name: '家庭成员' },
  { key: 'papers', name: '论文' },
  { key: 'patents', name: '专利' },
  { key: 'openSource', name: '开源成果' },
  { key: 'skills', name: '技能清单', single: true },
  { key: 'introTemplates', name: '自我介绍' },
  { key: 'commonAnswers', name: '常用问答', single: true },
  { key: 'customAnswers', name: '额外问题与答案' }
];

var yanyuLegacyRegionFieldize = globalThis.__yanyuLegacyRegionFieldize;
var yanyuLegacyRegionSummary = globalThis.__yanyuLegacyRegionSummary;

function yanyuRegionEscapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function yanyuRegionLabel(category, key) {
  try {
    const label = resolveFieldLabel(category, key);
    if (label && label !== key) return label;
  } catch {}
  const labels = {
    name: '名称', company: '公司', position: '职位', role: '角色', description: '描述', achievements: '成果',
    startDate: '开始时间', endDate: '结束时间', url: '链接', projectUrl: '项目链接', date: '日期', code: '证书编号',
    issuer: '颁发机构', expiryDate: '有效期至', publisher: '期刊/会议或出版社', abstract: '摘要', inventor: '专利人',
    stars: 'Stars 数', content: '自我介绍', skills: '专业技能', answer: '答案', question: '问题'
  };
  return labels[key] || key;
}

function yanyuGenericRegionFields(category, entry) {
  if (!entry || typeof entry !== 'object') return [];
  if (category === 'customAnswers') {
    return String(entry.answer || '').trim() ? [{
      key: 'answer', label: entry.question || '答案', value: String(entry.answer).trim(),
      pattern: new RegExp(yanyuRegionEscapeRegExp(entry.question || '答案'), 'i')
    }] : [];
  }
  if (category === 'introTemplates') {
    return String(entry.content || '').trim() ? [{
      key: 'content', label: entry.name || '自我介绍', value: String(entry.content).trim(),
      pattern: /自我介绍|个人简介|自我评价|个人评价|introduction|self.*introduction/i
    }] : [];
  }
  if (category === 'skills') {
    const value = Array.isArray(entry.skills) ? entry.skills.filter(Boolean).join('，') : String(entry.skills || '').trim();
    return value ? [{ key: 'skills', label: '专业技能', value, pattern: /专业技能|技能特长|个人技能|技能|skills/i }] : [];
  }

  const fields = [];
  const ignored = new Set(['id', 'createdAt', 'updatedAt', 'preferred']);
  for (const [key, raw] of Object.entries(entry)) {
    if (ignored.has(key) || raw === null || raw === undefined || typeof raw === 'object' && !Array.isArray(raw)) continue;
    const value = Array.isArray(raw) ? raw.filter(item => ['string', 'number'].includes(typeof item)).join('，') : String(raw).trim();
    if (!value) continue;
    const label = yanyuRegionLabel(category, key);
    const languagePattern = category === 'languageCertificates' && {
      language: /^(语种|外语种类|外语语种)$/,
      name: /考试名称|证书名称|技能名称/,
      obtainedDate: /获得时间|取得日期|证书获取时间/
    }[key];
    const pattern = languagePattern || REGION_COMMON_FIELD_PATTERNS[key] || new RegExp(yanyuRegionEscapeRegExp(label), 'i');
    fields.push({ key, label, value, pattern });
  }
  if (entry.startDate || entry.endDate) {
    fields.push({
      key: 'dateRange', label: '起止时间', value: [entry.startDate, entry.endDate].filter(Boolean).join(' 至 '),
      startDate: String(entry.startDate || ''), endDate: String(entry.endDate || ''), pattern: null
    });
  }
  return fields;
}

function regionFieldizeEntry(category, entry) {
  const hasLegacyDefs = category === 'basicInfo' || !!REGION_ENTRY_FIELD_DEFS[category];
  if (hasLegacyDefs) {
    const legacyFields = yanyuLegacyRegionFieldize(category, entry);
    const seen = new Set(legacyFields.map(field => field.key));
    // 保留经过人工调校的规则优先级，同时让后续新增字段进入同一选区链路。
    const additional = yanyuGenericRegionFields(category, entry).filter(field =>
      !seen.has(field.key) && !(seen.has('dateRange') && ['startDate', 'endDate'].includes(field.key)));
    return legacyFields.concat(additional);
  }
  return yanyuGenericRegionFields(category, entry);
}

function regionCategoryEntries(profile, category) {
  if (!profile) return [];
  if (category === 'languageCertificates') return profileLanguageEntries(profile);
  if (['basicInfo', 'jobIntention', 'languageSkills', 'commonAnswers'].includes(category)) {
    const value = category === 'languageSkills' ? profileLanguageScores(profile) : profile[category];
    return value && typeof value === 'object' && !Array.isArray(value) ? [value] : [];
  }
  if (category === 'skills') {
    const skills = Array.isArray(profile.skills) ? profileSkillEntries(profile).map(item => item.name) : (profile.skills?.skills || '');
    return (Array.isArray(skills) ? skills.length : String(skills || '').trim()) ? [{ skills }] : [];
  }
  if (category === 'introTemplates') {
    const entries = [];
    if (profile.introTemplates?.default) entries.push({ name: '默认自我介绍', content: profile.introTemplates.default });
    (profile.introTemplates?.custom || []).forEach((item, index) => {
      const content = typeof item === 'string' ? item : item?.content || item?.text;
      if (content) entries.push({ name: item?.name || `自我介绍 ${index + 1}`, content });
    });
    return entries;
  }
  const list = profile[category];
  return Array.isArray(list) ? list : [];
}

function regionEntrySummary(category, entry) {
  if (category === 'customAnswers') return String(entry.question || entry.answer || '');
  if (category === 'introTemplates') return String(entry.name || '自我介绍');
  if (category === 'skills') return Array.isArray(entry.skills) ? entry.skills.slice(0, 4).join('·') : String(entry.skills || '');
  if (category === 'basicInfo') return yanyuLegacyRegionSummary(category, entry);
  if (['jobIntention', 'languageSkills', 'commonAnswers'].includes(category)) {
    const first = yanyuGenericRegionFields(category, entry)[0];
    return first ? `${REGION_CATEGORY_META.find(item => item.key === category)?.name || ''}：${first.value}` : '';
  }
  return yanyuLegacyRegionSummary(category, entry) || yanyuGenericRegionFields(category, entry)[0]?.value || '';
}

function yanyuRegionRefKey(el, nameOrdinal, position) {
  return `${smartFillFieldSignature(el)}|${nameOrdinal}|${position}`;
}

function collectYanyuRegionFields(regions) {
  const nameOrdinals = new Map();
  const refs = [];
  const skipped = new Set();
  const noClue = new Set();
  listSmartFillFields().forEach((el, position) => {
    const name = el.getAttribute('name') || '';
    const nameKey = `${el.tagName}|${name}`;
    const nameOrdinal = nameOrdinals.get(nameKey) || 0;
    nameOrdinals.set(nameKey, nameOrdinal + 1);
    const rect = el.getBoundingClientRect();
    if (!regions.some(region => regionControlOverlapRatio(rect, region) > REGION_OVERLAP_RATIO)) return;
    const key = yanyuRegionRefKey(el, nameOrdinal, position);
    if (fieldHasValue(el)) { skipped.add(key); return; }
    const widget = el.tagName !== 'SELECT' && isWidgetSelectTrigger(el);
    if (widget && widgetSelectCurrentValue(el)) { skipped.add(key); return; }
    if (widget && !['INPUT', 'TEXTAREA'].includes(el.tagName)) {
      const inner = writableBox(el);
      if (inner && inner !== el && !isSmartFillWritableInnerInput(inner)) return;
    }
    const placeholder = el.placeholder || el.getAttribute('placeholder') || '';
    const domLabel = getClosestLabelText(el);
    if (!domLabel && !placeholder && !name) { noClue.add(key); return; }
    const ref = {
      el, signature: smartFillFieldSignature(el), id: el.id || '', name, nameOrdinal, position,
      tagName: el.tagName, type: (el.getAttribute('type') || '').toLowerCase(), domLabel,
      label: domLabel || placeholder, placeholder,
      maxLength: parseInt(el.getAttribute('maxlength') || '0', 10), options: smartFillSelectOptions(el)
    };
    if (widget) ref.kind = 'widget-select';
    refs.push(ref);
  });
  tagSmartFillFieldGroups(refs);
  return { refs, skippedHasValue: skipped.size, skippedNoClue: noClue.size };
}

function exitRegionFillMode() {
  const state = regionFillState;
  regionFillState = null;
  if (state) {
    if (state.urlTimer) clearTimeout(state.urlTimer);
    document.removeEventListener('keydown', state.onKeyDown, true);
    if (state.onWindowMouseUp) window.removeEventListener('mouseup', state.onWindowMouseUp);
    if (state.onWindowPointerUp) window.removeEventListener('pointerup', state.onWindowPointerUp);
    if (state.onWindowPointerCancel) window.removeEventListener('pointercancel', state.onWindowPointerCancel);
    if (state.root?.parentElement) state.root.parentElement.removeChild(state.root);
    if (state.panel?.parentElement) state.panel.parentElement.removeChild(state.panel);
  }
  // 只恢复普通 Dock / 清空资料选择视图，不删除同一个 dock host。
  if (typeof yanyuRestoreDockView === 'function') yanyuRestoreDockView();
  else yanyuDockState.host?.removeAttribute('data-region-active');
}

function enterRegionSelectMode(profile) {
  if (regionFillState) exitRegionFillMode();
  yanyuDockState.host?.removeAttribute('data-dock-view');
  yanyuDockState.host?.setAttribute('data-region-active', 'true');
  const root = document.createElement('div');
  root.id = REGION_OVERLAY_ID;
  root.setAttribute('data-theme', regionOverlayTheme());
  root.style.touchAction = 'none';
  const mk = cls => {
    const node = document.createElement('div');
    node.className = cls;
    return node;
  };
  const shadeTop = mk('job-autofill-region-shade');
  const shadeLeft = mk('job-autofill-region-shade');
  const shadeRight = mk('job-autofill-region-shade');
  const shadeBottom = mk('job-autofill-region-shade');
  const crossH = mk('job-autofill-region-cross-h');
  const crossV = mk('job-autofill-region-cross-v');
  const hint = mk('job-autofill-region-hint');
  const rectBox = mk('job-autofill-region-rect');
  const sizeBadge = mk('job-autofill-region-size');
  const savedLayer = mk('job-autofill-region-saved-layer');
  hint.textContent = '左键拖框；Ctrl/Command 拖框可追加模块；右键取消当前框；Esc 退出';
  [shadeTop, shadeLeft, shadeRight, shadeBottom, savedLayer, crossH, crossV, rectBox, hint, sizeBadge].forEach(node => root.appendChild(node));
  document.body.appendChild(root);

  const viewW = () => window.innerWidth || document.documentElement.clientWidth || 0;
  const viewH = () => window.innerHeight || document.documentElement.clientHeight || 0;
  const setBlock = (node, left, top, width, height) => {
    node.style.left = `${left}px`; node.style.top = `${top}px`;
    node.style.width = `${Math.max(0, width)}px`; node.style.height = `${Math.max(0, height)}px`;
  };
  const shadeFull = () => {
    setBlock(shadeTop, 0, 0, viewW(), viewH());
    setBlock(shadeLeft, 0, 0, 0, 0); setBlock(shadeRight, 0, 0, 0, 0); setBlock(shadeBottom, 0, 0, 0, 0);
  };
  const applyShades = rect => {
    setBlock(shadeTop, 0, 0, viewW(), rect.top);
    setBlock(shadeLeft, 0, rect.top, rect.left, rect.height);
    setBlock(shadeRight, rect.right, rect.top, viewW() - rect.right, rect.height);
    setBlock(shadeBottom, 0, rect.bottom, viewW(), viewH() - rect.bottom);
  };
  const normalized = (start, event) => {
    const left = Math.min(start.x, event.clientX), top = Math.min(start.y, event.clientY);
    const right = Math.max(start.x, event.clientX), bottom = Math.max(start.y, event.clientY);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  let dragStart = null;
  let activePointerId = null;
  const regions = [];
  const resetDrag = () => {
    dragStart = null; activePointerId = null;
    rectBox.style.display = 'none'; sizeBadge.style.display = 'none'; shadeFull();
  };
  const updateDrag = event => {
    if (!dragStart) return;
    const rect = normalized(dragStart, event);
    applyShades(rect);
    rectBox.style.display = 'block';
    setBlock(rectBox, rect.left, rect.top, rect.width, rect.height);
    sizeBadge.style.display = 'block';
    sizeBadge.textContent = `${rect.width} × ${rect.height} px`;
    sizeBadge.style.left = `${Math.min(rect.right + 8, Math.max(0, viewW() - 110))}px`;
    sizeBadge.style.top = `${Math.max(8, rect.top - 30)}px`;
  };
  const renderSaved = () => {
    savedLayer.innerHTML = '';
    regions.forEach((rect, index) => {
      const box = mk('job-autofill-region-rect yanyu-region-saved');
      box.style.display = 'block';
      setBlock(box, rect.left, rect.top, rect.width, rect.height);
      const badge = mk('job-autofill-region-size');
      badge.textContent = `模块 ${index + 1}`;
      badge.style.display = 'block';
      badge.style.left = `${rect.left + 6}px`; badge.style.top = `${Math.max(6, rect.top + 6)}px`;
      savedLayer.append(box, badge);
    });
    let finish = root.querySelector('[data-yy-region-finish]');
    if (regions.length && !finish) {
      finish = document.createElement('button');
      finish.type = 'button'; finish.dataset.yyRegionFinish = 'true';
      finish.textContent = '完成框选并选择资料';
      finish.style.cssText = 'position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:4;padding:10px 18px;border:0;border-radius:999px;background:#4f46e5;color:white;font:600 13px sans-serif;cursor:pointer;pointer-events:auto;';
      finish.addEventListener('pointerdown', event => event.stopPropagation());
      finish.addEventListener('click', event => { event.stopPropagation(); finishRegionSelect(null); });
      root.appendChild(finish);
    }
    if (!regions.length && finish) finish.remove();
    hint.textContent = regions.length
      ? `已添加 ${regions.length} 个模块；继续 Ctrl/Command 拖框，或点击“完成框选”`
      : '左键拖框；Ctrl/Command 拖框可追加模块；右键取消当前框；Esc 退出';
  };
  const onPointerMove = event => {
    crossH.style.top = `${event.clientY}px`; crossV.style.left = `${event.clientX}px`;
    updateDrag(event);
  };
  const onPointerDown = event => {
    if (event.button !== 0 || event.target.closest('[data-yy-region-finish]')) return;
    event.preventDefault();
    dragStart = { x: event.clientX, y: event.clientY, additive: event.ctrlKey || event.metaKey };
    activePointerId = event.pointerId;
    try { root.setPointerCapture(event.pointerId); } catch {}
    updateDrag(event);
  };
  const onPointerUp = event => {
    if (!dragStart || (activePointerId !== null && event.pointerId !== activePointerId)) return;
    const start = dragStart;
    const rect = normalized(start, event);
    const additive = start.additive || event.ctrlKey || event.metaKey;
    resetDrag();
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < REGION_MIN_DRAG_PX) return;
    if (additive) {
      regions.push(rect);
      renderSaved();
      return;
    }
    regions.push(rect);
    finishRegionSelect(null, regions.slice());
  };
  const onPointerCancel = () => resetDrag();
  const onContextMenu = event => { event.preventDefault(); resetDrag(); };
  const onKeyDown = event => {
    if (event.key !== 'Escape') return;
    event.preventDefault(); exitRegionFillMode(); showNotification('已退出选区模式', 'info');
  };
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerCancel);
  root.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  regionFillState = {
    phase: 'select', profile, root, panel: null, refs: [], skippedHasValue: 0,
    onKeyDown, onWindowPointerUp: onPointerUp, onWindowPointerCancel: onPointerCancel,
    urlTimer: null, lastHref: String(location.href), regions
  };
  shadeFull();
  scheduleRegionUrlWatch();
  if (typeof appLog !== 'undefined') appLog.info('content', 'region.enter', '进入 yanyu 选区模式');
}

function finishRegionSelect(selRect, allRegions) {
  const state = regionFillState;
  if (!state) return;
  const regions = Array.isArray(allRegions) && allRegions.length
    ? allRegions
    : (state.regions?.length ? state.regions.slice() : (selRect ? [selRect] : []));
  if (selRect && !regions.length) regions.push(selRect);
  if (!regions.length) return;
  if (state.root?.parentElement) state.root.parentElement.removeChild(state.root);
  state.root = null;
  state.phase = 'panel';
  const collected = collectYanyuRegionFields(regions);
  state.refs = collected.refs;
  state.skippedHasValue = collected.skippedHasValue;
  if (!collected.refs.length) {
    exitRegionFillMode();
    const suffix = collected.skippedHasValue ? `（${collected.skippedHasValue} 个已有值被跳过）` : '';
    showNotification(`未在框选区域内发现可填字段${suffix}`, 'warning');
    return;
  }
  showRegionEntryPanel();
}

function showRegionEntryPanel() {
  const state = regionFillState;
  if (!state) return;
  if (!yanyuDockState.host && typeof createFloatingButton === 'function') createFloatingButton();
  const host = yanyuDockState.host;
  const shadow = yanyuDockState.shadow;
  if (!host || !shadow) {
    exitRegionFillMode();
    showNotification('当前页面无法显示选区资料面板，请刷新后重试', 'warning');
    return;
  }

  const body = shadow.querySelector('[data-yy-region-view-body]');
  const summary = shadow.querySelector('[data-yy-region-summary]');
  const hint = shadow.querySelector('[data-yy-region-view-hint]');
  const applyBtn = shadow.querySelector('[data-yy-region-view-apply]');
  const closeBtn = shadow.querySelector('[data-yy-region-view-close]');
  if (!body || !summary || !hint || !applyBtn || !closeBtn) {
    exitRegionFillMode();
    showNotification('选区资料面板初始化失败，请刷新后重试', 'warning');
    return;
  }

  const categories = regionPanelCategories(state.profile);
  body.innerHTML = categories.map(cat => `
    <div class="region-cat" data-yy-region-cat-wrap="${escapeHtml(cat.key)}">
      <button type="button" class="region-cat-head" data-yy-region-cat="${escapeHtml(cat.key)}" aria-expanded="false">
        <span class="region-cat-name">${escapeHtml(cat.name)}</span><span class="region-cat-count">${cat.items.length}</span>
      </button>
      <div class="region-items" data-yy-region-items="${escapeHtml(cat.key)}" hidden>
        ${cat.items.map(item => `<button type="button" class="region-item" data-yy-region-entry data-cat="${escapeHtml(cat.key)}" data-yy-region-idx="${Number(item.idx) || 0}">${escapeHtml(cat.single ? item.summary : `${cat.name} ${item.idx + 1}：${item.summary}`)}</button>`).join('')}
      </div>
    </div>`).join('');
  summary.textContent = `已框选 ${state.refs.length} 个字段 · ${state.regions?.length || 1} 个模块`;
  hint.textContent = '手动选择一条资料后，点击立即填入；已有值不会覆盖';
  applyBtn.disabled = true;

  const closeMenus = except => body.querySelectorAll('[data-yy-region-items]').forEach(items => {
    const open = items === except;
    items.hidden = !open;
    const head = items.parentElement?.querySelector('[data-yy-region-cat]');
    if (head) head.setAttribute('aria-expanded', String(open));
  });
  body.querySelectorAll('[data-yy-region-cat]').forEach(head => head.addEventListener('click', () => {
    const items = head.parentElement?.querySelector('[data-yy-region-items]');
    if (!items) return;
    closeMenus(items.hidden ? items : null);
  }));
  body.querySelectorAll('[data-yy-region-entry]').forEach(item => item.addEventListener('click', () => {
    const category = item.dataset.cat;
    const idx = Number(item.dataset.yyRegionIdx);
    state.selection = { category, idx };
    body.querySelectorAll('[data-yy-region-entry]').forEach(el => el.classList.toggle('active', el === item));
    applyBtn.disabled = false;
    hint.textContent = `已选择：${item.textContent.trim()}`;
    closeMenus(null);
  }));

  closeBtn.onclick = () => {
    exitRegionFillMode();
    showNotification('已取消本次选区填入', 'info');
  };
  applyBtn.onclick = () => {
    if (!regionFillState || regionFillState !== state || !state.selection) return;
    const { category, idx } = state.selection;
    const entry = regionCategoryEntries(state.profile, category)[idx];
    if (!entry) return;
    // 沿用 runRegionFill 的 regionFillRunning 锁；这里先禁用按钮，快速连点也只执行一次。
    applyBtn.disabled = true;
    const refs = state.refs;
    const skipped = state.skippedHasValue;
    exitRegionFillMode();
    void runRegionFill(refs, skipped, category, entry).then(result => {
      if (result) publishSidePanel({ kind: 'regionResult', count: result.filled, profileId: state.profile.id });
    }).catch(error => {
      showNotification(error?.name === 'AbortError' ? '选区填入已取消' : '选区填入未能完成', 'warning');
    });
  };

  if (!yanyuShowRegionView()) {
    exitRegionFillMode();
    showNotification('选区资料面板显示失败，请刷新后重试', 'warning');
  }
}
