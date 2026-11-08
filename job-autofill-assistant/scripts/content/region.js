// ============================================================================
// Capybara 网申助手 content script —— region.js
// 选区填入：框选经历区域 → 选择条目 → 规则层 + AI 层定向写入
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';
// ========================================================================
// 7. 选区填入（框选页面一段经历区域 → 选择资料条目 → 定向填入区域内空白字段）
// ========================================================================

var  REGION_OVERLAY_ID = 'job-autofill-region-overlay';
var  REGION_PANEL_ID = 'job-autofill-region-panel';
var  REGION_MIN_DRAG_PX = 10;    // 误触阈值：拖拽距离不足视为误触，留在框选模式
var  REGION_OVERLAP_RATIO = 0.5; // 控件与选区相交面积超过控件面积 50% 视为框内
var  REGION_URL_WATCH_MS = 800;  // 框选期间轮询 URL 变化（覆盖 pushState 等 SPA 跳转）

// 选区填入单例状态：{ phase: 'select'|'panel', profile, root, panel, refs, skippedHasValue, onKeyDown, urlTimer, lastHref }
var  regionFillState = null;
// 选区填入执行锁：覆盖"读取设置 → AI 匹配 → 写入"全程，防止重入启动、与 AI 助填并发互相隐藏进度条
var  regionFillRunning = false;

// 分类展示元数据（顺序即面板展示顺序）
var  REGION_CATEGORY_META = [
  { key: 'basicInfo', name: '基本信息', single: true },
  { key: 'education', name: '教育经历' },
  { key: 'workExperience', name: '实习与工作经历' },
  { key: 'projects', name: '项目经历' },
  { key: 'awards', name: '奖项荣誉' },
  { key: 'familyMembers', name: '家庭成员' }
];

// 条目字段 → 常见 label 词映射（第一层规则匹配，思路同 FIELD_PATTERNS）。
// 特殊名称类字段（项目名/奖项名/成员姓名）在各分类定义里单独给 pattern，避免互相误伤。
var  REGION_COMMON_FIELD_PATTERNS = {
  college: /学院|院系|college/,
  school: /学校|院校|university|school/,
  academicDegree: /学位/,
  degree: /学历|文化程度|education/,
  major: /专业|major/,
  rank: /排名|名次|rank/,
  courses: /课程|主修|course/,
  company: /公司名称|公司|实习单位|工作单位|单位名称|单位|employer|company/,
  department: /部门|科室|department|dept/,
  position: /职位|岗位|职务|职称|position|title/,
  role: /角色|担任|role/,
  description: /描述|介绍|说明|内容|详情|description/,
  responsibilities: /职责|负责|responsib/,
  achievements: /成果|业绩|产出|achievement/,
  level: /级别|等级|level/,
  issuer: /颁发单位|颁发机构|颁奖单位|发证单位|颁发|issuer/,
  date: /日期|时间|date/,
  relation: /关系|称谓|relation/,
  employer: /工作单位|单位名称|单位|employer/,
  phone: /电话|手机|联系方式|phone|mobile|tel/
};

// 各分类条目字段化定义：数组顺序即规则匹配优先级（学院先于学校、学位先于学历、起止时间居后兜底）
var  REGION_ENTRY_FIELD_DEFS = {
  education: [
    { key: 'college', label: '学院' },
    { key: 'school', label: '学校' },
    { key: 'academicDegree', label: '学位' },
    { key: 'degree', label: '学历' },
    { key: 'major', label: '专业' },
    { key: 'dateRange', label: '起止时间' },
    { key: 'rank', label: '排名' },
    { key: 'courses', label: '课程' }
  ],
  workExperience: [
    { key: 'company', label: '公司' },
    { key: 'department', label: '部门' },
    { key: 'position', label: '职位' },
    { key: 'dateRange', label: '起止时间' },
    { key: 'description', label: '描述' },
    { key: 'achievements', label: '成果' }
  ],
  projects: [
    { key: 'name', label: '名称', pattern: /项目名称|项目名|名称|project/i },
    { key: 'role', label: '角色' },
    { key: 'dateRange', label: '起止时间' },
    { key: 'description', label: '描述' },
    { key: 'responsibilities', label: '职责' },
    { key: 'achievements', label: '成果' }
  ],
  awards: [
    { key: 'level', label: '级别' },
    { key: 'date', label: '日期' },
    { key: 'issuer', label: '颁发单位' },
    { key: 'description', label: '说明' },
    // name 收敛为具体词：泛化"奖项|奖励|荣誉"会抢占"奖项级别/荣誉等级"等字段的匹配
    { key: 'name', label: '名称', pattern: /奖项名称|奖励名称|荣誉名称|award/i }
  ],
  familyMembers: [
    { key: 'name', label: '姓名', pattern: /姓名|名字|成员姓名|name/i },
    { key: 'relation', label: '关系' },
    { key: 'employer', label: '单位' },
    { key: 'position', label: '职务' },
    { key: 'phone', label: '电话' }
  ]
};

