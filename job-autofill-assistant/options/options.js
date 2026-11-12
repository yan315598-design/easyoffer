// ============================================================================
// Options 页面脚本 - 全量校招网申字段增强版
// ============================================================================

let currentProfile = null;
let allProfiles = [];
let activeProfileId = null;
let aiKeySaveTimer = null;
let aiUrlSaveTimer = null;
let aiModelSaveTimer = null;
let profileSaveTimer = null;
let profileDirty = false;
let profileEditRevision = 0;
let profileDeletionInFlight = false;
let pendingProfileSave = Promise.resolve(true);
let editorDocumentId = null;
let savedAiSettingsFingerprint = null;
let pendingSettingsSave = Promise.resolve(true);
let modelFetchSeq = 0;
let selectedAiResumeFile = null;
// 每次解析/取消都递增；旧解析完成后发现序号变了就丢弃结果，防止过期数据写入表单
let aiParseRunSeq = 0;
// 简历工作区状态：'overview' 为默认只读概览，其余值为 section- 后缀的模块 key
let workspaceModule = 'overview';
let workspaceEditing = false;

function cancelOngoingAiParse() {
  resumeParser.cancelActiveParse();
  aiParseRunSeq++;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 并发并行获取设置、简历资料与投递记录，彻底消除多重 IPC 串行往返延迟
  const [settingsRes, profilesRes, editorRes] = await Promise.all([
    sendMessage({ action: 'getSettings' }).catch(() => ({})),
    sendMessage({ action: 'getAllProfiles' }).catch(() => ({})),
    sendMessage({ action: 'getEditorIdentity' }).catch(() => ({}))
  ]);

  editorDocumentId = editorRes.documentId;

  // 2. 极速应用主题
  applyThemeFromSettings(settingsRes);

  // 3. 填充资料数据
  if (profilesRes && profilesRes.success) {
    allProfiles = profilesRes.profiles || [];
    activeProfileId = profilesRes.activeProfileId;
    currentProfile = allProfiles.find((profile) => profile.id === activeProfileId) || allProfiles[0] || null;

    const select = document.getElementById('profileSelect');
    if (select) {
      select.innerHTML = '';
      allProfiles.forEach((profile) => {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.name;
        if (profile.id === activeProfileId) option.selected = true;
        select.appendChild(option);
      });
    }

    if (currentProfile) {
      loadProfileToForm(currentProfile);
    }
    renderNavCustomDropdown();
  }
  updateDeleteProfileAction();

  // 应用 AI 配置
  applyAiSettings(settingsRes);
  savedAiSettingsFingerprint = JSON.stringify(collectAiSettingsFromDom());

  // 初始化下拉组件。日期控件保留原生键盘操作。
  initAllAppleSelects();

  // 7. 绑定事件与导航
  bindEvents();
  initProfileNavigation();

  // 8. 无资料时也要渲染侧栏导航与概览空态
  refreshWorkspaceUi();
});

function applyThemeFromSettings(response) {
  try {
    const saved = response && response.success ? response.settings?.uiTheme : '';
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const legacy = document.documentElement.getAttribute('data-theme');
    const theme = saved || legacy || (prefersLight ? 'light' : 'dark');
    const mode = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('capybara-ui-theme', mode); } catch (e) {}
    if (!saved && legacy && response?.success) {
      sendMessage({ action: 'updateSettings', settings: { uiTheme: mode } }).catch(() => {});
    }
  } catch (e) {
    console.log('[Options] 主题初始化异常，使用默认主题', e);
  }
}

function applyAiSettings(response) {
  if (!response || !response.success) return;
  const settings = response.settings || {};
  document.getElementById('aiEnabled').checked = !!settings.aiEnabled;
  const smartFillToggle = document.getElementById('aiSmartFill');
  if (smartFillToggle) smartFillToggle.checked = settings.aiSmartFill !== false;
  document.getElementById('aiProvider').value = settings.aiProvider || 'deepseek';
  document.getElementById('aiApiKey').value = settings.aiApiKey || '';
  document.getElementById('aiApiUrl').value = settings.aiApiUrl || '';
  document.getElementById('aiSettings').style.display = settings.aiEnabled ? 'block' : 'none';
  populateModelSelect(settings.aiModel ? [settings.aiModel] : [], settings.aiModel || '');
  if (settings.aiApiKey && settings.aiEnabled) {
    refreshModelList({ silent: true });
  }
}

async function initTheme() {
  try {
    const response = await sendMessage({ action: 'getSettings' });
    applyThemeFromSettings(response);
  } catch (e) {
    console.log('[Options] 主题初始化异常', e);
  }
}

async function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  const button = document.getElementById('themeToggle');
  button.disabled = true;
  try {
    const result = await sendMessage({ action: 'updateSettings', settings: { uiTheme: next } });
    if (!result?.success) throw new Error(result?.error || '无法保存主题');
    applyThemeFromSettings({ success: true, settings: { uiTheme: next } });
  } catch (error) {
    showToast('主题切换失败：' + error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function attr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function html(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function emptyEducation() {
  return {
    id: generateId(),
    school: '',
    college: '',
    major: '',
    degree: '',
    degreeType: '',
    schoolType: '',
    startDate: '',
    endDate: '',
    gpa: '',
    rank: '',
    courses: '',
    description: ''
  };
}

function emptyWork() {
  return {
    id: generateId(),
    company: '',
    department: '',
    position: '',
    workType: '',
    city: '',
    startDate: '',
    endDate: '',
    description: '',
    achievements: ''
  };
}

function emptyProject() {
  return {
    id: generateId(),
    name: '',
    role: '',
    projectType: '',
    techStack: '',
    startDate: '',
    endDate: '',
    projectUrl: '',
    description: '',
    responsibilities: '',
    achievements: ''
  };
}

function emptyAward() {
  return {
    id: generateId(),
    name: '',
    level: '',
    date: ''
  };
}

function emptyFamilyMember() {
  return {
    id: generateId(),
    name: '',
    relation: '',
    employer: '',
    position: '',
    phone: ''
  };
}

function emptyCertificate() {
  return {
    id: generateId(),
    name: '',
    code: '',
    issuer: '',
    level: '',
    description: '',
    date: '',
    expiryDate: ''
  };
}

function normalizeCertificates(certificates) {
  return (Array.isArray(certificates) ? certificates : []).map((item) =>
    typeof item === 'string'
      ? { ...emptyCertificate(), name: item }
      : { ...emptyCertificate(), ...(item || {}), id: item?.id || generateId() }
  );
}


function collectAiSettingsFromDom() {
  return {
    aiEnabled: document.getElementById('aiEnabled').checked,
    aiProvider: document.getElementById('aiProvider').value,
    aiApiKey: document.getElementById('aiApiKey').value.trim(),
    aiApiUrl: document.getElementById('aiApiUrl').value.trim(),
    aiModel: getSelectedModel(),
    aiSmartFill: document.getElementById('aiSmartFill')?.checked !== false,
  };
}

function isPromptModelText(str) {
  return typeof str === 'string' && (/^请.*(?:填入|输入|选择)/.test(str) || str.includes('火山方舟') || /Endpoint ID \(ep-/i.test(str));
}

function getSelectedModel() {
  const select = document.getElementById('aiModel');
  const custom = document.getElementById('aiModelCustom');
  let val = '';
  if (!select) val = (custom && custom.value.trim()) || '';
  else if (select.value === '__custom__') val = (custom && custom.value.trim()) || '';
  else val = (select.value || '').trim() || ((custom && custom.value.trim()) || '');
  return isPromptModelText(val) ? '' : val;
}

function setModelHint(text, isError) {
  const hint = document.getElementById('aiModelHint');
  if (!hint) return;
  hint.textContent = text;
  hint.style.color = isError ? '#f87171' : 'var(--text-muted)';
}

function populateModelSelect(models, selected) {
  const select = document.getElementById('aiModel');
  const custom = document.getElementById('aiModelCustom');
  if (!select) return;

  const promptText = (models || []).find(isPromptModelText);
  const ids = Array.from(new Set((models || []).filter((m) => m && !isPromptModelText(m))));
  select.innerHTML = '';

  if (promptText) {
    setModelHint(promptText, false);
  }

  if (!ids.length) {
    select.appendChild(new Option(promptText || '未获取到模型，请手动填写', ''));
    select.appendChild(new Option('手动输入…', '__custom__'));
    select.value = '__custom__';
    if (custom) {
      custom.style.display = 'block';
      if (selected && !isPromptModelText(selected)) custom.value = selected;
      setTimeout(() => custom.focus(), 50);
    }
    if (select._refreshAppleSelect) {
      select._refreshAppleSelect();
    } else {
      upgradeToAppleSelect(select);
    }
    return;
  }

  ids.forEach((id) => select.appendChild(new Option(id, id)));
  select.appendChild(new Option('手动输入…', '__custom__'));

  if (selected && !isPromptModelText(selected) && ids.includes(selected)) {
    select.value = selected;
    if (custom) {
      custom.style.display = 'none';
      custom.value = '';
    }
  } else if (selected && !isPromptModelText(selected)) {
    select.value = '__custom__';
    if (custom) {
      custom.style.display = 'block';
      custom.value = selected;
    }
  } else {
    select.value = ids[0];
    if (custom) custom.style.display = 'none';
  }

  if (select._refreshAppleSelect) {
    select._refreshAppleSelect();
  } else {
    upgradeToAppleSelect(select);
  }
}

function syncCustomModelVisibility() {
  const select = document.getElementById('aiModel');
  const custom = document.getElementById('aiModelCustom');
  if (!select || !custom) return;
  const show = select.value === '__custom__' || !select.value;
  custom.style.display = show ? 'block' : 'none';
}

async function refreshModelList({ silent = false } = {}) {
  const settings = collectAiSettingsFromDom();
  if (!settings.aiApiKey) {
    setModelHint('请先填写 API Key，再获取可用模型', true);
    if (!silent) showToast('请先填写 API Key', 'warning');
    return [];
  }

  const seq = ++modelFetchSeq;
  const previous = getSelectedModel();
  setModelHint('正在用 API Key 获取可用模型…');
  const btn = document.getElementById('refreshModelsBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '🔄 获取中...';
  }

  try {
    const models = await resumeParser.listModels(settings);
    if (seq !== modelFetchSeq) return models;
    populateModelSelect(models, previous);
    const chosen = getSelectedModel();
    setModelHint(`已获取 ${models.length} 个可用模型` + (chosen ? `，当前：${chosen}` : ''));
    await autoSaveAiSettings();
    if (!silent) showToast(`已获取 ${models.length} 个模型`, 'success');
    return models;
  } catch (error) {
    if (seq !== modelFetchSeq) return [];
    populateModelSelect(previous ? [previous] : [], previous);
    const select = document.getElementById('aiModel');
    if (select) {
      if (![...select.options].some((opt) => opt.value === '__custom__')) {
        select.appendChild(new Option('手动输入…', '__custom__'));
      }
      select.value = '__custom__';
    }
    syncCustomModelVisibility();
    const custom = document.getElementById('aiModelCustom');
    if (custom && previous) custom.value = previous;
    setModelHint(`无法自动列出模型：${error.message}。请手动填写模型名。`, true);
    if (!silent) showToast('未能列出模型，请手动填写', 'warning');
    return [];
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg><span>获取可用模型</span>';
    }
  }
}

function setFieldValue(el, value) {
  const text = value == null ? '' : String(value);
  if (el.tagName === 'SELECT' && text && ![...el.options].some(option => option.value === text)) {
    el.add(new Option(text, text));
  }
  el.value = text;
  el._refreshAppleSelect?.();
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  setFieldValue(el, value);
}

function toDateInput(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{4}-\d{2}$/.test(v)) return v;
  const matched = v.match(/^(\d{4})[./年-](\d{1,2})(?:[./月-](\d{1,2}))?/);
  if (matched) {
    const month = matched[2].padStart(2, '0');
    return `${matched[1]}-${month}${matched[3] ? '-' + matched[3].padStart(2, '0') : ''}`;
  }
  return '';
}

async function loadProfiles() {
  const response = await sendMessage({ action: 'getAllProfiles' });
  if (!response?.success) return false;

  allProfiles = response.profiles || [];
  activeProfileId = response.activeProfileId;
  // “主动添加模块”是当前资料的工作区状态，不应泄漏到下一份资料。

  const select = document.getElementById('profileSelect');
  select.innerHTML = '';
  allProfiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    if (profile.id === activeProfileId) option.selected = true;
    select.appendChild(option);
  });

  currentProfile = allProfiles.find((profile) => profile.id === activeProfileId) || null;
  if (currentProfile) {
    loadProfileToForm(currentProfile);
  }
  renderNavCustomDropdown();
  await loadAISettings();
  return true;
}

function updateDeleteProfileAction() {
  const profileId = currentProfile?.id || '';
  const profileAvailable = Boolean(profileId) && allProfiles.some(profile => profile.id === profileId);
  const isOnlyProfile = profileAvailable && allProfiles.length <= 1;
  const label = profileDeletionInFlight
    ? '正在处理删除操作'
    : !profileId
      ? '暂无可删除的简历'
      : !profileAvailable
        ? '当前简历已在其他页面移除'
        : isOnlyProfile
          ? '至少需要保留一份简历'
          : `删除「${currentProfile.name || '当前简历'}」`;
  for (const button of document.querySelectorAll('#deleteProfileRailBtn, #deleteProfileBtn')) {
    button.disabled = profileDeletionInFlight || !profileAvailable || isOnlyProfile;
    button.title = label;
    button.setAttribute('aria-label', label);
  }
}

function renderNavCustomDropdown() {
  updateDeleteProfileAction();
  const nameLabel = document.getElementById('navSelectedProfileName');
  const menu = document.getElementById('navProfileDropdownMenu');
  if (!nameLabel || !menu) return;

  if (!currentProfile) {
    nameLabel.textContent = '暂无简历资料';
    menu.innerHTML = '<div class="nav-dropdown-item" style="color:var(--text-muted);">暂无资料</div>';
    updateRailProfileCard();
    return;
  }

  nameLabel.textContent = currentProfile.name || '默认资料';
  updateRailProfileCard();
  menu.innerHTML = '';

  allProfiles.forEach((profile) => {
    const isAct = profile.id === currentProfile.id;
    const item = document.createElement('div');
    item.className = 'nav-dropdown-item' + (isAct ? ' active' : '');
    item.innerHTML = `
      <span>${html(profile.name)}</span>
      ${isAct ? '<span class="check-icon">✓</span>' : ''}
    `;
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      closeNavCustomDropdown();
      if (profile.id !== currentProfile.id) {
        await switchProfile(profile.id);
      }
    });
    menu.appendChild(item);
  });
}

function toggleNavCustomDropdown(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('navProfileDropdown');
  if (dropdown) {
    dropdown.classList.toggle('is-open');
  }
}

function closeNavCustomDropdown() {
  const dropdown = document.getElementById('navProfileDropdown');
  if (dropdown) {
    dropdown.classList.remove('is-open');
  }
}

// ============================================================================
// Apple HIG 通用自定义下拉组件 (彻底替代原生 select)
// ============================================================================

function upgradeToAppleSelect(select) {
  if (!select || select.dataset.appleSelectInitialized) {
    if (select && select._refreshAppleSelect) {
      select._refreshAppleSelect();
    }
    return;
  }
  if (select.id === 'profileSelect') return; // 顶栏资料切换由专门 popover 处理
  select.dataset.appleSelectInitialized = 'true';

  // 隐藏原始 select 保留底层事件
  select.style.display = 'none';
  const oldArrow = select.parentNode?.querySelector('.field-arrow');
  if (oldArrow) oldArrow.style.display = 'none';

  const box = document.createElement('div');
  box.className = 'apple-custom-select-box';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'apple-custom-select-trigger';
  const fieldLabel = [...select.labels].map(label => label.textContent.trim()).join(' ');
  if (fieldLabel) trigger.setAttribute('aria-label', fieldLabel);

  const label = document.createElement('span');
  label.className = 'apple-custom-select-label';

  const arrow = document.createElement('span');
  arrow.className = 'apple-custom-select-arrow';
  arrow.innerHTML = `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

  trigger.appendChild(label);
  trigger.appendChild(arrow);

  const popover = document.createElement('div');
  popover.className = 'apple-custom-select-popover';

  function renderOptions() {
    popover.innerHTML = '';
    const selectedOption = select.options[select.selectedIndex] || select.options[0];
    label.textContent = selectedOption ? selectedOption.text : (select.placeholder || '请选择');

    Array.from(select.options).forEach((opt, idx) => {
      const optionItem = document.createElement('div');
      const isSelected = opt.selected || idx === select.selectedIndex;
      optionItem.className = 'apple-custom-select-option' + (isSelected ? ' selected' : '');
      optionItem.innerHTML = `
        <span>${html(opt.text)}</span>
        ${isSelected ? '<span class="option-check">✓</span>' : ''}
      `;

      optionItem.addEventListener('click', (e) => {
        e.stopPropagation();
        box.classList.remove('is-open');
        if (select.value !== opt.value) {
          select.value = opt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          renderOptions();
        }
      });
      popover.appendChild(optionItem);
    });
  }

  renderOptions();

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = box.classList.contains('is-open');
    document.querySelectorAll('.apple-custom-select-box.is-open').forEach((b) => {
      if (b !== box) b.classList.remove('is-open');
    });
    if (!isOpen) {
      renderOptions();
      box.classList.add('is-open');
      const selItem = popover.querySelector('.apple-custom-select-option.selected');
      if (selItem) {
        selItem.scrollIntoView({ block: 'nearest' });
      }
    } else {
      box.classList.remove('is-open');
    }
  });

  box.appendChild(trigger);
  box.appendChild(popover);

  select.parentNode.insertBefore(box, select.nextSibling);

  // 监听原生 select 变化以保持同步
  select.addEventListener('change', () => {
    renderOptions();
  });

  // 保存刷新钩子
  select._refreshAppleSelect = renderOptions;
}

function initAllAppleSelects(root = document) {
  root.querySelectorAll('select:not([data-apple-custom="false"])').forEach(upgradeToAppleSelect);
}

// ============================================================================
// Apple HIG 原生级模态输入与确认弹窗 (替代丑陋的 window.prompt / confirm)
// ============================================================================

function showApplePrompt({ title = '输入信息', subtitle = '', defaultValue = '', placeholder = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'apple-modal-overlay';
    overlay.innerHTML = `
      <div class="apple-modal-card">
        <div class="apple-modal-icon">📇</div>
        <div class="apple-modal-header">
          <h3 class="apple-modal-title">${html(title)}</h3>
          ${subtitle ? `<p class="apple-modal-subtitle">${html(subtitle)}</p>` : ''}
        </div>
        <div class="apple-modal-body">
          <input type="text" class="apple-modal-input" placeholder="${attr(placeholder)}" value="${attr(defaultValue)}">
        </div>
        <div class="apple-modal-actions">
          <button type="button" class="btn-modal-cancel">${html(cancelText)}</button>
          <button type="button" class="btn-modal-confirm">${html(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector('.apple-modal-input');
    const cancelBtn = overlay.querySelector('.btn-modal-cancel');
    const confirmBtn = overlay.querySelector('.btn-modal-confirm');

    input.focus();
    input.select();

    function cleanup(val) {
      overlay.remove();
      resolve(val);
    }

    cancelBtn.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(null);
    });

    function submit() {
      cleanup(input.value.trim());
    }

    confirmBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      }
    });
  });
}

