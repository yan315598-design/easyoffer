// ============================================================================
// Capybara 网申助手 content script —— detector.js
// 字段识别（证据评分）：FIELD_PATTERNS / FIELD_ALIASES / SECTION_SHORT_ALIASES 规则层 + 证据与置信度输出
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';
function hintKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[*＊]/g, '')
    .replace(/必填项未填写|必填|选填/g, '')
    .replace(/[\s:：\-_/|（）()【】\[\]·]+/g, '')
    .trim();
}

var  FIELD_ALIASES = [
  ['fullName', ['真实姓名', '中文姓名', '姓名', 'fullname', 'yourname']],
  ['phone', ['手机号码', '联系电话', '手机号', '电话号码', '移动电话', '手机', '电话', 'mobilephone', 'phonenumber', 'mobile', 'phone', 'tel']],
  ['email', ['电子邮箱', '邮箱地址', '邮件', '邮箱', 'email', 'e-mail', 'mail']],
  ['gender', ['性别', 'gender', 'sex']],
  ['birthDate', ['出生日期', '出生年月', '出生时间', '生日', 'birthday', 'birthdate', 'dateofbirth']],
  ['idCard', ['身份证号', '身份证', '证件号码', '证件号', 'idcard']],
  ['politicalStatus', ['政治面貌', '党派', '政治']],
  ['ethnicity', ['民族']],
  ['hometown', ['籍贯']],
  ['sourcePlace', ['生源地']],
  ['registeredAddress', ['户口所在地', '户籍所在地', '户籍地', '户籍']],
  ['graduationDate', ['预计毕业时间', '毕业时间', '毕业年月', '毕业年份']],
  ['maritalStatus', ['婚姻状况', '婚姻情况', '婚否', 'maritalstatus']],
  ['currentCity', ['现居住城市', '现居住地', '目前所在地', '现所在地', '现居地']],
  ['emergencyContact', ['紧急联系人姓名', '紧急联络人', '紧急联系人']],
  ['emergencyRelation', ['与本人关系', '紧急联系人关系', '联系人关系']],
  ['emergencyPhone', ['紧急联系人电话', '紧急联系人手机', '紧急联系电话']],
  ['expectedCity', ['期望工作地点', '意向工作地点', '期望城市', '意向城市', '期望工作地']],
  ['expectedPosition', ['期望职位', '期望岗位', '意向岗位', '求职岗位', '目标职位', '应聘职位', '求职意向']],
  ['expectedSalary', ['期望薪资', '期望月薪', '薪资要求', '期望年薪']],
  ['availableDate', ['最快到岗', '到岗时间', '可入职时间']],
  ['referralCode', ['内推码', '推荐码', '推荐人', '伯乐码', '内推人']],
  ['recruitSource', ['了解招聘信息的渠道', '招聘渠道', '信息来源', '获知渠道', '渠道来源']],
  ['yearsOfWork', ['工作经验', '工作年限', '工作年数']],
  ['willingToTravel', ['是否愿意出差', '是否接受出差', '出差意愿', '驻外意愿']],
  ['cet4', ['英语四级', '四级成绩', '四级', 'cet4']],
  ['cet6', ['英语六级', '六级成绩', '六级', 'cet6']],
  ['ielts', ['雅思成绩', '雅思', 'ielts']],
  ['toefl', ['托福成绩', '托福', 'toefl']],
  ['otherLanguages', ['其他外语', '第二外语', '小语种', '外语能力']],
  ['awards', ['获奖经历', '竞赛获奖', '荣誉奖项', '奖项', '荣誉']],
  ['certificates', ['资格证书', '职业证书', '证书名称', '所获证书']],
  ['certificateCode', ['证书编号', '资格证编号']],
  ['certificateIssuer', ['颁发机构', '发证机构']],
  ['certificateDate', ['取得日期', '获证日期', '发证日期']],
  ['certificateExpiryDate', ['有效期至', '证书有效期']],
  ['familyName', ['家庭成员姓名', '家属姓名', '亲属姓名', '成员姓名', '父亲姓名', '母亲姓名', '配偶姓名']],
  ['familyRelation', ['亲属关系', '家庭成员关系', '与家庭成员关系']],
  ['familyEmployer', ['家庭成员工作单位', '亲属工作单位', '家属工作单位']],
  ['familyPosition', ['家庭成员职务', '亲属职务', '家属职务']],
  ['familyPhone', ['家庭成员电话', '亲属联系电话', '家属电话', '亲属电话', '成员电话']],
  ['school', ['最高学历院校', '毕业学校', '毕业院校', '就读院校', '学校名称', '院校名称', 'school', 'university']],
  ['college', ['所属学院', '院系名称', '学院', '院系']],
  ['major', ['所学专业', '专业名称', '专业', 'major']],
  ['degree', ['最高学历', '学历层次', '学历']],
  ['academicDegree', ['学位', 'academicdegree']],
  ['secondMajor', ['第二专业', '辅修专业']],
  ['degreeType', ['培养方式', '学习形式', '学历类型']],
  ['schoolType', ['院校层次', '学校层次', '院校类别', '学校类型']],
  ['gpa', ['平均绩点', 'gpa', '绩点', '平均分']],
  ['rank', ['专业排名', '成绩排名', '班级排名', '排名']],
  ['courses', ['主修课程', '核心课程', '专业课程']],
  ['eduStartDate', ['入学时间', '入学年份', '入学年月', '就读开始']],
  ['eduEndDate', ['毕业时间', '预计毕业', '就读结束']],
  ['company', ['实习单位', '工作单位', '公司名称', '单位名称', '公司', '单位']],
  ['department', ['所属部门', '实习部门', '部门', '业务线']],
  ['position', ['担任职位', '实习岗位', '职位名称', '职务']],
  ['workCity', ['实习地点', '工作地点', '工作城市']],
  ['workStartDate', ['入职时间', '入职年月', '实习开始', '工作开始']],
  ['workEndDate', ['离职时间', '离职年月', '实习结束', '工作结束']],
  ['workDescription', ['实习职责', '工作职责', '工作内容', '工作描述', '主要工作', '岗位职责']],
  ['workAchievements', ['工作成果', '量化成果', '实习产出', '主要业绩', '核心贡献']],
  ['workType', ['工作性质', '实习类型', '雇佣类型']],
  ['projectName', ['项目名称', '项目名']],
  ['projectRole', ['项目中角色', '担任角色', '项目角色']],
  ['projectStartDate', ['项目开始', '项目起始']],
  ['projectEndDate', ['项目结束', '项目截止']],
  ['techStack', ['技术栈', '关键技术', '使用技术', '开发技术', '核心技术', '所用技术']],
  ['projectUrl', ['项目链接', '作品链接', '作品集链接', '在线地址', '演示地址']],
  ['projectResponsibilities', ['项目中职责', '项目职责', '个人职责', '主要职责', '负责内容', '个人分工']],
  ['projectAchievements', ['项目成果', '项目业绩', '主要成果', '项目产出']],
  ['projectDescription', ['项目描述', '项目背景', '项目简介', '项目介绍', '项目内容', '项目概述', '详细信息']],
  ['skills', ['专业技能', '技能特长', '个人技能', '技能']],
  ['introduction', ['自我介绍', '个人简介', '自我评价', '个人评价', '开放问答题', '开放题']],
  ['location', ['居住地址', '通信地址', '联系地址', '所在地', '地址']],
  ['city', ['城市']],
  ['github', ['github']],
  ['linkedin', ['linkedin', '领英']],
  ['resume', ['简历附件', '附件简历', 'resume', '简历']],
  ['paperName', ['论文名称', '文章名、书名', '学术论文', '论文题目']],
  ['paperPublisher', ['期刊/会议或出版社', '期刊名称', '发表期刊', '出版社', '发布渠道', '刊物、出版社', '发表刊物']],
  ['paperDate', ['论文发表时间', '论文发表日期', '发表时间', '发表日期']],
  ['paperAuthorOrder', ['作者顺序', '作者排名']],
  ['paperRole', ['担当角色', '担任角色']],
  ['paperAbstract', ['论文摘要', '内容摘要']],
  ['paperUrl', ['论文链接']],
  ['patentName', ['专利名称', '发明名称', '实用新型名称']],
  ['patentInventor', ['专利人', '发明人', '第一发明人']],
  ['patentDate', ['专利取得日期', '专利获得时间', '专利申请日', '专利授权日']],
  ['patentDescription', ['专利说明', '专利描述']],
  ['patentUrl', ['专利链接']]
];