// basicInfo 字段规则映射（顺序即优先级：紧急联系人/证件号等具体词先于 姓名/电话 等泛化词）
var  REGION_BASIC_INFO_FIELD_PATTERNS = [
  // 塔塔对齐字段：证件类型先于证件号（防"证件类型"label 命中 idCard）
  ['idCardType', /证件类型|证件种类|idcardtype|certificate\s*type/],
  ['idCard', /身份证|证件号码|idcard|identity/],
  ['emergencyPhone', /(?:紧急|应急)联系人?(?:电话|手机|联系方式)|(?:紧急|应急)电话|联系人电话/],
  ['emergencyContact', /(?:紧急|应急)联系人|联系人姓名/],
  ['emergencyRelation', /联系人?关系|(?:紧急|应急)关系/],
  // 拼音/英文名等"姓名+限定词"字段先于泛化的 姓名 匹配（否则被 fullName 的 name/姓名 抢占）；
  // 姓名全拼先于姓/名拼音（"姓名拼音"含子串"名拼音"，顺序反了会误命中名拼音）
  ['namePinyinFull', /姓名拼音|姓名全拼|全拼/],
  ['lastNamePinyin', /姓(?:氏|的)?拼音|last\s*name\s*(?:拼音|pinyin)/],
  ['firstNamePinyin', /名(?:字|的)?拼音|first\s*name\s*(?:拼音|pinyin)/],
  ['englishName', /英文名|english\s*name/],
  // 本人字段用变长负向后行断言排除"紧急/应急/联系人"语义（出现在 label 任意前部都拒绝）：
  // 资料中无对应专用字段时不允许回退误填本人姓名/手机号
  ['fullName', /(?<!紧急.*)(?<!应急.*)(?<!联系人.*)(姓名|名字|name)/],
  ['birthDate', /出生|生日|birth/],
  ['gender', /性别|gender/],
  ['politicalStatus', /政治面貌|政治身份|political/],
  ['partyJoinDate', /入党/],
  ['leagueJoinDate', /入团/],
  ['ethnicity', /民族|族别|ethnic/],
  ['sourcePlace', /生源地|生源/],
  ['hometown', /籍贯|hometown/],
  // 户籍类型（具体）先于户籍地（泛化 /户籍|户口/）
  ['registeredAddressType', /户籍类型|户口性质|户籍类别/],
  ['registeredAddress', /户籍|户口/],
  ['maritalStatus', /婚姻|婚否|marital/],
  ['graduationDate', /毕业时间|毕业日期|^毕业$/],
  ['currentCity', /现居|现所在|目前所在|当前所在|现居住/],
  ['city', /城市|city/],
  ['state', /省份|province/],
  ['nationality', /国籍|nationality/],
  ['country', /国家|country/],
  ['zipCode', /邮编|邮政编码|zip|postal/],
  ['address', /通讯地址|联系地址|详细地址|住址|地址|address/],
  ['street', /街道|street/],
  ['phoneType', /手机类型|号码类型/],
  ['phone', /(?<!紧急.*)(?<!应急.*)(?<!联系人.*)(手机|电话|联系方式|联系手机|mobile|phone|tel)/],
  ['email', /邮箱|电子邮件|邮件|email|mail/],
  ['linkedin', /领英|linkedin/],
  ['github', /github/],
  ['website', /个人主页|个人网站|主页|website/],
  ['twitter', /twitter|推特/],
  ['height', /身高|height/],
  ['weight', /体重|weight/],
  ['health', /健康状况|健康|health/],
  // 塔塔对齐字段（无既有泛化词冲突，统一收口在此）
  ['wechat', /微信/],
  ['qq', /qq/],
  ['bloodType', /血型/],
  ['religion', /宗教/],
  ['honor', /荣誉/],
  ['specialSkills', /特长|特殊技能/],
  ['openToWork', /求职状态|在职状态|就业状态/],
  ['yearsOfWork', /工作年限|工作年数/],
  ['permanentResidencePermit', /居住证/],
  ['jobSources', /招聘信息来源|招聘来源|信息来源|渠道/],
  ['foreignCitizenship', /外国国籍|外国居留权/],
  ['relativesEmployed', /亲属.*任职|亲属回避|回避/],
  ['personalPromise', /个人声明|个人承诺|承诺/],
  ['location', /现住址|现址|location/]
];

