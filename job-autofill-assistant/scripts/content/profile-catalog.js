// Shared résumé labels, experience formatting and quick-reference catalog.
// Loaded by both the content scripts and the browser sidebar.
'use strict';

var  FIELD_LABELS = {
  fullName: '姓名', firstName: '名', lastName: '姓', middleName: '中间名',
  phone: '手机号码', phoneType: '手机类型', email: '电子邮箱', gender: '性别', birthDate: '出生日期', idCard: '身份证号',
  politicalStatus: '政治面貌', ethnicity: '民族', hometown: '籍贯', graduationDate: '毕业时间', maritalStatus: '婚姻状况', currentCity: '现居住城市',
  emergencyContact: '紧急联系人', emergencyRelation: '联系人关系', emergencyPhone: '联系人电话',
  expectedCity: '期望城市', expectedPosition: '期望岗位', expectedSalary: '期望薪资', availableDate: '到岗时间', referralCode: '内推码', recruitSource: '招聘渠道', willingToTravel: '是否可出差',
  cet4: '英语四级', cet6: '英语六级', ielts: '雅思成绩', toefl: '托福成绩', otherLanguages: '其他外语', awards: '荣誉奖项', certificates: '资格证书', certificateCode: '证书编号', certificateIssuer: '颁发机构', certificateDate: '取得日期', certificateExpiryDate: '有效期至',
  familyName: '家庭成员姓名', familyRelation: '亲属关系', familyEmployer: '家庭成员工作单位', familyPosition: '家庭成员职务', familyPhone: '家庭成员电话',
  school: '毕业院校', college: '所属学院', major: '专业名称', degree: '学历', degreeType: '培养方式', schoolType: '院校层次', gpa: 'GPA绩点', rank: '成绩排名', courses: '主修课程', eduStartDate: '入学时间', eduEndDate: '毕业时间',
  company: '公司名称', position: '担任职位', department: '所属部门', workCity: '工作城市', workStartDate: '入职时间', workEndDate: '离职时间', workDescription: '工作内容', workAchievements: '工作成果',
  projectName: '项目名称', projectRole: '项目角色', projectStartDate: '项目开始', projectEndDate: '项目结束', projectResponsibilities: '项目中职责', projectAchievements: '项目成果', techStack: '技术栈', projectDescription: '项目描述', projectUrl: '项目链接',
  skills: '专业技能', advantage: '个人优势', intro: '自我介绍',
  paperName: '论文名称', paperPublisher: '期刊/出版社', paperDate: '发表时间', paperAbstract: '论文摘要', paperUrl: '论文链接',
  patentName: '专利名称', patentInventor: '专利人/发明人', patentDate: '取得日期', patentDescription: '专利说明', patentUrl: '专利链接',
  address: '完整地址', street: '街道地址', city: '城市', state: '省份', country: '国家', zipCode: '邮编',
  linkedin: '领英链接', github: 'GitHub', website: '个人主页', twitter: 'Twitter/X', resume: '简历附件'
};

