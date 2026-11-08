// 扩展字段共用定义：存储、编辑器与解析器使用相同键名；空值不代表“否”。
var profileSchema = {
  basicInfo: {
    sourcePlace: '生源地', registeredAddress: '户口所在地', nationality: '国籍', leagueJoinDate: '入团时间', partyJoinDate: '入党时间',
    height: '身高（cm）', weight: '体重（kg）', health: '健康状况',
    englishName: '英文名', wechat: '微信号', qq: 'QQ号', idCardType: '证件类型', bloodType: '血型',
    registeredAddressType: '户籍类型', religion: '宗教信仰', honor: '荣誉奖励', specialSkills: '特长', openToWork: '求职状态',
    permanentResidencePermit: '居住证号', jobSources: '招聘信息来源', foreignCitizenship: '是否取得外国国籍',
    relativesEmployed: '亲属在目标单位任职', yearsOfWork: '工作年限', lastNamePinyin: '姓拼音', firstNamePinyin: '名拼音',
    namePinyinFull: '姓名全拼', personalPromise: '个人声明/承诺',
    archiveOrganization: '人事档案所在单位', professionalTitle: '专业技术职称', homeAddress: '家庭现居地址',
    birthPlace: '出生地', interests: '兴趣爱好'
  },
  jobIntention: {
    expectedIndustry: '期望行业', currentSalary: '当前薪资', acceptAdjustment: '是否服从调剂',
    acceptCounty: '是否接受县级公司工作', salaryCurrency: '薪资币种', salaryUnit: '金额单位', salaryPeriod: '月薪/年薪周期',
    referred: '是否内推', expectedMonthlySalary: '期望月薪（元）', expectedAnnualSalary: '期望年薪（元）',
    currentMonthlySalary: '当前月薪（元）', currentAnnualSalary: '当前年薪（元）'
  },
  education: {
    academicDegree: '学位', secondMajor: '第二专业', schoolCity: '学校所在城市', advisor: '导师', laboratory: '实验室',
    researchArea: '研究方向', fullTime: '是否全日制', highestFullTime: '是否最高全日制学历', majorStatus: '主修状态',
    majorCategory: '专业分类', studentId: '学号', studyDuration: '学制', thesis: '毕业论文/课题', enrollmentType: '录取/培养类别',
    counselorName: '辅导员姓名', counselorPhone: '辅导员电话', gpaScale: '绩点满分', diplomaNumber: '毕业证编号',
    degreeNumber: '学位证编号', schoolEnglish: '学校英文名', majorEnglish: '专业英文名', schoolProvince: '学校所在省份',
    schoolDistrict: '学校所在区县', campusRole: '在校职位', academicScore: '学业成绩',
    classRank: '班级排名', classSize: '班级人数', overseasEducation: '是否海外/港澳台教育'
  },
  workExperience: {
    industry: '行业类别', salary: '工资/实习补贴', resignationReason: '离职原因', referenceName: '证明人',
    referencePhone: '证明人联系方式', referencePosition: '证明人职务', referenceCompany: '证明人工作单位',
    employerType: '单位性质'
  },
  projects: {
    projectLevel: '项目级别', organization: '项目所在单位', referenceName: '项目证明人',
    referencePhone: '项目证明人电话', referencePosition: '项目证明人职务', referenceCompany: '项目证明人单位'
  },
  awards: {
    category: '奖项类别', grade: '奖项等级', reason: '奖励原因', issuer: '颁奖单位', rank: '名次',
    description: '奖项描述', url: '链接', role: '担当角色'
  },
  certificates: { level: '证书等级', description: '证书描述' },
  languageCertificates: {
    language: '语种', name: '考试 / 证书名称', score: '成绩', obtainedDate: '获得时间',
    proficiency: '掌握程度', listeningSpeaking: '听说能力', readingWriting: '读写能力',
    level: '证书等级', notes: '补充说明'
  },
  familyMembers: { birthDate: '出生日期', politicalStatus: '政治面貌', homeAddress: '家庭所在地' },
  campusPositions: {
    organization: '组织/社团名称', title: '职务名称', level: '学生干部级别', startDate: '开始时间',
    endDate: '结束时间', description: '职务描述', activityName: '项目/活动名称'
  },
  campusActivities: { name: '活动名称', role: '担任职务', participation: '实践方式',
    startDate: '开始时间', endDate: '结束时间', description: '活动内容' },
  trainings: { name: '培训名称', institution: '培训机构', startDate: '开始时间', endDate: '结束时间', description: '培训内容' },
  papers: { name: '论文名称', date: '发表日期', publisher: '期刊/会议或出版社', authorOrder: '作者顺序', role: '担当角色', abstract: '摘要', url: '链接' },
  patents: { name: '专利名称', inventor: '专利人', date: '取得日期', description: '说明', url: '链接' },
  openSource: { url: '仓库链接', stars: 'Stars 数', date: '统计日期' },
  commonAnswers: { gameExperience: '游戏经历', programmingLanguages: '编程语言（按优先顺序，每行一个）', aiTools: 'AI 工具使用经历', hobbies: '爱好特长', strengthsWeaknesses: '优势不足', selfEvaluation: '自我评价', careerGoal: '求职目标' },
  customAnswers: { question: '问题（完整原文）', answer: '答案' },
  declarations: { question: '声明问题（完整原文）', answer: '是/否', explanation: '补充说明', company: '适用企业', hostname: '适用网站域名' }
};
var profileListKeys = ['education', 'workExperience', 'projects', 'awards', 'familyMembers', 'certificates', 'languageCertificates', 'campusPositions', 'campusActivities', 'trainings', 'papers', 'patents', 'openSource', 'customAnswers', 'declarations'];
function extendedDefaults(section) {
  return Object.fromEntries(Object.keys(profileSchema[section] || {}).map(key => [key, key === 'programmingLanguages' ? [] : '']));
}