// 纯函数：矩形 a 与 b 的相交面积（不相交为 0）
function regionRectsIntersectionArea(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

// 纯函数：控件与选区的相交面积占控件自身面积的比例（控件无面积时返回 0）
function regionControlOverlapRatio(controlRect, selRect) {
  if (!controlRect) return 0;
  const area = (controlRect.right - controlRect.left) * (controlRect.bottom - controlRect.top);
  if (area <= 0) return 0;
  return regionRectsIntersectionArea(controlRect, selRect) / area;
}

// 纯函数：起止时间类 label 判定（开始/结束/整段）。具体词优先：开始时间→start，毕业/结束→end，起止/时间→整段
function regionDateSideOfLabel(label) {
  const text = String(label || '');
  if (/开始|起始|入职|入学|start|from/i.test(text)) return 'start';
  if (/结束|截止|毕业|离职|end\b/i.test(text)) return 'end';
  if (/起止|时间|日期|从.*至|date|period/i.test(text)) return 'range';
  return null;
}

// 纯函数：把所选条目字段化为 [{key,label,value,pattern}]（空值剔除；起止时间合并为 dateRange 特殊字段）。
// basicInfo 全字段参与：有规则映射的走规则层，其余字段仅作为 AI 层的资料参考。
function regionLegacyFieldizeEntry(category, entry) {
  if (!entry || typeof entry !== 'object') return [];
  const text = (v) => String(v ?? '').trim();
  const pick = (key, label, pattern) => {
    const value = text(entry[key]);
    return value ? { key, label, value, pattern: pattern || null } : null;
  };

  if (category === 'basicInfo') {
    const fields = [];
    const seen = new Set();
    for (const [key, pattern] of REGION_BASIC_INFO_FIELD_PATTERNS) {
      const field = pick(key, resolveFieldLabel('basicInfo', key), pattern);
      if (field) { fields.push(field); seen.add(key); }
    }
    for (const key of Object.keys(entry)) {
      if (seen.has(key) || typeof entry[key] !== 'string') continue;
      const value = text(entry[key]);
      if (value) fields.push({ key, label: resolveFieldLabel('basicInfo', key), value, pattern: null });
    }
    return fields;
  }

  const fields = [];
  for (const def of REGION_ENTRY_FIELD_DEFS[category] || []) {
    if (def.key === 'dateRange') {
      const startDate = text(entry.startDate);
      const endDate = text(entry.endDate);
      if (!startDate && !endDate) continue;
      fields.push({
        key: 'dateRange',
        label: '起止时间',
        value: [startDate, endDate].filter(Boolean).join(' 至 '),
        startDate,
        endDate,
        pattern: null
      });
      continue;
    }
    const field = pick(def.key, def.label, def.pattern || REGION_COMMON_FIELD_PATTERNS[def.key]);
    if (field) fields.push(field);
  }
  return fields;
}

// 纯函数：label 与条目字段的规则匹配，返回 {field, side}（dateRange 字段附带 start/end/range 判定）；未命中返回 null
function regionMatchRuleField(labelText, fields) {
  const text = String(labelText || '').trim().toLowerCase();
  if (!text) return null;
  for (const field of fields) {
    if (field.key === 'dateRange') {
      const side = regionDateSideOfLabel(text);
      if (side) return { field, side };
      continue;
    }
    if (field.pattern && field.pattern.test(text)) return { field, side: '' };
  }
  return null;
}

// 纯函数：起止时间的分流判定。输入携带 label 语义 side（'start'/'end'/'range'，来自 regionMatchRuleField），
// 输出每个命中项的最终取值侧：
// - 显式 start/end 语义（如"入职时间/离职时间"）一律按 label 语义，不受 DOM 顺序影响；
// - range 语义（如"起止时间/时间"）在同一行容器内恰好两个时按 DOM 顺序拆成 开始/结束，其余保持整段填合并区间。
// 无 side 的命中项（外部直接构造）按 range 语义处理
function regionSplitDateRangeRefs(dateHits) {
  const resolved = new Map();
  const rangeOnly = [];
  for (const hit of dateHits) {
    if (hit.side === 'start' || hit.side === 'end') {
      resolved.set(hit, hit.side);
    } else {
      rangeOnly.push(hit);
    }
  }
  const byRow = new Map();
  for (const hit of rangeOnly) {
    const row = smartFillRowContainer(hit.ref.el) || hit.ref.el.parentElement || null;
    const list = byRow.get(row) || [];
    list.push(hit);
    byRow.set(row, list);
  }
  for (const hits of byRow.values()) {
    if (hits.length === 2) {
      resolved.set(hits[0], 'start');
      resolved.set(hits[1], 'end');
    } else {
      for (const hit of hits) resolved.set(hit, 'range');
    }
  }
  return resolved;
}

// 规则匹配用的字段描述文本：label 优先，其次 placeholder、name
function regionRefLabelText(ref) {
  return String(ref.domLabel || ref.placeholder || ref.name || '').trim();
}

// 纯函数：取资料中某分类的条目数组（basicInfo 视作单条目）
function regionCategoryEntries(profile, category) {
  if (!profile) return [];
  if (category === 'basicInfo') {
    return profile.basicInfo && Object.keys(profile.basicInfo).length ? [profile.basicInfo] : [];
  }
  const list = profile[category];
  return Array.isArray(list) ? list : [];
}

// 纯函数：条目摘要（工作=公司·职位，教育=学校·专业，项目=名称·角色，奖项=名称，家庭成员=姓名·关系）
function regionLegacyEntrySummary(category, entry) {
  const pick = (...vals) => vals.map((v) => String(v || '').trim()).filter(Boolean);
  let summary = '';
  if (category === 'education') summary = pick(entry.school, entry.major).join('·');
  else if (category === 'workExperience') summary = pick(entry.company, entry.position).join('·');
  else if (category === 'projects') summary = pick(entry.name, entry.role).join('·');
  else if (category === 'awards') summary = pick(entry.name).join('·');
  else if (category === 'familyMembers') summary = pick(entry.name, entry.relation).join('·');
  else if (category === 'basicInfo') summary = pick(entry.fullName, entry.phone)[0] || '';
  if (summary) return summary;
  // 指定摘要字段都为空时，退回条目里第一个非空字段值
  const first = regionFieldizeEntry(category, entry)[0];
  return first ? first.value : '';
}

// 纯函数：面板分类模型，仅返回资料中实际有条目的分类（含条目数与摘要）
function regionPanelCategories(profile) {
  const categories = [];
  for (const meta of REGION_CATEGORY_META) {
    const entries = regionCategoryEntries(profile, meta.key)
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => regionFieldizeEntry(meta.key, entry).length > 0);
    if (!entries.length) continue;
    categories.push({
      key: meta.key,
      name: meta.name,
      single: !!meta.single,
      items: entries.map(({ entry, idx }) => ({ idx, summary: regionEntrySummary(meta.key, entry) }))
    });
  }
  return categories;
}