function showAppleConfirm({ title = '确认操作', subtitle = '', confirmText = '确定删除', cancelText = '取消', isDanger = true }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'apple-modal-overlay';
    overlay.innerHTML = `
      <div class="apple-modal-card">
        <div class="apple-modal-icon ${isDanger ? 'danger' : ''}">${isDanger ? '⚠️' : '❓'}</div>
        <div class="apple-modal-header">
          <h3 class="apple-modal-title">${html(title)}</h3>
          ${subtitle ? `<p class="apple-modal-subtitle">${html(subtitle)}</p>` : ''}
        </div>
        <div class="apple-modal-actions">
          <button type="button" class="btn-modal-cancel">${html(cancelText)}</button>
          <button type="button" class="btn-modal-confirm ${isDanger ? 'danger' : ''}">${html(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector('.btn-modal-cancel');
    const confirmBtn = overlay.querySelector('.btn-modal-confirm');

    function cleanup(val) {
      overlay.remove();
      resolve(val);
    }

    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    function escHandler(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        cleanup(false);
      }
    }
    document.addEventListener('keydown', escHandler);
  });
}

async function loadAISettings() {
  const response = await sendMessage({ action: 'getSettings' });
  if (!response.success) return;
  const settings = response.settings || {};
  document.getElementById('aiEnabled').checked = !!settings.aiEnabled;
  const smartFillToggle = document.getElementById('aiSmartFill');
  if (smartFillToggle) smartFillToggle.checked = settings.aiSmartFill !== false;
  document.getElementById('aiProvider').value = settings.aiProvider || 'deepseek';
  document.getElementById('aiApiKey').value = settings.aiApiKey || '';
  document.getElementById('aiApiUrl').value = settings.aiApiUrl || '';
  document.getElementById('aiSettings').style.display = settings.aiEnabled ? 'block' : 'none';
  populateModelSelect(settings.aiModel ? [settings.aiModel] : [], settings.aiModel || '');
  if (settings.aiApiKey && settings.aiEnabled) {
    refreshModelList({ silent: true });
  }
  savedAiSettingsFingerprint = JSON.stringify(collectAiSettingsFromDom());
}

function loadProfileToForm(profile) {
  const info = profile.basicInfo || {};
  setInputValue('fullName', info.fullName);
  setInputValue('firstName', info.firstName);
  setInputValue('lastName', info.lastName);
  setInputValue('phone', info.phone);
  setInputValue('email', info.email);
  setInputValue('gender', info.gender);
  setInputValue('birthDate', info.birthDate);
  setInputValue('idCard', info.idCard);
  setInputValue('politicalStatus', info.politicalStatus);
  setInputValue('ethnicity', info.ethnicity);
  setInputValue('hometown', info.hometown);
  setInputValue('graduationDate', info.graduationDate);
  setInputValue('maritalStatus', info.maritalStatus);
  setInputValue('currentCity', info.currentCity);
  setInputValue('emergencyContact', info.emergencyContact);
  setInputValue('emergencyRelation', info.emergencyRelation);
  setInputValue('emergencyPhone', info.emergencyPhone);
  setInputValue('city', info.city);
  setInputValue('state', info.state);
  setInputValue('country', info.country);
  setInputValue('zipCode', info.zipCode);
  setInputValue('street', info.street);
  setInputValue('homeAddress', familyResidence(info).homeAddress);
  setInputValue('linkedin', info.linkedin);
  setInputValue('github', info.github);
  setInputValue('website', info.website);
  setInputValue('twitter', info.twitter);

  // 求职意向
  const job = profile.jobIntention || {};
  setInputValue('expectedCity', job.expectedCity);
  setInputValue('expectedPosition', job.expectedPosition);
  setInputValue('expectedIndustry', job.expectedIndustry);
  setInputValue('expectedSalary', job.expectedSalary);
  setInputValue('currentSalary', job.currentSalary);
  setInputValue('availableDate', job.availableDate);
  setInputValue('referralCode', job.referralCode);
  setInputValue('recruitSource', job.recruitSource);
  setInputValue('willingToTravel', job.willingToTravel);

  // 动态列表
  renderEducationList(profile.education || []);
  renderWorkList(profile.workExperience || []);
  renderProjectList(profile.projects || []);
  renderAwardsList(profile.awards || []);
  renderFamilyList(profile.familyMembers || []);
  const certificates = normalizeCertificates(profile.certificates);
  renderCertificatesList(certificates);
  renderSkillsList(profileSkillEntries(profile));

  document.getElementById('introduction').value = profile.introTemplates?.default || '';
  updateResumeAttachmentUI(profile.attachments?.resume?.name || profile.resumeFileName || '', profile.attachments?.resume?.size || 0);

  const greetingEl = document.getElementById('hrGreetingText');
  if (greetingEl) {
    greetingEl.value = profile.hrGreeting || '';
    updateGreetingCharCount(profile.hrGreeting || '');
  }

  renderExtendedProfile(profile);
  // 刷新所有 Apple 自定义下拉选框
  initAllAppleSelects();
  // 概览卡片、侧栏模块导航与右栏简历信息同步当前资料
  refreshWorkspaceUi();
}

// 经历条目沿用现有表单与保存逻辑，仅增加可折叠容器，避免长卡片占满屏幕。
function enhanceItemCard(card, entryId) {
  const header = card.querySelector('.item-card-header');
  if (!header || card.querySelector(':scope > .item-card-body')) return;
  const body = document.createElement('div');
  body.className = 'item-card-body';
  while (header.nextSibling) body.appendChild(header.nextSibling);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'item-collapse-btn';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg><span>收起</span>';
  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    card.classList.toggle('is-collapsed-item', !open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('span').textContent = open ? '收起' : '展开';
  });
  header.insertBefore(toggle, header.querySelector('.btn-delete') || null);
  if (entryId) {
    card.dataset.entryId = entryId;
    const order = document.createElement('div');
    order.className = 'experience-order';
    order.innerHTML = experienceOrderButtons();
    header.insertBefore(order, toggle);
  }
  card.appendChild(body);
}

function renderEducationList(educationList) {
  const container = document.getElementById('educationList');
  container.innerHTML = '';

  educationList.forEach((edu, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4><span class="item-index">${String(index + 1).padStart(2, '0')}</span><span>${html(edu.school || '未填写学校')}</span></h4>
        <button type="button" class="btn-delete" data-id="${attr(edu.id)}" data-type="education">删除经历</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>学校名称 <span class="required">*</span></label>
          <input type="text" class="edu-school" data-id="${attr(edu.id)}" value="${attr(edu.school)}" placeholder="例如: 北京大学">
        </div>
        <div class="form-group">
          <label>所属学院 / 院系</label>
          <input type="text" class="edu-college" value="${attr(edu.college)}" placeholder="例如: 计算机学院">
        </div>
        <div class="form-group">
          <label>专业全称 <span class="required">*</span></label>
          <input type="text" class="edu-major" value="${attr(edu.major)}" placeholder="例如: 计算机科学与技术">
        </div>
      </div>
      <div class="form-row form-row-4">
        <div class="form-group">
          <label>学历层次</label>
          <div class="select-box">
            <select class="edu-degree">
              <option value="">请选择</option>
              <option value="高中" ${edu.degree === '高中' ? 'selected' : ''}>高中</option>
              <option value="大专" ${edu.degree === '大专' ? 'selected' : ''}>大专</option>
              <option value="本科" ${edu.degree === '本科' ? 'selected' : ''}>本科</option>
              <option value="硕士" ${edu.degree === '硕士' ? 'selected' : ''}>硕士</option>
              <option value="博士" ${edu.degree === '博士' ? 'selected' : ''}>博士</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>培养方式</label>
          <div class="select-box">
            <select class="edu-degree-type">
              <option value="">请选择</option>
              <option value="普通全日制统招" ${edu.degreeType === '普通全日制统招' ? 'selected' : ''}>普通全日制统招</option>
              <option value="非全日制" ${edu.degreeType === '非全日制' ? 'selected' : ''}>非全日制</option>
              <option value="海外留学生" ${edu.degreeType === '海外留学生' ? 'selected' : ''}>海外留学生</option>
              <option value="定向委培" ${edu.degreeType === '定向委培' ? 'selected' : ''}>定向委培</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>院校层次</label>
          <div class="select-box">
            <select class="edu-school-type">
              <option value="">请选择</option>
              <option value="985" ${edu.schoolType === '985' ? 'selected' : ''}>985</option>
              <option value="211" ${edu.schoolType === '211' ? 'selected' : ''}>211</option>
              <option value="双一流" ${edu.schoolType === '双一流' ? 'selected' : ''}>双一流</option>
              <option value="普通本科" ${edu.schoolType === '普通本科' ? 'selected' : ''}>普通本科</option>
              <option value="专科" ${edu.schoolType === '专科' ? 'selected' : ''}>专科</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>GPA / 平均分</label>
          <input type="text" class="edu-gpa" value="${attr(edu.gpa)}" placeholder="例如: 3.8/4.0 或 89/100">
        </div>
        <div class="form-group">
          <label>专业 / 成绩排名</label>
          <input type="text" class="edu-rank" value="${attr(edu.rank)}" placeholder="例如: 前5% 或 3/120">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>入学时间</label>
          <input type="text" class="edu-start" value="${attr(edu.startDate)}" placeholder="例如: 2022-09">
        </div>
        <div class="form-group">
          <label>毕业时间</label>
          <input type="text" class="edu-end" value="${attr(edu.endDate)}" placeholder="例如: 2026-06 或 至今">
        </div>
      </div>
      <div class="form-group">
        <label>主修核心课程</label>
        <textarea class="edu-courses" rows="2" placeholder="例如: 数据结构与算法、计算机网络、操作系统、计算机体系结构、数据库原理">${html(edu.courses)}</textarea>
      </div>
      <div class="form-group">
        <label>在校经历 / 补充说明</label>
        <textarea class="edu-description" rows="3" placeholder="在校职务、荣誉、论文及其他补充信息">${html(edu.description)}</textarea>
      </div>
    `;
    setFieldValue(card.querySelector('.edu-degree'), edu.degree);
    setFieldValue(card.querySelector('.edu-degree-type'), edu.degreeType);
    setFieldValue(card.querySelector('.edu-school-type'), edu.schoolType);
    const score = card.querySelector('.edu-gpa').parentElement;
    const rank = card.querySelector('.edu-rank').parentElement;
    const grades = appendExtendedFields(card, 'education', edu, ['gpaScale'],
      { before: card.querySelector('.edu-start').closest('.form-row') });
    grades.prepend(score);
    grades.append(rank);
    appendExtendedFields(card, 'education', edu, ['academicDegree', 'schoolCity', 'majorCategory'],
      { before: card.querySelector('.edu-courses').parentElement });
    wrapExtendedCollapse(card, 'education', edu, '科研与毕业信息', ['advisor', 'laboratory', 'researchArea', 'thesis']);
    wrapExtendedCollapse(card, 'education', edu, '学籍与证明', extendedFieldKeys('education').filter(key =>
      !card.querySelector(`[data-ext-key="${key}"]`)));
    enhanceItemCard(card, edu.id);
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="education"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteEducation(e.currentTarget.getAttribute('data-id')));
  });

  syncExperienceOrder(container);
  initAllAppleSelects(container);
}

function renderWorkList(workList) {
  const container = document.getElementById('workList');
  container.innerHTML = '';

  workList.forEach((work, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4><span class="item-index">${String(index + 1).padStart(2, '0')}</span><span>${html(work.company || '未填写公司')}${work.position ? ` · ${html(work.position)}` : ''}</span></h4>
        <button type="button" class="btn-delete" data-id="${attr(work.id)}" data-type="work">删除经历</button>
      </div>
      <div class="form-row form-row-4">
        <div class="form-group">
          <label>公司 / 组织名称 <span class="required">*</span></label>
          <input type="text" class="work-company" data-id="${attr(work.id)}" value="${attr(work.company)}" placeholder="例如: 字节跳动">
        </div>
        <div class="form-group">
          <label>所属部门 / 业务线</label>
          <input type="text" class="work-department" value="${attr(work.department)}" placeholder="例如: 抖音电商研发部">
        </div>
        <div class="form-group">
          <label>职位名称 <span class="required">*</span></label>
          <input type="text" class="work-position" value="${attr(work.position)}" placeholder="例如: 前端开发实习生">
        </div>
        <div class="form-group">
          <label>工作性质</label>
          <div class="select-box">
            <select class="work-type">
              <option value="">请选择</option>
              <option value="实习" ${work.workType === '实习' ? 'selected' : ''}>实习</option>
              <option value="全职" ${work.workType === '全职' ? 'selected' : ''}>全职</option>
              <option value="兼职" ${work.workType === '兼职' ? 'selected' : ''}>兼职</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>工作城市</label>
          <input type="text" class="work-city" value="${attr(work.city)}" placeholder="例如: 北京 / 杭州">
        </div>
        <div class="form-group">
          <label>开始时间</label>
          <input type="text" class="work-start" value="${attr(work.startDate)}" placeholder="例如: 2024-06">
        </div>
        <div class="form-group">
          <label>结束时间</label>
          <input type="text" class="work-end" value="${attr(work.endDate)}" placeholder="例如: 2024-09 或 至今">
        </div>
      </div>
      <div class="form-group">
        <label>工作职责与内容 (建议采用 STAR 原则描述)</label>
        <textarea class="work-desc" rows="3" placeholder="负责核心模块的设计与开发，协同后端与产品快速迭代业务需求...">${html(work.description)}</textarea>
      </div>
      <div class="form-group">
        <label>核心量化业务成果 / 产出贡献</label>
        <textarea class="work-achievements" rows="2" placeholder="例如: 优化首屏加载耗时 35%，主导模块上线支撑日活 500 万+ 用户">${html(work.achievements)}</textarea>
      </div>
    `;
    setFieldValue(card.querySelector('.work-type'), work.workType);
    appendExtendedFields(card, 'workExperience', work, ['employerType', 'industry'],
      { before: card.querySelector('.work-city').closest('.form-row') });
    wrapExtendedCollapse(card, 'workExperience', work, '薪酬、离职与证明人',
      extendedFieldKeys('workExperience').filter(key => !['employerType', 'industry'].includes(key)));
    enhanceItemCard(card, work.id);
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="work"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteWorkExperience(e.currentTarget.getAttribute('data-id')));
  });

  syncExperienceOrder(container);
  initAllAppleSelects(container);
  applyWorkModuleFilter();
}

function renderProjectList(projectList) {
  const container = document.getElementById('projectList');
  container.innerHTML = '';

  projectList.forEach((project, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4><span class="item-index">${String(index + 1).padStart(2, '0')}</span><span>${html(project.name || '未填写项目')}</span></h4>
        <button type="button" class="btn-delete" data-id="${attr(project.id)}" data-type="project">删除项目</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>项目名称 <span class="required">*</span></label>
          <input type="text" class="proj-name" data-id="${attr(project.id)}" value="${attr(project.name)}" placeholder="例如: 高性能在线协同文档系统">
        </div>
        <div class="form-group">
          <label>担任角色</label>
          <input type="text" class="proj-role" value="${attr(project.role)}" placeholder="例如: 核心前端负责人 / 独立开发者">
        </div>
        <div class="form-group">
          <label>项目类型</label>
          <div class="select-box">
            <select class="proj-type">
              <option value="">请选择</option>
              <option value="商业项目" ${project.projectType === '商业项目' ? 'selected' : ''}>商业项目</option>
              <option value="科研课题" ${project.projectType === '科研课题' ? 'selected' : ''}>科研课题</option>
              <option value="竞赛获奖" ${project.projectType === '竞赛获奖' ? 'selected' : ''}>竞赛获奖</option>
              <option value="开源项目" ${project.projectType === '开源项目' ? 'selected' : ''}>开源项目</option>
              <option value="课程设计" ${project.projectType === '课程设计' ? 'selected' : ''}>课程设计</option>
              <option value="校园活动" ${project.projectType === '校园活动' ? 'selected' : ''}>校园活动</option>
              <option value="社会实践" ${project.projectType === '社会实践' ? 'selected' : ''}>社会实践</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>技术栈 / 关键技术</label>
          <input type="text" class="proj-tech" value="${attr(project.techStack || (Array.isArray(project.technologies) ? project.technologies.join(', ') : ''))}" placeholder="例如: React, TypeScript, WebRTC, Node.js">
        </div>
        <div class="form-group">
          <label>开始时间</label>
          <input type="text" class="proj-start" value="${attr(project.startDate)}" placeholder="例如: 2023-10">
        </div>
        <div class="form-group">
          <label>结束时间</label>
          <input type="text" class="proj-end" value="${attr(project.endDate)}" placeholder="例如: 2024-03 或 至今">
        </div>
      </div>
      <div class="form-group">
        <label>项目在线链接 / Demo / GitHub</label>
        <input type="url" class="proj-url" value="${attr(project.projectUrl)}" placeholder="https://github.com/username/project">
      </div>
      <div class="form-group">
        <label>项目背景与功能描述</label>
        <textarea class="proj-desc" rows="2" placeholder="简要描述项目的业务场景与要解决的核心痛点...">${html(project.description)}</textarea>
      </div>
      <div class="form-group">
        <label>个人职责与技术难点攻坚</label>
        <textarea class="proj-resp" rows="2" placeholder="负责 OT 协同算法的设计与实现，解决高并发网络抖动冲突问题...">${html(project.responsibilities)}</textarea>
      </div>
      <div class="form-group">
        <label>项目产出与成果量化</label>
        <textarea class="proj-achieve" rows="2" placeholder="例如: 荣获全国大学生计算机设计大赛一等奖，系统上线稳定支撑 10w+ 用户访问">${html(project.achievements)}</textarea>
      </div>
    `;
    setFieldValue(card.querySelector('.proj-type'), project.projectType);
    appendExtendedFields(card, 'projects', project, ['organization', 'projectLevel'],
      { before: card.querySelector('.proj-tech').closest('.form-row') });
    wrapExtendedCollapse(card, 'projects', project, '项目证明人',
      extendedFieldKeys('projects').filter(key => key.startsWith('reference')));
    enhanceItemCard(card, project.id);
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="project"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteProject(e.currentTarget.getAttribute('data-id')));
  });

  syncExperienceOrder(container);
  initAllAppleSelects(container);
}

const EXPERIENCE_LIST_IDS = {
  internship: 'workList', education: 'educationList', work: 'workList', projects: 'projectList', awards: 'awardsList',
  family: 'familyList', certificates: 'certificatesList', skills: 'skillsList',
  ...Object.fromEntries(['languageCertificates','campusPositions','campusActivities','trainings','papers','patents','openSource','customAnswers','declarations'].map(key => [key, `entryList-${key}`]))
};

function experienceOrderButtons(index = -1, total = 0) {
  return `<button type="button" data-move-entry="up" ${index === 0 ? 'disabled' : ''}>↑ 上移</button>
    <button type="button" data-move-entry="down" ${index >= 0 && index === total - 1 ? 'disabled' : ''}>↓ 下移</button>`;
}

function syncExperienceOrder(container) {
  const cards = [...container.children];
  cards.forEach((card, index) => {
    const number = card.querySelector('.item-index');
    if (number) number.textContent = String(index + 1).padStart(2, '0');
    const up = card.querySelector('[data-move-entry="up"]');
    const down = card.querySelector('[data-move-entry="down"]');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === cards.length - 1;
  });
}