var LANGUAGE_EXAMS = {
  cet4: { name: 'CET-4', label: '四级', match: /^(?:大学英语四级|英语四级|四级|cet[-\s]?4)$/i },
  cet6: { name: 'CET-6', label: '六级', match: /^(?:大学英语六级|英语六级|六级|cet[-\s]?6)$/i },
  ielts: { name: 'IELTS', label: '雅思', match: /^(?:雅思|ielts)$/i },
  toefl: { name: 'TOEFL', label: '托福', match: /^(?:托福|toefl)$/i },
  tem4: { name: 'TEM-4', label: '专四', match: /^(?:英语专业四级|专四|tem[-\s]?4)$/i },
  tem8: { name: 'TEM-8', label: '专八', match: /^(?:英语专业八级|专八|tem[-\s]?8)$/i },
  gre: { name: 'GRE', label: 'GRE', match: /^gre$/i },
  gmat: { name: 'GMAT', label: 'GMAT', match: /^gmat$/i }
};
var LEGACY_LANGUAGE_SCORES = ['cet4', 'cet6', 'ielts', 'toefl'];

function languageExamKey(value) {
  const parts = String(value ?? '').normalize('NFKC').trim().split(/[()]/).map(part => part.trim()).filter(Boolean);
  return Object.keys(LANGUAGE_EXAMS).find(key => parts.some(part => LANGUAGE_EXAMS[key].match.test(part))) || '';
}

function languageScoreKey(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s*分$/, '');
}

function languageEntryExam(entry) {
  return languageExamKey(entry?.name) || languageExamKey(entry?.level);
}