// 收集框选区域内的可填字段：几何命中（相交面积 > 控件面积 50%）→ 复用现有安全过滤与枚举 →
// 已有值控件跳过（本功能定位是补填空白块，跳过数记入日志）；返回与 resolveSmartFillField 兼容的字段引用
function collectRegionFields(selRect) {
  const nameOrdinals = new Map();
  const collected = [];
  let skippedHasValue = 0;
  let skippedNoClue = 0;

  listSmartFillFields().forEach((el, position) => {
    // nameOrdinal 必须在任何过滤之前、基于完整候选列表计算，解析时才能用同一口径取回
    const name = el.getAttribute('name') || '';
    const nameKey = `${el.tagName}|${name}`;
    const nameOrdinal = nameOrdinals.get(nameKey) || 0;
    nameOrdinals.set(nameKey, nameOrdinal + 1);

    if (regionControlOverlapRatio(el.getBoundingClientRect(), selRect) <= REGION_OVERLAP_RATIO) return;

    if (fieldHasValue(el)) { skippedHasValue++; return; }
    const widget = el.tagName !== 'SELECT' && isWidgetSelectTrigger(el);
    if (widget && widgetSelectCurrentValue(el)) { skippedHasValue++; return; } // 组件下拉已有选中值，视为已填
    // P0：非 input 的触发容器（div[role=combobox] 等）钻取到的内层控件若是密码/文件等敏感输入，整组拒绝
    if (widget && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      const inner = writableBox(el);
      if (inner && inner !== el && !isSmartFillWritableInnerInput(inner)) return;
    }

    const placeholder = el.placeholder || el.getAttribute('placeholder') || '';
    const domLabel = getClosestLabelText(el);
    if (!domLabel && !placeholder && !name) { skippedNoClue++; return; } // 完全无线索，规则与 AI 都无法判断

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
      label: domLabel || placeholder,
      placeholder,
      maxLength: parseInt(el.getAttribute('maxlength') || '0', 10),
      options: smartFillSelectOptions(el)
    };
    if (widget) ref.kind = 'widget-select';
    collected.push(ref);
  });

  tagSmartFillFieldGroups(collected);
  return { refs: collected, skippedHasValue, skippedNoClue };
}