var  SECTION_SHORT_ALIASES = {
  edu: [
    ['school', ['学校', '院校', '高校', '名称']],
    ['major', ['专业']],
    ['degree', ['学历', '层次']],
    ['academicDegree', ['学位']],
    ['secondMajor', ['第二专业', '辅修专业']],
    ['college', ['学院', '院系']],
    ['eduStartDate', ['开始时间', '开始日期', '起始时间', '入学']],
    ['eduEndDate', ['结束时间', '结束日期', '截止时间', '毕业']]
  ],
  work: [
    ['company', ['公司', '单位', '企业', '名称']],
    ['position', ['职位', '岗位', '职务']],
    ['workDescription', ['内容', '描述', '职责', '介绍']],
    ['workStartDate', ['开始时间', '开始日期', '起始时间']],
    ['workEndDate', ['结束时间', '结束日期', '截止时间']]
  ],
  project: [
    ['projectName', ['名称', '项目']],
    ['projectDescription', ['内容', '描述', '介绍', '简介', '概述', '详细信息']],
    ['projectResponsibilities', ['职责', '负责']],
    ['projectRole', ['角色', '担任']],
    ['projectStartDate', ['开始时间', '开始日期', '起始时间']],
    ['projectEndDate', ['结束时间', '结束日期', '截止时间']]
  ],
  family: [
    ['familyName', ['姓名', '名称']],
    ['familyRelation', ['关系', '与本人关系']],
    ['familyEmployer', ['工作单位', '单位']],
    ['familyPosition', ['职务', '职位']],
    ['familyPhone', ['联系电话', '电话', '手机']]
  ],
  certificate: [
    ['certificates', ['证书名称', '名称']],
    ['certificateCode', ['证书编号', '编号']],
    ['certificateIssuer', ['颁发机构', '发证机构', '机构']],
    ['certificateDate', ['取得日期', '发证日期', '日期']],
    ['certificateExpiryDate', ['有效期至', '有效期']]
  ],
  paper: [
    ['paperName', ['论文名称', '文章名', '书名', '名称']],
    ['paperPublisher', ['期刊', '出版社', '会议', '发表渠道', '刊物']],
    ['paperDate', ['发表时间', '发表日期', '出版时间', '日期', '时间']],
    ['paperAuthorOrder', ['作者顺序', '作者排名']],
    ['paperRole', ['担当角色', '担任角色', '角色']],
    ['paperAbstract', ['摘要', '内容摘要', '论文摘要']],
    ['paperUrl', ['链接', '论文链接', 'url']]
  ],
  patent: [
    ['patentName', ['专利名称', '名称']],
    ['patentInventor', ['专利人', '发明人', '第一发明人']],
    ['patentDate', ['取得日期', '获得时间', '申请日期', '授权日期', '日期', '时间']],
    ['patentDescription', ['说明', '专利说明', '描述']],
    ['patentUrl', ['链接', '专利链接', 'url']]
  ]
};