function profileLanguageEntries(profile) {
  const entries = (Array.isArray(profile?.languageCertificates) ? profile.languageCertificates : [])
    .filter(item => item && typeof item === 'object').map(item => {
      if (item.language) return { ...item };
      const name = String(item.name || '').trim();
      if (/^(英语|日语|韩语|德语|法语|俄语|西班牙语|阿拉伯语|意大利语|葡萄牙语)$/.test(name)) {
        return { ...item, language: name, name: '' };
      }
      return { ...item, language: languageEntryExam(item) ? '英语' : '' };
    });
  const legacyId = key => {
    const base = `legacy-language-${key}`;
    let id = base;
    let index = 1;
    while (entries.some(entry => entry.id === id)) id = `${base}-${index++}`;
    return id;
  };
  const legacy = profile?.languageSkills || {};
  for (const key of LEGACY_LANGUAGE_SCORES) {
    const score = String(legacy[key] ?? '').trim();
    if (!score) continue;
    const matches = entries.filter(item => languageEntryExam(item) === key);
    if (matches.some(item => languageScoreKey(item.score) === languageScoreKey(score))) continue;
    if (matches.length === 1 && !languageScoreKey(matches[0].score)) {
      matches[0].score = score;
    } else {
      entries.push({ id: legacyId(key), language: '英语', name: LANGUAGE_EXAMS[key].name, score });
    }
  }
  const notes = String(legacy.otherLanguages ?? '').trim();
  if (notes && !entries.some(item => item.notes === notes)) entries.push({ id: legacyId('other'), notes });
  return entries;
}

function languageEntryForExam(entries, key) {
  const matches = entries.filter(item => languageEntryExam(item) === key);
  const scores = matches.filter(item => languageScoreKey(item.score));
  const preferred = scores.filter(item => item.preferred === '是');
  if (preferred.length === 1) return preferred[0];
  return new Set(scores.map(item => languageScoreKey(item.score))).size === 1 ? scores[0] : undefined;
}

function profileLanguageScores(profile, entries = profileLanguageEntries(profile)) {
  const scores = Object.fromEntries(LEGACY_LANGUAGE_SCORES.map(key => [key, languageEntryForExam(entries, key)?.score]));
  scores.otherLanguages = [...new Set(entries.flatMap(item => {
    const otherLanguage = item.language && !/^(英语|english)$/i.test(item.language);
    const notes = otherLanguage || (!item.language && !item.name) ? item.notes : '';
    return [otherLanguage && [item.language, item.name, item.level, item.proficiency].filter(Boolean).join(' '), notes].filter(Boolean);
  }))].join('；');
  return scores;
}

// 兼容省市区和详细地址分别保存的旧简历。
function familyResidence(info = {}) {
  const raw = String(info?.homeAddress || '').trim();
  const legacy = ['homeProvince', 'homeCity', 'homeDistrict'].map(key => String(info?.[key] || '').trim());
  const normalize = value => value.replace(/[\s/／、，,省市]/g, '').replace(/^中国/, '');
  const rawKey = normalize(raw);
  const matchingLegacy = rawKey ? legacy.findIndex(part => normalize(part) && rawKey.startsWith(normalize(part))) : -1;
  const address = raw.replace(/^中国[\s/／、，,]*/, '');
  const province = address.match(/^(北京|上海|天津|重庆)市/)?.[0] ||
    address.match(/^[\u4e00-\u9fff]{1,12}?(?:省|自治区|特别行政区)/)?.[0] || '';
  const afterProvince = address.slice(province.length).replace(/^[\s/／、，,]+/, '');
  const municipality = /^(北京|上海|天津|重庆)市$/.test(province);
  const city = municipality ? province : afterProvince.match(/^[\u4e00-\u9fff]{1,10}?(?:市|自治州|地区|盟)/)?.[0] || '';
  const afterCity = (municipality ? afterProvince : afterProvince.slice(city.length)).replace(/^[\s/／、，,]+/, '');
  const district = afterCity.match(/^[\u4e00-\u9fff]{1,12}?(?:区|县|旗)/)?.[0] || '';
  const conflictingRegion = [province, city, district].some((value, index) =>
    value && legacy[index] && normalize(value) !== normalize(legacy[index]));
  const prefix = conflictingRegion || province ? [] : legacy.slice(0, matchingLegacy >= 0 ? matchingLegacy : legacy.length);
  const pieces = [];
  for (const part of prefix) {
    const key = normalize(part);
    if (key && !normalize(pieces.join('')).includes(key)) pieces.push(part);
  }
  if (raw) pieces.push(raw);
  return {
    homeAddress: pieces.join(''),
    homeProvince: (!conflictingRegion && legacy[0]) || province,
    homeCity: (!conflictingRegion && legacy[1]) || city,
    homeDistrict: (!conflictingRegion && legacy[2]) || district
  };
}