function regionOverlayTheme() {
  const dock = document.getElementById('job-autofill-dock');
  return dock && dock.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// 框选期间轮询 URL：SPA 跳转（含 pushState）自动退出框选模式；用 setTimeout 链避免常驻定时器
function scheduleRegionUrlWatch() {
  const state = regionFillState;
  if (!state) return;
  state.urlTimer = setTimeout(() => {
    if (regionFillState !== state) return;
    try {
      if (String(location.href) !== state.lastHref) {
        if (typeof appLog !== 'undefined') {
          appLog.info('content', 'region.url_exit', '页面 URL 变化，自动退出选区模式', { from: state.lastHref, to: String(location.href) });
        }
        exitRegionFillMode();
        showNotification('页面已跳转，选区模式已自动退出', 'info');
        return;
      }
    } catch { /* location 不可读时仅保持轮询 */ }
    scheduleRegionUrlWatch();
  }, REGION_URL_WATCH_MS);
}

// 彻底退出选区填入：移除 overlay/面板 DOM、解绑 document 监听、停止 URL 轮询（防泄漏）
function exitRegionFillMode() {
  const state = regionFillState;
  regionFillState = null;
  if (!state) return;
  if (state.urlTimer) clearTimeout(state.urlTimer);
  document.removeEventListener('keydown', state.onKeyDown, true);
  if (state.onWindowMouseUp) window.removeEventListener('mouseup', state.onWindowMouseUp);
  if (state.root && state.root.parentElement) state.root.parentElement.removeChild(state.root);
  if (state.panel && state.panel.parentElement) state.panel.parentElement.removeChild(state.panel);
}

function isRegionFillActive() {
  return !!regionFillState;
}

// 进入框选模式：全页遮罩（四块拼合）+ 十字参考线 + 顶部提示气泡。
// 遮罩层接收全部指针事件，页面原生元素收不到点击；右键 preventDefault 仅在本模式内生效
function enterRegionSelectMode(profile) {
  if (regionFillState) exitRegionFillMode();

  const root = document.createElement('div');
  root.id = REGION_OVERLAY_ID;
  root.setAttribute('data-theme', regionOverlayTheme());

  const mk = (cls) => {
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
  hint.textContent = '长按鼠标左键拖拽框选一段经历区域；鼠标右键取消重框；Esc 退出选区模式';
  const rectBox = mk('job-autofill-region-rect');
  const sizeBadge = mk('job-autofill-region-size');
  [shadeTop, shadeLeft, shadeRight, shadeBottom, crossH, crossV, rectBox, hint, sizeBadge].forEach((node) => {
    root.appendChild(node);
  });
  document.body.appendChild(root);

  const viewW = () => window.innerWidth || document.documentElement.clientWidth || 0;
  const viewH = () => window.innerHeight || document.documentElement.clientHeight || 0;
  const setBlock = (node, left, top, width, height) => {
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.width = `${Math.max(0, width)}px`;
    node.style.height = `${Math.max(0, height)}px`;
  };
  // 未拖拽或取消后：整页覆盖
  const shadeFull = () => {
    setBlock(shadeTop, 0, 0, viewW(), viewH());
    setBlock(shadeLeft, 0, 0, 0, 0);
    setBlock(shadeRight, 0, 0, 0, 0);
    setBlock(shadeBottom, 0, 0, 0, 0);
  };
  // 拖拽中：四块遮罩拼合围出选区，选区内正常亮度
  const applyShades = (x1, y1, x2, y2) => {
    setBlock(shadeTop, 0, 0, viewW(), y1);
    setBlock(shadeLeft, 0, y1, x1, y2 - y1);
    setBlock(shadeRight, x2, y1, viewW() - x2, y2 - y1);
    setBlock(shadeBottom, 0, y2, viewW(), viewH() - y2);
  };
  shadeFull();

  let dragStart = null;
  const resetDrag = () => {
    dragStart = null;
    rectBox.style.display = 'none';
    sizeBadge.style.display = 'none';
    shadeFull();
  };
  const updateDrag = (x, y) => {
    if (!dragStart) return;
    const x1 = Math.min(dragStart.x, x);
    const y1 = Math.min(dragStart.y, y);
    const x2 = Math.max(dragStart.x, x);
    const y2 = Math.max(dragStart.y, y);
    applyShades(x1, y1, x2, y2);
    rectBox.style.display = 'block';
    rectBox.style.left = `${x1}px`;
    rectBox.style.top = `${y1}px`;
    rectBox.style.width = `${x2 - x1}px`;
    rectBox.style.height = `${y2 - y1}px`;
    sizeBadge.style.display = 'block';
    sizeBadge.textContent = `${x2 - x1} × ${y2 - y1} px`;
    sizeBadge.style.left = `${Math.min(x2 + 8, Math.max(0, viewW() - 110))}px`;
    sizeBadge.style.top = `${Math.max(8, y1 - 30)}px`;
  };

  const onMouseMove = (e) => {
    crossH.style.top = `${e.clientY}px`;
    crossV.style.left = `${e.clientX}px`;
    updateDrag(e.clientX, e.clientY);
  };
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart = { x: e.clientX, y: e.clientY };
    updateDrag(e.clientX, e.clientY);
  };
  const onMouseUp = (e) => {
    if (e.button !== 0 || !dragStart) return;
    const x1 = Math.min(dragStart.x, e.clientX);
    const y1 = Math.min(dragStart.y, e.clientY);
    const x2 = Math.max(dragStart.x, e.clientX);
    const y2 = Math.max(dragStart.y, e.clientY);
    const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    dragStart = null;
    if (moved < REGION_MIN_DRAG_PX) { resetDrag(); return; } // 误触：留在框选模式
    finishRegionSelect({ left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1 });
  };
  const onContextMenu = (e) => {
    e.preventDefault();
    resetDrag(); // 右键取消当前框，回到框选模式初始态
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    exitRegionFillMode();
    showNotification('已退出选区模式', 'info');
  };

  root.addEventListener('mousemove', onMouseMove);
  root.addEventListener('mousedown', onMouseDown);
  root.addEventListener('mouseup', onMouseUp);
  root.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown, true);
  // 拖拽中鼠标移出视口再松开时 root 收不到 mouseup，用 window 兜底（onMouseUp 对空拖拽幂等）
  window.addEventListener('mouseup', onMouseUp);

  regionFillState = {
    phase: 'select',
    profile,
    root,
    panel: null,
    refs: [],
    skippedHasValue: 0,
    onKeyDown,
    onWindowMouseUp: onMouseUp,
    urlTimer: null,
    lastHref: String(location.href)
  };
  scheduleRegionUrlWatch();
  if (typeof appLog !== 'undefined') appLog.info('content', 'region.enter', '进入选区模式');
}

// 框选完成：收起遮罩（页面恢复交互）→ 收集框内字段 → 弹出条目选择面板
function finishRegionSelect(selRect) {
  const state = regionFillState;
  if (!state) return;
  if (state.root && state.root.parentElement) state.root.parentElement.removeChild(state.root);
  state.root = null;
  state.phase = 'panel';

  const collected = collectRegionFields(selRect);
  state.refs = collected.refs;
  state.skippedHasValue = collected.skippedHasValue;
  if (typeof appLog !== 'undefined') {
    appLog.info('content', 'region.collect', `框选到 ${collected.refs.length} 个可填字段`, {
      skippedHasValue: collected.skippedHasValue,
      skippedNoClue: collected.skippedNoClue,
      rect: { left: selRect.left, top: selRect.top, right: selRect.right, bottom: selRect.bottom }
    });
  }
  if (!collected.refs.length) {
    exitRegionFillMode();
    const suffix = collected.skippedHasValue ? `（${collected.skippedHasValue} 个已有值被跳过）` : '';
    showNotification(`未在框选区域内发现可填字段${suffix}`, 'warning');
    return;
  }
  showRegionEntryPanel();
}

