// ============================================================================
// Capybara 网申助手 content script —— core.js
// 核心工具：时间/事件/原生 setter、可见性与已填判定、label 提取、忽略名单、消息通道等各模块共用底座
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';
// ========================================================================
// 工具函数 - 从 ApplyEase 移植并改进
// ========================================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// 有界等待：先检查一次，再按固定间隔轮询。已知组件可观察其面板，限制 DOM 变更触发的检查频率。
// ============================================================================

/**
 * 有界等待条件成立。
 * @param {() => any} condition 返回真值时立即以该真值 resolve；异常视为未满足继续等待
 * @param {{timeoutMs?: number, pollMs?: number, signal?: AbortSignal, task?: object, observe?: Node}} [options]
 *   timeoutMs 默认 1500；signal.aborted 后立即以 null 结束
 * @returns {Promise<any>} 条件真值；超时或取消返回 null
 */
function waitFor(condition, options) {
  const opts = options || {};
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 1500;
  const pollMs = typeof opts.pollMs === 'number' ? opts.pollMs : 40;
  const signal = opts.signal || null;
  const task = opts.task;
  const started = Date.now();
  const pausedAtStart = task?.pausedMs || 0;
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(null); return; }
    let settled = false;
    let timer = null;
    let observer = null;
    let lastProbeAt = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      if (signal && signal.removeEventListener) signal.removeEventListener('abort', onAbort);
      resolve(value === undefined ? null : value);
    };
    const probe = () => {
      if (settled) return false;
      lastProbeAt = Date.now();
      let hit = null;
      try { hit = condition(); } catch { return false; }
      if (hit) { finish(hit); return true; }
      return false;
    };
    const onAbort = () => finish(null);
    if (signal && signal.addEventListener) signal.addEventListener('abort', onAbort);
    const schedule = () => {
      if (settled) return;
      if (task?.paused) {
        task.pausePromise.then(schedule);
        return;
      }
      if (probe()) return;
      const elapsed = Date.now() - started - ((task?.pausedMs || 0) - pausedAtStart);
      if (elapsed >= timeoutMs) finish(null);
      else timer = setTimeout(schedule, Math.min(pollMs, timeoutMs - elapsed));
    };
    if (opts.observe && typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => {
        if (!task?.paused && Date.now() - lastProbeAt >= 16) probe();
      });
      observer.observe(opts.observe, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['aria-expanded', 'aria-selected', 'class', 'style'] });
    }
    schedule();
  });
}

/**
 * 给异步操作加有界超时：超时返回 { timedOut: true }，不打断操作本身
 * （操作内部应通过传入的 signal 自行退出）。
 */
function withTimeout(promise, timeoutMs, onTimeout, task) {
  return new Promise((resolve) => {
    let settled = false;
    const started = Date.now();
    const initialPausedMs = task?.pausedMs || 0;
    let timer = null;
    const expire = () => {
      if (settled) return;
      if (task?.paused) {
        task.pausePromise.then(expire);
        return;
      }
      const pausedMs = (task?.pausedMs || 0) - initialPausedMs;
      const remaining = timeoutMs - (Date.now() - started - pausedMs);
      if (remaining > 0) {
        timer = setTimeout(expire, remaining);
        return;
      }
      settled = true;
      try { onTimeout && onTimeout(); } catch {}
      resolve({ timedOut: true });
    };
    timer = setTimeout(expire, timeoutMs);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false, value });
    }, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ timedOut: false, error: err });
    });
  });
}

// ============================================================================
// 组件下拉会话与面板归属：防止旧字段的迟到/残留弹层污染后续字段
// - generation 代际：新一次组件下拉写入开始时递增；旧会话的等待条件发现代际落后立即放弃。
// - 面板归属（ownership）：面板首次被某触发控件使用时记录归属；其他控件的会话跳过该面板，
//   同一控件的失败重试/连续写入仍可复用（quick-retry 场景不受影响）。
// - 收尾时尝试关闭残留面板（body 点击）；归属表在每次新的填充任务开始时整体重置。
// ============================================================================

var widgetDropdownGeneration = 0;
var dropdownPanelOwners = new WeakMap(); // panel -> 首个使用它的触发控件

function beginWidgetDropdownSession() {
  widgetDropdownGeneration += 1;
  var generation = widgetDropdownGeneration;
  return { generation: generation, isCurrent: () => widgetDropdownGeneration === generation };
}

// 面板归属登记：owner 为当前触发控件。无主面板登记为该控件所有；
// 已有归属且不是当前控件 → 属于其他字段的弹层，返回 false（跳过）。
// 例外：原归属控件已从 DOM 移除（SPA 重渲染）时允许重新归属。
function claimDropdownPanel(panel, ownerEl) {
  if (!panel) return false;
  const owner = dropdownPanelOwners.get(panel);
  if (owner === undefined) {
    dropdownPanelOwners.set(panel, ownerEl);
    return true;
  }
  if (owner === ownerEl) return true;
  try {
    if (owner && owner.isConnected === false) {
      dropdownPanelOwners.set(panel, ownerEl);
      return true;
    }
  } catch { /* isConnected 不可读时按 foreign 处理 */ }
  return false;
}