function moveExperience(button) {
  const preview = button.closest('.experience-preview');
  const direction = button.dataset.moveEntry;
  const forward = direction === 'down';
  const neighbor = forward ? 'nextElementSibling' : 'previousElementSibling';
  let card = button.closest('.item-card');
  let target = card?.[neighbor];
  while (target?.hidden) target = target[neighbor];
  if (preview) {
    const module = preview.closest('[data-module]')?.dataset.module;
    const container = document.getElementById(EXPERIENCE_LIST_IDS[module]);
    const cards = [...(container?.children || [])];
    card = cards.find(entry => entry.dataset.entryId === preview.dataset.entryId);
    target = cards.find(entry => entry.dataset.entryId === preview[neighbor]?.dataset.entryId);
  }
  if (!card || !target || card.parentElement !== target.parentElement) return;
  const list = card.parentElement;
  list.insertBefore(card, forward ? target.nextElementSibling : target);
  syncExperienceOrder(list);
  if (list.id === 'workList') applyWorkModuleFilter();
  debouncedSave();
  saveProfile({ silent: true });
  if (preview) {
    const id = preview.dataset.entryId;
    const scope = preview.closest('[data-module]').dataset.module;
    renderProfileOverview();
    const moved = [...document.querySelectorAll(`#profileOverview [data-module="${scope}"] .experience-preview`)]
      .find(entry => entry.dataset.entryId === id);
    const next = moved?.querySelector(`[data-move-entry="${direction}"]:not(:disabled)`);
    (next || moved?.querySelector('[data-move-entry]:not(:disabled)'))?.focus({ preventScroll: true });
  } else {
    (button.disabled ? card.querySelector('[data-move-entry]:not(:disabled)') : button)?.focus({ preventScroll: true });
  }
}