// 弹出「选择填写内容」面板：分类列表（仅有条目的分类）→ 单选条目 → 立即填入
function showRegionEntryPanel() {
  const state = regionFillState;
  if (!state) return;
  if (state.panel && state.panel.parentElement) state.panel.parentElement.removeChild(state.panel);

  const panel = document.createElement('div');
  panel.id = REGION_PANEL_ID;
  panel.setAttribute('data-theme', regionOverlayTheme());
  const categories = regionPanelCategories(state.profile);
  panel.innerHTML = `
    <div class="job-autofill-region-head job-autofill-panel-head" title="按住标题栏可自由拖动位置">
      <span>选择填写内容：</span>
      <button type="button" id="job-autofill-region-close" class="job-autofill-tool-btn" style="height:26px;padding:0 8px;">✕</button>
    </div>
    <div class="job-autofill-region-count">已框选 ${state.refs.length} 个字段</div>
    <div class="job-autofill-region-body">
      ${categories.map((cat) => `
      <div class="job-autofill-region-cat" data-cat="${cat.key}">
        <button type="button" class="job-autofill-region-cat-head">
          <span class="job-autofill-region-cat-arrow">▸</span>
          <span class="job-autofill-region-cat-name">${cat.name}</span>
          <span class="job-autofill-region-cat-count">${cat.items.length}</span>
        </button>
        <div class="job-autofill-region-items" style="display:none;">
          ${cat.items.map((item) => `
          <div class="job-autofill-region-item" data-cat="${cat.key}" data-idx="${item.idx}" title="点击选中这条资料">${escapeHtml(cat.single ? `${cat.name}：${item.summary}` : `${cat.name} ${item.idx + 1}：${item.summary}`)}</div>`).join('')}
        </div>
      </div>`).join('')}
    </div>
    <div class="job-autofill-region-foot">
      <button type="button" id="job-autofill-region-apply" class="job-autofill-region-apply" disabled>立即填入</button>
      <div class="job-autofill-region-panel-hint">手动选择一条资料后，点击立即填入</div>
    </div>
  `;
  document.body.appendChild(panel);
  state.panel = panel;

  const applyBtn = panel.querySelector('#job-autofill-region-apply');
  const setSelection = (catKey, idx) => {
    state.selection = { category: catKey, idx };
    panel.querySelectorAll('.job-autofill-region-item').forEach((itemEl) => {
      const active = itemEl.getAttribute('data-cat') === catKey && Number(itemEl.getAttribute('data-idx')) === idx;
      itemEl.classList.toggle('active', active);
    });
    if (applyBtn) applyBtn.disabled = false;
  };
  panel.querySelectorAll('.job-autofill-region-cat-head').forEach((head) => {
    head.addEventListener('click', () => {
      const items = head.parentElement && head.parentElement.querySelector('.job-autofill-region-items');
      if (!items) return;
      const open = items.style.display !== 'none';
      items.style.display = open ? 'none' : 'block';
      head.classList.toggle('open', !open);
      const arrow = head.querySelector('.job-autofill-region-cat-arrow');
      if (arrow) arrow.textContent = open ? '▸' : '▾';
    });
  });
  panel.querySelectorAll('.job-autofill-region-item').forEach((itemEl) => {
    itemEl.addEventListener('click', () => {
      setSelection(itemEl.getAttribute('data-cat'), Number(itemEl.getAttribute('data-idx')));
    });
  });
  const closeBtn = panel.querySelector('#job-autofill-region-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      exitRegionFillMode(); // 关闭即放弃本次填入
      showNotification('已取消本次选区填入', 'info');
    });
  }
  if (applyBtn) applyBtn.addEventListener('click', () => {
    if (!state.selection) return;
    const { category, idx } = state.selection;
    const entry = regionCategoryEntries(state.profile, category)[idx];
    if (!entry) return;
    const refs = state.refs;
    const skipped = state.skippedHasValue;
    exitRegionFillMode();
    void runRegionFill(refs, skipped, category, entry).catch(error => {
      showNotification(error?.name === 'AbortError' ? '选区填入已取消' : '选区填入未能完成', 'warning');
    });
  });

  initPanelDragging(panel, '.job-autofill-region-head');
}

// 选区填入的系统提示词（硬性规则与 ai.smart_fill 一致，资料来源改为单条选定条目）
function regionFillSystemPrompt() {
  return [
    '你是网申表单的字段匹配助手。用户已在页面上框选一段经历区域，并选定了一条资料条目，任务是判断框内每个字段应填入选定条目中的哪个值。',
    '硬性规则：',
    '1. 只输出严格的 JSON 数组，不要 markdown 代码块、不要任何解释文字，格式：[{"position":字段序号,"value":"要填的值"}]',
    '2. 只能使用【选定条目资料】中出现过的信息；条目里没有对应内容的字段绝不能出现在结果里，禁止虚构、推断或补全',
    '3. options 不为空的字段是下拉框，value 必须从选项原文中原样选择，一个字都不能改',
    '4. 日期类字段按 placeholder/maxLength 暗示的格式输出（如 2024-06 或 2024-06-30），没有提示时用 YYYY-MM',
    '5. value 必须简短、可直接填入输入框，不带单位说明、引号或多余文字',
    '6. widgetSelect: true 的字段是组件下拉框（选项未展开收集），value 必须填选项的常见原文',
    '7. cascadeGroup 相同的多个字段是同一组级联下拉（如 省/市/区）：只对 level=1 的字段返回一项，value 用数组按层级给出各级选项原文，例如 {"position":12,"value":["广东省","潮州市"]}；数组长度等于层级数，不要为 level>1 的字段单独返回',
    '8. 起止时间若拆成两个独立字段（开始/结束），分别填条目的开始与结束时间；单个整段字段填「开始 至 结束」'
  ].join('\n');
}