// 收尾：尽力关闭残留面板（body 点击）。真实页面面板会随之收起；无法关闭的面板靠归属规则隔离。
function dismissOpenDropdownPanels() {
  try {
    if (document.body) {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      document.body.click();
    }
  } catch { /* 页面收尾失败不影响主流程 */ }
}

function resetDropdownSessions() {
  dropdownPanelOwners = new WeakMap();
}

function dispatchInputEvents(element, value) {
  const valStr = String(value);
  if (element._valueTracker) {
    try { element._valueTracker.setValue(''); } catch {}
  }
  try {
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: valStr,
      inputType: 'insertFromPaste'
    }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function nativeSet(element, proto, value) {
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (element._valueTracker) {
    try { element._valueTracker.setValue(element.value); } catch {}
  }
  if (setter) setter.call(element, String(value));
  else element.value = String(value);
}

function writableBox(el) {
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return el;
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return el;
  if (tag === 'input') return el;
  const inner = el.querySelector && el.querySelector('textarea, [contenteditable="true"], input:not([type="hidden"])');
  return inner || el;
}

function valueWithinFieldLimit(el, value) {
  const text = String(value);
  const maxLength = parseInt(el.getAttribute('maxlength') || '0', 10);
  return maxLength > 0 && text.length > maxLength ? text.slice(0, maxLength) : text;
}

// P0 红线：组件外壳（combobox 等）钻取到的内层 input 只允许安全文本类写入，
// password/file/hidden/checkbox/radio/button 一律拒绝；textarea/select 原生路径不受影响
var  SMART_FILL_INPUT_TYPE_WHITELIST = new Set(['text', 'search', 'tel', 'email', 'url', 'number']);

function isSmartFillWritableInnerInput(input) {
  if (!input || input.tagName !== 'INPUT') return true;
  if (isIgnoredInput(input)) return false; // 密码/验证码/登录框/搜索框（含外层容器漏检的情形）
  const type = (input.getAttribute('type') || '').toLowerCase();
  return !type || SMART_FILL_INPUT_TYPE_WHITELIST.has(type);
}

var  JUNK_LABEL_RE = /^(必填项未填写|必填|选填|请选择|请输入|\+?86|年|月|日|号|\d{1,4})$/;

function cleanLabel(raw) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/[*＊]/g, '').replace(/（必填）|\(必填\)|必填项未填写/g, '').trim();
  if (!text || JUNK_LABEL_RE.test(text)) return '';
  if (text.length > 120) return '';
  return text.toLowerCase();
}

function getClosestLabelText(input) {
  try {
    const phoenix = input.closest('.form-item--phoenix');
    if (phoenix) return cleanLabel(phoenix.querySelector('.form-item__title')?.textContent);
    const mokaField = input.closest('[class*="apply-field-"]');
    if (isMokaForm() && mokaField) {
      return cleanLabel(mokaField.querySelector('[class^="title-"]')?.textContent);
    }
    const tableField = duoyiTableField(input);
    if (tableField) return tableField.label;
    const tecLabel = input.closest('.tec-form-item')?.querySelector('.tec-form-item__label');
    const tecQuestion = cleanLabel(tecLabel?.textContent).replace(/[:：]$/, '').trim();
    if (tecQuestion) return tecQuestion;
    const labelledBy = (input.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '').join(' ');
    const accessibleLabel = cleanLabel(labelledBy) || cleanLabel(input.getAttribute('aria-label'));
    if (accessibleLabel) return accessibleLabel;
    const antItem = input.closest('.ant-form-item');
    if (input.type === 'radio' && input.closest('.ant-radio-group')) {
      const question = cleanLabel(antItem?.querySelector('.ant-form-item-label')?.textContent);
      if (question) return question;
    }
    const label = input.labels?.[0] || input.closest('label') ||
      (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null);
    if (label) {
      const clone = label.cloneNode(true);
      clone.querySelectorAll('input, textarea, select, button').forEach((n) => n.remove());
      const cleaned = cleanLabel(clone.textContent);
      if (cleaned) return cleaned;
    }

    const item = antItem || input.closest('.el-form-item, .semi-form-field, .arco-form-item') ||
      input.closest('[class*="form-item"], [class*="FormItem"], [class*="formItem"], [class*="form-field"], [class*="field-item"], [class*="apply-item"]');
    if (item) {
      const titleEl = item.querySelector('.ant-form-item-label, .el-form-item__label, label, [class*="form-item-label"], [class*="field-label"], [class*="form-label"]');
      const cleaned = cleanLabel(titleEl && titleEl.textContent);
      // An input group can contain a country-code or document-type selector next to the labelled text input.
      const related = titleEl?.querySelector('label[for]') || (titleEl?.matches('label[for]') ? titleEl : null);
      const linked = related?.htmlFor ? document.getElementById(related.htmlFor) : null;
      if (cleaned && !(linked && linked !== input && input.closest('.ant-input-group-addon'))) return cleaned;
      const first = item.firstElementChild;
      const firstText = cleanLabel(first && first.textContent);
      if (firstText && first !== input && !first.contains(input)) return firstText;
    }

    let node = input;
    for (let i = 0; i < 4 && node; i++) {
      const prev = node.previousElementSibling;
      const cleaned = prev && !prev.matches('input, textarea, select, [role="combobox"]') &&
        !prev.querySelector('input, textarea, select, [role="combobox"]') && cleanLabel(prev.textContent);
      if (cleaned) return cleaned;
      node = node.parentElement;
    }

    const aria = cleanLabel(input.getAttribute('aria-label'));
    if (aria) return aria;
    const ph = cleanLabel(input.placeholder);
    if (ph) return ph;
    return '';
  } catch {
    return '';
  }
}