function scoreAliasHit(hint, key) {
  if (!hint || !key) return 0;
  if (hint === key) return 1000 + key.length;
  if (key.length <= 2) return 0;
  if (hint.startsWith(key) || hint.endsWith(key)) return 600 + key.length * 12;
  if (hint.includes(key)) return 300 + key.length * 12;
  return 0;
}

function matchAliasTable(hint, table, bonus) {
  let best = null;
  let bestScore = 0;
  let normalized = normalizedAliasTables.get(table);
  if (!normalized) {
    normalized = table.map(([type, keys]) => [type, keys.map(hintKey)]);
    normalizedAliasTables.set(table, normalized);
  }
  for (const [type, keys] of normalized) {
    for (const key of keys) {
      const hit = scoreAliasHit(hint, key);
      if (!hit) continue;
      const score = hit + (bonus || 0);
      if (score > bestScore) {
        bestScore = score;
        best = type;
      }
    }
  }
  return bestScore >= 300 ? best : null;
}

var normalizedAliasTables = new WeakMap();

// ============================================================================
// 证据评分：输出 fieldType + confidence + evidence
// 先排除敏感字段，再使用分区和可见标签。标准语义优先于泛用的 name/id。
// 每层命中携带置信度；低置信（< FIELD_WRITE_MIN_CONFIDENCE）不写入。
// ============================================================================