function mergeProfile(old, updates) {
  const merged = { ...old, ...updates };
  for (const [key, value] of Object.entries(updates)) {
    if (profileListKeys.includes(key) && Array.isArray(value)) {
      merged[key] = value.map(item => ({ ...(old[key] || []).find(previous => previous.id && previous.id === item.id), ...item }));
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = { ...old[key], ...value };
      if (key === 'basicInfo' && Object.hasOwn(value, 'homeAddress') &&
          String(value.homeAddress || '').trim() !== familyResidence(old.basicInfo).homeAddress) {
        for (const part of ['homeProvince', 'homeCity', 'homeDistrict']) {
          if (!Object.hasOwn(value, part) || value[part] === old.basicInfo?.[part]) delete merged[key][part];
        }
      }
    }
  }
  return merged;
}
function profileWithoutFiles(profile) {
  return JSON.parse(JSON.stringify(profile, (key, value) => ['resumeFile', 'attachments', 'attachmentContents', 'dataUrl'].includes(key) ? undefined : value));
}

// Module preferences retain source data; this projection is exclusively for filling.
var resumeOptionalModules = ['internship','work','projects','campusPositions','campusActivities','family','awards','languageCertificates','certificates','skills','introduction','aiTools','trainings','papers','patents','openSource','commonAnswers','customAnswers','declarations'];
var resumeModulesEnabledByContent = ['campusPositions', 'campusActivities', 'trainings', 'papers', 'patents', 'openSource', 'commonAnswers', 'customAnswers', 'declarations'];
function resumeModuleEnabled(profile, key) {
  if (!resumeOptionalModules.includes(key)) return true;
  const saved = profile?.moduleConfig?.enabled?.[key];
  if (typeof saved === 'boolean') return saved;
  if (!resumeModulesEnabledByContent.includes(key)) return true;
  const hasContent = value => Array.isArray(value) ? value.some(hasContent)
    : value && typeof value === 'object' ? Object.entries(value).some(([field, item]) => field !== 'id' && hasContent(item))
      : String(value ?? '').trim() !== '';
  return hasContent(profile?.[key]);
}
function resumeModuleConfig(profile) {
  return { version: 1, enabled: Object.fromEntries(resumeOptionalModules.map(key => [key, resumeModuleEnabled(profile, key)])) };
}
function isInternshipRecord(item) { return /实习|intern/i.test(item?.workType || ''); }
function profileForFilling(profile) {
  if (!profile) return profile;
  const copy = JSON.parse(JSON.stringify(profile));
  const aiTools = copy.commonAnswers?.aiTools;
  for (const key of resumeOptionalModules) {
    if (resumeModuleEnabled(copy, key)) continue;
    const dataKey = { family:'familyMembers', introduction:'introTemplates' }[key] || key;
    if (key === 'work' || key === 'internship' || key === 'aiTools') continue;
    copy[dataKey] = ['introTemplates', 'commonAnswers'].includes(dataKey) ? {} : [];
    if (key === 'languageCertificates') copy.languageSkills = {};
    if (key === 'introduction') { copy.hrGreeting = ''; copy.introduction = ''; }
  }
  copy.workExperience = (copy.workExperience || []).filter(item => resumeModuleEnabled(copy, isInternshipRecord(item) ? 'internship' : 'work'));
  if (!resumeModuleEnabled(copy, 'aiTools') && copy.commonAnswers) delete copy.commonAnswers.aiTools;
  else if (aiTools) { copy.commonAnswers = copy.commonAnswers || {}; copy.commonAnswers.aiTools = aiTools; }
  return copy;
}