// 获取元素的所有识别特征
function getElementFeatures(element) {
  const name = (element.name || '').toLowerCase();
  const id = (element.id || '').toLowerCase();
  const placeholder = (element.placeholder || '').toLowerCase();
  const label = getClosestLabelText(element);
  const className = (element.className || '').toLowerCase();

  return {
    name,
    id,
    placeholder,
    label,
    className,
    combined: `${name} ${id} ${placeholder} ${label} ${className}`
  };
}

// 字段匹配规则（中英文）
var  FIELD_PATTERNS = {
  // 姓名相关
  fullName: [
    /^(full[-_\s]?name|name|姓名|真实姓名|用户名称)$/i,
    /真实姓名|姓名/i
  ],
  firstName: [
    /^(first[-_\s]?name|given[-_\s]?name|名|firstname)$/i,
    /first|given|名字/i
  ],
  lastName: [
    /^(last[-_\s]?name|surname|family[-_\s]?name|姓|lastname)$/i,
    /last[-_\s]?name|surname|family[-_\s]?name|姓氏/i
  ],
  middleName: [
    /^(middle[-_\s]?name|middlename)$/i,
    /middle.*name/i
  ],

  // 联系方式
  phone: [
    /^(phone|mobile|tel|telephone|联系电话|手机|电话|contact)$/i,
    /phone|mobile|tel|电话|手机/i
  ],
  phoneType: [
    /^(phone[-_\s]?type)$/i,
    /phone.*type/i
  ],
  email: [
    /^(email|e[-_]?mail|邮箱|电子邮箱|mail)$/i,
    /email|mail|邮箱/i
  ],

  // 个人信息
  gender: [
    /^(gender|sex|性别)$/i,
    /gender|sex|性别/i
  ],
  birthDate: [
    /^(birth|birthday|birthdate|dob|出生日期|生日|date.*birth)$/i,
    /birth|生日|出生/i
  ],
  idCard: [
    /^(id[-_]?card|identity|身份证|证件号)$/i,
    /身份证|idcard|identity/i
  ],

  // 塔塔网申对齐扩展字段（具体词先于泛化词：证件类型≠证件号、特长由 specialSkills 优先于 skills 泛匹配）
  englishName: [
    /^(english[-_\s]?name|英文名)$/i,
    /英文名|english[-_\s]?name/i
  ],
  wechat: [
    /^(wechat|weixin|微信号|微信)$/i,
    /微信号|微信|wechat|weixin/i
  ],
  qq: [
    /^(qq|qq号|qq号码)$/i,
    /qq号|qq号码|\bqq\b/i
  ],
  idCardType: [
    /^(id[-_\s]?card[-_\s]?type|certificate[-_\s]?type|证件类型|证件种类)$/i,
    /证件类型|证件种类/i
  ],
  bloodType: [
    /^(blood[-_\s]?type|血型)$/i,
    /血型/i
  ],
  registeredAddressType: [
    /^(registered[-_\s]?address[-_\s]?type|户籍类型|户口性质|户籍类别)$/i,
    /户籍类型|户口性质|户籍类别/i
  ],
  religion: [
    /^(religion|宗教信仰|宗教)$/i,
    /宗教信仰|宗教/i
  ],
  honor: [
    /^(honor|荣誉奖励|荣誉称号)$/i,
    /荣誉奖励|荣誉称号|honor/i
  ],
  specialSkills: [
    /^(special[-_\s]?skills?|特长|特殊技能|个人特长)$/i,
    /特殊技能|个人特长|special[-_\s]?skill/i
  ],
  openToWork: [
    /^(open[-_\s]?to[-_\s]?work|求职状态|在职状态|就业状态)$/i,
    /求职状态|在职状态|就业状态|open[-_\s]?to[-_\s]?work/i
  ],
  permanentResidencePermit: [
    /^(permanent[-_\s]?residence[-_\s]?permit|居住证号|居住证)$/i,
    /居住证号|居住证/i
  ],
  jobSources: [
    /^(job[-_\s]?sources?|招聘信息来源|招聘来源)$/i,
    /招聘信息来源|招聘来源/i
  ],
  foreignCitizenship: [
    /^(foreign[-_\s]?citizenship|是否取得外国国籍|外国国籍|外国居留权)$/i,
    /外国国籍|外国居留权|foreign[-_\s]?citizenship/i
  ],
  relativesEmployed: [
    /^(relatives?[-_\s]*(employed|working)|亲属回避|是否回避)$/i,
    /亲属回避|回避事项/i
  ],
  yearsOfWork: [
    /^(years?[-_\s]*of[-_\s]*work|工作年限|工作年数)$/i,
    /工作年限|工作年数|years?[-_\s]*of[-_\s]*work/i
  ],
  namePinyinFull: [
    /^(name[-_\s]?pinyin[-_\s]?full|姓名全拼|姓名拼音|全拼)$/i,
    /姓名全拼|姓名拼音|name[-_\s]?pinyin[-_\s]?full/i
  ],
  lastNamePinyin: [
    /^(last[-_\s]?name[-_\s]?pinyin|姓氏拼音|姓拼音)$/i,
    /姓氏拼音|姓[\s(（的]*拼音|last[-_\s]?name[-_\s]?pinyin/i
  ],
  firstNamePinyin: [
    /^(first[-_\s]?name[-_\s]?pinyin|名字拼音|名拼音)$/i,
    /名字拼音|名[\s(（的]*拼音|first[-_\s]?name[-_\s]?pinyin/i
  ],
  personalPromise: [
    /^(personal[-_\s]?promise|个人声明|个人承诺|本人承诺)$/i,
    /personal[-_\s]?promise/i
  ],

  // 年龄：无存储字段，按出生日期动态推算（birthDate 缺失不填）
  age: [
    /^(age|年龄|周岁)$/i,
    /年龄|周岁|\bage\b/i
  ],

  // 地址信息（详细拆分）
  street: [
    /^(street|address.*line|addr.*line|street.*addr|街道)$/i,
    /street|街道|address.*1/i
  ],
  city: [
    /^(city|城市)$/i,
    /city|城市/i
  ],
  state: [
    /^(state|province|region|州|省|地区)$/i,
    /state|province|region|州|省/i
  ],
  country: [
    /^(country|nation|国家)$/i,
    /country|国家/i
  ],
  zipCode: [
    /^(zip|postal|postcode|邮编|邮政编码)$/i,
    /zip|postal|邮编/i
  ],
  location: [
    /^(location|address|所在地|居住地)$/i,
    /location|地址|所在地/i
  ],

  // 社交链接
  linkedin: [
    /^(linkedin|linked[-_]?in)$/i,
    /linkedin/i
  ],
  github: [
    /^(github|git[-_]?hub)$/i,
    /github/i
  ],
  website: [
    /^(website|homepage|personal.*site|个人网站)$/i,
    /website|homepage|个人.*网站/i
  ],
  twitter: [
    /^(twitter|x\.com)$/i,
    /twitter/i
  ],

  // 政治面貌与身份背景
  politicalStatus: [
    /^(political|party|政治面貌|党派)$/i,
    /政治面貌|political.*status|党派/i
  ],
  ethnicity: [
    /^(ethnicity|ethnic|nation|民族)$/i,
    /民族|ethnicity/i
  ],
  hometown: [
    /^(hometown|native.*place|籍贯)$/i,
    /籍贯/i
  ],
  graduationDate: [
    /^(graduation|grad.*date|毕业时间|毕业年月|预计毕业)$/i,
    /毕业时间|毕业年月|预计毕业/i
  ],
  maritalStatus: [
    /^(marital|marriage|marital.*status|婚姻状况|婚姻|婚否)$/i,
    /婚姻状况|婚姻情况|marital/i
  ],
  currentCity: [
    /^(current.*city|present.*city|residence.*city|现居住地|现居城市|目前所在地|现所在城市|居住城市)$/i,
    /现居住地|现居城市|目前所在城市|现所在地/i
  ],

  // 紧急联系人
  emergencyContact: [
    /^(emergency.*contact|emergency.*name|紧急联系人|紧急联络人)$/i,
    /紧急联系人|紧急联络人/i
  ],
  emergencyRelation: [
    /^(emergency.*relation|relationship|与本人关系|关系)$/i,
    /紧急.*关系|与本人关系/i
  ],
  emergencyPhone: [
    /^(emergency.*phone|emergency.*tel|紧急联系电话|紧急联系人手机)$/i,
    /紧急.*电话|紧急.*手机/i
  ],

  // 求职意向
  expectedCity: [
    /^(expected.*city|target.*city|期望城市|意向城市|期望工作地|意向工作地点)$/i,
    /期望城市|意向城市|期望工作地点/i
  ],
  expectedPosition: [
    /^(expected.*position|target.*job|期望岗位|意向岗位|求职岗位|目标职位|应聘职位)$/i,
    /期望岗位|意向职位|求职意向|目标岗位|应聘职位/i
  ],
  expectedSalary: [
    /^(expected.*salary|salary|期望薪资|期望月薪|期望年薪|薪资要求)$/i,
    /期望薪资|期望月薪|薪资要求/i
  ],
  availableDate: [
    /^(available.*date|start.*work|到岗时间|入职时间|最快到岗)$/i,
    /到岗时间|最快到岗|入职时间/i
  ],
  referralCode: [
    /^(referral.*code|recommender|内推码|推荐码|推荐人|伯乐码)$/i,
    /内推码|推荐码|推荐人|伯乐码/i
  ],
  recruitSource: [
    /^(recruit.*source|source.*recruit|channel|信息来源|招聘渠道|获取渠道|获知渠道|渠道来源)$/i,
    /招聘渠道|信息来源|获知渠道|渠道来源/i
  ],
  willingToTravel: [
    /^(willing.*travel|travel|出差|驻外|接受出差|愿意出差|能否出差|可出差)$/i,
    /出差|驻外|接受.*异地/i
  ],

  // 语言能力
  cet4: [
    /^(cet[-_\s]?4|四级|英语四级|四级成绩)$/i,
    /四级|cet[-_\s]?4/i
  ],
  cet6: [
    /^(cet[-_\s]?6|六级|英语六级|六级成绩)$/i,
    /六级|cet[-_\s]?6/i
  ],
  ielts: [
    /^(ielts|雅思|雅思成绩)$/i,
    /ielts|雅思/i
  ],
  toefl: [
    /^(toefl|托福|托福成绩)$/i,
    /toefl|托福/i
  ],
  otherLanguages: [
    /^(other.*languages?|第二外语|其他外语|小语种|外语能力)$/i,
    /其他外语|第二外语|小语种|other.*language/i
  ],

  // 荣誉奖项
  awards: [
    /^(awards|honors|荣誉|奖项|获奖经历|竞赛获奖)$/i,
    /荣誉|奖项|获奖经历|竞赛/i
  ],
  certificates: [
    /^(certificates?|licenses?|资格证书|职业证书|证书名称|所获证书)$/i,
    /资格证书|职业证书|所获证书|certificate/i
  ],
  certificateCode: [
    /^(certificate.*(?:code|number|no)|证书编号|资格证编号)$/i,
    /证书.*编号|certificate.*(?:code|number)/i
  ],
  certificateIssuer: [
    /^(certificate.*issuer|issuing.*organization|颁发机构|发证机构)$/i,
    /颁发机构|发证机构|certificate.*issuer/i
  ],
  certificateDate: [
    /^(certificate.*date|issue.*date|取得日期|获证日期|发证日期)$/i,
    /证书.*日期|取得日期|发证日期/i
  ],
  certificateExpiryDate: [
    /^(certificate.*expir|expiry.*date|有效期至|证书有效期)$/i,
    /有效期至|证书.*有效期|certificate.*expir/i
  ],
  familyName: [
    /^(family.*name|member.*name|家庭成员姓名|家属姓名)$/i,
    /家庭成员.*姓名|家属姓名/i
  ],
  familyRelation: [
    /^(family.*relation|member.*relation|亲属关系|家庭成员关系)$/i,
    /亲属关系|家庭成员.*关系/i
  ],
  familyEmployer: [
    /^(family.*employer|member.*company|亲属工作单位|家庭成员工作单位)$/i,
    /亲属.*工作单位|家庭成员.*单位/i
  ],
  familyPosition: [
    /^(family.*position|member.*position|亲属职务|家庭成员职务)$/i,
    /亲属.*职务|家庭成员.*职务/i
  ],
  familyPhone: [
    /^(family.*phone|member.*phone|亲属联系电话|家庭成员电话)$/i,
    /亲属.*电话|家庭成员.*电话/i
  ],

  // 教育信息
  school: [
    /^(school|university|college|edu|学校|院校|毕业院校|毕业学校|最高学历院校)$/i,
    /school|university|college|学校|院校|毕业院校/i
  ],
  college: [
    /^(department|faculty|college.*name|学院|院系|所属学院)$/i,
    /学院|院系/i
  ],
  major: [
    /^(major|专业|所学专业|discipline|专业名称)$/i,
    /major|专业|学科|discipline/i
  ],
  degree: [
    /^(学历|education|edu.*level|最高学历)$/i,
    /学历|education/i
  ],
  degreeType: [
    /^(degree.*type|study.*type|培养方式|学习形式|学历类型|统招)$/i,
    /培养方式|学历类型|全日制/i
  ],
  schoolType: [
    /^(school.*type|college.*type|院校层次|学校类型|院校类别|学校层次)$/i,
    /院校层次|学校类型|院校类别|学校层次/i
  ],
  gpa: [
    /^(gpa|grade|score|绩点|成绩|平均分|平均绩点)$/i,
    /gpa|绩点|成绩/i
  ],
  rank: [
    /^(rank|ranking|排名|成绩排名|专业排名|班级排名)$/i,
    /专业排名|成绩排名|班级排名/i
  ],
  courses: [
    /^(courses|major.*courses|主修课程|核心课程|专业课程)$/i,
    /主修课程|核心课程|专业课/i
  ],
  educationDescription: [
    /^(education.*description|在校经历|在校描述|教育经历描述|在校表现)$/i,
    /在校经历|在校描述|教育经历描述|在校表现/i
  ],
  eduStartDate: [
    /^(edu.*start|入学时间|入学年份|在读开始|就读开始|教育开始)$/i,
    /入学时间|入学年月|在读开始|就读开始/i
  ],
  eduEndDate: [
    /^(edu.*end|毕业时间|预计毕业|在读结束|就读结束|教育结束)$/i,
    /毕业时间|预计毕业|在读结束|就读结束/i
  ],

  // 工作经验
  company: [
    /^(company|employer|org|公司|单位|工作单位|实习单位|公司名称|单位名称)$/i,
    /公司名称|单位名称|实习单位|工作单位/i
  ],
  department: [
    /^(dept|department|部门|所属部门|业务线|事业群)$/i,
    /所属部门|实习部门|业务线|事业群/i
  ],
  position: [
    /^(position|title|job|role|职位|岗位|职务|实习岗位|担任职位|职位名称)$/i,
    /职位名称|担任职位|实习岗位/i
  ],
  workCity: [
    /^(work.*city|job.*location|实习地点|工作城市|工作地点)$/i,
    /工作地点|实习地点|工作城市/i
  ],
  workStartDate: [
    /^(work.*start|job.*start|入职时间|入职年月|实习开始|工作开始)$/i,
    /入职时间|入职年月|实习开始|工作开始/i
  ],
  workEndDate: [
    /^(work.*end|job.*end|离职时间|离职年月|实习结束|工作结束)$/i,
    /离职时间|离职年月|实习结束|工作结束/i
  ],
  workDescription: [
    /^(work.*desc|job.*desc|工作内容|工作职责|实习职责|工作描述|主要工作|岗位职责)$/i,
    /工作内容|工作职责|工作描述|主要工作|岗位职责/i
  ],
  workAchievements: [
    /^(achievements|work.*output|工作成果|量化成果|实习产出|主要业绩|核心贡献)$/i,
    /工作成果|主要业绩|量化成果|核心贡献/i
  ],

  // 项目经验
  projectName: [
    /^(project.*name|proj.*name|项目名称|项目名|项目)$/i,
    /项目名称|项目名|project.*name/i
  ],
  projectRole: [
    /^(project.*role|proj.*role|担任角色|项目角色|项目中角色|项目职位|担任职位)$/i,
    /担任角色|项目角色|项目中角色|项目职位/i
  ],
  projectStartDate: [
    /^(project.*start|proj.*start|项目开始|项目起始|项目起止)$/i,
    /项目.*开始|项目.*起始|项目.*起止/i
  ],
  projectEndDate: [
    /^(project.*end|proj.*end|项目结束|项目截止)$/i,
    /项目.*结束|项目.*截止/i
  ],
  techStack: [
    /^(tech.*stack|technologies|技术栈|关键技术|使用技术|开发技术|核心技术|主要技术|所用技术|技术框架|工具栈)$/i,
    /技术栈|关键技术|开发技术|核心技术|使用技术|所用技术|技术框架/i
  ],
  projectUrl: [
    /^(project.*url|demo.*url|项目链接|作品链接|作品集链接|在线地址|GitHub地址|演示地址)$/i,
    /项目链接|作品集?链接|github.*url|在线地址/i
  ],
  projectResponsibilities: [
    /^(project.*resp|proj.*role|个人职责|项目职责|项目中职责|主要职责|主要工作|所任职责|负责内容|个人分工|承担职责|开发工作|工作职责|难点攻关)$/i,
    /个人职责|项目职责|项目中职责|主要职责|负责内容|个人分工|承担职责|主要工作|所任职责|开发工作|难点攻关/i
  ],
  projectAchievements: [
    /^(project.*achieve|项目成果|竞赛产出|项目业绩|主要成果|项目产出|量化成果|主要成效|达成成果)$/i,
    /项目成果|项目业绩|竞赛产出|量化成果|主要成果|项目产出|主要成效/i
  ],
  projectDescription: [
    /^(project.*desc|proj.*desc|项目描述|项目背景|项目简介|项目介绍|项目内容|项目概述|项目简述)$/i,
    /项目描述|项目背景|项目简介|项目介绍|项目内容|项目概述|项目简述/i
  ],

  // 技能
  skills: [
    /^(skill|技能|专业技能|特长)$/i,
    /skill|技能|特长/i
  ],

  // 自我介绍
  introduction: [
    /^(intro|self.*intro|个人简介|自我介绍|about)$/i,
    /intro|简介|自我介绍|about.*me/i
  ],

  // 简历上传
  resume: [
    /^(resume|cv|简历|附件)$/i,
    /resume|cv|简历|attachment/i
  ]
};

// ========================================================================
// 输入框智能过滤与 HR 沟通框识别 (避免误填全站搜索框/登录框)
// ========================================================================

// 判断输入框是否应被忽略（排除全站搜索框、登录验证码框、密码框等）
function isIgnoredInput(element, features) {
  if (!element) return true;
  if (element.disabled) return !isSelectWidget(element) && !element.closest('.el-date-editor');

  // 1. 悬浮窗或抽屉内部元素排除
  if (element.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel, #job-autofill-region-overlay, #job-autofill-region-panel')) {
    return true;
  }
  if (element.closest('.el-cascader__dropdown, .tec-cascade__popper, .tec-select__popper')) return true;

  const type = (element.type || '').toLowerCase();
  if (type === 'password' || type === 'hidden') return true;
  if (type === 'search' && !element.closest('.ant-select, .el-select, .rc-select, .semi-select, [class*="form-item"], [class*="form-field"]')) return true;

  // 3. 搜索栏与全局检索框（如 BOSS/智联/猎聘/全网导航搜索）
  if (element.closest('form[role="search"], .search-form, .search-box, .search-bar, .search-wrap, .search-panel, .header-search, .navbar-search, .global-search, .search-container, .top-search, .search-input-box')) {
    return true;
  }

  features ||= getElementFeatures(element);
  if (isProtectedQuestion(features.label)) return true;
  if (/^(query|keyword|keywords|kw|search_kw|search_key|search_input|q|searchword|searchinput)$/i.test(features.name) ||
      /^(query|keyword|keywords|kw|search_kw|search_key|search_input|q|searchword|searchinput)$/i.test(features.id)) {
    return true;
  }

  if (/(搜索职位|搜索公司|搜索岗位|搜索工作|搜职位|搜公司|搜人才|搜索全站|关键词搜索|请输入关键词|请输入搜索|站内搜索)/i.test(features.placeholder) ||
      (/^(?:请)?输入(?:职位|公司|岗位)$/.test(features.placeholder) &&
       features.label === features.placeholder && !element.closest('.el-form-item,.ant-form-item,label'))) {
    return true;
  }

  // 4. 登录/注册/手机验证码（防误填登录弹窗）
  if (/(验证码|短信验证码|图形验证码|短信校验码|手机验证码|captcha|smscode|verifycode|vcode|authcode)/i.test(features.combined)) {
    return true;
  }
  if (element.closest('.login-modal, .login-dialog, .login-wrap, .login-box, .login-form, .signin-form, .auth-modal, .passport-login, #login-modal, #loginModal')) {
    return true;
  }

  return false;
}

// 从日期字符串中提取年和月 (支持 2025-09, 2025.09, 2025/09, 2025年9月)
function parseYearMonth(dateStr) {
  if (!dateStr) return { year: '', month: '', padMonth: '', full: '' };
  const clean = String(dateStr).trim();
  const m = clean.match(/(\d{4})[-/.\s年]?(\d{1,2})?/);
  if (m) {
    const year = m[1];
    const month = m[2] ? String(parseInt(m[2], 10)) : '';
    const padMonth = m[2] ? m[2].padStart(2, '0') : '';
    const exact = clean.match(/^\d{4}[-/.年]\s*\d{1,2}[-/.月]\s*(\d{1,2})日?$/);
    return {
      year,
      month,
      padMonth,
      full: exact ? `${year}-${padMonth}-${exact[1].padStart(2, '0')}` : (month ? `${year}-${padMonth}` : year)
    };
  }
  return { year: '', month: '', padMonth: '', full: clean };
}

// 纯函数：按出生日期计算周岁（未过生日减 1；now 可注入便于测试）。
// birthDate 缺失或无法解析返回 ''，结果不合理（负数/超 150 岁）也返回 ''（不填）。
function computeAgeFromBirthDate(birthDate, now) {
  const m = String(birthDate || '').match(/(\d{4})[-/.\s年](\d{1,2})(?:[-/.\s月](\d{1,2}))?/);
  if (!m) return '';
  const today = now instanceof Date ? now : new Date();
  if (Number.isNaN(today.getTime())) return '';
  const birthYear = Number(m[1]);
  const birthMonth = Number(m[2]);
  const birthDay = m[3] ? Number(m[3]) : 1;
  let age = today.getFullYear() - birthYear;
  const beforeBirthday = (today.getMonth() + 1) < birthMonth ||
    ((today.getMonth() + 1) === birthMonth && today.getDate() < birthDay);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 150 ? String(age) : '';
}

function markManual(input, value) {
  input.setAttribute('data-job-autofill-manual', value);
  input.title = `请手动确认：${value}`;
  const root = input.closest('.form-item--phoenix, .ant-form-item, .el-form-item, [class*="apply-field-"], .form-group') || input.parentElement;
  let note = root.querySelector('.job-autofill-manual-hint');
  if (!note) { note = document.createElement('small'); note.className = 'job-autofill-manual-hint'; root.append(note); }
  note.textContent = `请手动确认：${value}`;
  note.style.color = '#a65b00';
}

function clearManualHint(input) {
  if (!input.getAttribute('data-job-autofill-manual')) return;
  input.removeAttribute('data-job-autofill-manual');
  if (input.title?.startsWith('请手动确认：')) input.removeAttribute('title');
  const root = input.closest('.form-item--phoenix, .ant-form-item, .el-form-item, [class*="apply-field-"], .form-group') || input.parentElement;
  root?.querySelector('.job-autofill-manual-hint')?.remove();
}

function exactQuestion(text) {
  return String(text || '').replace(/[\s*＊:：?？。]/g, '').toLowerCase();
}

function questionContainer(input) {
  return input.closest('.form-item--phoenix, .ant-form-item, .tec-form-item, [class*="apply-field-"], fieldset, .form-group') || input.parentElement;
}

// ========================================================================
// AI 逐步智能解析与深度填表引擎 (AI Step-by-Step Deep Filler)
// ========================================================================

var  LONG_FIELD_TYPES = new Set([
  'projectDescription', 'projectResponsibilities', 'projectAchievements',
  'workDescription', 'workAchievements', 'introduction', 'skills', 'awards', 'courses'
]);
var  PROJECT_LONG_FIELD_TYPES = new Set(['projectDescription', 'projectResponsibilities', 'projectAchievements']);
var  WORK_LONG_FIELD_TYPES = new Set(['workDescription', 'workAchievements']);
var  OPEN_LABEL_RE = /描述|职责|成果|总结|评价|动机|原因|介绍|问答|理由|难点|优势|规划|说明|详述|开放|为什么|自我|请|是否|谈谈|列出|分享|经历|看法|如何|什么|哪些|使用/;
var  SHORT_LABEL_RE = /姓名|名字|手机|电话|邮箱|性别|民族|政治面貌|籍贯|生源地|户籍|身份证|证件|出生|生日|学校|学院|专业|学历|学位|绩点|排名|年级|入学|毕业|起止|时间|日期|城市|薪资|岗位|到岗|推荐码|内推码|公司名称|职位名称|项目名称|链接|网址|url|年|月|日/i;
var  AI_FIELD_SELECTOR = 'textarea, input[type="text"], input:not([type]), div[contenteditable="true"]';
var  aiFillRunning = false;

function isElementTrulyVisible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return true;
  return el.getClientRects && el.getClientRects().length > 0;
}

function fieldHasValue(el) {
  if (el.type === 'radio') return radioGroup(el).some(radio => radio.checked);
  if (el.type === 'checkbox') return !!questionContainer(el).querySelector('input:checked, [aria-checked="true"], .phoenix-radio--checked, .ant-radio-wrapper-checked');
  if (el.matches('.tec-select__input, .tec-cascade__input')) return !!tecSelectedLabel(el);
  const phoenix = el.closest('.phoenix-select');
  if (phoenix) return !!phoenix.querySelector('.phoenix-select__tipEle')?.textContent.trim();
  if (el.isContentEditable) return !!(el.textContent || '').trim();
  const mokaSelect = el.closest('[class*="sd-Select-container-"]');
  if (mokaSelect) return !!mokaSelect.querySelector('[class*="sd-Input-display-value-"]')?.textContent.trim();
  if (el.tagName === 'SELECT') {
    const option = el.options[el.selectedIndex];
    return !!option && !!el.value && !/^(请选择.*|请选择|please\s+select.*|select(?:\s.*)?|年|月|日|[-—]+)$/i.test(option.text.trim());
  }
  if (el.closest('.el-select, .ant-select, .rc-select')) return !!widgetSelectCurrentValue(el);
  return Boolean((el.value || '').trim());
}

function runtimeSend(payload, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: 'timeout' });
    }, timeoutMs || 15000);
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { success: false });
      });
    } catch (err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    }
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