// 选区填入引擎：第一层 label 规则匹配 → 第二层 AI 匹配（规则未命中的字段）→ 汇总反馈。
// 成功写入的字段加 'job-autofill-ai-filled' 高亮；未配置 AI 时仅走规则层
async function regionFillApply(refs, skippedHasValue, category, entry, settings, options) {
  const task = options?.task || null;
  const signal = options?.signal || task?.controller.signal || null;
  const total = refs.length;
  let filled = 0;
  const fields = regionFieldizeEntry(category, entry);
  const doneRefs = new Set();
  const aiConfigured = !!(settings && settings.aiEnabled && settings.aiApiKey);
  const aiReady = aiConfigured && settings.aiSmartFill !== false; // 与 AI 助填同一开关口径

  // —— 第一层：label 规则匹配 ——
  const ruleHits = [];
  const dateHits = [];
  for (const ref of refs) {
    if (ref.cascadeGroupId) continue; // 级联组只能整组取值（如省/市/区），交给 AI 层
    const hit = regionMatchRuleField(regionRefLabelText(ref), fields);
    if (!hit) continue;
    if (hit.field.key === 'dateRange') { dateHits.push({ ref, field: hit.field, side: hit.side }); continue; }
    if (hit.field.value) ruleHits.push({ ref, value: hit.field.value, fieldLabel: hit.field.label });
  }
  // 起止时间分流：显式 label 语义（入职/离职等）优先，两个 range 语义同行才按 DOM 顺序拆
  const sideOf = regionSplitDateRangeRefs(dateHits);
  for (const hit of dateHits) {
    const side = sideOf.get(hit);
    const value = side === 'start' ? hit.field.startDate : side === 'end' ? hit.field.endDate : hit.field.value;
    if (value) ruleHits.push({ ref: hit.ref, value, fieldLabel: hit.field.label });
  }

  for (const hit of ruleHits) {
    await waitForFillCheckpoint(task);
    try {
      const live = resolveSmartFillField(hit.ref);
      if (!live) { doneRefs.add(hit.ref); continue; } // 节点已消失/已被填，AI 层同样写不进
      const check = validateSmartFillValue(hit.ref, hit.value);
      if (!check.ok) {
        if (typeof appLog !== 'undefined') {
          appLog.info('content', 'region.rule_skip', `规则值未通过校验: ${hit.ref.label}`, { value: String(hit.value).slice(0, 60), reason: check.reason });
        }
        continue; // 如下拉无该选项，交给 AI 层重试
      }
      const written = hit.ref.kind === 'widget-select'
        ? await fillSelectWidget(live, check.value, { task, signal })
        : await fillField(live, check.value, { task, signal });
      if (written) {
        live.classList.add('job-autofill-ai-filled');
        filled++;
        doneRefs.add(hit.ref);
        if (typeof appLog !== 'undefined') appLog.info('content', 'region.rule_fill', `规则匹配写入: ${hit.ref.label} ← ${hit.fieldLabel}`);
      } else if (typeof appLog !== 'undefined') {
        appLog.warn('content', 'region.rule_write_miss', `规则匹配未能写入: ${hit.ref.label}`, { value: String(check.value).slice(0, 80) });
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (typeof appLog !== 'undefined') {
        appLog.warn('content', 'region.rule_error', `选区单字段失败，继续后续字段: ${hit.ref.label}`, error?.message || String(error));
      }
    }
  }

  // —— 第二层：AI 匹配（规则未命中的字段）——
  const remaining = refs.filter((ref) => !doneRefs.has(ref));
  if (remaining.length && aiReady) {
    showAiProgress(`选区填入：AI 匹配 ${remaining.length} 个字段…`);
    try {
      const entryJson = JSON.stringify(entry);
      for (let i = 0; i < remaining.length; i += SMART_FILL_BATCH_SIZE) {
        await waitForFillCheckpoint(task);
        const batch = remaining.slice(i, i + SMART_FILL_BATCH_SIZE);
        const payload = batch.map(smartFillFieldPayload);
        const userPrompt =
          `【选定条目资料】\n${entryJson}\n\n` +
          `【待填字段】\n${JSON.stringify(payload)}\n\n` +
          '请对照选定条目逐个判断：条目中有明确对应值的字段才输出，严格按 [{"position":字段序号,"value":"要填的值"}] 的 JSON 数组返回；条目中没有对应信息的字段不要出现在结果里。';
        let aiRes = null;
        try {
          aiRes = await askAi(userPrompt, regionFillSystemPrompt(), 3000);
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          if (typeof appLog !== 'undefined') appLog.error('content', 'region.ai_error', '选区填入 AI 调用异常', err?.message || String(err));
        }
        throwIfFillCancelled(signal);
        if (!aiRes || !aiRes.success || !aiRes.text) {
          if (typeof appLog !== 'undefined') {
            appLog.warn('content', 'region.ai_miss', '选区填入 AI 未返回结果', { error: aiRes?.error || aiRes?.message || '返回正文为空' });
          }
          continue;
        }
        const items = parseSmartFillAiJson(aiRes.text);
        if (!items) {
          if (typeof appLog !== 'undefined') {
            appLog.warn('content', 'region.ai_parse', '选区填入 AI 返回的不是合法 JSON', { text: String(aiRes.text).slice(0, 200) });
          }
          continue;
        }
        const applied = await applySmartFillAiItems(items, batch, refs, 'region.ai', { task, signal });
        filled += applied.count;
        if (typeof appLog !== 'undefined') {
          appLog.info('content', 'region.ai_fill', `选区 AI 匹配写入 ${applied.count} 项`, { labels: applied.labels });
        }
      }
    } finally {
      hideAiProgress();
    }
  } else if (remaining.length) {
    if (typeof appLog !== 'undefined') {
      if (aiConfigured) appLog.info('content', 'region.ai_off', `未启用 AI 智能匹配（aiSmartFill 开关已关闭），${remaining.length} 个规则未命中字段跳过`);
      else appLog.info('content', 'region.ai_off', `未配置 AI，${remaining.length} 个规则未命中字段跳过 AI 匹配`);
    }
  }

  throwIfFillCancelled(signal);
  const unmatched = total - filled;
  let message = `选区填入完成：${filled}/${total}，跳过已有值 ${skippedHasValue} 个`;
  if (unmatched > 0) {
    const reason = !aiConfigured ? '未配置 AI 或规则未命中' : (aiReady ? '规则未命中' : '未启用 AI 智能匹配或规则未命中');
    message += `；${unmatched} 个字段未能识别（${reason}）`;
  }
  showNotification(message, filled > 0 ? 'success' : 'warning');
  if (typeof appLog !== 'undefined') {
    appLog.success('content', 'region.done', message, { url: location.href, filled, total, skippedHasValue, unmatched });
  }
  return { filled, total, unmatched, skippedHasValue };
}

// 面板「立即填入」入口：加执行锁 → 读取设置 → 执行选区填入引擎 → 异常兜底提示。
// 锁必须在读取设置前置位（等待期间禁止重入与 AI 助填并发），最外层 finally 复位
async function runRegionFill(refs, skippedHasValue, category, entry) {
  if (regionFillRunning) return; // 防重入兜底（面板关闭后理论上不会再触发）
  const task = startActiveFillTask('region', 'full');
  if (!task) {
    showNotification('已有填入任务正在进行，请稍候', 'info');
    return;
  }
  regionFillRunning = true;
  try {
    if (typeof appLog !== 'undefined') appLog.info('content', 'region.fill_start', `开始选区填入：${refs.length} 个字段`, { category });
    let settings = {};
    try {
      const res = await runtimeSend({ action: 'getSettings' }, 8000);
      settings = res?.settings || {};
    } catch { /* 设置读取失败时按未配置 AI 处理 */ }
      try {
        const result = await regionFillApply(refs, skippedHasValue, category, entry, settings, {
          task, signal: task.controller.signal
        });
        if (result && typeof showYanyuTaskResult === 'function') {
          showYanyuTaskResult({
            filledCount: result.filled,
            reviewCount: result.unmatched,
            skippedCount: result.skippedHasValue,
            results: []
          });
        }
        return result;
      } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (typeof appLog !== 'undefined') appLog.error('content', 'region.fill_error', '选区填入执行异常', err?.message || String(err));
      showNotification('选区填入执行异常，请重试', 'error');
    }
  } finally {
    regionFillRunning = false;
    finishActiveFillTask(task);
  }
}