function renderAwardsList(awardsList) {
  const container = document.getElementById('awardsList');
  if (!container) return;
  container.innerHTML = '';

  awardsList.forEach((award, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4><span class="item-index">${String(index + 1).padStart(2, '0')}</span><span>${html(award.name || '未填写奖项')}</span></h4>
        <button type="button" class="btn-delete" data-id="${attr(award.id)}" data-type="award">删除奖项</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label>奖项 / 竞赛全称 <span class="required">*</span></label>
          <input type="text" class="award-name" data-id="${attr(award.id)}" value="${attr(award.name)}" placeholder="例如: 国家奖学金 / ACM-ICPC 区域赛金奖">
        </div>
        <div class="form-group">
          <label>获奖级别</label>
          <div class="select-box">
            <select class="award-level">
              <option value="">请选择</option>
              <option value="国际级">国际级</option>
              <option value="国家级" ${award.level === '国家级' ? 'selected' : ''}>国家级</option>
              <option value="省级">省级</option>
              <option value="省部级" ${award.level === '省部级' ? 'selected' : ''}>省部级</option>
              <option value="校级" ${award.level === '校级' ? 'selected' : ''}>校级</option>
              <option value="院系级" ${award.level === '院系级' ? 'selected' : ''}>院系级</option>
              <option value="企业级/行业级" ${award.level === '企业级/行业级' ? 'selected' : ''}>企业级/行业级</option>
            </select>
            <svg class="field-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
        </div>
        <div class="form-group">
          <label>获奖时间</label>
          <input type="text" class="award-date" value="${attr(award.date)}" placeholder="例如: 2024-11">
        </div>
      </div>
    `;
    setFieldValue(card.querySelector('.award-level'), award.level);
    appendExtendedFields(card, 'awards', award, ['category', 'grade', 'issuer', 'description']);
    wrapExtendedCollapse(card, 'awards', award, '奖励原因、名次与链接', ['reason', 'rank', 'role', 'url']);
    enhanceItemCard(card, award.id);
    container.appendChild(card);
  });

  container.querySelectorAll('.btn-delete[data-type="award"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteAward(e.currentTarget.getAttribute('data-id')));
  });

  syncExperienceOrder(container);
  initAllAppleSelects(container);
}

function renderFamilyList(members) {
  const container = document.getElementById('familyList');
  if (!container) return;
  container.innerHTML = '';
  members.forEach((member, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    const fieldId = `family-card-${crypto.randomUUID()}`;
    card.innerHTML = `
      <div class="item-card-header">
        <h4><span class="item-index">${String(index + 1).padStart(2, '0')}</span><span>${html(member.name || '未填写成员')}${member.relation ? ` · ${html(member.relation)}` : ''}</span></h4>
        <button type="button" class="btn-delete" data-id="${attr(member.id)}" data-type="family">删除成员</button>
      </div>
      <div class="form-row">
        <div class="form-group"><label for="${fieldId}-name">姓名</label><input id="${fieldId}-name" type="text" class="family-name" data-id="${attr(member.id)}" value="${attr(member.name)}"></div>
        <div class="form-group"><label for="${fieldId}-relation">与本人关系</label><input id="${fieldId}-relation" type="text" class="family-relation" value="${attr(member.relation)}" placeholder="父亲 / 母亲 / 配偶"></div>
        <div class="form-group"><label for="${fieldId}-phone">联系电话</label><input id="${fieldId}-phone" type="tel" class="family-phone" value="${attr(member.phone)}"></div>
        <div class="form-group"><label for="${fieldId}-occupation">职业</label><input id="${fieldId}-occupation" type="text" data-ext-key="occupation" value="${attr(member.occupation)}" placeholder="例如 教师、个体经营者"></div>
        <div class="form-group"><label for="${fieldId}-employer">工作单位</label><input id="${fieldId}-employer" type="text" class="family-employer" value="${attr(member.employer)}" placeholder="例如 某某学校、某某商行"></div>
        <div class="form-group"><label for="${fieldId}-position">职务</label><input id="${fieldId}-position" type="text" class="family-position" value="${attr(member.position)}" placeholder="例如 班主任、店主"></div>
      </div>`;
    appendExtendedFields(card, 'familyMembers', member, ['birthDate', 'age', 'politicalStatus', 'homeAddress']);
    enhanceItemCard(card, member.id);
    container.appendChild(card);
  });
  container.querySelectorAll('.btn-delete[data-type="family"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteFamilyMember(e.currentTarget.getAttribute('data-id')));
  });
  syncExperienceOrder(container);
}

function renderCertificatesList(certificates) {
  const container = document.getElementById('certificatesList');
  if (!container) return;
  container.innerHTML = '';
  certificates.forEach((certificate, index) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.innerHTML = `
      <div class="item-card-header">
        <h4><span class="item-index">${String(index + 1).padStart(2, '0')}</span><span>${html(certificate.name || '未填写证书')}</span></h4>
        <button type="button" class="btn-delete" data-id="${attr(certificate.id)}" data-type="certificate">删除证书</button>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group"><label>证书名称</label><input type="text" class="certificate-name" data-id="${attr(certificate.id)}" value="${attr(certificate.name)}"></div>
        <div class="form-group"><label>证书编号</label><input type="text" class="certificate-code" value="${attr(certificate.code)}"></div>
        <div class="form-group"><label>颁发机构</label><input type="text" class="certificate-issuer" value="${attr(certificate.issuer)}"></div>
      </div>
      <details class="ext-collapse">
        <summary class="ext-collapse-toggle">证书有效期与说明</summary>
        <div class="ext-collapse-body">
          <div class="form-group"><label>有效期至</label><input type="text" class="certificate-expiry" value="${attr(certificate.expiryDate)}" placeholder="例如: 2030-06 / 长期"></div>
        </div>
      </details>`;
    const supplement = card.querySelector('details');
    const grid = appendExtendedFields(card, 'certificates', certificate, ['level'], { before: supplement });
    grid.insertAdjacentHTML('afterbegin', `
      <div class="form-group"><label>取得日期</label><input type="text" class="certificate-date" value="${attr(certificate.date)}" placeholder="例如: 2025-06"></div>`);
    appendExtendedFields(supplement.querySelector('.ext-collapse-body'), 'certificates', certificate, ['description']);
    enhanceItemCard(card, certificate.id);
    container.appendChild(card);
  });
  container.querySelectorAll('.btn-delete[data-type="certificate"]').forEach((btn) => {
    btn.addEventListener('click', (e) => deleteCertificate(e.currentTarget.getAttribute('data-id')));
  });
  syncExperienceOrder(container);
}

function renderSkillsList(skills) {
  const container = document.getElementById('skillsList');
  container.innerHTML = '';
  skills.forEach((skill, index) => appendSkillCard(container, skill, index));
  syncExperienceOrder(container);
}

const IT_SKILL_GROUPS = [
  ['办公与协作', ['Office', 'Excel', 'Word', 'PowerPoint', 'Access', 'Visio', 'WPS']],
  ['数据分析与统计', ['数据分析', '数据建模', '数据挖掘', 'SPSS', 'SAS', 'R语言', 'MATLAB', 'Stata', 'Power BI', 'Tableau', 'OLAP']],
  ['数据库与大数据', ['SQL', 'MySQL', 'SQL Server', 'Oracle', 'DB2', 'PostgreSQL', 'SQLite', 'Redis', 'MongoDB', 'Hive', 'Hadoop', 'Spark', 'Sybase', 'ERwin']],
  ['编程与软件开发', ['Python', 'Java', 'C/C++', 'C', 'C++', 'C#', 'C#.NET', '.NET', 'ASP.NET', 'Visual Basic', 'Go', 'Rust', 'Ruby', 'PHP', 'Lua', 'Perl', 'Clojure']],
  ['网页与移动开发', ['Web前端', 'HTML5', 'CSS', 'JavaScript', 'TypeScript', 'React', 'Vue', 'Android', 'iOS', 'XML/XSLT', 'ActiveX', 'SEO']],
  ['系统与开发工具', ['Linux', 'Shell', 'Git', 'Docker', 'Kubernetes']],
  ['设计与多媒体', ['UI', 'PS', 'Figma', 'AutoCAD', 'CATIA', 'CorelDRAW', '3D Studio', '3D Studio MAX', 'Blender', 'Maya', 'LightWave', 'PageMaker', 'Dreamweaver', 'Director', 'FrontPage', 'Flash', 'GoLive']]
];
const IT_SKILL_LEVELS = [['', ['一般', '良好', '熟悉', '精通', '了解', '熟练']]];

function bindSkillPicker(input, groups) {
  const root = input.parentElement;
  const menu = root.querySelector('[role="listbox"]');
  const toggle = root.querySelector('button');
  const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  let options = [];
  let active = -1;

  function highlight(index) {
    options[active]?.classList.remove('is-active');
    active = index;
    const option = options[active];
    if (!option) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    option.classList.add('is-active');
    input.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }

  function close() {
    menu.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    highlight(-1);
  }

  function open(query = '') {
    const search = normalize(query);
    let count = 0;
    menu.innerHTML = groups.map(([group, names]) => {
      const items = names.filter(name => normalize(group + name).includes(search)).map(name =>
        `<div id="${menu.id}-${++count}" class="skill-picker-option" role="option" aria-selected="${name === input.value}">${html(name)}</div>`
      ).join('');
      if (!items || !group) return items;
      return `<div role="group" aria-label="${attr(group)}"><div class="skill-picker-group" aria-hidden="true">${html(group)}</div>${items}</div>`;
    }).join('') || '<p class="skill-picker-empty">没有匹配项，保留输入内容即可。</p>';
    options = [...menu.querySelectorAll('[role="option"]')];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    const { top, bottom } = root.getBoundingClientRect();
    const below = window.innerHeight - bottom;
    const above = top - (document.querySelector('.navbar')?.getBoundingClientRect().bottom || 0);
    const flip = below < 200 && above > below;
    menu.classList.toggle('opens-up', flip);
    menu.style.setProperty('--skill-menu-height', `${Math.max(80, Math.min(300, (flip ? above : below) - 12))}px`);
    menu.hidden = false;
    menu.scrollTop = 0;
    input.setAttribute('aria-expanded', 'true');
  }

  function choose(option) {
    input.value = option.textContent;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    close();
  }

  input.addEventListener('focus', () => open());
  input.addEventListener('click', () => { if (menu.hidden) open(); });
  input.addEventListener('blur', close);
  input.addEventListener('input', () => open(input.value));
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (menu.hidden) open();
      if (options.length) {
        const next = event.key === 'ArrowDown' ? active + 1 : active < 0 ? options.length - 1 : active - 1;
        highlight(Math.min(options.length - 1, Math.max(0, next)));
      }
    } else if (event.key === 'Enter' && !menu.hidden) {
      event.preventDefault();
      if (active >= 0) choose(options[active]);
      else close();
    }
  });
  toggle.addEventListener('mousedown', event => event.preventDefault());
  toggle.addEventListener('click', () => {
    const wasOpen = !menu.hidden;
    input.focus();
    if (wasOpen) close();
    else open();
  });
  menu.addEventListener('mousedown', event => {
    if (event.target.closest('[role="option"]')) event.preventDefault();
  });
  menu.addEventListener('click', event => {
    const option = event.target.closest('[role="option"]');
    if (option) choose(option);
  });
}

function skillPickerMarkup(id, label, fieldClass, value, placeholder) {
  return `<div class="form-group"><label for="${id}">${label}</label>
    <div class="skill-picker">
      <input id="${id}" type="text" class="${fieldClass}" value="${attr(value)}" placeholder="${placeholder}"
        role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${id}-options" autocomplete="off">
      <button type="button" class="skill-picker-toggle" tabindex="-1" aria-label="展开${label}">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
      </button>
      <div id="${id}-options" class="skill-picker-menu" role="listbox" aria-label="${label}选项" hidden></div>
    </div></div>`;
}

function appendSkillCard(container, skill, index = container.children.length) {
  const card = document.createElement('div');
  card.className = 'item-card';
  const fieldId = `skill-card-${crypto.randomUUID()}`;
  card.innerHTML = `<div class="item-card-header"><h4><span class="item-index">${index + 1}</span><span>${html(skill.name || '新技能')}</span></h4>
    <button type="button" class="btn-delete">删除技能</button></div>
    <div class="form-row skill-fields">
      ${skillPickerMarkup(`${fieldId}-name`, '技能名称', 'skill-name', skill.name, '搜索技能或直接输入')}
      ${skillPickerMarkup(`${fieldId}-level`, '掌握程度', 'skill-proficiency', skill.proficiency, '选择或输入掌握程度')}
      <div class="form-group"><label for="${fieldId}-category">自定义分类 <span class="label-tip">选填</span></label>
        <input id="${fieldId}-category" type="text" class="skill-category" value="${attr(skill.category)}" placeholder="例如 数据分析、办公软件"></div>
      <div class="form-group"><label for="${fieldId}-notes">补充说明 <span class="label-tip">选填</span></label>
        <textarea id="${fieldId}-notes" class="skill-description" rows="2" placeholder="例如 能用数据透视表制作业务报表">${html(skill.description)}</textarea></div>
    </div>`;
  const name = card.querySelector('.skill-name');
  bindSkillPicker(name, IT_SKILL_GROUPS);
  bindSkillPicker(card.querySelector('.skill-proficiency'), IT_SKILL_LEVELS);
  name.addEventListener('input', () => { card.querySelector('.item-index + span').textContent = name.value.trim() || '新技能'; });
  card.querySelector('.btn-delete').onclick = () => { card.remove(); syncExperienceOrder(container); debouncedSave(); };
  enhanceItemCard(card, skill.id);
  container.append(card);
  return name;
}

function collectSkillsData() {
  return [...document.querySelectorAll('#skillsList > .item-card')].map(card => ({ id: card.dataset.entryId,
    name: card.querySelector('.skill-name').value.trim(), proficiency: card.querySelector('.skill-proficiency').value.trim(),
    category: card.querySelector('.skill-category').value.trim(), description: card.querySelector('.skill-description').value.trim()
  })).filter(skill => skill.name || skill.proficiency || skill.category || skill.description);
}

function bindEvents() {
  document.getElementById('navProfileDropdownBtn')?.addEventListener('click', toggleNavCustomDropdown);
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('navProfileDropdown');
    if (dropdown && !dropdown.contains(e.target)) {
      closeNavCustomDropdown();
    }
    if (!e.target.closest('.apple-custom-select-box')) {
      document.querySelectorAll('.apple-custom-select-box.is-open').forEach((b) => b.classList.remove('is-open'));
    }
    if (!e.target.closest('.apple-status-dropdown-box')) {
      document.querySelectorAll('.apple-status-dropdown-box.is-open').forEach((b) => b.classList.remove('is-open'));
    }
  });

  document.getElementById('profileSelect')?.addEventListener('change', async (e) => {
    await switchProfile(e.target.value);
  });
  document.getElementById('renameProfileBtn')?.addEventListener('click', renameCurrentProfile);
  document.getElementById('addProfileBtn').addEventListener('click', addNewProfile);
  document.getElementById('saveBtn').addEventListener('click', finishWorkspaceEdit);
  document.getElementById('saveBtn2').addEventListener('click', () => saveProfile());
  document.getElementById('sidebarSaveBtn')?.addEventListener('click', finishWorkspaceEdit);
  document.getElementById('finishModuleEditBtn').addEventListener('click', finishWorkspaceEdit);
  document.querySelector('.profile-main')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-move-entry]');
    if (button) moveExperience(button);
  });
  document.getElementById('exportBackupBtn')?.addEventListener('click', exportBackup);
  document.getElementById('importBackupBtn')?.addEventListener('click', () => document.getElementById('importBackupFile').click());
  document.getElementById('importBackupFile')?.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    await importBackup(file);
  });
  document.getElementById('deleteProfileBtn').addEventListener('click', deleteCurrentProfile);
  document.getElementById('deleteProfileRailBtn')?.addEventListener('click', deleteCurrentProfile);
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.jobAutofillData) {
      const nextProfiles = changes.jobAutofillData.newValue?.profiles;
      allProfiles = Array.isArray(nextProfiles) ? nextProfiles : [];
      updateDeleteProfileAction();
    }
    const theme = changes.jobAutofillData?.newValue?.settings?.uiTheme;
    if (area === 'local' && (theme === 'light' || theme === 'dark')) {
      applyThemeFromSettings({ success: true, settings: { uiTheme: theme } });
    }
  });
  initSidebarNav();

  // 工作区：编辑模块返回概览 + 概览卡片按钮（概览 DOM 会被整体重建，用委托）。
  // 注意 [data-edit-module] 是模块卡“编辑”按钮的既定选择器（回归测试按 strict 模式取唯一元素），
  // 工作台头部动作与缺失项快捷改用 [data-goto-module]，避免选择器歧义。
  document.getElementById('backToOverviewBtn')?.addEventListener('click', () => navigateWorkspace('overview'));
  document.getElementById('profileOverview')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-edit-entry]')?.closest('.experience-preview');
    if (row) {
      const module = row.closest('[data-module]').dataset.module;
      navigateWorkspace(module, true);
      const list = document.getElementById(EXPERIENCE_LIST_IDS[module]);
      const card = [...(list?.children || [])].find(entry => entry.dataset.entryId === row.dataset.entryId);
      if (card?.classList.contains('is-collapsed-item')) card.querySelector('.item-collapse-btn').click();
      card?.scrollIntoView({ block: 'center' });
      card?.querySelector('input')?.focus({ preventScroll: true });
      return;
    }
    const editBtn = e.target.closest('[data-edit-module]');
    if (editBtn) {
      navigateWorkspace(editBtn.getAttribute('data-edit-module'), true);
      return;
    }
    const moduleBtn = e.target.closest('[data-goto-module]');
    if (moduleBtn) {
      navigateWorkspace(moduleBtn.getAttribute('data-goto-module'), true);
      return;
    }
    if (e.target.closest('[data-create-profile]')) addNewProfile();
  });

  document.getElementById('addEducationBtn').addEventListener('click', () => addEducation());
  document.getElementById('addWorkBtn').addEventListener('click', () => addWorkExperience());
  document.getElementById('addProjectBtn').addEventListener('click', () => addProject());
  const addAwardBtn = document.getElementById('addAwardBtn');
  if (addAwardBtn) addAwardBtn.addEventListener('click', () => addAward());
  document.getElementById('addFamilyBtn')?.addEventListener('click', addFamilyMember);
  document.getElementById('addCertificateBtn')?.addEventListener('click', addCertificate);

  document.getElementById('addSkillBtn').addEventListener('click', addSkill);

  document.querySelectorAll('.btn-template').forEach((btn) => {
    btn.addEventListener('click', (e) => loadIntroductionTemplate(e.target.getAttribute('data-template')));
  });

  const removeAttachmentBtn = document.getElementById('removeResumeFileBtn');
  if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener('click', async () => {
      try { await changeAttachment('deleteAttachment', 'resume', { id: currentProfile.attachments?.resume?.id }); }
      catch (error) { showToast(error.message, 'error'); return; }
      clearSelectedAiResumeFile();
    });
  }
  document.getElementById('parseTextBtn').addEventListener('click', parseResumeText);

  // HR 打招呼语事件监听
  const greetingTextEl = document.getElementById('hrGreetingText');
  if (greetingTextEl) {
    greetingTextEl.addEventListener('input', (e) => {
      updateGreetingCharCount(e.target.value);
      debouncedSave();
    });
  }

  const copyGreetingBtn = document.getElementById('copyGreetingBtn');
  if (copyGreetingBtn) {
    copyGreetingBtn.addEventListener('click', async () => {
      const text = document.getElementById('hrGreetingText')?.value.trim();
      if (!text) {
        showToast('打招呼语为空，请先点击「AI 重新生成」或上传简历', 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast('✅ 打招呼语已复制，可直接发送给 HR！', 'success');
      } catch (e) {
        showToast('复制失败，请手动选中文本复制', 'error');
      }
    });
  }

  const regenerateGreetingBtn = document.getElementById('regenerateGreetingBtn');
  if (regenerateGreetingBtn) {
    regenerateGreetingBtn.addEventListener('click', async () => {
      const btn = regenerateGreetingBtn;
      const resp = await sendMessage({ action: 'getSettings' });
      const settings = resp?.settings || {};
      if (!settings.aiEnabled || !settings.aiApiKey) {
        showToast('请先在上方启用 AI 并填写 API Key', 'warning');
        return;
      }
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner-ring" style="width:12px;height:12px;border-width:2px;display:inline-block;"></div><span>生成中...</span>';
      showToast('正在提炼高转化 HR 打招呼自荐语...', 'info');

      try {
        const profileData = collectProfileUpdates();
        const rawText = document.getElementById('resumeText')?.value.trim();
        const inputData = (rawText && rawText.length > 50) ? rawText : profileData;
        const greeting = await resumeParser.generateHrGreeting(inputData, settings);

        const targetEl = document.getElementById('hrGreetingText');
        if (targetEl) {
          targetEl.value = greeting;
          updateGreetingCharCount(greeting);
        }
        if (currentProfile) {
          currentProfile.hrGreeting = greeting;
        }
        await saveProfile({ silent: true });
        showToast('✅ HR 打招呼语已重新生成并保存！', 'success');
      } catch (err) {
        console.error('[生成打招呼语失败]:', err);
        showToast(`❌ 生成失败: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    });
  }

  const aiUploadBtn = document.getElementById('aiUploadBtn');
  const aiResumeFile = document.getElementById('aiResumeFile');
  if (aiUploadBtn && aiResumeFile) {
    aiUploadBtn.addEventListener('click', () => aiResumeFile.click());
    aiResumeFile.addEventListener('change', handleAiFileImport);
  }
  const resumeText = document.getElementById('resumeText');
  if (resumeText) {
    resumeText.addEventListener('input', () => {
      if (!selectedAiResumeFile) return;
      cancelOngoingAiParse();
      selectedAiResumeFile = null;
      if (aiResumeFile) aiResumeFile.value = '';
      setAiFileStatus('已切换为粘贴文本模式，将直接解析下方文字。', 'text');
    });
  }

  document.getElementById('aiEnabled').addEventListener('change', (e) => {
    document.getElementById('aiSettings').style.display = e.target.checked ? 'block' : 'none';
    autoSaveAiSettings();
    if (e.target.checked && document.getElementById('aiApiKey').value.trim()) {
      refreshModelList({ silent: true });
    }
  });
  document.getElementById('aiSmartFill')?.addEventListener('change', () => {
    autoSaveAiSettings();
  });
  document.getElementById('aiProvider').addEventListener('change', async () => {
    populateModelSelect([], '');
    document.getElementById('aiModelCustom').value = '';
    setModelHint('提供商已切换，请重新获取可用模型');
    await autoSaveAiSettings();
    if (document.getElementById('aiApiKey').value.trim()) {
      refreshModelList({ silent: true });
    }
  });
  document.getElementById('aiApiKey').addEventListener('input', () => {
    clearTimeout(aiKeySaveTimer);
    aiKeySaveTimer = setTimeout(async () => {
      await autoSaveAiSettings();
      const key = document.getElementById('aiApiKey').value.trim();
      if (key.length >= 16) refreshModelList({ silent: true });
    }, 600);
  });
  document.getElementById('aiApiUrl').addEventListener('input', () => {
    clearTimeout(aiUrlSaveTimer);
    aiUrlSaveTimer = setTimeout(async () => {
      await autoSaveAiSettings();
      if (document.getElementById('aiApiKey').value.trim()) {
        refreshModelList({ silent: true });
      }
    }, 600);
  });
  document.getElementById('aiModel').addEventListener('change', async () => {
    syncCustomModelVisibility();
    await autoSaveAiSettings();
  });
  document.getElementById('aiModelCustom').addEventListener('input', () => {
    clearTimeout(aiModelSaveTimer);
    aiModelSaveTimer = setTimeout(autoSaveAiSettings, 400);
  });
  document.getElementById('refreshModelsBtn').addEventListener('click', () => refreshModelList());
  document.getElementById('testAiBtn').addEventListener('click', testAiConnection);

  for (const eventName of ['input', 'change']) {
    document.getElementById('view-profile').addEventListener(eventName, event => {
      const input = event.target;
      if (!input.matches('input,select,textarea') || input.type === 'file' || input.closest('#section-ai,#section-parser,.module-tiles')) return;
      debouncedSave();
      if (eventName === 'change' && input.matches('.work-type')) applyWorkModuleFilter();
    });
  }
  window.addEventListener('blur', () => { if (profileDirty) flushProfileSave(); });
  window.addEventListener('beforeunload', event => {
    if (!profileDirty && (savedAiSettingsFingerprint === null ||
        savedAiSettingsFingerprint === JSON.stringify(collectAiSettingsFromDom()))) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

async function switchProfile(profileId) {
  if (!await flushProfileSave()) return;
  const response = await sendMessage({ action: 'setActiveProfile', profileId });
  if (response.success) {
    clearSelectedAiResumeFile();
    await loadProfiles();
    showToast('已切换资料', 'success');
  }
}

async function addNewProfile() {
  const creation = await chooseNewProfile(allProfiles, activeProfileId);
  if (!creation || !await flushProfileSave()) return;
  const response = await sendMessage({ action: 'addProfile', ...creation });
  if (!response?.success) {
    showToast(response?.error || '创建简历失败，请重试', 'error');
    return;
  }
  clearSelectedAiResumeFile();
  await loadProfiles();
  showToast('新简历已创建', 'success');
}

async function renameCurrentProfile() {
  if (!currentProfile) {
    showToast('当前没有选中的资料', 'warning');
    return;
  }
  const oldName = currentProfile.name || '默认资料';
  const newName = await showApplePrompt({
    title: '重命名当前资料档案',
    subtitle: '修改此份简历的名称，便于在投递不同岗位时快速识别',
    defaultValue: oldName,
    placeholder: '例如：前端开发版 / 字节跳动专版 / 英文外企版',
    confirmText: '保存修改'
  });
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    showToast('资料档案名称不能为空', 'warning');
    return;
  }
  if (trimmed === oldName) return;

  const response = await sendMessage({
    action: 'updateProfile',
    profileId: activeProfileId,
    updates: { name: trimmed }
  });

  if (response && response.success) {
    currentProfile.name = trimmed;
    const select = document.getElementById('profileSelect');
    if (select) {
      const option = select.querySelector(`option[value="${activeProfileId}"]`);
      if (option) option.textContent = trimmed;
    }
    renderNavCustomDropdown();
    showToast(`✅ 资料档案已重命名为: 「${trimmed}」`, 'success');
  } else {
    showToast('重命名失败，请重试', 'error');
  }
}

function collectEducationData() {
  const education = [];
  document.querySelectorAll('#educationList .item-card').forEach((card) => {
    education.push({
      ...readExtendedFields(card),
      id: card.querySelector('.edu-school').getAttribute('data-id') || generateId(),
      school: card.querySelector('.edu-school').value.trim(),
      college: card.querySelector('.edu-college')?.value.trim() || '',
      major: card.querySelector('.edu-major').value.trim(),
      degree: card.querySelector('.edu-degree').value,
      degreeType: card.querySelector('.edu-degree-type')?.value || '',
      schoolType: card.querySelector('.edu-school-type')?.value || '',
      gpa: card.querySelector('.edu-gpa').value.trim(),
      rank: card.querySelector('.edu-rank')?.value.trim() || '',
      startDate: card.querySelector('.edu-start')?.value.trim() || '',
      endDate: card.querySelector('.edu-end')?.value.trim() || '',
      courses: card.querySelector('.edu-courses')?.value.trim() || '',
      description: card.querySelector('.edu-description')?.value.trim() || ''
    });
  });
  return education;
}

function collectWorkData() {
  const work = [];
  document.querySelectorAll('#workList .item-card').forEach((card) => {
    work.push({
      ...readExtendedFields(card),
      id: card.querySelector('.work-company').getAttribute('data-id') || generateId(),
      company: card.querySelector('.work-company').value.trim(),
      department: card.querySelector('.work-department')?.value.trim() || '',
      position: card.querySelector('.work-position').value.trim(),
      workType: card.querySelector('.work-type')?.value || '',
      city: card.querySelector('.work-city')?.value.trim() || '',
      startDate: card.querySelector('.work-start')?.value.trim() || '',
      endDate: card.querySelector('.work-end')?.value.trim() || '',
      description: card.querySelector('.work-desc').value.trim(),
      achievements: card.querySelector('.work-achievements')?.value.trim() || ''
    });
  });
  return work;
}

function collectProjectData() {
  const projects = [];
  document.querySelectorAll('#projectList .item-card').forEach((card) => {
    const tech = card.querySelector('.proj-tech')?.value.trim() || '';
    projects.push({
      ...readExtendedFields(card),
      id: card.querySelector('.proj-name').getAttribute('data-id') || generateId(),
      name: card.querySelector('.proj-name').value.trim(),
      role: card.querySelector('.proj-role').value.trim(),
      projectType: card.querySelector('.proj-type')?.value || '',
      techStack: tech,
      startDate: card.querySelector('.proj-start')?.value.trim() || '',
      endDate: card.querySelector('.proj-end')?.value.trim() || '',
      projectUrl: card.querySelector('.proj-url')?.value.trim() || '',
      description: card.querySelector('.proj-desc').value.trim(),
      responsibilities: card.querySelector('.proj-resp')?.value.trim() || '',
      achievements: card.querySelector('.proj-achieve')?.value.trim() || ''
    });
  });
  return projects;
}

function collectAwardsData() {
  const awards = [];
  document.querySelectorAll('#awardsList .item-card').forEach((card) => {
    awards.push({
      ...readExtendedFields(card),
      id: card.querySelector('.award-name').getAttribute('data-id') || generateId(),
      name: card.querySelector('.award-name').value.trim(),
      level: card.querySelector('.award-level')?.value || '',
      date: card.querySelector('.award-date')?.value.trim() || ''
    });
  });
  return awards;
}

function collectFamilyData() {
  return [...document.querySelectorAll('#familyList .item-card')].map((card) => ({
    ...readExtendedFields(card),
    id: card.querySelector('.family-name')?.getAttribute('data-id') || generateId(),
    name: card.querySelector('.family-name')?.value.trim() || '',
    relation: card.querySelector('.family-relation')?.value.trim() || '',
    employer: card.querySelector('.family-employer')?.value.trim() || '',
    position: card.querySelector('.family-position')?.value.trim() || '',
    phone: card.querySelector('.family-phone')?.value.trim() || ''
  }));
}

function collectCertificatesData() {
  return [...document.querySelectorAll('#certificatesList .item-card')].map((card) => ({
    ...readExtendedFields(card),
    id: card.querySelector('.certificate-name')?.getAttribute('data-id') || generateId(),
    name: card.querySelector('.certificate-name')?.value.trim() || '',
    code: card.querySelector('.certificate-code')?.value.trim() || '',
    issuer: card.querySelector('.certificate-issuer')?.value.trim() || '',
    date: card.querySelector('.certificate-date')?.value.trim() || '',
    expiryDate: card.querySelector('.certificate-expiry')?.value.trim() || ''
  }));
}

function collectProfileUpdates() {
  const updates = {
    moduleConfig: resumeModuleConfig(currentProfile),
    basicInfo: {
      fullName: document.getElementById('fullName').value.trim(),
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      email: document.getElementById('email').value.trim(),
      gender: document.getElementById('gender').value,
      birthDate: document.getElementById('birthDate').value,
      idCard: document.getElementById('idCard').value.trim(),
      politicalStatus: document.getElementById('politicalStatus')?.value || '',
      ethnicity: document.getElementById('ethnicity')?.value.trim() || '',
      hometown: document.getElementById('hometown')?.value.trim() || '',
      graduationDate: document.getElementById('graduationDate')?.value.trim() || '',
      maritalStatus: document.getElementById('maritalStatus')?.value || '',
      currentCity: document.getElementById('currentCity')?.value.trim() || '',
      emergencyContact: document.getElementById('emergencyContact')?.value.trim() || '',
      emergencyRelation: document.getElementById('emergencyRelation')?.value.trim() || '',
      emergencyPhone: document.getElementById('emergencyPhone')?.value.trim() || '',
      city: document.getElementById('city').value.trim(),
      state: document.getElementById('state').value.trim(),
      country: document.getElementById('country').value.trim(),
      zipCode: document.getElementById('zipCode').value.trim(),
      street: document.getElementById('street').value.trim(),
      homeAddress: document.getElementById('homeAddress').value.trim(),
      linkedin: document.getElementById('linkedin').value.trim(),
      github: document.getElementById('github').value.trim(),
      website: document.getElementById('website').value.trim(),
      twitter: document.getElementById('twitter').value.trim()
    },
    jobIntention: {
      expectedCity: document.getElementById('expectedCity')?.value.trim() || '',
      expectedPosition: document.getElementById('expectedPosition')?.value.trim() || '',
      expectedIndustry: document.getElementById('expectedIndustry')?.value.trim() || '',
      expectedSalary: document.getElementById('expectedSalary')?.value.trim() || '',
      currentSalary: document.getElementById('currentSalary')?.value.trim() || '',
      availableDate: document.getElementById('availableDate')?.value.trim() || '',
      referralCode: document.getElementById('referralCode')?.value.trim() || '',
      recruitSource: document.getElementById('recruitSource')?.value.trim() || '',
      willingToTravel: document.getElementById('willingToTravel')?.value || ''
    },
    awards: collectAwardsData(),
    familyMembers: collectFamilyData(),
    certificates: collectCertificatesData(),
    education: collectEducationData(),
    workExperience: collectWorkData(),
    projects: collectProjectData(),
    skills: collectSkillsData(),
    introTemplates: {
      default: document.getElementById('introduction').value.trim()
    },
    hrGreeting: document.getElementById('hrGreetingText')?.value.trim() || '',

  };
  const merged = mergeProfile(currentProfile || {}, collectExtendedProfile(updates));
  const aiToolsInput = document.querySelector('#section-aiTools [data-ext-key="aiTools"]');
  if (aiToolsInput) merged.commonAnswers = {...merged.commonAnswers, aiTools: aiToolsInput.value.trim()};
  delete merged.attachments; delete merged.resumeFile; delete merged.resumeFileName;
  return merged;
}

function debouncedSave() {
  profileDirty = true;
  profileEditRevision++;
  clearTimeout(profileSaveTimer);
  profileSaveTimer = setTimeout(() => {
    saveProfile({ silent: true }).catch((error) => {
      console.error('[自动保存] 失败:', error);
    });
  }, 600);
}

function saveProfile({ silent = false } = {}) {
  if (window.YanyuDates?.validate && !window.YanyuDates.validate()) {
    if (!silent) showToast(window.YanyuDates.error, 'error');
    return Promise.resolve(false);
  }
  clearTimeout(profileSaveTimer);
  const settings = collectAiSettingsFromDom();
  const snapshot = { silent, profileId: activeProfileId, updates: structuredClone(collectProfileUpdates()),
    settings: JSON.stringify(settings) === savedAiSettingsFingerprint ? null : settings, revision: profileEditRevision };
  pendingProfileSave = pendingProfileSave.catch(() => false).then(() => persistProfile(snapshot));
  return pendingProfileSave;
}

async function flushProfileSave() {
  while (true) {
    const revision = profileEditRevision;
    clearTimeout(profileSaveTimer);
    for (const timer of [aiKeySaveTimer, aiUrlSaveTimer, aiModelSaveTimer]) clearTimeout(timer);
    modelFetchSeq++;
    const profileSaved = await (profileDirty ? saveProfile({ silent: true }) : pendingProfileSave);
    if (!profileSaved) {
      if (window.YanyuDates?.error) showToast(window.YanyuDates.error, 'error');
      return false;
    }
    const settingsSaved = JSON.stringify(collectAiSettingsFromDom()) !== savedAiSettingsFingerprint
      ? await autoSaveAiSettings() : await pendingSettingsSave;
    if (!settingsSaved) return false;
    if (revision === profileEditRevision &&
        JSON.stringify(collectAiSettingsFromDom()) === savedAiSettingsFingerprint) return true;
  }
}

// 备份前由 background 定向请求各编辑页落盘；导入期间暂停编辑与定时保存。
chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  if (!editorDocumentId || request.documentId !== editorDocumentId) return;
  if (request.action === 'flushProfileEditor') {
    if (request.importing) document.body.inert = true;
    flushProfileSave().then(success => respond({ success })).catch(error => respond({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'finishProfileImport') {
    clearTimeout(profileSaveTimer);
    (async () => {
      try {
        if (request.success) { profileDirty = false; cancelOngoingAiParse(); await loadProfiles(); }
        respond({ success: true });
      } finally { document.body.inert = false; }
    })().catch(error => respond({ success: false, error: error.message }));
    return true;
  }
});

function backupChoiceDialog(title, summary, choices, confirmText) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'backup-choice-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const description = document.createElement('p');
    description.textContent = summary;
    const list = document.createElement('div');
    list.className = 'backup-choice-list';
    const inputs = choices.map(choice => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!choice.checked;
      label.append(input, document.createTextNode(choice.label));
      list.append(label);
      return input;
    });
    const form = document.createElement('form');
    form.method = 'dialog';
    form.className = 'backup-dialog-actions';
    for (const [label, value] of [['取消', 'cancel'], [confirmText, 'apply']]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.value = value;
      button.className = value === 'apply' ? 'shell-button backup-primary' : 'shell-button';
      form.append(button);
    }
    dialog.append(heading, description, list, form);
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      const values = dialog.returnValue === 'apply' ? Object.fromEntries(choices.map((choice, i) => [choice.key, inputs[i].checked])) : null;
      dialog.remove();
      resolve(values);
    }, { once: true });
    dialog.showModal();
  });
}