var FIELD_EVIDENCE_CONFIDENCE = {
  mokaLabel: 0.95,    // Moka 站点 label 精确映射
  dateHint: 0.9,      // 起止/开始/结束时间 + section 上下文
  sectionAlias: 0.9,  // 分区短别名（section 上下文 + 别名表）
  extendedExact: 0.95,
  globalAlias: 0.95,  // 全局别名表（精确/前缀/包含分级计分）
  patternExact: 0.9,  // FIELD_PATTERNS 精确正则（label/placeholder/name/id 整段命中）
  patternFuzzy: 0.75, // FIELD_PATTERNS 泛化正则（仅 label 部分命中）
  autocomplete: 0.9,  // autocomplete 标准 token 精确命中
  inputType: 0.9
};
var FIELD_WRITE_MIN_CONFIDENCE = 0.7;

// autocomplete 标准 token → fieldType（HTML 规范词；只认整段 token 精确匹配，禁止模糊扩展）
var AUTOCOMPLETE_TOKEN_MAP = {
  name: 'fullName', 'full-name': 'fullName', 'given-name': 'firstName',
  'family-name': 'lastName', 'additional-name': 'middleName',
  email: 'email', tel: 'phone', 'tel-national': 'phone',
  bday: 'birthDate', sex: 'gender', gender: 'gender',
  organization: 'company', 'organization-title': 'position',
  'street-address': 'street', 'address-line1': 'street',
  'address-level1': 'state', 'address-level2': 'city',
  city: 'city', country: 'country', 'country-name': 'country',
  'postal-code': 'zipCode', url: 'website'
};

// 敏感 autocomplete token：密码/验证码/银行卡类永不识别（比旧版只查 type=password 更严）
var SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  'current-password', 'new-password', 'one-time-code', 'otp', 'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'sms-otp'
]);

// 采集识别证据（来源 + 片段 + 权重），命中时随结果返回供结果面板/日志展示
function collectFieldEvidence(element, features) {
  const evidence = [];
  const push = (source, snippet, weight) => {
    const text = snippet === undefined || snippet === null ? '' : String(snippet).trim();
    if (text) evidence.push({ source, snippet: text.slice(0, 60), weight });
  };
  push('label', features.label, 1.0);
  push('aria-label', element.getAttribute ? element.getAttribute('aria-label') : '', 0.95);
  push('aria-labelledby', element.getAttribute ? element.getAttribute('aria-labelledby') : '', 0.95);
  push('autocomplete', element.getAttribute ? element.getAttribute('autocomplete') : '', 0.9);
  push('FormItem/placeholder', features.placeholder, 0.8);
  push('name/id', `${features.name} ${features.id}`.trim(), 0.7);
  push('section', features.section, 0.8);
  return evidence;
}

/**
 * 证据评分字段识别。
 * @param {Element} element 表单控件
 * @returns {{fieldType: string, confidence: number, via: string, evidence: Array}|null}
 *   via 为命中的规则层；confidence < FIELD_WRITE_MIN_CONFIDENCE 时调用方不应写入
 */