function isRegionFillRunning() {
  return regionFillRunning;
}

// Dock「选区」按钮入口：与 AI 助填双向互斥；切换式——未激活时校验资料并进入框选模式，已激活时退出
async function startRegionFillFlow() {
  if (regionFillRunning) {
    const error = '选区填入正在进行中，请稍候';
    showNotification(error, 'info');
    return { started: false, error };
  }
  if (aiFillRunning) {
    const error = 'AI 助填正在进行中，请稍候';
    showNotification(error, 'info');
    return { started: false, error };
  }
  if (activeFillTask?.running) {
    const error = '已有填入任务正在进行，请稍候';
    showNotification(error, 'info');
    return { started: false, error };
  }
  if (regionFillState) {
    exitRegionFillMode();
    const error = '已退出选区模式';
    showNotification(error, 'info');
    return { started: false, error };
  }
  let profile = currentActiveProfile;
  if (!profile) {
    const response = await runtimeSend({ action: 'getActiveProfile' }, 8000);
    if (response && response.success && response.profile) {
      currentActiveProfile = response.profile;
      profile = response.profile;
    }
  }
  if (!profile) {
    const error = '请先在插件配置资料';
    showNotification(error, 'warning');
    return { started: false, error };
  }
  // 资料读取期间可能已有新任务启动；进入选区前必须复查，避免覆盖运行中的 Dock 控件。
  if (activeFillTask?.running || aiFillRunning || regionFillRunning || regionFillState) {
    const error = '已有填入或选区任务在进行，请稍候';
    showNotification(error, 'info');
    return { started: false, error };
  }
  if (!regionPanelCategories(profile).length) {
    const error = '当前资料没有任何可填条目，请先在插件配置中补充';
    showNotification(error, 'warning');
    return { started: false, error };
  }
  enterRegionSelectMode(profile);
  return { started: true };
}

// 显式保留原实现引用，供 region-yanyu.v2 在独立脚本和 VM 合并加载两种环境复用。
globalThis.__yanyuLegacyRegionFieldize = regionLegacyFieldizeEntry;
globalThis.__yanyuLegacyRegionSummary = regionLegacyEntrySummary;