async function exportBackup(event) {
  try {
    const options = { includeApiKey: !!document.getElementById('backupIncludeKey')?.checked };
    const partial = event === 'partial';
    const scope = await backupChoiceDialog(partial ? '选择导出内容' : '导出全部资料',
      partial ? `选择一份或多份简历，再决定是否包含其他资料。${options.includeApiKey ? '勾选包含设置时也会导出 API Key。' : '本次不含 API Key。'}` : `备份全部 ${allProfiles.length} 份简历及附件、投递记录和设置。${options.includeApiKey ? '本次包含 API Key。' : '本次不含 API Key。'}`,
      partial ? [
        ...allProfiles.map(profile => ({ key: `profile:${profile.id}`, label: profile.name || '未命名简历', checked: profile.id === currentProfile?.id })),
        { key: 'includeAttachments', label: '包含所选简历的附件', checked: true },
        { key: 'includeSubmissions', label: '包含投递记录' }, { key: 'includeSettings', label: '包含设置' }
      ] : [], '下载 JSON');
    if (!scope) return;
    if (partial) {
      options.profileIds = allProfiles.filter(profile => scope[`profile:${profile.id}`]).map(profile => profile.id);
      if (!options.profileIds.length) throw new Error('请至少选择一份简历');
      for (const key of ['includeAttachments', 'includeSubmissions', 'includeSettings']) options[key] = scope[key];
    }
    const response = await sendMessage({ action: 'exportData', options });
    if (!response?.success) throw new Error(response?.error || '请重试');
    const backup = JSON.parse(response.data);
    const blob = new Blob([response.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `易offer-${partial ? '部分' : '全部'}备份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已开始下载 ${backup.profiles.length} 份简历的备份`, 'success');
  } catch (error) {
    showToast('导出失败：' + error.message, 'error');
  }
}

async function importBackup(file) {
  if (!file) return;
  try {
    const data = await file.text();
    const check = await sendMessage({ action: 'previewBackup', data });
    if (!check?.success) throw new Error(check?.error || '备份无法预览');
    const preview = check.preview;
    const conflicts = preview.profiles.filter(profile => profile.conflict);
    const choices = conflicts.map(profile => ({ key: `update:${profile.id}`, label: `更新已有简历「${profile.name}」` }));
    if (preview.hasSettings) choices.push({ key: 'restoreSettings', label: '恢复备份中的设置' });
    if (preview.hasApiKey) choices.push({ key: 'restoreApiKey', label: '恢复备份中的 API Key' });
    const selected = await backupChoiceDialog('预览资料恢复',
      `新增 ${preview.profiles.length - conflicts.length} 份简历 · ${conflicts.length} 份同 ID 简历默认跳过 · 备份含 ${preview.attachments} 个附件 · 合并 ${preview.newSubmissions} 条新投递记录 · 保留 ${preview.existingSubmissions} 条同 ID 投递记录。${preview.profiles.some(profile => !profile.conflict) ? '\n新增简历：' + preview.profiles.filter(profile => !profile.conflict).map(profile => profile.name).join('、') : ''}`, choices, '确认导入');
    if (!selected) return;
    const options = { updateIds: conflicts.filter(profile => selected[`update:${profile.id}`]).map(profile => profile.id),
      restoreSettings: selected.restoreSettings, restoreApiKey: selected.restoreApiKey };
    const response = await sendMessage({ action: 'importData', data, options });
    if (!response?.success) throw new Error(response?.error || '数据格式不匹配');
    showToast(`恢复完成 · 新增 ${response.added} · 更新 ${response.updated} · 跳过 ${response.skipped}`, 'success');
  } catch (error) {
    showToast('导入失败：' + error.message, 'error');
  }
}

async function persistProfile({ silent, profileId, updates, settings, revision }) {
  if (!profileId) {
    if (!silent) showToast('没有可保存的资料', 'error');
    return false;
  }


  try {
    const response1 = await sendMessage({
      action: 'updateProfile',
      profileId,
      updates
    });
    const response2 = settings ? await sendMessage({ action: 'updateSettings', settings }) : { success: true };
    if (settings && response2.success) savedAiSettingsFingerprint = JSON.stringify(settings);

    if (response1.success && response2.success) {
      if (profileId === activeProfileId && revision === profileEditRevision) {
        currentProfile = mergeProfile(currentProfile || {}, { ...updates, id: profileId });
        profileDirty = false;
      }
      if (typeof appLog !== 'undefined') appLog.success('options', 'profile.save', silent ? '资料已静默保存' : '资料已保存');
      if (!silent) showToast('资料与设置已保存', 'success');
      return true;
    }

    showToast(response1.error || response2.error || '保存失败，请重试', 'error');
    return false;
  } catch (error) {
    console.error('[保存] 失败:', error);
    showToast('保存失败: ' + error.message, 'error');
    return false;
  }
}

function addEducation() {
  if (!currentProfile) return;
  currentProfile.education = collectEducationData();
  currentProfile.education.push(emptyEducation());
  renderEducationList(currentProfile.education);
  debouncedSave();
}

async function deleteEducation(eduId) {
  const ok = await showAppleConfirm({
    title: '删除教育经历',
    subtitle: '确定要删除这条教育背景信息吗？删除后需手动重新填写',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.education = collectEducationData().filter((item) => item.id !== eduId);
  if (currentProfile.education.length === 0) currentProfile.education.push(emptyEducation());
  renderEducationList(currentProfile.education);
  debouncedSave();
}

function addWorkExperience() {
  if (!currentProfile) return;
  currentProfile.workExperience = collectWorkData();
  const entry = emptyWork();
  if (workspaceModule === 'internship') entry.workType = '实习';
  currentProfile.workExperience.push(entry);
  renderWorkList(currentProfile.workExperience);
  debouncedSave();
}

async function deleteWorkExperience(workId) {
  const ok = await showAppleConfirm({
    title: '删除工作经历',
    subtitle: '确定要删除这条工作/实习经历记录吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.workExperience = collectWorkData().filter((item) => item.id !== workId);
  if (currentProfile.workExperience.length === 0) {
    const entry = emptyWork();
    if (workspaceModule === 'internship') entry.workType = '实习';
    currentProfile.workExperience.push(entry);
  }
  renderWorkList(currentProfile.workExperience);
  debouncedSave();
}

function addProject() {
  if (!currentProfile) return;
  currentProfile.projects = collectProjectData();
  currentProfile.projects.push(emptyProject());
  renderProjectList(currentProfile.projects);
  debouncedSave();
}

async function deleteProject(projectId) {
  const ok = await showAppleConfirm({
    title: '删除项目经历',
    subtitle: '确定要删除这条项目经历记录吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.projects = collectProjectData().filter((item) => item.id !== projectId);
  if (currentProfile.projects.length === 0) currentProfile.projects.push(emptyProject());
  renderProjectList(currentProfile.projects);
  debouncedSave();
}

function addAward() {
  if (!currentProfile) return;
  currentProfile.awards = collectAwardsData();
  currentProfile.awards.push(emptyAward());
  renderAwardsList(currentProfile.awards);
  debouncedSave();
}

async function deleteAward(awardId) {
  const ok = await showAppleConfirm({
    title: '删除荣誉奖项',
    subtitle: '确定要删除这条奖项/证书记录吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.awards = collectAwardsData().filter((item) => item.id !== awardId);
  if (currentProfile.awards.length === 0) currentProfile.awards.push(emptyAward());
  renderAwardsList(currentProfile.awards);
  debouncedSave();
}

function addFamilyMember() {
  if (!currentProfile) return;
  currentProfile.familyMembers = collectFamilyData();
  currentProfile.familyMembers.push(emptyFamilyMember());
  renderFamilyList(currentProfile.familyMembers);
  debouncedSave();
}

async function deleteFamilyMember(memberId) {
  const ok = await showAppleConfirm({
    title: '删除家庭成员',
    subtitle: '确定要删除这条家庭成员信息吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.familyMembers = collectFamilyData().filter((item) => item.id !== memberId);
  if (!currentProfile.familyMembers.length) currentProfile.familyMembers.push(emptyFamilyMember());
  renderFamilyList(currentProfile.familyMembers);
  debouncedSave();
}

function addCertificate() {
  if (!currentProfile) return;
  currentProfile.certificates = collectCertificatesData();
  currentProfile.certificates.push(emptyCertificate());
  renderCertificatesList(currentProfile.certificates);
  debouncedSave();
}

async function deleteCertificate(certificateId) {
  const ok = await showAppleConfirm({
    title: '删除资格证书',
    subtitle: '确定要删除这条资格证书信息吗？',
    confirmText: '确定删除',
    isDanger: true
  });
  if (!ok) return;
  currentProfile.certificates = collectCertificatesData().filter((item) => item.id !== certificateId);
  if (!currentProfile.certificates.length) currentProfile.certificates.push(emptyCertificate());
  renderCertificatesList(currentProfile.certificates);
  debouncedSave();
}

function addSkill() {
  const list = document.getElementById('skillsList');
  appendSkillCard(list, { id: generateId() }).focus();
  syncExperienceOrder(list);
}

function loadIntroductionTemplate(type) {
  const templates = {
    tech: '热爱计算机与前沿技术，具备扎实的计算机基础与全栈项目实践经验，善于钻研技术难点，具备良好的工程规范与团队协作能力...',
    product: '具备严密的逻辑思维与同理心，熟悉互联网产品全流程生命周期，擅长需求分析、数据洞察与跨部门沟通协同...',
    ops: '对互联网运营充满热情，具备优秀的用户增长意识、内容策划能力与数据复盘能力，具备极强的执行力与自驱力...'
  };
  document.getElementById('introduction').value = templates[type] || '';
  debouncedSave();
}

function updateResumeAttachmentUI(fileName, fileSize = 0) {
  const card = document.getElementById('resumeAttachmentCard');
  const nameEl = document.getElementById('resumeFileName');
  const sizeEl = document.getElementById('resumeFileSize');
  const btnText = document.getElementById('aiUploadBtnText');
  if (!card || !nameEl) return;

  if (fileName) {
    card.style.display = 'flex';
    nameEl.textContent = fileName;
    if (sizeEl) {
      sizeEl.textContent = fileSize ? `（${formatAiFileSize(fileSize)}）` : '';
    }
    if (btnText) btnText.textContent = '更换简历源文件';
  } else {
    card.style.display = 'none';
    nameEl.textContent = '未上传简历文件';
    if (sizeEl) sizeEl.textContent = '';
    if (btnText) btnText.textContent = '上传 / 导入简历源文件';
  }
}

function setAiFileStatus(message, state = 'selected') {
  const status = document.getElementById('aiFileStatus');
  if (!status) return;
  status.hidden = !message;
  status.textContent = message || '';
  status.className = `ai-file-status is-${state}`;
}

function clearSelectedAiResumeFile({ keepStatus = false } = {}) {
  cancelOngoingAiParse();
  selectedAiResumeFile = null;
  const input = document.getElementById('aiResumeFile');
  if (input) input.value = '';
  if (!keepStatus) setAiFileStatus('');
}

function formatAiFileSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function handleAiParseProgress(progress, button) {
  if (!progress || !progress.message) return;
  let state = 'text';
  if (progress.stage === 'direct') state = 'direct';
  if (progress.stage === 'fallback') state = 'fallback';
  setAiFileStatus(progress.message, state);
  const label = button && button.querySelector('span');
  if (label) label.textContent = progress.message.replace(/…$/, '');
}

function handleAiFileImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  if (!resumeParser.isSupported(file)) {
    clearSelectedAiResumeFile();
    showToast('不支持的文件格式，请使用 PDF / Word / 图片 / TXT / MD / LaTeX / HTML', 'error');
    return;
  }

  // 新简历上传时中断上一轮还在进行的解析
  cancelOngoingAiParse();
  selectedAiResumeFile = file;

  // 自动保留源文件（用于网申页面自动上传简历附件）
  saveAttachmentFile('resume', file).catch(error => showToast(error.message, 'error'));

  document.getElementById('resumeText').value = '';
  setAiFileStatus(
    `已就绪：${file.name}（${formatAiFileSize(file.size)}），已自动绑定为网申简历附件；点击下方按钮即可一键解析。`,
    'selected'
  );
  showToast(`已上传 ${file.name} 并保存为简历源文件`, 'success');
}

function ensurePdfJs() {
  if (typeof pdfjsLib !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = '../vendor/pdfjs/pdf.min.js';
    el.onload = resolve;
    el.onerror = () => reject(new Error('PDF 引擎加载失败'));
    document.head.appendChild(el);
  });
}

async function parseResumeText() {
  const resumeTextArea = document.getElementById('resumeText');
  const resumeText = resumeTextArea.value.trim();
  const resumeFile = selectedAiResumeFile;
  if (!resumeFile && !resumeText) {
    showToast('请先粘贴简历内容，或从文件导入', 'warning');
    return;
  }

  const settings = collectAiSettingsFromDom();
  if (!settings.aiEnabled) {
    showToast('请先勾选启用 AI 功能', 'warning');
    return;
  }
  if (!settings.aiApiKey) {
    showToast('请先填写 API Key', 'warning');
    return;
  }
  if (!settings.aiModel) {
    showToast('请先获取并选择模型', 'warning');
    return;
  }

  await autoSaveAiSettings();

  const btn = document.getElementById('parseTextBtn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner-ring" style="width:14px;height:14px;border-width:2px;"></div><span>正在全量智能解析简历...</span>';
  showToast('正在解析简历，请稍候...', 'info');
  if (typeof appLog !== 'undefined') {
    appLog.info('options', 'parse.click', resumeFile ? `开始解析文件 ${resumeFile.name}` : '开始解析粘贴文本');
  }

  const runId = ++aiParseRunSeq;

  try {
    let parsedData;
    let parseResult = null;
    if (resumeFile) {
      if (/\.pdf$/i.test(resumeFile.name) || resumeFile.type === 'application/pdf') {
        await ensurePdfJs();
      }
      parseResult = await resumeParser.parseFileWithAI(resumeFile, settings, {
        fallbackText: resumeText,
        onProgress: (progress) => handleAiParseProgress(progress, btn)
      });

      // 等待期间用户重新上传了简历/切换了资料，本轮结果作废（须在改动任何 UI 前判断）
      if (runId !== aiParseRunSeq) return;

      parsedData = parseResult.data;

      if (parseResult.inputMode === 'text') {
        resumeTextArea.value = parseResult.extractedText || '';
        clearSelectedAiResumeFile({ keepStatus: true });
        setAiFileStatus(`${parseResult.fileName} 已提取文字并解析。`, 'fallback');
      } else {
        setAiFileStatus(`${parseResult.fileName} 已由当前模型直接读取。`, 'direct');
      }
    } else {
      parsedData = await resumeParser.parseWithAI(resumeText, settings);

      if (runId !== aiParseRunSeq) return;
    }

    fillParsedData(parsedData);
    const saved = await saveProfile({ silent: true });
    if (saved) {
      const modeText = parseResult?.inputMode === 'file'
        ? '模型已直接读取原始文件'
        : parseResult?.inputMode === 'text'
          ? '已自动回退本地文字解析'
          : '文字解析完成';
      showToast(`✅ ${modeText}，已写入表单并保存`, 'success');
      if (typeof appLog !== 'undefined') appLog.success('options', 'parse.save', modeText + '，已保存');
    } else {
      showToast('解析已写入表单，但保存失败，请再点保存', 'warning');
      if (typeof appLog !== 'undefined') appLog.warn('options', 'parse.save', '解析已写入表单，但保存失败');
    }
  } catch (error) {
    if (error.message === '解析已取消') {
      showToast('已取消上一轮解析', 'info');
      if (typeof appLog !== 'undefined') appLog.info('options', 'parse.cancel', '重新上传/切换资料，已中断上一轮解析');
      return;
    }
    console.error('[AI解析] 失败:', error);
    if (typeof appLog !== 'undefined') appLog.error('options', 'parse.fail', '解析失败', error.message);
    if (resumeFile) setAiFileStatus(`解析失败：${error.message}`, 'error');
    showToast(`❌ 解析失败: ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function fillParsedData(data) {
  if (!currentProfile) {
    throw new Error('当前没有资料，请先创建一份');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('AI 返回的数据格式不正确');
  }

  currentProfile = mergeProfile(currentProfile, collectProfileUpdates());
  currentProfile.basicInfo = currentProfile.basicInfo || {};
  const bi = data.basicInfo || {};
  if (bi.homeAddress) {
    currentProfile = mergeProfile(currentProfile, { basicInfo: { homeAddress: bi.homeAddress } });
    setInputValue('homeAddress', currentProfile.basicInfo.homeAddress);
  }
  const basicFields = [
    'fullName', 'firstName', 'lastName', 'phone', 'email', 'gender', 'idCard',
    'politicalStatus', 'ethnicity', 'hometown', 'graduationDate', 'maritalStatus', 'currentCity',
    'emergencyContact', 'emergencyRelation', 'emergencyPhone',
    'city', 'state', 'country', 'zipCode', 'street',
    'linkedin', 'github', 'website', 'twitter'
  ];
  basicFields.forEach((key) => {
    if (bi[key]) {
      setInputValue(key, bi[key]);
      currentProfile.basicInfo[key] = bi[key];
    }
  });
  if (bi.birthDate) {
    const birth = toDateInput(bi.birthDate);
    if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(birth)) {
      setInputValue('birthDate', birth);
      currentProfile.basicInfo.birthDate = birth;
    }
  }

  // 求职意向
  currentProfile.jobIntention = currentProfile.jobIntention || {};
  const ji = data.jobIntention || {};
  ['expectedCity', 'expectedPosition', 'expectedIndustry', 'expectedSalary', 'currentSalary', 'availableDate', 'referralCode', 'recruitSource', 'willingToTravel'].forEach(key => {
    if (ji[key]) {
      setInputValue(key, ji[key]);
      currentProfile.jobIntention[key] = ji[key];
    }
  });

  const languageList = document.querySelector('[data-ext-list="languageCertificates"]');
  const languageEntries = languageList ? readExtendedList(languageList) : profileLanguageEntries(currentProfile);
  for (const entry of profileLanguageEntries(data)) {
    const keys = Object.keys(profileSchema.languageCertificates);
    const matches = languageEntries.filter(item => {
      const exam = languageEntryExam(entry);
      const sameIdentity = exam ? exam === languageEntryExam(item) :
        (entry.language || entry.name) ? entry.language === item.language && entry.name === item.name : entry.notes && entry.notes === item.notes;
      return sameIdentity && keys.every(key => !entry[key] || !item[key] ||
        (key === 'score' ? languageScoreKey(entry[key]) === languageScoreKey(item[key]) :
          key === 'name' && exam ? true : entry[key] === item[key]));
    });
    if (matches.length === 1) {
      for (const key of keys) if (!matches[0][key] && entry[key]) matches[0][key] = entry[key];
    } else if (!matches.length) {
      languageEntries.push({ ...entry, id: generateId() });
    }
  }
  currentProfile.languageCertificates = languageEntries;

  if (data.familyMembers && data.familyMembers.length) {
    currentProfile.familyMembers = data.familyMembers.map((item) => ({ ...emptyFamilyMember(), ...item, id: generateId() }));
    renderFamilyList(currentProfile.familyMembers);
  }

  if (data.certificates && data.certificates.length) {
    currentProfile.certificates = normalizeCertificates(data.certificates);
    renderCertificatesList(currentProfile.certificates);
  }

  // 荣誉奖项
  if (data.awards && data.awards.length) {
    currentProfile.awards = data.awards.map(item => ({ ...emptyAward(), ...item, id: generateId() }));
    renderAwardsList(currentProfile.awards);
  }

  // 教育背景
  if (data.education && data.education.length) {
    currentProfile.education = data.education.map((item) => ({ ...emptyEducation(), ...item, id: generateId() }));
    renderEducationList(currentProfile.education);
  }

  // 工作经历
  if (data.workExperience && data.workExperience.length) {
    currentProfile.workExperience = data.workExperience.map((item) => ({ ...emptyWork(), ...item, id: generateId() }));
    renderWorkList(currentProfile.workExperience);
  }

  // 项目经历
  if (data.projects && data.projects.length) {
    currentProfile.projects = data.projects.map((item) => ({ ...emptyProject(), ...item, id: generateId() }));
    renderProjectList(currentProfile.projects);
  }

  // 技能标签
  if (data.skills && data.skills.length) {
    currentProfile.skills = data.skills;
    renderSkillsList(profileSkillEntries(currentProfile));
  }

  // 自我介绍
  if (data.introduction) {
    document.getElementById('introduction').value = data.introduction;
    currentProfile.introTemplates = currentProfile.introTemplates || { default: '', custom: [] };
    currentProfile.introTemplates.default = data.introduction;
  }
  for (const section of Object.keys(profileSchema)) {
    if (profileListKeys.includes(section)) {
      if (['campusPositions', 'campusActivities', 'trainings', 'papers', 'patents', 'openSource', 'customAnswers', 'declarations'].includes(section) && data[section]?.length) {
        currentProfile[section] = data[section].map(item => ({ ...item, id: generateId() }));
      }
    } else {
      for (const key of Object.keys(profileSchema[section])) {
        if (data[section]?.[key]?.length) currentProfile[section][key] = data[section][key];
      }
    }
  }
  renderExtendedProfile(currentProfile);
  // AI 解析完成可能发生在用户已返回概览或停留在解析页之后，统一刷新概览、导航与右栏计数。
  refreshWorkspaceUi();
  updateRailProfileCard();

}

async function deleteCurrentProfile() {
  if (profileDeletionInFlight) return;
  const profileId = currentProfile?.id || '';
  const profileName = currentProfile?.name || '当前资料';
  if (!profileId || !allProfiles.some(profile => profile.id === profileId)) {
    showToast('当前简历不可用，请刷新后重试', 'warning');
    updateDeleteProfileAction();
    return;
  }
  if (allProfiles.length <= 1) {
    showToast('至少需要保留一份资料', 'warning');
    updateDeleteProfileAction();
    return;
  }

  profileDeletionInFlight = true;
  updateDeleteProfileAction();
  let deleteSucceeded = false;
  try {
    const ok = await showAppleConfirm({
      title: '删除当前资料档案',
      subtitle: `确定要删除「${profileName}」吗？此操作不可撤销`,
      confirmText: '确定删除',
      isDanger: true
    });
    if (!ok) return;
    if (!allProfiles.some(profile => profile.id === profileId)) {
      showToast('这份简历已在其他页面移除', 'warning');
      return;
    }
    if (allProfiles.length <= 1) {
      showToast('至少需要保留一份资料', 'warning');
      return;
    }

    clearTimeout(profileSaveTimer);
    profileDirty = false;
    const response = await sendMessage({ action: 'deleteProfile', profileId });
    if (response?.success) {
      deleteSucceeded = true;
      clearSelectedAiResumeFile();
      const refreshed = await loadProfiles();
      showToast(
        refreshed ? '资料已删除' : '资料已删除，但列表刷新失败，请刷新页面',
        refreshed ? 'success' : 'warning'
      );
    } else {
      showToast(response?.error || '删除失败，请重试', 'warning');
    }
  } catch (error) {
    showToast(
      deleteSucceeded ? '资料已删除，但页面状态更新失败，请刷新页面' : '删除简历失败：' + error.message,
      deleteSucceeded ? 'warning' : 'error'
    );
  } finally {
    profileDeletionInFlight = false;
    updateDeleteProfileAction();
  }
}

function autoSaveAiSettings() {
  const settings = collectAiSettingsFromDom();
  pendingSettingsSave = pendingSettingsSave.catch(() => false).then(async () => {
    try {
      const response = await sendMessage({ action: 'updateSettings', settings });
      if (response?.success) savedAiSettingsFingerprint = JSON.stringify(settings);
      else showToast(response?.error || 'AI 设置保存失败，请重试', 'error');
      return !!response?.success;
    } catch (error) {
      showToast('AI 设置保存失败：' + error.message, 'error');
      return false;
    }
  });
  return pendingSettingsSave;
}

async function testAiConnection() {
  const settings = collectAiSettingsFromDom();
  if (!settings.aiApiKey) {
    showToast('请先输入 API Key', 'warning');
    return;
  }

  settings.aiEnabled = true;
  document.getElementById('aiEnabled').checked = true;
  document.getElementById('aiSettings').style.display = 'block';

  if (!settings.aiModel) {
    const models = await refreshModelList({ silent: true });
    settings.aiModel = getSelectedModel() || models[0] || '';
  }

  if (!settings.aiModel) {
    showToast('请先获取并选择模型', 'warning');
    setModelHint('测试前需要先选出一个模型', true);
    return;
  }

  await autoSaveAiSettings();

  const btn = document.getElementById('testAiBtn');
  const resultDiv = document.getElementById('testResult');
  btn.disabled = true;
  btn.textContent = '🔍 测试中...';
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div style="color: #818cf8;">正在连接大模型服务...</div>';

  try {
    const startTime = Date.now();
    const result = await resumeParser.testConnection(settings);
    const duration = Date.now() - startTime;
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>测试连接</span>';
    resultDiv.innerHTML = `
      <div style="background: rgba(16, 185, 129, 0.15); color: #34d399; padding: 12px; border-radius: 12px; border: 1px solid rgba(16, 185, 129, 0.35);">
        <strong>✅ 接口连接成功</strong><br>
        使用模型: ${html(result.model || settings.aiModel)}<br>
        响应耗时: ${duration}ms<br>
        模型回复: ${html(result.preview || 'OK')}
      </div>
    `;
    showToast('✅ AI连接测试成功', 'success');
  } catch (error) {
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>测试连接</span>';
    console.error('[AI测试] 失败:', error);

    let errorType = '请求失败';
    let suggestion = '查看下方详细错误';
    const message = error.message || '';
    if (/401|403|unauthorized|invalid api key/i.test(message)) {
      errorType = 'API Key 无效或未授权';
      suggestion = '请检查 API Key 是否完整粘贴，前后是否有空格';
    } else if (/failed to fetch|network|连接失败/i.test(message)) {
      errorType = '网络连接失败';
      suggestion = '检查网络连接，或尝试配置代理/中转 API URL';
    } else if (/model/i.test(message)) {
      errorType = '模型不可用';
      suggestion = '点击「获取可用模型」后改选列表中的模型；豆包请选 ep- 接入点';
    } else if (/balance|quota|额度|余额/i.test(message)) {
      errorType = '账号余额不足';
      suggestion = '请登录对应大模型平台控制台充值后再试';
    }

    resultDiv.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.15); color: #f87171; padding: 12px; border-radius: 12px; border: 1px solid rgba(239, 68, 68, 0.35);">
        <strong>❌ 连接失败：${html(errorType)}</strong><br>
        <div style="margin-top: 6px; font-size: 11.5px;">${html(suggestion)}</div>
        <details style="margin-top: 6px;">
          <summary style="cursor: pointer; font-size: 11px;">查看详细错误日志</summary>
          <pre style="margin-top: 4px; font-size: 10.5px; background: rgba(0,0,0,0.3); padding: 6px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap;">${html(message)}</pre>
        </details>
      </div>
    `;
    showToast(`❌ 测试失败: ${errorType}`, 'error');
  }
}

let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimer);

  const rawMsg = String(message || '').trim();
  const emojiMatch = rawMsg.match(/^([\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{2300}-\u{23FF}])/u);
  let iconHtml = '';
  let displayText = rawMsg;

  if (emojiMatch) {
    iconHtml = `<span class="toast-emoji">${emojiMatch[0]}</span>`;
    displayText = rawMsg.slice(emojiMatch[0].length).trim();
  } else {
    const svgs = {
      success: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>',
      error: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
      warning: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      info: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
    };
    iconHtml = svgs[type] || svgs.info;
  }

  toast.innerHTML = `${iconHtml}<span>${html(displayText)}</span>`;
  toast.className = `toast ${type}`;
  toast.style.display = 'inline-flex';
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0) scale(1)';

  toastTimer = setTimeout(() => {
    toast.style.transition = 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px) scale(0.94)';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 240);
  }, 2200);
}

function updateGreetingCharCount(text) {
  const countEl = document.getElementById('greetingCharCount');
  if (countEl) {
    const len = String(text || '').length;
    countEl.textContent = `${len} / 300 字`;
    countEl.style.color = len > 300 ? '#ef4444' : '';
  }
}

// ============================================================================
// 侧边栏模块导航（事件委托，配合 refreshSidebarModules 动态重建的菜单）
// ============================================================================

function initSidebarNav() {
  // 概览/模块导航由 refreshSidebarModules 动态重建，统一用事件委托绑定。
  const menu = document.getElementById('sidebarMenu');
  menu?.addEventListener('click', (e) => {
    const link = e.target.closest('.sidebar-link');
    if (!link || !menu.contains(link)) return;
    e.preventDefault();
    const moduleKey = link.dataset.module
      || (link.dataset.section ? link.dataset.section.replace(/^section-/, '') : 'overview');
    navigateWorkspace(moduleKey);
  });

  // 「添加更多模块」：展开低频空模块列表，点击某项即启用并进入编辑
  document.getElementById('sidebarMoreToggle')?.addEventListener('click', () => {
    const group = document.getElementById('sidebarMore');
    if (!group) return;
    const open = group.classList.toggle('is-open');
    document.getElementById('sidebarMoreToggle')?.setAttribute('aria-expanded', String(open));
  });
  document.getElementById('sidebarMoreList')?.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-module]');
    if (!item) return;
    enableExtraModule(item.getAttribute('data-add-module'));
  });
}

function initProfileNavigation() {
  function showFromHash() {
    if (/^#(product|tracker|help|settings)(?:$|[/?-])/.test(location.hash)) return;
    const match = window.location.hash.match(/^#(section|view)-([A-Za-z0-9_-]+)$/);
    showWorkspaceModule(match?.[2], match?.[1] === 'section');
  }
  showFromHash();
}

const EXTENDED_FIELD_ORDER = {
  basicInfo: [
    'sourcePlace', 'registeredAddress', 'leagueJoinDate', 'partyJoinDate', 'nationality', 'height', 'weight', 'health',
    'englishName', 'lastNamePinyin', 'firstNamePinyin', 'namePinyinFull', 'wechat', 'qq', 'idCardType',
    'bloodType', 'registeredAddressType', 'religion', 'openToWork', 'yearsOfWork', 'permanentResidencePermit',
    'archiveOrganization', 'professionalTitle', 'birthPlace', 'childhoodCity', 'interests'
  ],
  awards: ['category', 'grade', 'issuer', 'rank', 'role', 'url', 'reason', 'description'],
  jobIntention: ['salaryCurrency', 'salaryUnit', 'salaryPeriod', 'acceptAdjustment', 'acceptCounty', 'referred',
    'expectedMonthlySalary', 'expectedAnnualSalary', 'currentMonthlySalary', 'currentAnnualSalary'],
  papers: ['name', 'date', 'publisher', 'authorOrder', 'role', 'url', 'abstract'],
  patents: ['name', 'inventor', 'date', 'url', 'description'],
  declarations: ['question', 'answer', 'company', 'hostname', 'explanation']
};
function extendedFieldKeys(section) {
  return EXTENDED_FIELD_ORDER[section] || Object.keys(profileSchema[section] || {});
}

function appendExtendedFields(root, section, values = {}, keys = extendedFieldKeys(section), { before = null } = {}) {
  const grid = document.createElement('div');
  grid.className = 'form-row form-row-3 extended-fields';
  grid.dataset.fieldSection = section;
  for (const key of keys) {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.dataset.field = key;
    const caption = document.createElement('label');
    caption.textContent = profileSchema[section][key];
    const yesNo = ['fullTime', 'highestFullTime', 'overseasEducation', 'acceptAdjustment', 'acceptCounty', 'referred', 'personalPromise'].includes(key) || (section === 'declarations' && key === 'answer');
    const choices = yesNo ? ['是', '否'] :
      section === 'awards' && key === 'category' ? ['竞赛获奖', '奖学金', '其他'] :
      section === 'languageCertificates' && ['proficiency', 'listeningSpeaking', 'readingWriting'].includes(key) ?
        ['精通', '熟练', '良好', '一般'] : [];
    const multiline = ['description', 'abstract', 'answer', 'explanation', 'question', 'notes'].includes(key) && !choices.length || section === 'commonAnswers';
    const input = document.createElement(choices.length ? 'select' : multiline ? 'textarea' : 'input');
    input.id = `ext-${section}-${key}-${crypto.randomUUID()}`;
    caption.htmlFor = input.id;
    if (multiline) group.classList.add('field-wide');
    if (choices.length) for (const value of ['', ...choices]) input.add(new Option(value || '未填写', value));
    else if (multiline) input.rows = 3;
    else input.type = 'text';
    input.dataset.extKey = key;
    setFieldValue(input, Array.isArray(values[key]) ? values[key].join('\n') : values[key]);
    if (/date$/i.test(key)) input.placeholder = 'YYYY-MM 或 YYYY-MM-DD';
    if (section === 'languageCertificates' && key === 'language') input.placeholder = '例如 英语、日语、德语';
    if (section === 'languageCertificates' && key === 'name') input.placeholder = '例如 CET-6、JLPT N1，可留空';
    if (section === 'languageCertificates' && key === 'score') input.placeholder = '例如 560、7.5、通过';
    if (section === 'awards' && key === 'grade') input.placeholder = '例如 二等奖、金奖';
    if (section === 'declarations' && key === 'question') input.placeholder = '例如：是否有亲属在本公司任职或退休？';
    if (key === 'hostname') input.placeholder = '例如：job.xiaohongshu.com';
    group.append(caption, input);
    grid.append(group);
  }
  if (section === 'basicInfo' && values.politicalJoinDate) {
    const legacy = document.createElement('p');
    legacy.className = 'legacy-political-date';
    legacy.textContent = `旧入党团时间：${values.politicalJoinDate}。请核对后分别填写入团时间或入党时间，旧记录仍保留。`;
    grid.append(legacy);
  }
  root.insertBefore(grid, before);
  initAllAppleSelects(grid);
  return grid;
}

function readExtendedFields(root) {
  return Object.fromEntries([...root.querySelectorAll('[data-ext-key]')].map(input => [input.dataset.extKey,
    input.dataset.extKey === 'programmingLanguages' ? input.value.split('\n').map(s => s.trim()).filter(Boolean) : input.value.trim()]));
}

function readExtendedList(list) {
  return [...list.children].map(card => ({
    id: card.dataset.entryId,
    ...readExtendedFields(card),
    ...(list.dataset.extList === 'languageCertificates' ? { preferred: card.dataset.preferred || '' } : {})
  }));
}

function appendExtendedEntry(section, root, entry) {
    const entryIndex = root.children.length;
    const isLanguage = section === 'languageCertificates';
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.entryId = entry.id;
    const header = document.createElement('div');
    header.className = 'item-card-header';
    const heading = document.createElement('h4');
    const index = document.createElement('span');
    index.className = 'item-index';
    index.textContent = String(entryIndex + 1).padStart(2, '0');
    const summary = document.createElement('span');
    summary.textContent = isLanguage ? languageCardTitle(entry) :
      entry.organization || entry.name || entry.question || entry.url || '未填写条目';
    heading.append(index, summary);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-delete';
    remove.textContent = '删除条目';
    remove.onclick = () => {
      card.remove();
      syncExperienceOrder(root);
      if (isLanguage) refreshLanguageCards(root);
      debouncedSave();
    };
    header.append(heading, remove);
    card.append(header);
    if (isLanguage) {
      card.dataset.preferred = entry.preferred || '';
      appendExtendedFields(card, section, entry, ['language', 'name', 'score', 'obtainedDate', 'proficiency', 'listeningSpeaking', 'readingWriting']);
      if (entry.notes || entry.level) {
        appendExtendedFields(card, section, entry, ['level', 'notes'].filter(key => entry[key]));
      }
      const preference = document.createElement('button');
      preference.type = 'button';
      preference.className = 'language-preference';
      preference.onclick = () => {
        const exam = languageEntryExam(readExtendedFields(card));
        const selected = card.dataset.preferred === '是';
        for (const row of root.children) {
          if (languageEntryExam(readExtendedFields(row)) === exam) row.dataset.preferred = '';
        }
        if (!selected) card.dataset.preferred = '是';
        refreshLanguageCards(root);
        debouncedSave();
      };
      card.append(preference);
    } else {
      appendExtendedFields(card, section, entry);
    }
    enhanceItemCard(card, entry.id);
    root.append(card);
    syncExperienceOrder(root);
    return card;
}

function languageCardTitle(entry) {
  return [entry.language, entry.name].filter(Boolean).join(' · ') || (entry.notes ? '其他语言资料' : '未填写语种');
}

function refreshLanguageCards(list) {
  const entries = readExtendedList(list);
  [...list.children].forEach((card, index) => {
    const entry = entries[index];
    const exam = languageEntryExam(entry);
    const matches = entries.filter(item => exam && languageEntryExam(item) === exam && languageScoreKey(item.score));
    const preferred = entry.preferred === '是';
    card.querySelector('.item-index').textContent = String(index + 1).padStart(2, '0');
    card.querySelector('.item-index + span').textContent = languageCardTitle(entry);
    const button = card.querySelector('.language-preference');
    button.hidden = !entry.score || new Set(matches.map(item => languageScoreKey(item.score))).size < 2;
    button.textContent = preferred ? '单项成绩默认使用此条' : '设为单项成绩默认';
    button.setAttribute('aria-pressed', String(preferred));
  });
}

// 标题和目录共用线性图标，避免依赖系统 Emoji 字形。
function profileIcon(key) {
  const paths = {
    ai: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/>',
    parser: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8m-8 4h5"/>',
    basic: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
    intention: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    education: '<path d="m2 9 10-5 10 5-10 5zM6 11v6c4 3 8 3 12 0v-6m4-2v7"/>',
    work: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12a20 20 0 0 0 18 0M12 11v4"/>',
    projects: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    awards: '<path d="M8 3h8v7a4 4 0 0 1-8 0zM8 5H3v3a4 4 0 0 0 5 4m8-7h5v3a4 4 0 0 1-5 4M12 14v7m-4 0h8"/>',
    certificates: '<circle cx="12" cy="8" r="5"/><path d="m8 12-2 9 6-3 6 3-2-9"/>',
    papers: '<path d="M4 3h12a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2zm0 14h14M8 7h6m-6 4h6"/>',
    patents: '<path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4"/>',
    openSource: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
    campusPositions: '<circle cx="9" cy="8" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2m2-17 2 2 4-4"/>',
    campusActivities: '<path d="M3 19h18M6 16V9l6-4 6 4v7M10 16v-4h4v4"/>',
    trainings: '<path d="M4 4h16v13H4zM8 21h8m-4-4v4M8 8h8m-8 4h5"/>',
    skills: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
    introduction: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
    modules: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="m14 18 2 2 5-5"/>',
    dates: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4m8-4v4m-4 6v3m0 2h.01"/>',
    commonAnswers: '<path d="M21 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM7 7h10M7 12h7"/>',
    customAnswers: '<path d="M21 15a3 3 0 0 1-3 3H8l-5 4V5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3zM9 7a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
    family: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 3a4 4 0 0 1 0 8m2 4a6 6 0 0 1 3 6"/>',
    declarations: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>',
    actions: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2M7 3v6h10V3M7 21v-8h10v8"/>',
    address: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    language: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    languageCertificates: '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2 2 12 0 14M10 3c-2 2-2 12 0 14"/><path d="m15 16 2 2 4-4"/>'
  };
  const icon = paths[key === 'internship' ? 'work' : key === 'aiTools' ? 'ai' : key];
  return icon ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>` : '';
}

// 页面内章节顺序固定；侧栏导航按“业务是否有数据”由 refreshSidebarModules 生成。
function arrangeProfileSections() {
  document.querySelectorAll('#view-profile [data-heading-icon]').forEach(heading => {
    heading.querySelector('.heading-icon')?.remove();
    const icon = document.createElement('span');
    icon.className = 'heading-icon';
    icon.innerHTML = profileIcon(heading.dataset.headingIcon);
    heading.prepend(icon);
  });
  const content = document.querySelector('#view-profile .form-content');
  for (const key of WORKSPACE_PROFILE_SECTION_ORDER) {
    const section = document.getElementById(`section-${key}`);
    if (!section) continue;
    content.append(section);
    const heading = section.querySelector('.section-title');
    if (heading) {
      let icon = section.querySelector('.section-icon');
      if (!icon) {
        icon = document.createElement('span');
        icon.className = 'section-icon';
        heading.prepend(icon);
      }
      icon.innerHTML = profileIcon(key);
    }
  }
  refreshSidebarModules();
}

function renderExtendedProfile(profile) {
  document.querySelector('#section-aiTools .form-group')?.remove();
  const basic = document.getElementById('section-basic');
  const intention = document.getElementById('section-intention');
  for (const [section, root] of [['basicInfo', basic], ['jobIntention', intention]]) {
    const inputs = [...root.querySelectorAll('[data-primary-ext]')];
    for (const input of inputs) setFieldValue(input, profile[section]?.[input.dataset.extKey]);
    const optionalKeys = extendedFieldKeys(section).filter(key => !inputs.some(input => input.dataset.extKey === key));
    if (section === 'basicInfo') wrapExtendedCollapse(basic, section, profile[section], '专项个人资料', optionalKeys);
    else {
      const supplement = intention.querySelector('[data-job-supplement]');
      supplement.replaceChildren();
      appendExtendedFields(supplement, section, profile[section], optionalKeys);
    }
  }
  const politicalStatus = document.getElementById('politicalStatus');
  function refreshPoliticalDates() {
    for (const group of basic.querySelectorAll('[data-political-date]')) {
      const applies = group.dataset.politicalDate === 'partyJoinDate' ? /党员/.test(politicalStatus.value) : /团员/.test(politicalStatus.value);
      group.hidden = !applies && !group.querySelector('input').value;
    }
  }
  politicalStatus.onchange = refreshPoliticalDates;
  refreshPoliticalDates();

  for (const [section, title] of Object.entries({ campusPositions: '在校职务', campusActivities: '校园活动', trainings: '培训经历', languageCertificates: '外语能力', papers: '论文', patents: '专利', openSource: '开源成果', commonAnswers: '常用问答', customAnswers: '额外问题与答案', declarations: '个人声明' })) {
    let panel = document.getElementById(`section-${section}`);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = `section-${section}`;
      panel.className = 'section glass';
      const heading = document.createElement('h2');
      heading.className = 'section-title';
      heading.textContent = title;
      panel.append(heading);
      basic.parentElement.append(panel);
    }
    while (panel.children.length > 1) panel.lastElementChild.remove();
    if (section === 'declarations') {
      const note = document.createElement('p');
      note.textContent = '亲属任职或退休、境外身份、违法违纪等按原题逐项保存。未填写不代表否。自动填写需匹配企业和域名，并每次确认；承诺、签名请本人操作。';
      panel.append(note);
    }
    if (section === 'commonAnswers') appendExtendedFields(panel, section, profile[section]);
    else {
      const list = document.createElement('div');
      list.dataset.extList = section;
      list.id = `entryList-${section}`;
      if (section === 'languageCertificates') {
        const note = document.createElement('p');
        note.className = 'language-help';
        note.textContent = '每条填写一个语种或一项考试。没有证书或成绩时，可以只填写语种和掌握程度。';
        const actions = document.createElement('div');
        actions.className = 'language-quick-add';
        const options = [...LEGACY_LANGUAGE_SCORES.map(key => [key, LANGUAGE_EXAMS[key].label]), ['', '其他语种 / 考试']];
        for (const [key, label] of options) {
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'btn-add-item btn-add-entry';
          add.textContent = `＋ ${label}`;
          add.onclick = () => {
            const entry = key ? { language: '英语', name: LANGUAGE_EXAMS[key].name } : {};
            const card = appendExtendedEntry(section, list, { id: generateId(), ...entry });
            refreshLanguageCards(list);
            card.querySelector(`[data-ext-key="${key ? 'score' : 'language'}"]`).focus();
            debouncedSave();
          };
          actions.append(add);
        }
        list.addEventListener('input', () => refreshLanguageCards(list));
        for (const entry of profileLanguageEntries(profile)) appendExtendedEntry(section, list, entry);
        refreshLanguageCards(list);
        panel.append(note, actions, list);
        continue;
      }
      for (const entry of profile[section] || []) appendExtendedEntry(section, list, entry);
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'btn-add-item btn-add-entry';
      add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
      const addLabel = document.createElement('span');
      addLabel.textContent = `添加${title === '额外问题与答案' ? '问答' : title}`;
      add.append(addLabel);
      add.onclick = () => {
        appendExtendedEntry(section, list, { id: generateId() });
        debouncedSave();
      };
      panel.append(list, add);
    }
  }
  arrangeProfileSections();
  for (const input of basic.parentElement.querySelectorAll('input[class*="-start"],input[class*="-end"],input[class*="-date"],input[class*="-expiry"],#graduationDate')) {
    input.placeholder = 'YYYY-MM 或 YYYY-MM-DD（结束时间也可填至今）';
  }
  renderAttachmentPanel();
  window.YanyuDates?.refresh();
}

function collectExtendedProfile(updates) {
  for (const [section, target] of [['basicInfo', 'section-basic'], ['jobIntention', 'section-intention'], ['commonAnswers', 'section-commonAnswers']]) {
    const root = document.getElementById(target);
    if (root) updates[section] = { ...updates[section], ...readExtendedFields(root) };
  }
  for (const [section, target] of [['education', 'educationList'], ['projects', 'projectList'], ['awards', 'awardsList'], ['familyMembers', 'familyList']]) {
    document.querySelectorAll(`#${target} .item-card`).forEach((card, index) => Object.assign(updates[section][index], readExtendedFields(card)));
  }
  for (const list of document.querySelectorAll('[data-ext-list]')) {
    updates[list.dataset.extList] = readExtendedList(list);
  }
  return updates;
}

async function changeAttachment(action, kind, extra) {
  const profileId = extra.profileId || activeProfileId;
  const response = await sendMessage({ action, profileId, kind, ...extra });
  if (!response.success) throw new Error(response.error || '附件保存失败');
  if (profileId === activeProfileId) {
    currentProfile.attachments = response.attachments;
    if (kind === 'resume') { currentProfile.resumeFile = null; currentProfile.resumeFileName = ''; }
    renderAttachmentPanel();
    updateResumeAttachmentUI(currentProfile.attachments.resume?.name || '', currentProfile.attachments.resume?.size || 0);
  }
}

async function saveAttachmentFile(kind, file, replaceId) {
  const profileId = activeProfileId;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
  });
  await changeAttachment('saveAttachment', kind, { profileId, file: { name: file.name, size: file.size, type: file.type, dataUrl }, replaceId });
}

let attachmentPanelRenderSeq = 0;

function renderAttachmentPanel() {
  const renderSeq = ++attachmentPanelRenderSeq;
  let root = document.getElementById('attachmentPanel');
  if (!root) {
    root = document.createElement('div'); root.id = 'attachmentPanel';
    document.getElementById('section-parser').append(root);
  }
  root.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'attachment-panel-title'; heading.textContent = '附件管理';
  const grid = document.createElement('div'); grid.className = 'attachment-grid';
  root.append(heading, grid);
  for (const [kind, title] of Object.entries({ resume: '简历', idPhoto: '证件照', lifePhoto: '生活照', works: '作品附件' })) {
    const group = document.createElement('section'); group.className = 'attachment-card';
    const header = document.createElement('div'); header.className = 'attachment-card-header';
    const label = document.createElement('h4'); label.textContent = title;
    const hint = document.createElement('span'); hint.className = 'attachment-kind-hint';
    hint.textContent = kind === 'works' ? '支持多个文件' : /Photo$/.test(kind) ? '图片 · 保存一份' : '保存一份';
    header.append(label, hint); group.append(header);
    const input = document.createElement('input'); input.type = 'file'; input.multiple = kind === 'works';
    input.hidden = true; input.setAttribute('aria-label', `上传${title}`);
    if (/Photo$/.test(kind)) input.accept = 'image/*';
    input.onchange = async () => {
      try { for (const file of input.files) await saveAttachmentFile(kind, file); }
      catch (error) { showToast(error.message, 'error'); }
    };
    group.append(input);
    const files = kind === 'works' ? currentProfile.attachments?.works || [] : [currentProfile.attachments?.[kind]].filter(Boolean);
    if (!files.length) {
      const empty = document.createElement('p'); empty.className = 'attachment-empty';
      empty.textContent = `尚未上传${title}`; group.append(empty);
    }
    for (const file of files) {
      const row = document.createElement('div'); row.className = 'attachment-file';
      const meta = document.createElement('div'); meta.className = 'attachment-file-meta';
      const name = document.createElement('span'); name.className = 'attachment-file-name'; name.textContent = file.name;
      const size = document.createElement('span'); size.className = 'attachment-file-size'; size.textContent = formatAiFileSize(file.size);
      meta.append(name, size); row.append(meta);
      const actions = document.createElement('div'); actions.className = 'attachment-file-actions';
      for (const [action, title] of [['download', '下载'], ['replace', '替换'], ['delete', '删除']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title;
        button.className = `attachment-action${action === 'delete' ? ' is-danger' : ''}`;
        button.setAttribute('aria-label', `${title} ${file.name}`);
        button.onclick = async () => {
          try {
            if (action === 'delete') await changeAttachment('deleteAttachment', kind, { id: file.id });
            else if (action === 'replace') {
              const picker = document.createElement('input'); picker.type = 'file'; picker.accept = input.accept;
              picker.onchange = () => picker.files[0] && saveAttachmentFile(kind, picker.files[0], file.id).catch(error => showToast(error.message, 'error'));
              picker.click();
            } else {
              const response = await sendMessage({ action: 'getAttachment', profileId: activeProfileId, id: file.id });
              if (!response.success) throw new Error(response.error);
              const link = document.createElement('a'); link.href = response.file.dataUrl; link.download = file.name; link.click();
            }
          } catch (error) { showToast(error.message, 'error'); }
        };
        actions.append(button);
      }
      row.append(actions); group.append(row);
    }
    if (!files.length || kind === 'works') {
      const upload = document.createElement('button'); upload.type = 'button';
      upload.className = 'btn-add-item attachment-upload';
      upload.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>';
      upload.append(document.createTextNode(`上传${title}`));
      upload.onclick = () => input.click(); group.append(upload);
    }
    grid.append(group);
  }
  sendMessage({ action: 'getStorageInfo' }).then(response => {
    if (!response.success || !root.isConnected || renderSeq !== attachmentPanelRenderSeq) return;
    const info = document.createElement('p'); info.className = 'attachment-storage-info';
    info.textContent = `资料与附件实际占用 ${response.info.sizeInMB} MB（附件 ${formatAiFileSize(response.info.attachmentBytes)}）；可用配额由当前浏览器管理。`;
    root.append(info);
  }).catch(console.warn);
}

// ============================================================================
// 简历工作区：默认只读概览 + 单模块编辑（三栏布局的中栏状态机）
// ============================================================================

const WORKSPACE_BASE_MODULES = [
  ['ai', 'AI 模型配置'], ['parser', '简历源文件 & AI 解析'], ['basic', '基础个人信息'],
  ['intention', '求职意向'], ['education', '教育经历'], ['work', '工作经历'], ['internship', '实习经历'], ['languageCertificates', '外语能力'],
  ['projects', '项目经历'], ['awards', '荣誉奖项'], ['certificates', '资格证书'],
  ['family', '家庭成员'], ['skills', 'IT 技能'], ['introduction', '自我介绍'], ['aiTools', 'AI 工具应用'], ['dates', '日期待完善'], ['modules', '模块管理'], ['actions', '保存 / 删除资料']
];
const WORKSPACE_EXTRA_MODULES = [
  ['campusPositions', '在校职务'], ['campusActivities', '校园活动'], ['trainings', '培训经历'], ['papers', '论文'], ['patents', '专利'], ['openSource', '开源成果'],
  ['commonAnswers', '常用问答'], ['customAnswers', '额外问答'], ['declarations', '个人声明']
];
const WORKSPACE_MODULE_TITLES = Object.fromEntries([
  ...WORKSPACE_BASE_MODULES, ...WORKSPACE_EXTRA_MODULES, ['overview', '简历概览']
]);
// 章节在 .form-content 中的固定顺序；菜单顺序与之一致（概览置顶）
const WORKSPACE_PROFILE_SECTION_ORDER = [
  'ai', 'parser', 'basic', 'intention', 'education', 'internship', 'work', 'projects', 'campusPositions', 'campusActivities', 'awards',
  'languageCertificates', 'certificates', 'trainings', 'papers', 'patents', 'openSource', 'skills', 'introduction', 'aiTools',
  'commonAnswers', 'customAnswers', 'family', 'declarations', 'dates', 'modules', 'actions'
];
const WORKSPACE_MENU_ORDER = ['overview', ...WORKSPACE_PROFILE_SECTION_ORDER];
const WORKSPACE_EXTRA_KEYS = WORKSPACE_EXTRA_MODULES.map(([key]) => key);
const OVERVIEW_MODULE_ICON = '<rect x="5" y="4" width="14" height="16" rx="2.5"/><path d="M9 9.5h6M9 13h6M9 16.5h3.5"/>';

function entryHasContent(entry) {
  return Object.entries(entry || {}).some(([key, value]) => {
    if (key === 'id' || key === 'preferred') return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value ?? '').trim() !== '';
  });
}

function listEntriesWithData(snapshot, key) {
  const entries = snapshot?.[key];
  return Array.isArray(entries) ? entries.filter(entryHasContent) : [];
}

// 概览展示与模块判空都取“表单实时值 + 当前资料”的合并快照，避免保存延迟导致概览滞后
function currentFormSnapshot() {
  if (!currentProfile) return null;
  try {
    return collectProfileUpdates();
  } catch (e) {
    console.warn('[Options] 生成资料快照失败，使用当前资料兜底', e);
    return currentProfile;
  }
}

function showWorkspaceModule(moduleKey, edit = false) {
  const enabled = !currentProfile || resumeModuleEnabled(currentProfile, moduleKey);
  const target = Object.hasOwn(WORKSPACE_MODULE_TITLES, moduleKey) && enabled ? moduleKey : 'overview';
  workspaceModule = target;
  workspaceEditing = target !== 'overview' && (edit || ['ai', 'parser', 'actions', 'modules', 'dates'].includes(target));
  ensureModuleManagement();
  const editorTarget = target === 'internship' ? 'work' : target;
  if (editorTarget === 'work') {
    document.querySelector('#section-work .section-title').textContent = WORKSPACE_MODULE_TITLES[target];
    document.querySelector('#addWorkBtn span').textContent = '添加' + WORKSPACE_MODULE_TITLES[target];
  }
  document.querySelectorAll('#workList > .item-card').forEach(card => {
    card.hidden = ['work','internship'].includes(target) && isInternshipRecord({workType:card.querySelector('.work-type')?.value}) !== (target === 'internship');
  });
  document.querySelectorAll('#view-profile .form-content > .section[id]').forEach((section) => {
    section.classList.toggle('is-module-hidden', !workspaceEditing || section.id !== `section-${editorTarget}`);
  });
  applyWorkModuleFilter();
  const overview = document.getElementById('profileOverview');
  overview.hidden = workspaceEditing;
  const backBar = document.getElementById('moduleBackBar');
  backBar.hidden = target === 'overview';
  document.getElementById('moduleTitle').textContent = workspaceEditing ? '编辑模式' : '资料查看';
  document.getElementById('finishModuleEditBtn').hidden =
    !workspaceEditing || ['ai', 'parser', 'actions', 'modules', 'dates'].includes(target);
  if (!workspaceEditing) renderProfileOverview();
  updateSidebarActive();
  if (document.getElementById('view-profile')?.classList.contains('active') && window.scrollY > 24) window.scrollTo(0, 0);
}

function navigateWorkspace(moduleKey, edit = false) {
  showWorkspaceModule(moduleKey, edit);
  history.replaceState(null, null, workspaceModule === 'overview'
    ? '#profile-overview' : `#${workspaceEditing ? 'section' : 'view'}-${workspaceModule}`);
  document.dispatchEvent(new Event('yanyu-section-change'));
}

async function finishWorkspaceEdit() {
  const module = workspaceModule;
  const profileId = activeProfileId;
  const editing = workspaceEditing;
  const revision = profileEditRevision;
  if (await saveProfile() && editing && profileId === activeProfileId && module === workspaceModule &&
      workspaceEditing && revision === profileEditRevision && !['ai', 'parser', 'actions'].includes(module)) {
    refreshSidebarModules();
    navigateWorkspace(module);
  }
}

function updateSidebarActive() {
  document.querySelectorAll('#sidebarMenu .sidebar-link').forEach((link) => {
    const active = link.dataset.module === workspaceModule;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function buildSidebarModuleLink(moduleKey, title, snapshot) {
  const link = document.createElement('a');
  link.className = 'sidebar-link';
  link.href = moduleKey === 'overview' ? '#profile-overview' : `#view-${moduleKey}`;
  link.dataset.module = moduleKey;
  const icon = document.createElement('span');
  icon.className = 'nav-icon';
  icon.innerHTML = moduleKey === 'overview'
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${OVERVIEW_MODULE_ICON}</svg>`
    : profileIcon(moduleKey);
  const text = document.createElement('span');
  text.className = 'nav-text';
  text.textContent = title;
  link.append(icon, text);
  const entries = { work: 'workExperience', internship: 'workExperience', family: 'familyMembers' }[moduleKey] || moduleKey;
  if (profileListKeys.includes(entries)) {
    const count = listEntriesWithData(snapshot, entries).filter(item => !['work','internship'].includes(moduleKey) || isInternshipRecord(item) === (moduleKey === 'internship')).length;
    const badge = document.createElement('span');
    badge.className = 'module-count';
    badge.textContent = count ? String(count) : '空';
    link.append(badge);
  }
  return link;
}

// 侧栏导航：基础模块常驻；低频模块有业务数据或被用户启用后进入主导航，否则收进「添加更多模块」
function refreshSidebarModules() {
  const menu = document.getElementById('sidebarMenu');
  if (!menu) return;
  const snapshot = currentFormSnapshot();
  menu.replaceChildren(...WORKSPACE_MENU_ORDER
    .filter(key => !['ai'].includes(key) && resumeModuleEnabled(snapshot, key))
    .map((key) => buildSidebarModuleLink(key, WORKSPACE_MODULE_TITLES[key], snapshot)));
  updateSidebarActive();

  const hiddenExtras = WORKSPACE_EXTRA_MODULES.filter(([key]) => !resumeModuleEnabled(snapshot, key));
  const list = document.getElementById('sidebarMoreList');
  if (list) {
    list.replaceChildren(...hiddenExtras.map(([key, title]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sidebar-more-item';
      item.dataset.addModule = key;
      const name = document.createElement('span');
      name.className = 'more-item-name';
      name.textContent = title;
      const hint = document.createElement('span');
      hint.className = 'more-item-hint';
      hint.textContent = '+ 添加';
      item.append(name, hint);
      return item;
    }));
  }
  const group = document.getElementById('sidebarMore');
  if (group) {
    group.hidden = hiddenExtras.length === 0;
    if (hiddenExtras.length === 0) group.classList.remove('is-open');
  }
}

function enableExtraModule(moduleKey) {
  if (!WORKSPACE_MODULE_TITLES[moduleKey] || !WORKSPACE_EXTRA_KEYS.includes(moduleKey)) return;
  currentProfile.moduleConfig = resumeModuleConfig(currentProfile);
  currentProfile.moduleConfig.enabled[moduleKey] = true;
  debouncedSave();
  refreshSidebarModules();
  navigateWorkspace(moduleKey, true);
}

// 低频扩展字段折叠区：只折叠不删键；重复渲染时先清理旧包装（兼容旧 .extended-fields 直挂结构）
function countFilledExtFields(keys, values) {
  return keys.filter((key) => {
    const value = values?.[key];
    return Array.isArray(value) ? value.length > 0 : String(value ?? '').trim() !== '';
  }).length;
}

function wrapExtendedCollapse(root, section, values, title, keys = extendedFieldKeys(section)) {
  if (!root) return;
  for (const existing of root.querySelectorAll(`:scope > [data-ext-collapse="${section}"]`)) {
    if (existing.dataset.groupTitle === title) existing.remove();
  }
  const wrap = document.createElement('div');
  wrap.className = 'ext-collapse';
  wrap.dataset.extCollapse = section;
  wrap.dataset.groupTitle = title;
  const filled = countFilledExtFields(keys, values);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ext-collapse-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = `
    <svg class="chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>
    <span class="ext-collapse-title">${html(title)}</span>
    <span class="ext-collapse-meta">${filled ? `已填 ${filled} 项` : '网申低频字段，按需展开'}</span>
  `;
  const body = document.createElement('div');
  body.className = 'ext-collapse-body';
  body.hidden = true;
  appendExtendedFields(body, section, values, keys);
  toggle.addEventListener('click', () => {
    const open = wrap.classList.toggle('is-open');
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  wrap.append(toggle, body);
  root.append(wrap);
}

// ============================================================================
// 简历概览（只读摘要）：空值不显示；DOM 独立于 item-card / *List，避免污染收集链路
// ============================================================================

function overviewRow(label, value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return `<div class="ov-row${text.length > 38 ? ' ov-wide' : ''}"><dt>${html(label)}</dt><dd>${html(text)}</dd></div>`;
}

function overviewCardHtml(moduleKey, title, bodyHtml, entryCount) {
  return `<section class="overview-card" data-module="${attr(moduleKey)}">
    <header class="overview-card-header">
      <h3 class="overview-card-title">${html(title)}${entryCount ? `<span class="ov-count">${entryCount} 条</span>` : ''}</h3>
      <button type="button" class="overview-edit" data-edit-module="${attr(moduleKey)}">编辑</button>
    </header>
    <div class="overview-card-body">${bodyHtml || '<p class="ov-empty">暂无内容，点击「编辑」补充。</p>'}</div>
  </section>`;
}

function overviewExperienceList(entries, details) {
  return entries.map((entry, index) => {
    const { title, meta, descriptions } = details(entry);
    const date = [entry.startDate, entry.endDate].filter(Boolean).join(' 至 ');
    const text = descriptions.filter(([, value]) => String(value || '').trim())
      .map(([label, value]) => String(value).length > 120
        ? `<details class="experience-copy"><summary>${html(label)}</summary><p>${html(value)}</p></details>`
        : `<div class="experience-copy"><strong>${html(label)}</strong><p>${html(value)}</p></div>`).join('');
    return `<article class="experience-preview" data-entry-id="${attr(entry.id)}">
      <header class="experience-preview-header">
        <h4>${html(title || '未命名经历')}</h4>
        ${date ? `<p class="experience-period">${html(date)}</p>` : ''}
      </header>
      ${meta.filter(Boolean).length ? `<p class="experience-meta">${html(meta.filter(Boolean).join(' · '))}</p>` : ''}
      ${text}
      <div class="experience-order">${experienceOrderButtons(index, entries.length)}<button type="button" data-edit-entry>编辑</button></div>
    </article>`;
  }).join('');
}

// ============================================================================
// 简历工作台头部：当前简历身份 + 求职方向 + 共享完整度 + 缺失项快捷入口
// ============================================================================

/** 相对时间（工作台头部的“更新 / 上次使用”） */
function overviewFormatTime(isoString) {
  if (!isoString) return '从未';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '从未';
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins} 分钟前`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)} 小时前`;
  if (diffMins < 10080) return `${Math.floor(diffMins / 1440)} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/** 完整度输入：表单快照 + 当前资料的附件信息（collectProfileUpdates 会剥离附件键） */
function overviewCompletenessSource(snapshot) {
  return {
    ...snapshot,
    resumeFile: currentProfile?.resumeFile,
    resumeFileName: currentProfile?.resumeFileName,
    attachments: currentProfile?.attachments
  };
}

/** 工作台头部 HTML：完整度与缺失项取自共享 ProfileCompleteness（与弹窗同源） */
function overviewWorkbenchHtml(snapshot) {
  const info = snapshot.basicInfo || {};
  const job = snapshot.jobIntention || {};
  const education = listEntriesWithData(snapshot, 'education');
  const completeness = ProfileCompleteness.computeProfileCompleteness(overviewCompletenessSource(snapshot));
  const missingQuick = completeness.missing.slice(0, 3);
  const direction = [job.expectedPosition, job.expectedCity].filter(Boolean).join(' · ');
  const tagline = [
    education[0] && [education[0].degree, education[0].school, education[0].major].filter(Boolean).join(' · '),
    direction
  ].filter(Boolean).join(' ｜ ') || '完善基础信息与教育经历，让网申填充更精准';
  const updatedAt = overviewFormatTime(currentProfile?.updatedAt);
  const lastUsedAt = overviewFormatTime(currentProfile?.lastUsedAt);

  const missingHtml = completeness.missing.length === 0
    ? '<span class="ov-wb-done">关键信息已齐全，可直接一键填入</span>'
    : missingQuick.map((item) =>
      `<button type="button" class="ov-missing-link" data-goto-module="${attr(item.moduleKey)}" title="去补充：${attr(item.label)}">+ ${html(item.label)}</button>`
    ).join('');

  return `<header class="overview-hero overview-workbench">
    <div class="overview-hero-main">
      <p class="ov-wb-resume">
        <span class="ov-wb-resume-name">${html(currentProfile?.name || '默认资料')}</span>
        <span class="overview-hero-badge">简历工作台</span>
      </p>
      <h2 class="overview-name">${html(info.fullName || '未填写姓名')}</h2>
      <p class="overview-tagline">${html(tagline)}</p>
      <div class="ov-wb-actions">
        <button type="button" class="ov-wb-btn is-primary" data-goto-module="basic">编辑资料</button>
        <button type="button" class="ov-wb-btn" data-goto-module="parser">导入简历</button>
        <button type="button" class="ov-wb-btn" data-create-profile>新建简历</button>
      </div>
    </div>
    <div class="ov-wb-status">
      <div class="ov-wb-completeness">
        <span class="ov-wb-percent">${completeness.percent}%</span>
        <div class="ov-wb-progress"><div class="ov-wb-progress-fill" style="width: ${completeness.percent}%;"></div></div>
        <span class="ov-wb-caption">资料完整度 ${completeness.filled}/${completeness.total}</span>
      </div>
      <p class="ov-wb-meta">更新 ${html(updatedAt)} · 上次使用 ${html(lastUsedAt)}</p>
      <div class="ov-wb-missing">${missingHtml}</div>
    </div>
  </header>`;
}

function renderProfileOverview() {
  const root = document.getElementById('profileOverview');
  if (!root) return;
  const snapshot = currentFormSnapshot();
  if (!snapshot) {
    root.innerHTML = '<div class="overview-empty-state">暂无简历资料，请点击右侧「新增资料」创建一份。</div>';
    return;
  }

  const info = snapshot.basicInfo || {};
  const job = snapshot.jobIntention || {};
  const education = listEntriesWithData(snapshot, 'education');
  const work = listEntriesWithData(snapshot, 'workExperience');
  const projects = listEntriesWithData(snapshot, 'projects');

  const basicBody = [
    overviewRow('姓名', info.fullName),
    overviewRow('英文名', info.englishName),
    overviewRow('性别', info.gender),
    overviewRow('出生日期', info.birthDate),
    overviewRow('手机号码', info.phone),
    overviewRow('电子邮箱', info.email),
    overviewRow('微信号', info.wechat),
    overviewRow('QQ 号', info.qq),
    overviewRow('证件类型', info.idCardType),
    overviewRow('政治面貌', info.politicalStatus),
    overviewRow('现居城市', info.currentCity),
    overviewRow('预计毕业', info.graduationDate),
    ...Object.entries(profileSchema.basicInfo).filter(([key]) => !['englishName', 'wechat', 'qq', 'idCardType'].includes(key))
      .map(([key, label]) => overviewRow(label, info[key]))
  ].join('');

  const intentionBody = [
    overviewRow('期望职位', job.expectedPosition),
    overviewRow('期望行业', job.expectedIndustry),
    overviewRow('期望城市', job.expectedCity),
    overviewRow('期望薪资', job.expectedSalary),
    overviewRow('薪资周期', job.salaryPeriod),
    overviewRow('当前薪资', job.currentSalary),
    overviewRow('到岗时间', job.availableDate),
    overviewRow('是否服从调剂', job.acceptAdjustment),
    overviewRow('出差意愿', job.willingToTravel)
  ].join('');

  const educationBody = overviewExperienceList(education, (edu) => ({
    title: edu.school || edu.major, meta: [edu.degree, edu.college, edu.major],
    descriptions: [['主修课程', edu.courses], ['在校经历', edu.description]]
  }));
  const workBody = overviewExperienceList(work, (item) => ({
    title: item.company || item.position, meta: [item.position, item.workType, item.city],
    descriptions: [['主要职责', item.description], ['成果', item.achievements]]
  }));
  const projectsBody = overviewExperienceList(projects, (item) => ({
    title: item.name, meta: [item.role, item.projectType, item.techStack],
    descriptions: [['项目介绍', item.description], ['项目职责', item.responsibilities], ['项目成果', item.achievements]]
  }));

  const skills = profileSkillEntries(snapshot).filter(skill => skill.name || skill.proficiency || skill.category || skill.description);
  const attachments = currentProfile?.attachments || {};
  const skillsBody = [
    overviewExperienceList(skills, skill => ({ title: skill.name, meta: [skill.category],
      descriptions: [['掌握程度', skill.proficiency], ['补充说明', skill.description]] })),

    overviewRow('简历附件', attachments.resume?.name || snapshot.resumeFileName || ''),
    attachments.idPhoto ? overviewRow('证件照', attachments.idPhoto.name) : '',
    attachments.lifePhoto ? overviewRow('生活照', attachments.lifePhoto.name) : '',
    Array.isArray(attachments.works) && attachments.works.length ? overviewRow('作品附件', `${attachments.works.length} 个`) : ''
  ].filter(Boolean).join('');

  const cards = new Map([
    ['basic', overviewCardHtml('basic', '基础信息', basicBody && `<dl class="ov-field-list">${basicBody}</dl>`)],
    ['intention', overviewCardHtml('intention', '求职意向', intentionBody && `<dl class="ov-field-list">${intentionBody}</dl>`)],
    ['education', overviewCardHtml('education', '教育经历', educationBody, education.length)],
    ['work', overviewCardHtml('work', '工作 / 实习经历', workBody, work.length)],
    ['projects', overviewCardHtml('projects', '项目经历', projectsBody, projects.length)],
    ['skills', overviewCardHtml('skills', 'IT 技能', skillsBody, skills.length)]
  ]);

  // 低频与辅助模块：仅有业务数据时才生成概览卡，空模块不占屏
  const listCards = [
    ['awards', '荣誉奖项', 'awards', { level:'级别', date:'获奖日期' }],
    ['certificates', '资格证书', 'certificates', { issuer:'颁发机构', code:'编号', date:'取得日期', expiryDate:'有效期至' }],
    ['family', '家庭成员', 'familyMembers', { relation:'关系', employer:'工作单位', position:'职务', phone:'联系电话' }],
    ['campusPositions', '在校职务', 'campusPositions'], ['campusActivities', '校园活动', 'campusActivities'],
    ['trainings', '培训经历', 'trainings'], ['languageCertificates', '外语能力', 'languageCertificates'],
    ['papers', '论文', 'papers'], ['patents', '专利', 'patents'], ['openSource', '开源成果', 'openSource'],
    ['customAnswers', '额外问答', 'customAnswers'], ['declarations', '个人声明', 'declarations']
  ];
  for (const [moduleKey, title, dataKey, extra] of listCards) {
    const entries = listEntriesWithData(snapshot, dataKey);
    if (!entries.length) continue;
    const fields = { ...extra, ...profileSchema[dataKey] };
    const details = item => ({
      title: dataKey === 'languageCertificates' ? languageCardTitle(item) : item.name || item.organization || item.title || item.question || item.url,
      meta: [], descriptions: Object.entries(fields).filter(([key]) => !['name','question','startDate','endDate'].includes(key))
        .map(([key, label]) => [label, item[key]])
    });
    cards.set(moduleKey, overviewCardHtml(moduleKey, title, overviewExperienceList(entries, details), entries.length));
  }
  const commonAnswers = snapshot.commonAnswers || {};
  const commonRows = Object.entries(profileSchema.commonAnswers || {}).filter(([key]) => key !== 'aiTools').map(([key, label]) =>
    overviewRow(label, Array.isArray(commonAnswers[key]) ? commonAnswers[key].join('、') : commonAnswers[key])).join('');
  if (commonRows) cards.set('commonAnswers', overviewCardHtml('commonAnswers', '常用问答', commonRows));

  cards.set('introduction', overviewCardHtml('introduction', '自我介绍', overviewRow('自我介绍', snapshot.introTemplates?.default)));
  cards.set('aiTools', overviewCardHtml('aiTools', 'AI 工具应用', overviewRow('应用经验', snapshot.commonAnswers?.aiTools)));
  for (const key of ['work', 'internship']) {
    const entries = work.filter(item => isInternshipRecord(item) === (key === 'internship'));
    cards.set(key, overviewCardHtml(key, WORKSPACE_MODULE_TITLES[key], overviewExperienceList(entries, item => ({title:item.company || item.position, meta:[item.position,item.workType,item.city], descriptions:[['主要职责',item.description],['成果',item.achievements]]})), entries.length));
  }
  for (const key of cards.keys()) if (!resumeModuleEnabled(snapshot, key)) cards.delete(key);
  const contents = workspaceModule === 'overview'
    ? overviewWorkbenchHtml(snapshot) + [...cards.values()].join('')
    : cards.get(workspaceModule) || overviewCardHtml(workspaceModule, WORKSPACE_MODULE_TITLES[workspaceModule], '');
  root.innerHTML = `<div class="overview-grid">${contents}</div>`;
  updateRailProfileCard();
}

function updateRailProfileCard() {
  const nameEl = document.getElementById('railProfileName');
  if (nameEl) nameEl.textContent = currentProfile?.name || '默认资料';
  const metaEl = document.getElementById('railProfileMeta');
  if (!metaEl) return;
  const snapshot = currentFormSnapshot();
  if (!snapshot) {
    metaEl.textContent = '';
    return;
  }
  const completeness = ProfileCompleteness.computeProfileCompleteness(overviewCompletenessSource(snapshot));
  metaEl.textContent = `完整度 ${completeness.percent}% · 教育 ${listEntriesWithData(snapshot, 'education').length} · 工作 ${listEntriesWithData(snapshot, 'workExperience').length} · 项目 ${listEntriesWithData(snapshot, 'projects').length}`;
}

function refreshWorkspaceUi() {
  // 切换资料或删除内容后，若当前低频模块在新资料中为空且未主动启用，不允许出现无导航的孤儿编辑页。
  if (!resumeModuleEnabled(currentProfile, workspaceModule)) {
    workspaceModule = 'overview';
    history.replaceState(null, null, '#profile-overview');
  }
  refreshSidebarModules();
  showWorkspaceModule(workspaceModule, workspaceEditing);
}

function ensureModuleManagement() {
  const host = document.querySelector('#view-profile .form-content');
  if (!host) return;
  for (const [key,title] of [['introduction','自我介绍'],['aiTools','AI 工具应用'],['modules','模块管理'],['dates','日期待完善']]) {
    if (document.getElementById('section-'+key)) continue;
    const section = document.createElement('section');
    section.id = 'section-'+key; section.className = 'section glass is-module-hidden';
    const heading = document.createElement('h2'); heading.textContent = title; section.append(heading); host.append(section);
  }
  const intro = document.getElementById('introduction')?.closest('.form-group');
  if (intro) document.getElementById('section-introduction').append(intro);
  const ai = document.querySelector('#section-commonAnswers [data-ext-key="aiTools"]')?.closest('.form-group');
  if (ai) document.getElementById('section-aiTools').append(ai);
  const manager = document.getElementById('section-modules');
  manager.querySelector('.module-tiles')?.remove();
  const tiles = document.createElement('div');
  tiles.className = 'module-tiles';
  const snapshot = currentFormSnapshot();
  for (const key of ['basic', 'intention', 'education', ...resumeOptionalModules]) {
    const label = document.createElement('label');
    label.className = 'module-tile';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = resumeModuleEnabled(snapshot, key);
    input.disabled = !currentProfile || !resumeOptionalModules.includes(key);
    input.dataset.moduleToggle = key;
    const dataKey = { work: 'workExperience', internship: 'workExperience', family: 'familyMembers' }[key] || key;
    let entries = snapshot?.[dataKey];
    if (Array.isArray(entries) && ['work', 'internship'].includes(key)) {
      entries = entries.filter(item => isInternshipRecord(item) === (key === 'internship'));
    }
    const title = document.createElement('strong');
    title.textContent = WORKSPACE_MODULE_TITLES[key] || key;
    const state = document.createElement('small');
    const updateState = () => {
      const count = Array.isArray(entries) ? ` · ${entries.filter(entryHasContent).length} 条` : '';
      state.textContent = (input.disabled ? '固定保留' : input.checked ? '已启用' : '已关闭') + count;
    };
    updateState();
    label.append(input, title, state);
    input.addEventListener('change', async () => {
      currentProfile.moduleConfig = resumeModuleConfig(currentProfile);
      currentProfile.moduleConfig.enabled[key] = input.checked;
      updateState();
      profileDirty = true;
      profileEditRevision++;
      if (!await saveProfile({ silent: true })) {
        showToast(window.YanyuDates?.error || '模块设置保存失败，请重试', 'error');
      }
      refreshSidebarModules();
      updateRailProfileCard();
      window.YanyuDates?.refresh();
    });
    tiles.append(label);
  }
  manager.append(tiles);
}

function applyWorkModuleFilter() {
  document.querySelectorAll('#workList > .item-card').forEach(card => {
    card.hidden = ['work','internship'].includes(workspaceModule) && isInternshipRecord({workType:card.querySelector('.work-type')?.value}) !== (workspaceModule === 'internship');
  });
  const cards = [...document.querySelectorAll('#workList > .item-card')].filter(card => !card.hidden);
  cards.forEach((card,index) => {
    const up = card.querySelector('[data-move-entry="up"]');
    const down = card.querySelector('[data-move-entry="down"]');
    if(up) up.disabled = index === 0;
    if(down) down.disabled = index === cards.length-1;
  });
}