function detectField(element) {
  if (!element) return null;
  const features = getElementFeatures(element);
  if (isIgnoredInput(element, features)) return null;
  if (/^(自我评价|求职目标|游戏经历|编程语言|ai工具使用经历|爱好特长|优势不足)$/.test(features.label)) return null;

  // autocomplete 敏感 token 硬排除（整段 token 精确比对）
  const autocompleteAttr = element.getAttribute ? (element.getAttribute('autocomplete') || '') : '';
  const acTokens = autocompleteAttr.toLowerCase().split(/\s+/).filter(Boolean);
  if (acTokens.some((token) => SENSITIVE_AUTOCOMPLETE_TOKENS.has(token))) return null;

  features.section = nearestSectionKind(element);
  const finish = (fieldType, via) => {
    if (!fieldType) return null;
    return {
      fieldType: fieldType,
      confidence: FIELD_EVIDENCE_CONFIDENCE[via] != null ? FIELD_EVIDENCE_CONFIDENCE[via] : 0.75,
      via: via,
      evidence: collectFieldEvidence(element, features)
    };
  };

  if (isMokaForm() && element.closest('[class*="apply-field-"]')) {
    if (/^(年|月)$/.test(element.placeholder || '')) return null;
    const label = features.label;
    const block = element.closest('[data-nav-id]')?.getAttribute('data-nav-id');
    if (block === 'block-practiceInfo' && label === '工作职责') return finish('workDescription', 'mokaLabel');
    return finish(({
      姓名: 'fullName', 手机号码: element.placeholder === '请输入手机号' ? 'phone' : null,
      邮箱: 'email', 性别: 'gender', '出生日期 (年龄)': 'birthDate',
      最高学历: 'degree', 籍贯: 'hometown', '当前所在城市（市）': 'currentCity',
      推荐码: 'referralCode', 学校名称: 'school', 专业名称: 'major', 学历: 'degree',
      公司名称: 'company', 职位名称: 'position', 项目名称: 'projectName',
      项目描述: 'projectDescription', 项目中职责: 'projectResponsibilities', 作品集链接: 'portfolioLinks'
    })[label] || null, 'mokaLabel');
  }

  const labelHint = String(features.label || '');
  const hint = hintKey(/起止|开始结束/.test(labelHint) && features.placeholder && /开始|结束|start|end/i.test(features.placeholder)
    ? features.placeholder : (features.label || features.placeholder));
  const section = features.section;
  const rawLabel = String(features.label || '').trim();

  // OfferLink 基础信息中的地址是独立语义，不能进入学校名称、家庭成员或通用地址规则。
  const directAddress = {
    '详细地址': 'street',
    '家庭地址': 'extended:basicInfo:homeAddress',
    '家庭现居地址': 'extended:basicInfo:homeAddress',
    '家庭所在地区': 'extended:basicInfo:homeProvince',
    '家庭所在城市': 'extended:basicInfo:homeCity',
    '家庭所在区县': 'extended:basicInfo:homeDistrict',
    '出生地': 'extended:basicInfo:birthPlace',
    '出生地点': 'extended:basicInfo:birthPlace',
    '当前所在地': 'currentCity',
    '现居住地': 'currentCity',
    '学校所在地区': 'extended:education:schoolProvince',
    '学校所在城市': 'extended:education:schoolCity',
    '学校所在区县': 'extended:education:schoolDistrict'
  }[rawLabel];
  if (directAddress) return finish(directAddress, 'extendedExact');

  if (typeof isOfferLinkResumeForm === 'function' && isOfferLinkResumeForm() && !section) {
    const offerLinkField = {
      '工作经验': 'yearsOfWork',
      '了解招聘信息的渠道': 'recruitSource',
      '是否接受岗位调剂': 'extended:jobIntention:acceptAdjustment',
      '是否接受调剂': 'extended:jobIntention:acceptAdjustment',
      '期望月薪': 'extended:jobIntention:expectedMonthlySalary',
      '期望年薪': 'extended:jobIntention:expectedAnnualSalary',
      '当前月薪': 'extended:jobIntention:currentMonthlySalary',
      '当前年薪': 'extended:jobIntention:currentAnnualSalary',
      '期望城市（多选）': 'expectedCity'
    }[rawLabel];
    if (offerLinkField) return finish(offerLinkField, 'extendedExact');
  }

  // 在明确分区内，扩展字段的精确 label 优先于共享日期和本人字段别名。
  const extendedSection = {
    edu: 'education', work: 'workExperience', project: 'projects', family: 'familyMembers',
    certificate: 'certificates', paper: 'papers', patent: 'patents', campus: 'campusPositions', training: 'trainings',
    language: 'languageCertificates', award: 'awards', campusActivity: 'campusActivities'
  }[section];
  if (extendedSection && features.label && typeof EXTENDED_MAPPINGS !== 'undefined') {
    const key = EXTENDED_MAPPINGS[extendedSection]?.[hintKey(features.label) === '起止日期' || hintKey(features.label) === '起止时间'
      ? features.placeholder : rawLabel];
    if (key) return finish(`extended:${extendedSection}:${key}`, 'extendedExact');
  }
  if (/^(证明人|推荐人).*(姓名|电话|手机|邮箱|单位|职位|职务|联系方式)$/.test(rawLabel)) return null;

  if (hint && /起止时间|起止日期|开始结束/.test(hint)) {
    if (section === 'campus' || section === 'campusActivity' || section === 'training') return null;
    if (section === 'work') return finish('workDateRange', 'dateHint');
    if (section === 'project') return finish('projectDateRange', 'dateHint');
    if (section === 'birth') return finish('birthDate', 'dateHint');
    if (section === 'certificate') return finish('certificateDate', 'dateHint');
    if (section === 'edu') return finish('eduDateRange', 'dateHint');
    if (section !== 'family') return finish('eduDateRange', 'dateHint');
  }
  if (hint && /开始时间|开始日期|起始时间|起始日期/.test(hint)) {
    if (section === 'work') return finish('workStartDate', 'dateHint');
    if (section === 'project') return finish('projectStartDate', 'dateHint');
    if (section === 'edu') return finish('eduStartDate', 'dateHint');
    if (section === 'certificate') return finish('certificateDate', 'dateHint');
  }
  if (hint && /结束时间|结束日期|截止时间|截止日期/.test(hint)) {
    if (section === 'work') return finish('workEndDate', 'dateHint');
    if (section === 'project') return finish('projectEndDate', 'dateHint');
    if (section === 'edu') return finish('eduEndDate', 'dateHint');
    if (section === 'certificate') return finish('certificateExpiryDate', 'dateHint');
  }

  const familyHint = hint && /家庭成员|家属|亲属|直系|父亲姓名|母亲姓名|配偶姓名|家人姓名|familymember|relativename/.test(hint);
  if (hint && (section === 'family' || familyHint) && SECTION_SHORT_ALIASES.family) {
    const familyHit = matchAliasTable(hint, SECTION_SHORT_ALIASES.family, 80);
    if (familyHit) return finish(familyHit, 'sectionAlias');
  }

  if (hint && section && SECTION_SHORT_ALIASES[section]) {
    const sectional = matchAliasTable(hint, SECTION_SHORT_ALIASES[section], 80);
    if (sectional) return finish(sectional, 'sectionAlias');
  }

  if (hint) {
    let aliased = matchAliasTable(hint, FIELD_ALIASES, 0);
    if (aliased === 'gpa' && section !== 'edu' && !/gpa|绩点|平均分/i.test(rawLabel)) aliased = null;
    if (aliased) return finish(aliased, 'globalAlias');
  }

  const patterns = Object.entries(FIELD_PATTERNS);
  const isGpaField = section === 'edu' || /gpa|绩点|平均分/i.test(rawLabel);
  const exactMatch = (...texts) => {
    for (const text of texts.filter(Boolean)) {
      for (const [fieldType, [exact]] of patterns) {
        if ((fieldType !== 'gpa' || isGpaField) && exact?.test(text)) return fieldType;
      }
    }
    return null;
  };
  const visibleMatch = exactMatch(features.label, features.placeholder);
  if (visibleMatch) return finish(visibleMatch, 'patternExact');

  // 扩展资料精确 label 在核心精确规则之后、模糊规则之前执行，既保持旧协议，又避免泛匹配误伤。
  if (features.label && typeof EXTENDED_MAPPINGS !== 'undefined') {
    const label = String(features.label).trim();
    for (const [section, mapping] of Object.entries(EXTENDED_MAPPINGS)) {
      const key = mapping[label];
      if (key) return finish(`extended:${section}:${key}`, 'extendedExact');
    }
  }

  // 标准语义优先于复用的 name/id（例如联系方式使用 name="contact"）。
  for (const token of acTokens) {
    const mapped = AUTOCOMPLETE_TOKEN_MAP[token];
    if (mapped) return finish(mapped, 'autocomplete');
  }
  if (element.type === 'email') return finish('email', 'inputType');
  if (element.type === 'tel') return finish('phone', 'inputType');
  const identifierMatch = exactMatch(features.name, features.id);
  if (identifierMatch) return finish(identifierMatch, 'patternExact');

  for (const [fieldType, [, fuzzy]] of patterns) {
    if ((fieldType !== 'gpa' || isGpaField) && features.label && fuzzy?.test(features.label)) return finish(fieldType, 'patternFuzzy');
  }
  return null;
}