// 智能拆解项目内容（将大段混合的 description 自动分解为背景概述、工作职责、成果产出、技术栈）
function smartExtractProjectParts(project) {
  if (!project) return {};

  const rawDesc = String(project.description || '').trim();
  const rawResp = String(project.responsibilities || '').trim();
  const rawAchieve = String(project.achievements || '').trim();
  const rawTech = String(project.techStack || '').trim();
  const role = String(project.role || '').trim();

  // 如果各字段本来就是结构化填好的，直接使用
  if (rawResp && (rawDesc || rawAchieve || rawTech)) {
    return {
      description: rawDesc || rawResp,
      responsibilities: rawResp,
      achievements: rawAchieve,
      techStack: rawTech,
      role
    };
  }

  const fullText = [rawDesc, rawResp, rawAchieve].filter(Boolean).join('\n');
  if (!fullText) {
    return { description: '', responsibilities: '', achievements: '', techStack: rawTech, role };
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const descLines = [];
  const respLines = [];
  const achieveLines = [];
  const techLines = [];

  let currentSection = 'desc';

  for (const line of lines) {
    if (/^(项目描述|项目背景|项目简介|项目介绍|项目概述|背景|介绍)[：:]/i.test(line)) {
      currentSection = 'desc';
      const content = line.replace(/^(项目描述|项目背景|项目简介|项目介绍|项目概述|背景|介绍)[：:]/i, '').trim();
      if (content) descLines.push(content);
    } else if (/^(项目职责|项目中职责|个人职责|主要职责|职责|工作内容|负责内容|项目内容|主要工作|个人分工|担任角色)[：:]/i.test(line)) {
      currentSection = 'resp';
      const content = line.replace(/^(项目职责|项目中职责|个人职责|主要职责|职责|工作内容|负责内容|项目内容|主要工作|个人分工|担任角色)[：:]/i, '').trim();
      if (content) respLines.push(content);
    } else if (/^(项目成果|主要成果|项目业绩|量化成果|主要成效|成果|业绩)[：:]/i.test(line)) {
      currentSection = 'achieve';
      const content = line.replace(/^(项目成果|主要成果|项目业绩|量化成果|主要成效|成果|业绩)[：:]/i, '').trim();
      if (content) achieveLines.push(content);
    } else if (/^(技术栈|关键技术|使用技术|核心技术|开发技术|技术)[：:]/i.test(line)) {
      currentSection = 'tech';
      const content = line.replace(/^(技术栈|关键技术|使用技术|核心技术|开发技术|技术)[：:]/i, '').trim();
      if (content) techLines.push(content);
    } else if (/^[●•\-*]\s*(职责|负责|构建|设计|微调|开发|实现|重构|编写|主导|优化|搭建|处理|训练|部署|集成)/i.test(line) ||
               /^(负责|主导|构建|设计|微调|开发|实现|编写|搭建|训练)/i.test(line)) {
      respLines.push(line);
    } else if (/[0-9]+%|降低[0-9]+|提升[0-9]+|并发|延迟|准确率|QPS|TPS|节省|产出|上线/i.test(line) && currentSection === 'achieve') {
      achieveLines.push(line);
    } else {
      if (currentSection === 'resp') respLines.push(line);
      else if (currentSection === 'achieve') achieveLines.push(line);
      else if (currentSection === 'tech') techLines.push(line);
      else descLines.push(line);
    }
  }

  const finalDesc = descLines.filter(Boolean).join('\n').trim() || (respLines.length ? descLines.join('\n').trim() : fullText);
  const finalResp = rawResp || respLines.filter(Boolean).join('\n').trim();
  const finalAchieve = rawAchieve || achieveLines.filter(Boolean).join('\n').trim();
  const finalTech = rawTech || techLines.filter(Boolean).join(', ').trim();

  return {
    description: finalDesc || fullText,
    responsibilities: finalResp,
    achievements: finalAchieve,
    techStack: finalTech,
    role
  };
}

// 智能拆解工作经历
function smartExtractWorkParts(work) {
  if (!work) return {};
  const rawDesc = String(work.description || '').trim();
  const rawAchieve = String(work.achievements || '').trim();
  if (rawAchieve && rawDesc) return { description: rawDesc, achievements: rawAchieve };

  const lines = rawDesc.split('\n').map(l => l.trim()).filter(Boolean);
  const descLines = [];
  const achieveLines = [];
  let currentSection = 'desc';

  for (const line of lines) {
    if (/^(工作成果|主要成果|工作业绩|量化成果|主要成效|成果|业绩)[：:]/i.test(line)) {
      currentSection = 'achieve';
      const c = line.replace(/^(工作成果|主要成果|工作业绩|量化成果|主要成效|成果|业绩)[：:]/i, '').trim();
      if (c) achieveLines.push(c);
    } else if (/^(工作职责|岗位职责|工作内容|负责内容|主要职责|职责)[：:]/i.test(line)) {
      currentSection = 'desc';
      const c = line.replace(/^(工作职责|岗位职责|工作内容|负责内容|主要职责|职责)[：:]/i, '').trim();
      if (c) descLines.push(c);
    } else if (/[0-9]+%|降低[0-9]+|提升[0-9]+|节省|产出|上线|获奖/i.test(line) && currentSection === 'achieve') {
      achieveLines.push(line);
    } else {
      if (currentSection === 'achieve') achieveLines.push(line);
      else descLines.push(line);
    }
  }

  return {
    description: descLines.filter(Boolean).join('\n').trim() || rawDesc,
    achievements: rawAchieve || achieveLines.filter(Boolean).join('\n').trim()
  };
}

function joinDateRange(start, end) {
  const a = String(start || '').trim();
  const b = String(end || '').trim();
  if (a && b) return `${a} ~ ${b}`;
  return a || b;
}

function pushCopyRow(items, label, val) {
  const text = val == null ? '' : String(val).trim();
  if (text && text !== '~') items.push({ label, val: text });
}

function formatWorkBlock(work, idx) {
  const smart = smartExtractWorkParts(work);
  const lines = [
    `【实习/工作 ${idx + 1}】${work.company || ''}`,
    work.position ? `职位：${work.position}` : '',
    work.department ? `部门：${work.department}` : '',
    work.city ? `城市：${work.city}` : '',
    work.workType ? `性质：${work.workType}` : '',
    joinDateRange(work.startDate, work.endDate) ? `时间：${joinDateRange(work.startDate, work.endDate)}` : '',
    smart.description ? `职责：\n${smart.description}` : '',
    smart.achievements ? `成果：\n${smart.achievements}` : ''
  ];
  return lines.filter(Boolean).join('\n');
}

function formatProjectBlock(proj, idx) {
  const smart = smartExtractProjectParts(proj);
  const lines = [
    `【项目 ${idx + 1}】${proj.name || ''}`,
    smart.role || proj.role ? `角色：${smart.role || proj.role}` : '',
    joinDateRange(proj.startDate, proj.endDate) ? `时间：${joinDateRange(proj.startDate, proj.endDate)}` : '',
    smart.techStack || proj.techStack ? `技术栈：${smart.techStack || proj.techStack}` : '',
    proj.projectUrl ? `链接：${proj.projectUrl}` : '',
    smart.description ? `描述：\n${smart.description}` : '',
    smart.responsibilities ? `职责：\n${smart.responsibilities}` : '',
    smart.achievements ? `成果：\n${smart.achievements}` : ''
  ];
  return lines.filter(Boolean).join('\n');
}

function normalizeExperienceNarrative(parts) {
  return [...new Set(parts
    .map((part) => String(part || '').trim())
    .filter(Boolean))]
    .join('\n')
    .toLowerCase()
    .replace(/^(项目描述|项目背景|项目简介|项目职责|个人职责|工作职责|岗位职责|工作内容|负责内容|项目成果|工作成果|主要成果|成果|业绩)[：:]/gm, '')
    .replace(/[\s，。；：、,.!！?？;:（）()【】\[\]「」“”'"\-_/|]+/g, '');
}

function hasSameExperienceNarrative(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= 40 && longer.includes(shorter) && shorter.length / longer.length >= 0.8;
}

function resolveFieldLabel(section, key) {
  const schema = (typeof profileSchema !== 'undefined' ? profileSchema : {});
  if (schema && schema[section] && schema[section][key]) return schema[section][key];
  if (typeof FIELD_LABELS !== 'undefined' && FIELD_LABELS[key]) return FIELD_LABELS[key];
  if (schema) {
    for (const sec of Object.keys(schema)) {
      if (schema[sec] && schema[sec][key]) return schema[sec][key];
    }
  }
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
}

function appendUndiscoveredFields(items, sourceObj, knownKeys, section, prefix = '') {
  if (!sourceObj || typeof sourceObj !== 'object') return;
  const ignored = new Set([
    'id', 'createdAt', 'updatedAt', 'attachments', 'attachmentContents', 'dataUrl',
    'resumeFile', 'resumeFileName',
    ...(knownKeys || [])
  ]);
  for (const [key, val] of Object.entries(sourceObj)) {
    if (ignored.has(key)) continue;
    if (val == null || val === '' || val === '~') continue;
    if (typeof val === 'object' && !Array.isArray(val)) continue;
    const label = `${prefix}${resolveFieldLabel(section, key)}`;
    const text = Array.isArray(val) ? val.join('、') : String(val).trim();
    if (text) pushCopyRow(items, label, text);
  }
}

function quickReferenceCatalog(profile) {
  if (!profile) return {};
  const categories = {
    basic: { familyMembers: '家庭成员' },
    edu: { education: '教育经历', languageCertificates: '语言能力', awards: '荣誉奖项', certificates: '资格证书', papers: '论文', patents: '专利' },
    exp: { workExperience: '实习与工作', projects: '项目经历', campusPositions: '在校职务', campusActivities: '校园活动', trainings: '培训经历', skills: 'IT 技能', openSource: '开源作品' },
    qa: {}
  };
  const flat = { ...profile };
  for (const section of Object.values(categories).flatMap(Object.keys)) delete flat[section];
  return Object.fromEntries(Object.entries(categories).map(([category, sections]) => {
    const groups = [{
      title: { basic: '基本信息与求职意向', edu: '外语成绩', exp: '补充资料', qa: '问答与自述' }[category],
      items: getCopyItemsForCategory(flat, category)
    }].filter(group => group.items.length);
    for (const [section, heading] of Object.entries(sections)) {
      const entries = section === 'skills' ? profileSkillEntries(profile) : section === 'languageCertificates'
        ? profileLanguageEntries(profile) : profile[section] || [];
      if (!Array.isArray(entries)) continue;
      entries.forEach((source, index) => {
        const entry = typeof source === 'string' ? { name: source } : source;
        const items = Object.entries(entry || {}).filter(([key, val]) =>
          !['id', 'createdAt', 'updatedAt'].includes(key) && ['string', 'number'].includes(typeof val) && String(val).trim() && val !== '~')
          .map(([key, val]) => {
            const label = (section === 'skills' ? { name: '技能名称', category: '技能类别', proficiency: '熟练程度', description: '补充说明' }[key] : '') ||
              resolveFieldLabel(section, key);
            return { key, label, val: String(val), block: String(val).length > 100 || String(val).includes('\n') };
          });
        if (!items.length) return;
        groups.push({ section, entry, items, heading,
          title: entry.school || entry.company || entry.name || entry.title || entry.language || entry.organization || `第 ${index + 1} 条` });
      });
    }
    return [category, groups];
  }));
}

function getCopyItemsForCategory(profile, category) {
  if (!profile) return [];
  const items = [];
  const b = profile.basicInfo || {};
  const ji = profile.jobIntention || {};
  const ls = profileLanguageScores(profile);
  const edus = profile.education || [];
  const works = profile.workExperience || [];
  const projs = profile.projects || [];
  const awards = profile.awards || [];
  const certs = profile.certificates || [];
  const family = profile.familyMembers || [];
  const papers = profile.papers || [];
  const patents = profile.patents || [];
  const openSource = profile.openSource || [];
  const commonAnswers = profile.commonAnswers || {};
  const customAnswers = profile.customAnswers || [];
  const declarations = profile.declarations || [];

  if (category === 'basic' || category === 'all') {
    pushCopyRow(items, '姓名', b.fullName);
    pushCopyRow(items, '姓氏', b.lastName);
    pushCopyRow(items, '名字', b.firstName);
    pushCopyRow(items, '手机号', b.phone);
    pushCopyRow(items, '电子邮箱', b.email);
    pushCopyRow(items, '身份证号', b.idCard);
    pushCopyRow(items, '性别', b.gender);
    pushCopyRow(items, '出生日期', b.birthDate);
    pushCopyRow(items, '政治面貌', b.politicalStatus);
    pushCopyRow(items, '入党时间', b.partyJoinDate);
    pushCopyRow(items, '入团时间', b.leagueJoinDate);
    pushCopyRow(items, '民族', b.ethnicity);
    pushCopyRow(items, '国籍', b.nationality);
    pushCopyRow(items, '籍贯', b.hometown);
    pushCopyRow(items, '生源地', b.sourcePlace);
    pushCopyRow(items, '户籍所在地', b.registeredAddress);
    pushCopyRow(items, '现居住城市', b.currentCity || b.location || b.city);
    pushCopyRow(items, '婚姻状况', b.maritalStatus);
    pushCopyRow(items, '毕业时间', b.graduationDate);

    pushCopyRow(items, '身高 (cm)', b.height);
    pushCopyRow(items, '体重 (kg)', b.weight);
    pushCopyRow(items, '健康状况', b.health);

    // 塔塔网申对齐扩展字段（有值才显示，与上方各行动一致）
    pushCopyRow(items, '英文名', b.englishName);
    pushCopyRow(items, '姓拼音', b.lastNamePinyin);
    pushCopyRow(items, '名拼音', b.firstNamePinyin);
    pushCopyRow(items, '姓名全拼', b.namePinyinFull);
    pushCopyRow(items, '微信号', b.wechat);
    pushCopyRow(items, 'QQ号', b.qq);
    pushCopyRow(items, '证件类型', b.idCardType);
    pushCopyRow(items, '血型', b.bloodType);
    pushCopyRow(items, '户籍类型', b.registeredAddressType);
    pushCopyRow(items, '宗教信仰', b.religion);
    pushCopyRow(items, '荣誉奖励', b.honor);
    pushCopyRow(items, '特长', b.specialSkills);
    pushCopyRow(items, '求职状态', b.openToWork);
    pushCopyRow(items, '工作年限', b.yearsOfWork);
    pushCopyRow(items, '居住证号', b.permanentResidencePermit);
    pushCopyRow(items, '招聘信息来源', b.jobSources);
    pushCopyRow(items, '是否取得外国国籍', b.foreignCitizenship);
    pushCopyRow(items, '亲属在目标单位任职', b.relativesEmployed);
    pushCopyRow(items, '个人声明/承诺', b.personalPromise);

    pushCopyRow(items, '完整住址', b.address);
    pushCopyRow(items, '省/州', b.state);
    pushCopyRow(items, '城市', b.city);
    pushCopyRow(items, '街道地址', b.street);
    pushCopyRow(items, '邮政编码', b.zipCode);

    pushCopyRow(items, '期望城市', ji.expectedCity);
    pushCopyRow(items, '期望岗位', ji.expectedPosition);
    pushCopyRow(items, '期望行业', ji.expectedIndustry);
    pushCopyRow(items, '期望薪资', ji.expectedSalary);
    pushCopyRow(items, '当前薪资', ji.currentSalary);
    pushCopyRow(items, '薪资币种', ji.salaryCurrency);
    pushCopyRow(items, '薪资金额单位', ji.salaryUnit);
    pushCopyRow(items, '薪资结算周期', ji.salaryPeriod);
    pushCopyRow(items, '到岗时间', ji.availableDate);
    pushCopyRow(items, '内推码', ji.referralCode);
    pushCopyRow(items, '招聘渠道', ji.recruitSource);
    pushCopyRow(items, '出差意愿', ji.willingToTravel);
    pushCopyRow(items, '服从调剂', ji.acceptAdjustment);
    pushCopyRow(items, '接受县级工作', ji.acceptCounty);

    if (b.emergencyContact || b.emergencyPhone) {
      pushCopyRow(items, '紧急联系人 · 姓名', b.emergencyContact);
      pushCopyRow(items, '紧急联系人 · 电话', b.emergencyPhone);
      pushCopyRow(items, '紧急联系人 · 关系', b.emergencyRelation);
      const fullContact = `${b.emergencyContact || ''} ${b.emergencyRelation ? '(' + b.emergencyRelation + ')' : ''} ${b.emergencyPhone || ''}`.trim();
      if (fullContact) items.push({ label: '紧急联系人 · 完整信息', val: fullContact });
    }

    family.forEach((member, i) => {
      if (!member || !(member.name || member.relation)) return;
      const prefix = `家属${i + 1} · `;
      pushCopyRow(items, `${prefix}姓名`, member.name);
      pushCopyRow(items, `${prefix}关系`, member.relation);
      pushCopyRow(items, `${prefix}工作单位`, member.employer);
      pushCopyRow(items, `${prefix}职务`, member.position);
      pushCopyRow(items, `${prefix}电话`, member.phone);
      pushCopyRow(items, `${prefix}出生日期`, member.birthDate);
      pushCopyRow(items, `${prefix}年龄`, member.age);
      pushCopyRow(items, `${prefix}职业`, member.occupation);
    });

    // 动态自动探测：捕获 basicInfo 与 jobIntention 中后续新增的未知字段
    const knownBasicKeys = ['fullName', 'firstName', 'lastName', 'middleName', 'phone', 'phoneType', 'email', 'idCard', 'gender', 'birthDate', 'politicalStatus', 'partyJoinDate', 'leagueJoinDate', 'ethnicity', 'nationality', 'hometown', 'sourcePlace', 'registeredAddress', 'currentCity', 'location', 'city', 'maritalStatus', 'graduationDate', 'height', 'weight', 'health', 'address', 'state', 'street', 'zipCode', 'country', 'emergencyContact', 'emergencyPhone', 'emergencyRelation', 'github', 'website', 'linkedin', 'twitter', 'englishName', 'wechat', 'qq', 'idCardType', 'bloodType', 'registeredAddressType', 'religion', 'honor', 'specialSkills', 'openToWork', 'permanentResidencePermit', 'jobSources', 'foreignCitizenship', 'relativesEmployed', 'yearsOfWork', 'lastNamePinyin', 'firstNamePinyin', 'namePinyinFull', 'personalPromise'];
    const knownIntentionKeys = ['expectedCity', 'expectedPosition', 'expectedSalary', 'salaryCurrency', 'salaryUnit', 'salaryPeriod', 'availableDate', 'referralCode', 'recruitSource', 'willingToTravel', 'acceptAdjustment', 'acceptCounty'];
    appendUndiscoveredFields(items, b, knownBasicKeys, 'basicInfo');
    appendUndiscoveredFields(items, ji, knownIntentionKeys, 'jobIntention');
  }

  if (category === 'edu' || category === 'all') {
    edus.forEach((edu, i) => {
      if (!edu || !(edu.school || edu.major)) return;
      const prefix = (edus.length > 1) ? `教育${i + 1} · ` : '';
      pushCopyRow(items, `${prefix}院校`, edu.school);
      pushCopyRow(items, `${prefix}学院`, edu.college);
      pushCopyRow(items, `${prefix}专业`, edu.major);
      pushCopyRow(items, `${prefix}第二专业`, edu.secondMajor);
      pushCopyRow(items, `${prefix}学历`, edu.degree);
      pushCopyRow(items, `${prefix}学位`, edu.academicDegree);
      pushCopyRow(items, `${prefix}培养方式`, edu.degreeType);
      pushCopyRow(items, `${prefix}院校层次`, edu.schoolType);
      pushCopyRow(items, `${prefix}学校城市`, edu.schoolCity);
      pushCopyRow(items, `${prefix}起止`, joinDateRange(edu.startDate, edu.endDate));
      pushCopyRow(items, `${prefix}GPA`, edu.gpa);
      pushCopyRow(items, `${prefix}排名`, edu.rank);
      pushCopyRow(items, `${prefix}导师姓名`, edu.advisor);
      pushCopyRow(items, `${prefix}实验室`, edu.laboratory);
      pushCopyRow(items, `${prefix}研究方向`, edu.researchArea);
      pushCopyRow(items, `${prefix}全日制`, edu.fullTime);
      pushCopyRow(items, `${prefix}最高全日制`, edu.highestFullTime);
      pushCopyRow(items, `${prefix}主修课程`, edu.courses);
      if (edu.description) items.push({ label: `${prefix}在校经历/补充`, val: edu.description, block: true });
    });

    pushCopyRow(items, '英语四级', ls.cet4);
    pushCopyRow(items, '英语六级', ls.cet6);
    pushCopyRow(items, '雅思成绩', ls.ielts);
    pushCopyRow(items, '托福成绩', ls.toefl);
    pushCopyRow(items, '其他外语', ls.otherLanguages);

    awards.forEach((award, i) => {
      if (!award || !award.name) return;
      const prefix = awards.length > 1 ? `奖项${i + 1} · ` : '奖项 · ';
      const summary = `${award.date || ''} ${award.name} ${award.level || ''}`.trim();
      if (summary) items.push({ label: `${prefix}完整信息`, val: summary });
      pushCopyRow(items, `${prefix}名称`, award.name);
      pushCopyRow(items, `${prefix}级别`, award.level);
      pushCopyRow(items, `${prefix}时间`, award.date);
      pushCopyRow(items, `${prefix}颁发单位`, award.issuer);
      pushCopyRow(items, `${prefix}名次`, award.rank);
      pushCopyRow(items, `${prefix}担任角色`, award.role);
      pushCopyRow(items, `${prefix}链接`, award.url);
      pushCopyRow(items, `${prefix}说明`, award.description);
    });

    certs.map((item) => typeof item === 'string' ? { name: item } : item)
      .filter((item) => item && item.name)
      .forEach((certificate, i) => {
        const prefix = `证书${i + 1} · `;
        pushCopyRow(items, `${prefix}名称`, certificate.name);
        pushCopyRow(items, `${prefix}编号`, certificate.code);
        pushCopyRow(items, `${prefix}机构`, certificate.issuer);
        pushCopyRow(items, `${prefix}日期`, certificate.date);
        pushCopyRow(items, `${prefix}有效期`, certificate.expiryDate);
      });

    papers.forEach((paper, i) => {
      if (!paper || !paper.name) return;
      const prefix = papers.length > 1 ? `论文${i + 1} · ` : '论文 · ';
      const cite = [paper.name, paper.publisher, paper.date, paper.authorOrder].filter(Boolean).join('，');
      if (cite) items.push({ label: `${prefix}整条引用`, val: cite });
      pushCopyRow(items, `${prefix}名称`, paper.name);
      pushCopyRow(items, `${prefix}期刊/会议`, paper.publisher);
      pushCopyRow(items, `${prefix}发表日期`, paper.date);
      pushCopyRow(items, `${prefix}作者顺序`, paper.authorOrder);
      pushCopyRow(items, `${prefix}角色`, paper.role);
      pushCopyRow(items, `${prefix}链接`, paper.url);
      if (paper.abstract) items.push({ label: `${prefix}摘要`, val: paper.abstract, block: true });
    });

    patents.forEach((patent, i) => {
      if (!patent || !patent.name) return;
      const prefix = patents.length > 1 ? `专利${i + 1} · ` : '专利 · ';
      pushCopyRow(items, `${prefix}名称`, patent.name);
      pushCopyRow(items, `${prefix}发明人`, patent.inventor);
      pushCopyRow(items, `${prefix}取得日期`, patent.date);
      pushCopyRow(items, `${prefix}链接`, patent.url);
      if (patent.description) items.push({ label: `${prefix}说明`, val: patent.description, block: true });
    });

    // 动态自动探测：捕获 education 子项及 languageSkills 中后续新增的未知字段
    const knownEduKeys = ['id', 'school', 'college', 'major', 'secondMajor', 'degree', 'academicDegree', 'degreeType', 'schoolType', 'schoolCity', 'startDate', 'endDate', 'gpa', 'rank', 'advisor', 'laboratory', 'researchArea', 'fullTime', 'highestFullTime', 'majorStatus', 'courses', 'description'];
    edus.forEach((edu, i) => {
      if (!edu) return;
      const prefix = (edus.length > 1) ? `教育${i + 1} · ` : '教育 · ';
      appendUndiscoveredFields(items, edu, knownEduKeys, 'education', prefix);
    });
    const knownLangKeys = ['cet4', 'cet6', 'ielts', 'toefl', 'otherLanguages'];
    appendUndiscoveredFields(items, ls, knownLangKeys, 'languageSkills');
  }

  if (category === 'exp' || category === 'all') {
    const projectNarratives = projs.map((proj) => {
      const smart = smartExtractProjectParts(proj);
      return normalizeExperienceNarrative([
        smart.description || proj.description,
        smart.responsibilities || proj.responsibilities,
        smart.achievements || proj.achievements
      ]);
    }).filter(Boolean);
    const visibleWorks = works.filter((work) => {
      if (!work || !(work.company || work.position || work.description)) return false;
      const smart = smartExtractWorkParts(work);
      const narrative = normalizeExperienceNarrative([
        smart.description || work.description,
        smart.achievements || work.achievements
      ]);
      return !projectNarratives.some((projectNarrative) => hasSameExperienceNarrative(narrative, projectNarrative));
    });

    visibleWorks.forEach((work, i) => {
      const smart = smartExtractWorkParts(work);
      const prefix = `实习${i + 1} · `;
      items.push({ label: `${prefix}整段`, val: formatWorkBlock(work, i), block: true });
      pushCopyRow(items, `${prefix}公司`, work.company);
      pushCopyRow(items, `${prefix}职位`, work.position);
      pushCopyRow(items, `${prefix}部门`, work.department);
      pushCopyRow(items, `${prefix}工作性质`, work.workType);
      pushCopyRow(items, `${prefix}城市`, work.city);
      pushCopyRow(items, `${prefix}起止`, joinDateRange(work.startDate, work.endDate));
      pushCopyRow(items, `${prefix}职责`, smart.description || work.description);
      pushCopyRow(items, `${prefix}成果`, smart.achievements || work.achievements);
    });

    const visibleProjects = projs.filter((proj) =>
      proj && (proj.name || proj.description || proj.responsibilities)
    );
    visibleProjects.forEach((proj, i) => {
      const smart = smartExtractProjectParts(proj);
      const prefix = `项目${i + 1} · `;
      items.push({ label: `${prefix}整段`, val: formatProjectBlock(proj, i), block: true });
      pushCopyRow(items, `${prefix}名称`, proj.name);
      pushCopyRow(items, `${prefix}角色`, smart.role || proj.role);
      pushCopyRow(items, `${prefix}类型`, proj.projectType);
      pushCopyRow(items, `${prefix}级别`, proj.projectLevel);
      pushCopyRow(items, `${prefix}起止`, joinDateRange(proj.startDate, proj.endDate));
      pushCopyRow(items, `${prefix}技术栈`, smart.techStack || proj.techStack);
      pushCopyRow(items, `${prefix}描述`, smart.description || proj.description);
      pushCopyRow(items, `${prefix}职责`, smart.responsibilities || proj.responsibilities);
      pushCopyRow(items, `${prefix}成果`, smart.achievements || proj.achievements);
      pushCopyRow(items, `${prefix}链接`, proj.projectUrl);
    });

    openSource.forEach((os, i) => {
      if (!os || !os.url) return;
      const prefix = openSource.length > 1 ? `开源${i + 1} · ` : '开源 · ';
      pushCopyRow(items, `${prefix}仓库链接`, os.url);
      pushCopyRow(items, `${prefix}Stars`, os.stars != null ? String(os.stars) : '');
      pushCopyRow(items, `${prefix}统计日期`, os.date);
    });

    // 动态自动探测：捕获去重后的工作经历和项目经历中后续新增的未知字段
    const knownWorkKeys = ['id', 'company', 'position', 'department', 'workType', 'city', 'startDate', 'endDate', 'description', 'achievements'];
    visibleWorks.forEach((work, i) => {
      const prefix = `实习${i + 1} · `;
      appendUndiscoveredFields(items, work, knownWorkKeys, 'workExperience', prefix);
    });
    const knownProjKeys = ['id', 'name', 'role', 'projectType', 'projectLevel', 'startDate', 'endDate', 'techStack', 'technologies', 'projectUrl', 'description', 'responsibilities', 'achievements'];
    visibleProjects.forEach((proj, i) => {
      const prefix = `项目${i + 1} · `;
      appendUndiscoveredFields(items, proj, knownProjKeys, 'projects', prefix);
    });
  }

  if (category === 'qa' || category === 'intro' || category === 'all') {
    if (profile.skillAdvantage) items.push({ label: '个人优势', val: profile.skillAdvantage, block: true });
    if (commonAnswers.selfEvaluation) items.push({ label: '问答 · 自我评价', val: commonAnswers.selfEvaluation, block: true });
    if (commonAnswers.careerGoal) items.push({ label: '问答 · 职业规划/求职目标', val: commonAnswers.careerGoal, block: true });
    if (commonAnswers.strengthsWeaknesses) items.push({ label: '问答 · 优势与不足', val: commonAnswers.strengthsWeaknesses, block: true });
    if (commonAnswers.hobbies) items.push({ label: '问答 · 兴趣特长/爱好', val: commonAnswers.hobbies, block: true });
    if (commonAnswers.gameExperience) items.push({ label: '问答 · 游戏经历', val: commonAnswers.gameExperience, block: true });
    if (commonAnswers.aiTools) items.push({ label: '问答 · AI 工具使用经历', val: commonAnswers.aiTools, block: true });
    const progLangs = Array.isArray(commonAnswers.programmingLanguages) ? commonAnswers.programmingLanguages.join('、') : commonAnswers.programmingLanguages;
    pushCopyRow(items, '问答 · 编程语言优先级', progLangs);

    const defaultIntro = profile.introTemplates?.default || profile.skills?.intro;
    if (defaultIntro) items.push({ label: '自我介绍 (默认)', val: defaultIntro, block: true });
    (profile.introTemplates?.custom || []).forEach((tpl, i) => {
      const content = typeof tpl === 'string' ? tpl : tpl.content || tpl.text;
      const name = typeof tpl === 'object' && tpl.name ? tpl.name : `模板${i + 1}`;
      if (content) items.push({ label: `自我介绍 (${name})`, val: content, block: true });
    });
    if (profile.hrGreeting && profile.hrGreeting.trim()) {
      items.push({ label: 'HR沟通打招呼语', val: profile.hrGreeting.trim(), block: true });
    }

    const skillText = profileSkillText(profile);
    pushCopyRow(items, '技能清单', skillText);

    customAnswers.forEach((qa, i) => {
      if (!qa || (!qa.question && !qa.answer)) return;
      const qLabel = qa.question ? `问答 · ${qa.question}` : `自定义问答 ${i + 1}`;
      if (qa.answer) items.push({ label: qLabel, val: qa.answer, block: true });
    });

    declarations.forEach((dec, i) => {
      if (!dec || (!dec.question && !dec.answer)) return;
      const prefix = dec.question ? `声明 · ${dec.question}` : `个人声明 ${i + 1}`;
      const decVal = `${dec.answer || ''} ${dec.explanation ? '(' + dec.explanation + ')' : ''}`.trim();
      pushCopyRow(items, prefix, decVal || dec.answer);
    });

    // 动态自动探测：捕获 commonAnswers 中后续新增的未知问答
    const knownCommonKeys = ['selfEvaluation', 'careerGoal', 'strengthsWeaknesses', 'hobbies', 'gameExperience', 'aiTools', 'programmingLanguages'];
    appendUndiscoveredFields(items, commonAnswers, knownCommonKeys, 'commonAnswers', '问答 · ');

    pushCopyRow(items, 'GitHub', b.github);
    pushCopyRow(items, '个人网站', b.website);
    pushCopyRow(items, 'LinkedIn', b.linkedin);
    pushCopyRow(items, 'Twitter / X', b.twitter);
  }

  return items;
}