// 兼容旧调用：仅返回 fieldType
function matchFieldType(element) {
  const detection = detectField(element);
  return detection ? detection.fieldType : null;
}

function classifySectionTitle(text) {
  const t = String(text || '').replace(/\s+/g, '').slice(0, 24);
  if (!t || t.length > 18) return '';
  if (/家庭成员|家庭情况|家属信息|亲属信息|直系亲属|家庭信息/.test(t)) return 'family';
  if (/英语能力|外语能力|语言能力|语言证书|英语水平/.test(t)) return 'language';
  if (/获奖经历|奖惩情况|荣誉奖项|奖项荣誉|获奖情况/.test(t)) return 'award';
  if (/在校职务|干部任职|学生干部|社团职务|校园职务/.test(t)) return 'campus';
  if (/^(校园活动|校园活动经历|校内实践)$/.test(t)) return 'campusActivity';
  if (/培训经历|培训信息|培训课程|职业培训/.test(t)) return 'training';
  if (/资格证书|职业证书|证书信息|所获证书/.test(t)) return 'certificate';
  if (/教育经历|教育背景|教育信息|学习经历|学历信息/.test(t) || (/教育|学历|院校/.test(t) && !/最高学历/.test(t))) return 'edu';
  if (/项目经历|项目经验|项目信息/.test(t) || (/项目/.test(t) && !/项目名称|项目角色|项目描述|项目职责|项目成果/.test(t))) return 'project';
  if (/工作经历|实习经历|工作经验|任职经历|工作信息|实习信息/.test(t) || /^(实习|工作|任职)$/.test(t)) return 'work';
  if (/出生|生日/.test(t)) return 'birth';
  if (/论文|论著|发表论文|学术论文|论文著作/.test(t)) return 'paper';
  if (/专利|发明专利|实用新型|知识产权/.test(t)) return 'patent';
  return '';
}

function nearestSectionKind(el) {
  if (typeof isOfferLinkResumeForm === 'function' && isOfferLinkResumeForm()) {
    const section = el?.closest?.('.form-section[id]');
    if (section && Object.hasOwn(OFFERLINK_RESUME_SECTIONS, section.id)) {
      return OFFERLINK_RESUME_SECTIONS[section.id][1] || '';
    }
  }
  const explicit = el?.closest?.('[data-profile-section]')?.getAttribute('data-profile-section');
  const explicitKind = {
    education: 'edu', workExperience: 'work', projects: 'project', familyMembers: 'family',
    certificates: 'certificate', languageCertificates: 'language', awards: 'award', campusPositions: 'campus',
    trainings: 'training', campusActivities: 'campusActivity', papers: 'paper', patents: 'patent'
  }[explicit || ''];
  if (explicitKind) return explicitKind;

  let node = el;
  for (let i = 0; i < 8 && node; i++) {
    let prev = node.previousElementSibling;
    while (prev) {
      // 前面的 label/其他输入框只是字段线索，不是分区标题；继续向上寻找真正的模块标题。
      const isFormRow = prev.matches?.('input,textarea,select,label,button') || !!prev.querySelector?.('input,textarea,select,[role="combobox"]');
      const kind = isFormRow ? '' : classifySectionTitle(prev.textContent);
      if (kind) return kind;
      prev = prev.previousElementSibling;
    }
    const selfKind = classifySectionTitle(node.getAttribute && node.getAttribute('data-title'));
    if (selfKind) return selfKind;
    node = node.parentElement;
  }

  const top = el.getBoundingClientRect().top;
  const heads = [...document.querySelectorAll('h2, h3, h4, legend, [class*="section-title"], [class*="group-title"], [class*="module-title"]')];
  let best = '';
  let bestDist = 1e9;
  for (const h of heads) {
    const t = h.getBoundingClientRect().top;
    if (t <= top + 8) {
      const d = top - t;
      if (d < bestDist) {
        bestDist = d;
        best = h.textContent.trim();
      }
    }
  }
  return classifySectionTitle(best);
}
