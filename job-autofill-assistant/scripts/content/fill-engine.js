// ============================================================================
// Capybara 网申助手 content script —— fill-engine.js
// 填充引擎：fillForm 主循环（逐字段 try/catch/finally、结构化结果、full/incremental 模式、任务取消）与岗位信息探测
// 本目录各文件按 manifest content_scripts 顺序在同一隔离世界全局作用域中执行；
// 跨文件引用在运行时解析，模块内顶层 const/let 统一为 var 以支持扩展重注入。
// ============================================================================

'use strict';

var activeFillTask = null;

function syncFillTaskControls() {
  if (typeof syncYanyuTaskControls === 'function') syncYanyuTaskControls();
  if (typeof publishSidePanelTask === 'function') publishSidePanelTask();
}

function startActiveFillTask(kind, mode) {
  if (activeFillTask?.running) return null;
  const task = {
    running: true,
    paused: false,
    kind: kind || 'fill',
    mode: mode || 'full',
    controller: new AbortController(),
    pausePromise: null,
    pauseResolve: null,
    pausedMs: 0,
    pauseStartedAt: 0,
    lastYieldAt: Date.now(),
    stage: 'init'
  };
  activeFillTask = task;
  syncFillTaskControls();
  return task;
}

function releaseFillTaskPause(task) {
  if (!task) return;
  const resolve = task.pauseResolve;
  if (task.paused) task.pausedMs += Date.now() - task.pauseStartedAt;
  task.paused = false;
  task.pauseResolve = null;
  task.pausePromise = null;
  if (resolve) resolve();
  syncFillTaskControls();
}

function pauseActiveFillTask() {
  const task = activeFillTask;
  if (!task?.running) return false;
  if (task.paused) return true;
  task.paused = true;
  task.pauseStartedAt = Date.now();
  task.pausePromise = new Promise(resolve => { task.pauseResolve = resolve; });
  syncFillTaskControls();
  return true;
}

function resumeActiveFillTask() {
  if (!activeFillTask?.running) return false;
  releaseFillTaskPause(activeFillTask);
  return true;
}

function toggleActiveFillPause() {
  return activeFillTask?.paused ? resumeActiveFillTask() : pauseActiveFillTask();
}

async function waitForFillCheckpoint(task) {
  if (!task) return;
  throwIfFillCancelled(task.controller.signal);
  if (Date.now() - task.lastYieldAt >= 16) {
    await sleep(0);
    task.lastYieldAt = Date.now();
  }
  while (task.paused && task.pausePromise) await task.pausePromise;
  throwIfFillCancelled(task.controller.signal);
}

function finishActiveFillTask(task) {
  if (!task) return;
  releaseFillTaskPause(task);
  task.running = false;
  if (activeFillTask === task) activeFillTask = null;
  syncFillTaskControls();
}

function throwIfFillCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('填充任务已取消');
  error.name = 'AbortError';
  throw error;
}

function cancelActiveFillTask() {
  if (!activeFillTask?.running) return false;
  const task = activeFillTask;
  task.controller.abort();
  releaseFillTaskPause(task);
  syncFillTaskControls();
  return true;
}

function fillResultEntry(input, detection, status, reason, value) {
  return {
    element: input || null,
    fieldType: detection?.fieldType || '',
    label: getClosestLabelText(input) || input?.placeholder || input?.name || detection?.fieldType || '未命名字段',
    confidence: detection?.confidence ?? 0,
    via: detection?.via || '',
    status,
    reason: reason || '',
    value
  };
}

async function fillForm(profile, options) {
  profile = profileForFilling(profile);
  const opts = options && typeof options === 'object' ? options : {};
  const mode = opts.mode === 'incremental' ? 'incremental' : 'full';
  if (!profile) {
    console.log('[易offer] 未找到激活的资料');
    return { filledCount: 0, results: [], isChat: false, mode };
  }
  const ownsTask = !opts.task;
  const task = ownsTask ? startActiveFillTask('fill', mode) : opts.task;
  if (!task || (activeFillTask?.running && activeFillTask !== task)) {
    return { filledCount: 0, results: [], cancelled: true, error: '已有填充任务正在进行', mode };
  }
  activeFillTask = task;
  const signal = task.controller.signal;
  const incremental = mode === 'incremental';
  const fillStartedAt = Date.now();
  let structureResult = null;
  let filledCount = 0;
  const results = [];
  const attemptedFields = new WeakSet();
  const processedRanges = new WeakSet();
  const recheckFields = new Map();
  const home = familyResidence(profile.basicInfo);
  const languageEntries = profileLanguageEntries(profile);
  const languageScores = profileLanguageScores(profile, languageEntries);

  try {
    resetDropdownSessions();
    activeDeclarationQuestions = new Set((profile?.declarations || []).map(item => exactQuestion(item.question)).filter(Boolean));
    if (typeof prepareFormStructure === 'function') {
      task.stage = 'structure';
      await waitForFillCheckpoint(task);
      structureResult = await prepareFormStructure(profile, { signal, mode, task, completeRows: opts.completeRows });
      throwIfFillCancelled(signal);
    }
    task.stage = 'declarations';
    await waitForFillCheckpoint(task);
    await fillConfirmedDeclarations(profile, { ...opts, signal, task });
    throwIfFillCancelled(signal);
    task.stage = 'site';
    await waitForFillCheckpoint(task);
    if (isBeisenForm()) {
      const siteResult = await fillBeisenForm(profile, { ...opts, signal, mode, task });
      if (typeof showYanyuTaskResult === 'function') showYanyuTaskResult({
        ...siteResult,
        results: siteResult.fieldResults || siteResult.results || [],
        reviewCount: siteResult.reviewCount ?? siteResult.manualFields?.length ?? 0
      });
      return siteResult;
    }
    if (isXhsForm()) {
      const siteResult = await fillXhsForm(profile, { ...opts, signal, mode, task });
      if (typeof showYanyuTaskResult === 'function') showYanyuTaskResult({
        ...siteResult,
        results: siteResult.fieldResults || siteResult.results || [],
        reviewCount: siteResult.reviewCount ?? siteResult.manualFields?.length ?? 0
      });
      return siteResult;
    }

    // 1. 优先检查当前是否处于 HR 聊天/沟通框界面
    const chatInput = findChatInputElement();
    if (chatInput) {
      const posName = detectPositionName(profile) || profile?.jobIntention?.expectedPosition || '应聘岗位';
      const compName = detectCompanyName() || '';
      const greeting = (profile.hrGreeting && profile.hrGreeting.trim()) || (profile.skills?.intro && profile.skills.intro.trim()) || generateDefaultGreeting(profile, posName, compName);
      const ok = setChatInputValue(chatInput, greeting);
      if (ok) {
        if (typeof appLog !== 'undefined') appLog.success('content', 'fill.chat', '已自动填充 HR 打招呼语', { position: posName, greeting });
        const chatResult = { filledCount: 1, results: [], isChat: true, greeting, mode };
        if (typeof showYanyuTaskResult === 'function') showYanyuTaskResult(chatResult);
        return chatResult;
      }
    }

    // 必须在写入“工作经历/担任职位”等输入框之前保存目标岗位。
    const isResumeEditor = isOfferLinkResumeForm();
    if (!isResumeEditor) cacheJobMetaFromPage();
    if (!incremental) await ensureMokaEntries(profile, { ...opts, signal, task });

  // 2. 扫描所有可填充的网申输入框
  const inputs = document.querySelectorAll(
    'input[type="text"], input[type="email"], input[type="tel"], ' +
    'input[type="number"], input[type="date"], input[type="month"], input[type="url"], input[type="search"], input[type="radio"], input:not([type]), ' +
    'textarea, select, [role="combobox"], [contenteditable="true"]'
  );
  // 组件外壳和内部输入框只扫描一次，避免经历计数错位。
  const fields = [...new Set([...inputs].map((el) => writableBox(el)))].filter((el) =>
    el && (isElementTrulyVisible(el) || (el.type === 'radio' && isElementTrulyVisible(el.closest('label.tec-radio'))) ||
      (isSelectWidget(el) && isElementTrulyVisible(el.closest('.ant-select, .el-select, .rc-select, .semi-select, .arco-select')))));

  console.log(`[易offer] 扫描到 ${inputs.length} 个输入框`);
  if (typeof appLog !== 'undefined') {
    appLog.info('content', 'fill.scan', `扫描到 ${inputs.length} 个输入框`, {
      url: location.href,
      profile: profile && profile.name
    });
  }

  // 预探测：页面上是否同时存在独立的项目职责/工作成果框
  const detectedFields = [];
  const unmappedFields = [];
  for (const input of fields) {
    await waitForFillCheckpoint(task);
    const detection = detectField(input);
    if (detection) detectedFields.push({ input, detection });
    else if (input.closest('[class*="form-item"],fieldset,[data-profile-section]') &&
      !isIgnoredInput(input) && getClosestLabelText(input)) unmappedFields.push(input);
  }
  const matchedTypes = detectedFields.map(({ detection }) => detection.fieldType);
  const offerLinkEntries = collectOfferLinkCardEntries(profile, detectedFields);
  const hasSeparateProjResp = matchedTypes.includes('projectResponsibilities');
  const hasSeparateProjAchieve = matchedTypes.includes('projectAchievements');
  const hasSeparateTechStack = matchedTypes.includes('techStack');
  const hasSeparateWorkAchieve = matchedTypes.includes('workAchievements');
  const profileDocumentType = profile.basicInfo?.idCardType ||
    (/^(?:\d{15}|\d{17}[\dXx])$/.test(String(profile.basicInfo?.idCard || '').trim()) ? '身份证' : '');

  // 多段经历智能计数追踪
  let currentProjIdx = 0;
  let currentWorkIdx = 0;
  let currentEduIdx = 0;
  let currentFamilyIdx = 0;
  let currentCertificateIdx = 0;
  let currentPaperIdx = 0;
  let currentPatentIdx = 0;
  let seenProjNames = 0;
  let seenCompanies = 0;
  let seenSchools = 0;
  let seenFamilyNames = 0;
  let seenCertificates = 0;
  let seenPaperNames = 0;
  let seenPatentNames = 0;

  const projList = (profile.projects || []).filter((item) =>
    item && [item.name, item.description, item.responsibilities, item.achievements].some((value) => String(value || '').trim())
  );
  const workList = (profile.workExperience || []).filter((item) =>
    item && [item.company, item.position, item.description, item.achievements].some((value) => String(value || '').trim())
  );
  const eduList = (profile.education || []).filter((item) =>
    item && [item.school, item.major, item.degree].some((value) => String(value || '').trim())
  );
  const educationRank = item => {
    const level = String(item.degree || item.academicDegree || '');
    return [/中学|高中|中专/, /大专|专科/, /本科|学士/, /硕士|MBA/i, /博士/].findIndex(pattern => pattern.test(level));
  };
  const topRank = Math.max(...eduList.map(educationRank));
  const highest = eduList.filter(item => educationRank(item) === topRank);
  const highestEducation = highest.length === 1 ? highest[0] : null;
  const familyList = (profile.familyMembers || []).filter((item) =>
    item && [item.name, item.relation, item.employer, item.position, item.phone, item.age, item.occupation].some((value) => String(value || '').trim())
  );
  const duoyiFamilyEntries = collectDuoyiFamilyEntries(detectedFields, familyList);
  const handledRadios = new WeakSet();
  const certificateList = (profile.certificates || []).map((item) =>
    typeof item === 'string' ? { name: item } : item
  ).filter((item) => item && [item.name, item.code, item.issuer].some((value) => String(value || '').trim()));
  const paperList = (profile.papers || []).filter((item) =>
    item && [item.name, item.publisher, item.date, item.url, item.abstract].some((value) => String(value || '').trim())
  );
  const patentList = (profile.patents || []).filter((item) =>
    item && [item.name, item.inventor, item.date, item.description, item.url].some((value) => String(value || '').trim())
  );

  const projectParts = new Map(projList.map(entry => [entry, smartExtractProjectParts(entry)]));
  const workParts = new Map(workList.map(entry => [entry, smartExtractWorkParts(entry)]));
  const dateParts = new Map();
  const date = value => {
    if (!dateParts.has(value)) dateParts.set(value, parseYearMonth(value));
    return dateParts.get(value);
  };
  const queue = typeof repeatFillFields === 'function' ? repeatFillFields(profile, detectedFields, {
    signal, task, explicitCards: isResumeEditor, addRows: !incremental || opts.completeRows,
    manual: structureResult?.manual || [], onAdded: () => { if (structureResult) structureResult.added++; },
    verifyAnchor: async anchor => {
      const until = recheckFields.get(anchor);
      if (until > Date.now()) await sleep(until - Date.now());
      await waitForFillCheckpoint(task);
      const row = results.find(result => result.element === anchor && result.status === 'filled');
      return anchor.isConnected && fieldHasValue(anchor) && (!row || !until || verifyFieldWrite(anchor, row.value));
    }
  }) : detectedFields;
  for await (const { input, detection, binding } of queue) {
    task.stage = 'fields';
    await waitForFillCheckpoint(task);
    throwIfFillCancelled(signal);
    try {
      if (!input.isConnected || isIgnoredInput(input)) continue;
      if (binding) attemptedFields.add(input);
      if (detection.confidence < FIELD_WRITE_MIN_CONFIDENCE) {
        results.push(fillResultEntry(input, detection, 'needs_review', 'low_confidence'));
        continue;
      }
      const fieldType = detection.fieldType;
      const range = binding?.entry && /^(startDate|endDate)$/.test(binding.key) && input.closest('.ant-picker-range');
      if (range) {
        if (processedRanges.has(range)) continue;
        processedRanges.add(range);
        const endpoints = ['startDate', 'endDate'].map(key => binding.row.fields.find(field => field.key === key && range.contains(field.input)));
        if (endpoints.every(Boolean) && endpoints[0].input !== endpoints[1].input) {
          const fields = endpoints.map(endpoint => endpoint.input);
          fields.forEach(field => attemptedFields.add(field));
          const values = [binding.entry.startDate, binding.entry.endDate];
          const hasValue = fields.some(fieldHasValue);
          const written = !hasValue && await fillAntDateRange(fields, values, { ...opts, signal, task });
          for (const endpoint of endpoints) {
            const kept = hasValue && fieldHasValue(endpoint.input);
            const status = written ? 'filled' : kept ? 'skipped_has_value' : 'needs_review';
            const reason = written || kept ? '' : endpoint.input.hasAttribute('data-job-autofill-manual') ? 'date_precision_required' : 'range_not_committed';
            if (written) filledCount++;
            results.push(fillResultEntry(endpoint.input, endpoint.detection, status, reason));
          }
          continue;
        }
        results.push(fillResultEntry(input, detection, 'needs_review', 'range_not_committed'));
        continue;
      }
      if (input.type === 'radio') {
        if (handledRadios.has(input)) continue;
        for (const radio of radioGroup(input)) handledRadios.add(radio);
      }

    // 多段经历换项检测
    if (fieldType === 'projectName') {
      if (seenProjNames > 0) currentProjIdx++;
      seenProjNames++;
    } else if (fieldType === 'company') {
      if (seenCompanies > 0) currentWorkIdx++;
      seenCompanies++;
    } else if (fieldType === 'school') {
      if (seenSchools > 0) currentEduIdx++;
      seenSchools++;
    } else if (fieldType === 'familyName') {
      if (seenFamilyNames > 0) currentFamilyIdx++;
      seenFamilyNames++;
    } else if (fieldType === 'certificates') {
      if (seenCertificates > 0) currentCertificateIdx++;
      seenCertificates++;
    } else if (fieldType === 'paperName') {
      if (seenPaperNames > 0) currentPaperIdx++;
      seenPaperNames++;
    } else if (fieldType === 'patentName') {
      if (seenPatentNames > 0) currentPatentIdx++;
      seenPatentNames++;
    }

      const preserveExisting = binding || input.type !== 'checkbox' &&
        (input.type !== 'radio' || incremental || input.closest('.tec-radio-group'));
      if (preserveExisting && fieldHasValue(input)) {
        const invalidCompetition = binding?.key === 'name' && binding?.module.section === 'awards' &&
          getClosestLabelText(input) === '竞赛名称' && !verifyFieldWrite(input, input.value);
        results.push(fillResultEntry(input, detection, invalidCompetition ? 'needs_review' : 'skipped_has_value',
          invalidCompetition ? 'validation_failed' : '已有值，保持不变'));
        continue;
      }
      if (binding && (!binding.entry || !binding.key)) {
        results.push(fillResultEntry(input, detection, 'needs_review', binding.key ? 'record_ambiguous' : 'unrecognized_field'));
        continue;
      }

    // 获取当前项目数据
    const scoped = offerLinkCardEntry(input, offerLinkEntries);
    const proj = (scoped?.section === 'projects' ? scoped.entry : projList[currentProjIdx]) || {};
    const smartProj = projectParts.get(proj) || {};
    const projStart = date(proj.startDate);
    const projEnd = date(proj.endDate);

    const work = (scoped?.section === 'workExperience' ? scoped.entry : workList[currentWorkIdx]) || {};
    const smartWork = workParts.get(work) || {};
    const workStart = date(work.startDate);
    const workEnd = date(work.endDate);

    // 获取当前教育数据
    const edu = (scoped?.section === 'education' ? scoped.entry : eduList[currentEduIdx]) || {};
    const eduStart = date(edu.startDate);
    const eduEnd = date(edu.endDate);
    const tableField = duoyiTableField(input);
    const family = (tableField ? duoyiFamilyEntries.get(tableField.row)?.entry : familyList[currentFamilyIdx]) || {};
    const certificate = (scoped?.section === 'certificates' ? scoped.entry : certificateList[currentCertificateIdx]) || {};
    const paper = paperList[currentPaperIdx] || paperList[0] || {};
    const patent = patentList[currentPatentIdx] || patentList[0] || {};

    let valueToFill = null;
    const isSelect = input.tagName.toLowerCase() === 'select';

    // 根据字段类型填充对应的值
    if (binding) valueToFill = repeatFieldValue(binding.entry, binding.key);
    else switch (fieldType) {
      // 基础信息
      case 'fullName':
        valueToFill = profile.basicInfo?.fullName;
        break;
      case 'firstName':
        valueToFill = profile.basicInfo?.firstName;
        break;
      case 'lastName':
        valueToFill = profile.basicInfo?.lastName;
        break;
      case 'middleName':
        valueToFill = profile.basicInfo?.middleName;
        break;
      case 'phone':
        valueToFill = profile.basicInfo?.phone;
        break;
      case 'phoneType':
        valueToFill = profile.basicInfo?.phoneType;
        break;
      case 'email':
        valueToFill = profile.basicInfo?.email;
        break;
      case 'gender':
        valueToFill = profile.basicInfo?.gender;
        break;
      case 'birthDate':
        valueToFill = profile.basicInfo?.birthDate;
        break;
      case 'idCard': {
        const type = questionContainer(input)?.querySelector('.tec-select__input');
        if (input.matches('.tec-input__inner') && type &&
            !fieldOptionEquals(getClosestLabelText(input), widgetSelectCurrentValue(type), profileDocumentType)) break;
        valueToFill = profile.basicInfo?.idCard;
        break;
      }
      case 'politicalStatus':
        valueToFill = profile.basicInfo?.politicalStatus;
        break;
      case 'ethnicity':
        valueToFill = profile.basicInfo?.ethnicity;
        break;
      case 'hometown':
        valueToFill = profile.basicInfo?.hometown;
        break;
      case 'graduationDate':
        valueToFill = profile.basicInfo?.graduationDate;
        break;
      case 'highestDegree':
      case 'highestSchool':
      case 'highestMajor':
      case 'highestGraduation': {
        const key = { highestDegree:'degree', highestSchool:'school', highestMajor:'major', highestGraduation:'endDate' }[fieldType];
        valueToFill = highestEducation?.[key];
        break;
      }
      case 'maritalStatus':
        valueToFill = profile.basicInfo?.maritalStatus;
        break;
      case 'currentCity':
        valueToFill = profile.basicInfo?.currentCity;
        break;

      // 塔塔网申对齐扩展字段（同名资料为空时按语义回退到既有字段，保持旧数据可用）
      case 'englishName':
        valueToFill = profile.basicInfo?.englishName;
        break;
      case 'wechat':
        valueToFill = profile.basicInfo?.wechat;
        break;
      case 'qq':
        valueToFill = profile.basicInfo?.qq;
        break;
      case 'idCardType':
        valueToFill = profileDocumentType;
        break;
      case 'imContactType':
      case 'imContactAccount': {
        const item = questionContainer(input);
        const type = item?.querySelector('.tec-select__input');
        const account = item?.querySelector('.tec-input__inner');
        if (!type || !account) break;
        if (fieldType === 'imContactType') {
          if (!fieldHasValue(account)) valueToFill = profile.basicInfo?.wechat ? '微信号' : profile.basicInfo?.qq ? 'QQ号' : '';
        } else {
          const selected = widgetSelectCurrentValue(type);
          if (/^微信(?:号)?$/.test(selected)) valueToFill = profile.basicInfo?.wechat;
          if (/^qq(?:号)?$/i.test(selected)) valueToFill = profile.basicInfo?.qq;
        }
        break;
      }
      case 'bloodType':
        valueToFill = profile.basicInfo?.bloodType;
        break;
      case 'registeredAddressType':
        valueToFill = profile.basicInfo?.registeredAddressType;
        break;
      case 'religion':
        valueToFill = profile.basicInfo?.religion;
        break;
      case 'honor':
        valueToFill = profile.basicInfo?.honor ||
          (Array.isArray(profile.awards) && profile.awards.length
            ? profile.awards.map(a => `${a.date || ''} ${a.name}${a.level ? ` (${a.level})` : ''}`.trim()).join('；')
            : '');
        break;
      case 'specialSkills':
        valueToFill = profileSkillText(profile, ', ');
        break;
      case 'duoyiSkill':
      case 'duoyiSkillProficiency': {
        const firstSkill = profileSkillEntries(profile).find(item => item.name);
        const skill = firstSkill?.name || String(profile.basicInfo?.specialSkills || '').split(/\r?\n|[；;]/)
          .map(part => part.trim()).find(Boolean);
        if (tableField?.row.sectionRowIndex !== 1 || !skill) break;
        if (fieldType === 'duoyiSkill') valueToFill = skill;
        else {
          const displayedSkill = tableField.row.cells[0]?.querySelector('input')?.value.trim();
          if (displayedSkill === skill) valueToFill = firstSkill?.proficiency || profile.basicInfo?.specialSkillProficiency;
        }
        break;
      }
      case 'openToWork':
        valueToFill = profile.basicInfo?.openToWork;
        break;
      case 'permanentResidencePermit':
        valueToFill = profile.basicInfo?.permanentResidencePermit;
        break;
      case 'jobSources':
        valueToFill = profile.basicInfo?.jobSources || profile.jobIntention?.recruitSource;
        break;
      case 'foreignCitizenship':
        valueToFill = profile.basicInfo?.foreignCitizenship;
        break;
      case 'relativesEmployed':
        valueToFill = profile.basicInfo?.relativesEmployed;
        break;
      case 'yearsOfWork':
        valueToFill = profile.basicInfo?.yearsOfWork;
        break;
      case 'lastNamePinyin':
        valueToFill = profile.basicInfo?.lastNamePinyin;
        break;
      case 'firstNamePinyin':
        valueToFill = profile.basicInfo?.firstNamePinyin;
        break;
      case 'namePinyinFull':
        valueToFill = profile.basicInfo?.namePinyinFull;
        break;
      case 'personalPromise':
        valueToFill = profile.basicInfo?.personalPromise;
        break;
      case 'age':
        // 年龄不落库，按出生日期动态推算；birthDate 缺失返回空串即不填
        valueToFill = computeAgeFromBirthDate(profile.basicInfo?.birthDate, new Date());
        break;
      case 'emergencyContact':
        valueToFill = profile.basicInfo?.emergencyContact;
        break;
      case 'emergencyRelation':
        valueToFill = profile.basicInfo?.emergencyRelation;
        break;
      case 'emergencyPhone':
        valueToFill = profile.basicInfo?.emergencyPhone;
        break;

      // 求职意向
      case 'expectedCity':
        valueToFill = profile.jobIntention?.expectedCity;
        break;
      case 'expectedPosition':
        valueToFill = profile.jobIntention?.expectedPosition;
        break;
      case 'expectedSalary':
        if (/年薪|月薪/.test(getClosestLabelText(input)) && (!profile.jobIntention?.salaryPeriod || !getClosestLabelText(input).includes(profile.jobIntention.salaryPeriod) || !profile.jobIntention.salaryUnit)) {
          if (profile.jobIntention?.expectedSalary) markManual(input, `${profile.jobIntention.expectedSalary}（请确认薪资周期和单位）`);
          break;
        }
        valueToFill = profile.jobIntention?.expectedSalary;
        break;
      case 'availableDate':
        valueToFill = profile.jobIntention?.availableDate;
        break;
      case 'referralCode':
        valueToFill = profile.jobIntention?.referralCode;
        break;
      case 'recruitSource':
        valueToFill = profile.jobIntention?.recruitSource || profile.basicInfo?.jobSources;
        break;
      case 'willingToTravel':
        valueToFill = profile.jobIntention?.willingToTravel;
        break;

      // 语言外语
      case 'cet4':
      case 'cet6':
      case 'ielts':
      case 'toefl':
      case 'otherLanguages':
        valueToFill = languageScores[fieldType];
        break;

      // 荣誉奖项
      case 'awards':
        if (/^(荣誉奖项|奖项荣誉|获奖经历|获奖情况|奖励情况|获奖信息|awards)$/i.test(getClosestLabelText(input)) &&
            Array.isArray(profile.awards) && profile.awards.length) {
          valueToFill = profile.awards.map(a => `${a.date || ''} ${a.name}${a.level ? ` (${a.level})` : ''}`.trim()).join('；');
        }
        break;
      case 'certificates':
        valueToFill = certificate.name;
        break;
      case 'skillName':
      case 'skillProficiency': {
        const entries = profileSkillEntries(profile).filter(item => item.name);
        if (entries.length === 1) valueToFill = entries[0][fieldType === 'skillName' ? 'name' : 'proficiency'];
        break;
      }
      case 'certificateCode':
        valueToFill = certificate.code;
        break;
      case 'certificateIssuer':
        valueToFill = certificate.issuer;
        break;
      case 'certificateDate':
        valueToFill = certificate.date;
        break;
      case 'certificateExpiryDate':
        valueToFill = certificate.expiryDate;
        break;
      case 'familyName':
        valueToFill = family.name;
        break;
      case 'familyRelation':
        valueToFill = family.relation;
        if (tableField && /^(父亲|母亲)$/.test(familyRelationKey(valueToFill)) && /^(男|女)$/.test(profile.basicInfo?.gender)) {
          valueToFill = familyRelationKey(valueToFill)[0] + (profile.basicInfo.gender === '男' ? '子' : '女');
        }
        break;
      case 'familyAge':
        valueToFill = family.age || (elementDateParts(family.birthDate)?.[2]
          ? computeAgeFromBirthDate(family.birthDate, new Date()) : '');
        break;
      case 'familyOccupation':
        valueToFill = family.occupation;
        break;
      case 'familyEmployer':
        valueToFill = family.employer;
        break;
      case 'familyPosition':
        valueToFill = family.position;
        break;
      case 'familyPhone':
        valueToFill = family.phone;
        break;

      // 论文与成果
      case 'paperName':
        valueToFill = paper.name;
        break;
      case 'paperPublisher':
        valueToFill = paper.publisher;
        break;
      case 'paperDate':
        valueToFill = paper.date;
        break;
      case 'paperAbstract':
        valueToFill = paper.abstract;
        break;
      case 'paperUrl':
        valueToFill = paper.url;
        break;
      case 'paperAuthorOrder':
        valueToFill = paper.authorOrder;
        break;
      case 'paperRole':
        valueToFill = paper.role;
        break;
      case 'patentName':
        valueToFill = patent.name;
        break;
      case 'patentInventor':
        valueToFill = patent.inventor;
        break;
      case 'patentDate':
        valueToFill = patent.date;
        break;
      case 'patentDescription':
        valueToFill = patent.description;
        break;
      case 'patentUrl':
        valueToFill = patent.url;
        break;

      // 地址信息
      case 'street':
        valueToFill = profile.basicInfo?.street;
        break;
      case 'city':
        valueToFill = profile.basicInfo?.city;
        break;
      case 'state':
        valueToFill = profile.basicInfo?.state;
        break;
      case 'country':
        valueToFill = profile.basicInfo?.country || profile.basicInfo?.nationality;
        break;
      case 'zipCode':
        valueToFill = profile.basicInfo?.zipCode;
        break;
      case 'location':
        valueToFill = profile.basicInfo?.location || profile.basicInfo?.address ||
                      `${profile.basicInfo?.city || ''} ${profile.basicInfo?.state || ''}`.trim();
        break;

      // 社交链接
      case 'linkedin':
        valueToFill = profile.basicInfo?.linkedin;
        break;
      case 'github':
        valueToFill = profile.basicInfo?.github;
        break;
      case 'website':
        valueToFill = profile.basicInfo?.website;
        break;
      case 'twitter':
        valueToFill = profile.basicInfo?.twitter;
        break;

      // 教育信息 (支持多段教育经历与起止年月)
      case 'school':
        valueToFill = edu.school;
        break;
      case 'college':
        valueToFill = edu.college;
        break;
      case 'major':
        valueToFill = edu.major;
        break;
      case 'academicDegree': valueToFill = edu.academicDegree; break;
      case 'secondMajor': valueToFill = edu.secondMajor; break;
      case 'sourcePlace': valueToFill = profile.basicInfo?.sourcePlace; break;
      case 'registeredAddress': valueToFill = profile.basicInfo?.registeredAddress; break;
      case 'degree':
        valueToFill = edu.degree;
        break;
      case 'degreeType':
        valueToFill = edu.degreeType;
        break;
      case 'schoolType':
        valueToFill = edu.schoolType;
        break;
      case 'gpa':
        valueToFill = edu.gpa;
        break;
      case 'rank':
        valueToFill = edu.rank;
        break;
      case 'courses':
        valueToFill = edu.courses;
        break;
      case 'educationDescription':
        valueToFill = edu.description;
        break;
      case 'eduDateRange':
        valueToFill = [eduStart.full || edu.startDate, eduEnd.full || edu.endDate].filter(Boolean).join(' 至 ');
        break;
      case 'eduStartDate':
        if (isSelect) {
          const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
          valueToFill = hasYears ? eduStart.year : (eduStart.month || eduStart.padMonth);
        } else {
          valueToFill = eduStart.full || edu.startDate;
        }
        break;
      case 'eduEndDate':
        if (isSelect) {
          const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
          valueToFill = hasYears ? eduEnd.year : (eduEnd.month || eduEnd.padMonth);
        } else {
          valueToFill = eduEnd.full || edu.endDate;
        }
        break;

      // 工作/实习经验 (支持多段经历与职责/产出解耦)
      case 'company':
        valueToFill = work.company;
        break;
      case 'department':
        valueToFill = work.department;
        break;
      case 'position':
        valueToFill = work.position;
        break;
      case 'workCity':
        valueToFill = work.city;
        break;
      case 'workDateRange':
        valueToFill = [workStart.full || work.startDate, workEnd.full || work.endDate].filter(Boolean).join(' 至 ');
        break;
      case 'workStartDate':
        if (isSelect) {
          const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
          valueToFill = hasYears ? workStart.year : (workStart.month || workStart.padMonth);
        } else {
          valueToFill = workStart.full || work.startDate;
        }
        break;
      case 'workEndDate':
        if (isSelect) {
          const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
          valueToFill = hasYears ? workEnd.year : (workEnd.month || workEnd.padMonth);
        } else {
          valueToFill = workEnd.full || work.endDate;
        }
        break;
      case 'workType':
        valueToFill = work.workType;
        break;
      case 'workDescription':
        valueToFill = [smartWork.description, !hasSeparateWorkAchieve && smartWork.achievements].filter(Boolean).join('\n');
        break;
      case 'workAchievements':
        valueToFill = smartWork.achievements;
        break;

      // 项目经验 (支持多段项目与背景/职责/成果/技术栈智能拆分)
      case 'projectName':
        valueToFill = proj.name;
        break;
      case 'projectRole':
        valueToFill = smartProj.role || proj.role;
        break;
      case 'techStack':
        valueToFill = smartProj.techStack || proj.techStack;
        break;
      case 'projectUrl':
        valueToFill = proj.projectUrl;
        break;
      case 'portfolioLinks':
        valueToFill = [...new Set([profile.basicInfo?.github, profile.basicInfo?.website,
          ...(profile.projects || []).map(p => p.projectUrl)].filter(Boolean))].join('\n');
        break;
      case 'projectDateRange':
        valueToFill = [projStart.full || proj.startDate, projEnd.full || proj.endDate].filter(Boolean).join(' 至 ');
        break;
      case 'projectStartDate':
        if (isSelect) {
          const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
          valueToFill = hasYears ? projStart.year : (projStart.month || projStart.padMonth);
        } else {
          valueToFill = projStart.full || proj.startDate;
        }
        break;
      case 'projectEndDate':
        if (isSelect) {
          const hasYears = Array.from(input.options).some(o => /^\d{4}/.test(o.value || o.text));
          valueToFill = hasYears ? projEnd.year : (projEnd.month || projEnd.padMonth);
        } else {
          valueToFill = projEnd.full || proj.endDate;
        }
        break;
      case 'projectResponsibilities':
        // 独立「项目中职责」项，优先填入个人具体工作/职责部分
        valueToFill = smartProj.responsibilities || proj.responsibilities;
        break;
      case 'projectAchievements':
        // 独立「项目成果/业绩」项
        valueToFill = smartProj.achievements || proj.achievements;
        break;
      case 'projectDescription':
        valueToFill = [
          smartProj.description,
          !hasSeparateTechStack && smartProj.techStack && `技术栈：${smartProj.techStack}`,
          !hasSeparateProjResp && smartProj.responsibilities,
          !hasSeparateProjAchieve && smartProj.achievements && `项目成果：${smartProj.achievements}`
        ].filter(Boolean).join('\n');
        break;

      // 技能
      case 'skills':
        valueToFill = profileSkillText(profile, ', ');
        break;

      // 自我介绍
      case 'introduction':
        valueToFill = profile.introTemplates?.default || '';
        break;

      default: {
        const extended = (detection?.fieldType || '').match(/^extended:([^:]+):([^:]+)$/);
        if (extended) {
          const section = extended[1];
          const key = extended[2];
          if (section === 'basicInfo') valueToFill = home[key] ?? profile.basicInfo?.[key];
          else if (section === 'jobIntention') valueToFill = profile.jobIntention?.[key];
          else {
            const target = scoped || extendedEntry(input, profile);
            const isBasicSchoolAddress = !scoped && section === 'education' &&
              ['schoolProvince', 'schoolCity', 'schoolDistrict'].includes(key);
            if (target.section === section || isBasicSchoolAddress) {
              let sourceEntry = target.entry;
              // 基础信息里的学校地址指向当前/第一份有效教育，不消费主循环教育索引。
              if (!sourceEntry && isBasicSchoolAddress) {
                sourceEntry = validExtendedEntries(profile, 'education')[0];
              }
              if (key === '__combined') {
                const duties = section === 'projects' ? sourceEntry?.responsibilities : sourceEntry?.description;
                valueToFill = [duties, sourceEntry?.achievements].filter(Boolean).join('\n');
              }
              else if (sourceEntry && section === 'languageCertificates' && key === 'level' && isResumeEditor &&
                (input.tagName === 'SELECT' || isSelectWidget(input))) {
                valueToFill = LANGUAGE_EXAMS[languageEntryExam(sourceEntry)]?.name;
              } else valueToFill = sourceEntry?.[key];
            }
          }
        }
        break;
      }
    }

      if (LEGACY_LANGUAGE_SCORES.includes(fieldType) && !languageScoreKey(valueToFill) && languageEntries.some(item =>
        languageEntryExam(item) === fieldType && languageScoreKey(item.score))) {
        attemptedFields.add(input);
        results.push(fillResultEntry(input, detection, 'needs_review', 'language_score_ambiguous'));
        continue;
      }
      if (input.type === 'number' && (LEGACY_LANGUAGE_SCORES.includes(fieldType) || fieldType === 'extended:languageCertificates:score') &&
          languageScoreKey(valueToFill)) {
        const score = languageScoreKey(valueToFill);
        if (!/^\d+(?:\.\d+)?$/.test(score)) {
          attemptedFields.add(input);
          results.push(fillResultEntry(input, detection, 'needs_review', 'numeric_score_required', valueToFill));
          continue;
        }
        valueToFill = score;
      }
      if (valueToFill && input.closest('.el-cascader')) {
        const parts = {
          'extended:basicInfo:homeProvince': [home.homeCity, home.homeDistrict],
          'extended:education:schoolProvince': [
            (scoped?.entry || (!scoped && eduList[0]))?.schoolCity,
            (scoped?.entry || (!scoped && eduList[0]))?.schoolDistrict
          ]
        }[fieldType];
        if (parts) valueToFill = [valueToFill, ...parts].filter(Boolean).join(' / ');
      }
      if (valueToFill !== null && valueToFill !== undefined && String(valueToFill).trim() !== '') {
        if ((fieldType === 'rank' || (binding?.module?.section === 'education' && binding.key === 'rank')) && isSelectWidget(input)) {
          valueToFill = educationRankOptionValue(getClosestLabelText(input), valueToFill);
        }
        attemptedFields.add(input);
        const fieldController = new AbortController();
        const abortField = () => fieldController.abort();
        signal.addEventListener('abort', abortField, { once: true });
        try {
          const outcome = await withTimeout(
            fillField(input, valueToFill, {
              signal: fieldController.signal,
              task,
              deferVerification: (field, until) => recheckFields.set(field, until),
              openTimeoutMs: opts.openTimeoutMs || 1200
            }),
            opts.fieldTimeoutMs || 8000,
            abortField,
            task
          );
          if (outcome.timedOut) {
            results.push(fillResultEntry(input, detection, 'failed', 'field_timeout', valueToFill));
          } else if (outcome.error) {
            throw outcome.error;
          } else if (outcome.value) {
            filledCount++;
            clearManualHint(input);
            const confirmedValue = getClosestLabelText(input) === '竞赛名称' ? input.value : valueToFill;
            results.push(fillResultEntry(input, detection, 'filled', '', confirmedValue));
            input.style.backgroundColor = '#e8f5e9';
            input.style.outline = '2px solid #4caf50';
          } else {
            const reason = input.getAttribute('data-easyoffer-write-reason') ||
              (/请确认(?:具体|完整)日期/.test(input.getAttribute('data-job-autofill-manual') || '') ? 'date_precision_required' : 'write_failed_or_option_not_found');
            results.push(fillResultEntry(input, detection, 'needs_review', reason, valueToFill));
          }
        } finally {
          signal.removeEventListener('abort', abortField);
        }
      } else {
        results.push(fillResultEntry(input, detection, 'needs_review', 'no_profile_value'));
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      results.push(fillResultEntry(input, detection, 'failed', error?.message || String(error)));
      if (typeof appLog !== 'undefined') {
        appLog.warn('content', 'fill.field_error', `单字段失败，继续后续字段: ${detection?.fieldType || 'unknown'}`, error?.message || String(error));
      }
    }
  }

  task.stage = 'supplement';
  await waitForFillCheckpoint(task);
  throwIfFillCancelled(signal);
  try {
    filledCount += await fillYearMonthWidgets(profile, { ...opts, signal, mode, task });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    results.push(fillResultEntry(null, null, 'failed', `年月控件：${error?.message || error}`));
  }
  await waitForFillCheckpoint(task);
  try {
    filledCount += await fillExtendedFields(profile, { ...opts, signal, mode, task, attemptedFields, results, offerLinkEntries });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    results.push(fillResultEntry(null, null, 'failed', `扩展字段：${error?.message || error}`));
  }
  for (const input of unmappedFields) {
    if (input.isConnected && !fieldHasValue(input)) {
      results.push(fillResultEntry(input, null, 'needs_review', 'unrecognized_field'));
    }
  }
  if (!incremental) {
    await waitForFillCheckpoint(task);
    try {
      await handleResumeUpload(profile);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      results.push(fillResultEntry(null, null, 'failed', `附件：${error?.message || error}`));
    }
  }

  if (recheckFields.size) {
    const remaining = Math.max(...recheckFields.values()) - Date.now();
    if (remaining > 0) await sleep(remaining);
    await waitForFillCheckpoint(task);
  }
  for (const row of results) {
    if (row.status !== 'filled' || !recheckFields.has(row.element) || verifyFieldWrite(row.element, row.value)) continue;
    row.status = 'needs_review';
    row.reason = row.element.getAttribute('data-easyoffer-write-reason') || 'value_reset';
    row.element.style.removeProperty('outline');
    row.element.style.removeProperty('background-color');
    filledCount--;
  }

  console.log(`[易offer] 填充完成: ${filledCount} 个字段`);
  if (typeof appLog !== 'undefined') {
    appLog.success('content', 'fill.done', `页面填充完成，${filledCount} 个字段`, { url: location.href });
    appLog.info('content', 'fill.performance', `填写耗时 ${Date.now() - fillStartedAt}ms`, structureResult || {});
  }

  // 显示通知
  const manualFields = [...new Set([...document.querySelectorAll('[data-job-autofill-manual]')]
    .map(el => el.getAttribute('data-job-autofill-manual')))];
  if (structureResult?.manual?.length) manualFields.push(...structureResult.manual);
  const reviewTotal = results.filter(item => item.status === 'needs_review' || item.status === 'failed').length;
  let message = `已自动填充 ${filledCount} 个字段`;
  if (manualFields.length) message += ` · 请手动选择：${manualFields.join('、')}`;
  else if (reviewTotal) message += ` · ${reviewTotal} 项待人工核对`;
  else if (!filledCount) message += ' · 没有新增填入，已有内容保持不变';
  showNotification(message, manualFields.length || reviewTotal ? 'warning' : 'success');

  const summary = {
    filledCount,
    results,
    manualFields,
    mode,
    cancelled: signal.aborted,
    skippedCount: results.filter(item => item.status === 'skipped_has_value').length,
    reviewCount: results.filter(item => item.status === 'needs_review').length,
    failedCount: results.filter(item => item.status === 'failed').length,
    structure: structureResult,
    durationMs: Date.now() - fillStartedAt
  };
  if (typeof showYanyuTaskResult === 'function') showYanyuTaskResult(summary);
  return summary;
  } finally {
    if (ownsTask) finishActiveFillTask(task);
    dismissOpenDropdownPanels();
  }
}

var  JOB_TITLE_HINT = /工程师|开发|算法|产品|运营|设计|测试|管培|专员|经理|助理|分析师|研究员|架构师|实习|前端|后端|全栈|数据|策划|美术|原画|安全|运维|大模型|\bAI\b|游戏|客户端|服务端|量化|策略|增长|投放|审核|编辑|翻译|法务|财务|人力|HR|研发|技术|软件|硬件|嵌入式|芯片|通信|网络|自动化|机械|电气|材料|工艺|销售|商务|BD|市场|公关|客服|风控|会计|审计|采购|物流|供应链|行政|文员|顾问|教研|教师|导师|主管|总监|负责人|Leader|应届生|储备干部|管培生/;
var  JUNK_COMPANY_RE = /^(校园招聘|校招|社招|社会招聘|招聘官网|招聘|官方网站|网申系统|应届生招聘|招聘首页|登录|注册|首页|职位详情|网申|投递记录|人才招聘|mokahr|beisen|dayee|51job|zhaopin|liepin|nowcoder|boss直聘|申请职位|职位申请)$/i;
var  JUNK_POSITION_RE = /^(工作职责|岗位职责|任职要求|任职资格|岗位要求|职位描述|职位详情|投递信息|基本信息|个人信息|教育背景|工作经历|项目经历|荣誉奖励|附件简历|求职意向|账号设置|个人中心|申请表单|申请信息|填写信息|校园招聘|校招|社会招聘|登录|注册|首页|网申|校招首页|工作地点|工作城市|工作性质|工作经验|所属部门|所属业务线|职位类别|职位类型|职位方向|招聘人数|发布时间|更新时间|薪资待遇|薪酬范围|学历要求|招聘对象|投递岗位|申请职位|应聘职位|应聘岗位|目标职位|选择职位|立即申请|立即投递|投递简历|投递表单|简历预览|简历填写|查看更多|返回列表|暂无职位|暂无数据|职位列表|全部职位|搜索职位|招聘动态|招聘公告|关于我们|加入我们|人才招聘|招聘系统|海外招聘|内推专区|职位名称|岗位名称)$/i;
var  KNOWN_COMPANIES = [
  { match: /37\.com|37wan|\/37\/|37interactive|三七/i, name: '三七互娱' },
  { match: /tencent|\/tencent\//i, name: '腾讯' },
  { match: /bytedance|douyin|\/bytedance\//i, name: '字节跳动' },
  { match: /alibaba|aliyun|taobao|tmall|\/alibaba\//i, name: '阿里巴巴' },
  { match: /meituan|\/meituan\//i, name: '美团' },
  { match: /baidu|\/baidu\//i, name: '百度' },
  { match: /kuaishou|\/kuaishou\//i, name: '快手' },
  { match: /xiaohongshu|\/xiaohongshu\//i, name: '小红书' },
  { match: /pinduoduo|pdd|\/pdd\//i, name: '拼多多' },
  { match: /jd\.com|\/jd\//i, name: '京东' },
  { match: /huawei|\/huawei\//i, name: '华为' },
  { match: /xiaomi|mi\.com|\/xiaomi\//i, name: '小米' },
  { match: /bilibili|\/bilibili\//i, name: '哔哩哔哩' },
  { match: /netease|163\.com|\/netease\//i, name: '网易' },
  { match: /didi|\/didi\//i, name: '滴滴' },
  { match: /oppo|\/oppo\//i, name: 'OPPO' },
  { match: /vivo|\/vivo\//i, name: 'vivo' },
  { match: /honor|\/honor\//i, name: '荣耀' },
  { match: /nio|\/nio\//i, name: '蔚来' },
  { match: /lixiang|liuto|\/lixiang\//i, name: '理想汽车' },
  { match: /xiaopeng|xpeng|\/xiaopeng\//i, name: '小鹏汽车' },
  { match: /byd|\/byd\//i, name: '比亚迪' },
  { match: /antgroup|\/antgroup\//i, name: '蚂蚁集团' },
  { match: /shopee|\/shopee\//i, name: 'Shopee' },
  { match: /shein|\/shein\//i, name: 'SHEIN' },
  { match: /mihoyo|\/mihoyo\//i, name: '米哈游' },
  { match: /moonshot/i, name: '月之暗面' },
  { match: /cmbchina|cmb/i, name: '招商银行' },
  { match: /icbc/i, name: '工商银行' },
  { match: /ccb\.com/i, name: '建设银行' },
  { match: /boc\.cn/i, name: '中国银行' },
  { match: /abchina/i, name: '农业银行' },
  { match: /pingan/i, name: '中国平安' }
];

function currentJobId() {
  const hash = location.hash || '';
  const m = hash.match(/job\/([a-z0-9-]+)/i);
  return (m && m[1]) || '';
}

function cleanPositionName(text) {
  if (!text) return '';
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/【.*?】|\[.*?\]|（.*?届.*?）|\(.*?\d{4}.*?\)/g, ' ')
    .replace(/^(?:应聘职位|申请岗位|投递职位|应聘岗位|目标职位|申请职位|职位名称|岗位名称|招聘岗位|招聘职位)[：:\s]+/g, '')
    .replace(/^[\s·\-_|:：、/]+|[\s·\-_|:：、/]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePosition(text) {
  const t = cleanPositionName(text);
  if (t.length < 2 || t.length > 50) return false;
  if (JUNK_POSITION_RE.test(t)) return false;
  if (JUNK_COMPANY_RE.test(t)) return false;
  if (KNOWN_COMPANIES.some((c) => c.name === t)) return false;
  return true;
}

function readJsonLdJob() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent || 'null');
      const items = Array.isArray(data) ? data : [data, data && data['@graph']].flat().filter(Boolean);
      for (const item of items) {
        if (item && (item['@type'] === 'JobPosting' || /JobPosting/i.test(String(item['@type'] || '')))) {
          return {
            position: String(item.title || '').trim(),
            company: String(item.hiringOrganization?.name || '').trim()
          };
        }
      }
    } catch {}
  }
  return null;
}

function readPositionFromMeta() {
  const selectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    'meta[name="job-title"]',
    'meta[name="jobTitle"]',
    'meta[itemprop="title"]'
  ];
  for (const el of document.querySelectorAll(selectors.join(','))) {
    const parts = String(el.getAttribute('content') || '')
      .split(/[-_|—–\t]|\s+\/\s+/)
      .map(cleanPositionName)
      .filter(Boolean);
    for (const part of parts) {
      if (looksLikePosition(part) && JOB_TITLE_HINT.test(part)) return part;
    }
  }
  return null;
}

function readPositionFromUrl() {
  try {
    const search = new URLSearchParams(window.location.search);
    const hashStr = window.location.hash ? window.location.hash.split('?')[1] : '';
    const hashParams = hashStr ? new URLSearchParams(hashStr) : null;

    const keys = ['jobName', 'positionName', 'jobTitle', 'position', 'postName', 'recruitPostName', 'job_name', 'job_title', 'pos_name', 'post_name', 'title'];
    for (const k of keys) {
      let val = search.get(k) || (hashParams && hashParams.get(k));
      if (val) {
        try { val = decodeURIComponent(val); } catch {}
        val = cleanPositionName(val);
        if (looksLikePosition(val) && (JOB_TITLE_HINT.test(val) || val.length <= 24)) {
          return val;
        }
      }
    }
  } catch {}
  return null;
}

function readPositionFromFormInputs() {
  try {
    const inputs = document.querySelectorAll('input[name*="position" i], input[name*="job" i], input[name*="post" i], input[id*="position" i], input[id*="job" i], input[id*="post" i], [class*="apply-position"] input, [class*="applyPosition"] input');
    for (const inp of inputs) {
      if (inp.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
      const marker = `${inp.name || ''} ${inp.id || ''} ${inp.className || ''}`;
      if (/work|experience|intern|resume|history|经历|实习/i.test(marker)) continue;
      if (!inp.readOnly && !inp.disabled && inp.type !== 'hidden' && !/apply|target|current|recruit|应聘|申请|目标/i.test(marker)) continue;
      const val = cleanPositionName(inp.value || inp.getAttribute('value') || inp.placeholder);
      if (looksLikePosition(val) && (JOB_TITLE_HINT.test(val) || val.length <= 24)) {
        return val;
      }
    }

    const labels = document.querySelectorAll('label, .ant-form-item-label, .el-form-item__label, [class*="form-label"], [class*="item-label"]');
    for (const lbl of labels) {
      if (lbl.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
      const txt = lbl.textContent.trim();
      if (/应聘职位|申请岗位|投递职位|应聘岗位|目标职位|申请职位|职位名称|岗位名称/.test(txt)) {
        const item = lbl.closest('.ant-form-item, .el-form-item, .form-item, .form-group, [class*="formItem"], tr, div');
        if (item) {
          const valEl = item.querySelector('input, select, .ant-form-item-control, .el-form-item__content, [class*="value"], [class*="content"]');
          if (valEl) {
            const genericLabel = /^(?:职位名称|岗位名称)[：:]?$/.test(txt.replace(/\s+/g, ''));
            if (genericLabel && valEl.matches?.('input, select, textarea') && !valEl.readOnly && !valEl.disabled) continue;
            const val = cleanPositionName(valEl.value || valEl.textContent);
            if (looksLikePosition(val) && !/职位名称|岗位名称/.test(val)) {
              return val;
            }
          }
        }
      }
    }
  } catch {}
  return null;
}

function readPositionFromBreadcrumbs() {
  try {
    const crumbContainers = document.querySelectorAll('.breadcrumb, .breadcrumbs, .ant-breadcrumb, .el-breadcrumb, .arco-breadcrumb, .semi-breadcrumb, [class*="breadcrumb" i], [class*="Breadcrumb"]');
    for (const container of crumbContainers) {
      if (container.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
      const items = container.querySelectorAll('li, a, span, [class*="item"]');
      if (items.length > 1) {
        for (let i = items.length - 1; i >= 0; i--) {
          const text = cleanPositionName(items[i].textContent);
          if (looksLikePosition(text) && (JOB_TITLE_HINT.test(text) || text.length <= 24)) {
            return text;
          }
        }
      }
    }
  } catch {}
  return null;
}

function saveJobMeta(meta) {
  try {
    if (!meta) return;
    const prev = loadJobMeta() || {};
    const newPos = (meta.position && looksLikePosition(meta.position)) ? cleanPositionName(meta.position) : (prev.position || '');
    const newComp = (meta.company && meta.company !== '未知企业') ? meta.company.trim() : (prev.company || '未知企业');
    if (!newPos && (!newComp || newComp === '未知企业')) return;

    const jobId = currentJobId() || location.pathname;
    const merged = { company: newComp, position: newPos, jobId, savedAt: Date.now() };
    sessionStorage.setItem('capybaraJobMeta', JSON.stringify(merged));
  } catch {}
}

function loadJobMeta() {
  try {
    const raw = sessionStorage.getItem('capybaraJobMeta');
    if (!raw) return null;
    const meta = JSON.parse(raw);
    return meta && (meta.position || meta.company) ? meta : null;
  } catch {
    return null;
  }
}

function readPositionFromStructuredDom() {
  const selectors = [
    '.job-name', '.job-title', '.position-name', '.position-title',
    '[class*="jobName"]', '[class*="jobTitle"]', '[class*="positionTitle"]',
    '[class*="job-name"]', '[class*="job-title"]', '[class*="position-name"]', '[class*="position-title"]',
    '[class*="postName"]', '[class*="post-name"]', '[class*="postTitle"]',
    '.job-detail-header h1', '.job-banner h1', 'h1.job-title', '.job-header-title',
    '[class*="apply-job"] h1', '[class*="job-info"] h1', '[class*="job-info"] h2',
    '.pos-name', '.post-title', '#lblJobTitle', '.detail-title', '[class*="detailTitle"]',
    '[class*="JobDetail_title"]', '[class*="JobHeader"] h1', '[class*="headerTitle"]',
    '[data-automation-id="jobPostingHeader"]', '[data-automation-id*="jobTitle" i]',
    '[data-testid*="job-title" i]', '[data-testid*="position-title" i]',
    '[data-qa*="job-title" i]', '[itemprop="title"]',
    '[data-job-title]', '[data-job-name]', '[data-position-name]'
  ];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
      const raw = el.getAttribute('data-job-title') || el.getAttribute('data-job-name') ||
        el.getAttribute('data-position-name') || el.getAttribute('content') || el.textContent;
      const text = cleanPositionName(raw);
      if (looksLikePosition(text) && (JOB_TITLE_HINT.test(text) || text.length <= 24)) return text;
    }
  }
  return null;
}

function detectCompanyName() {
  const url = window.location.href.toLowerCase();
  const host = window.location.hostname.toLowerCase();
  const cached = loadJobMeta();

  for (const item of KNOWN_COMPANIES) {
    if (item.match.test(host) || item.match.test(url) || item.match.test(document.title || '')) return item.name;
  }

  const jsonld = readJsonLdJob();
  if (jsonld && jsonld.company && !JUNK_COMPANY_RE.test(jsonld.company)) return jsonld.company;

  const og = document.querySelector('meta[property="og:site_name"], meta[property="og:title"]');
  if (og) {
    const parts = String(og.getAttribute('content') || '').split(/[-_|—–]/).map((s) => s.trim());
    const hit = parts.find((p) => p.length >= 2 && p.length <= 20 && !JUNK_COMPANY_RE.test(p) && /公司|科技|集团|证券|银行|互娱|游戏|网络|软件/.test(p));
    if (hit) return hit;
  }

  const logoImgs = document.querySelectorAll('img[alt], img[title], .org-name, .company-name, [class*="company-name"], [class*="org-name"]');
  for (const el of logoImgs) {
    const text = (el.alt || el.title || el.textContent || '').trim();
    const clean = text.replace(/校园招聘|校招|社会招聘|招聘官网|招聘|官方网站|网申系统|人才招聘/g, '').trim();
    if (clean.length >= 2 && clean.length <= 20 && !JUNK_COMPANY_RE.test(clean)) return clean;
  }

  if (cached && cached.company && !JUNK_COMPANY_RE.test(cached.company)) return cached.company;

  const parts = (document.title || '').split(/[-_|—–\/]/).map((s) => s.replace(/【.*?】|\[.*?\]/g, '').trim()).filter(Boolean);
  for (const p of parts) {
    const clean = p.replace(/校园招聘|校招|社会招聘|招聘官网|招聘|官方网站/g, '').trim();
    if (clean.length >= 2 && clean.length <= 20 && !JUNK_COMPANY_RE.test(clean) && /公司|科技|集团|证券|银行|互娱|游戏|网络|软件|制造|生物|医药/.test(clean)) {
      return clean;
    }
  }

  return '未知企业';
}

function detectPositionName(profile, options = {}) {
  const jsonld = readJsonLdJob();
  if (jsonld && looksLikePosition(jsonld.position)) {
    return cleanPositionName(jsonld.position);
  }

  const metaPos = readPositionFromMeta();
  if (metaPos) return metaPos;

  const urlPos = readPositionFromUrl();
  if (urlPos) return urlPos;

  const domPos = readPositionFromStructuredDom();
  if (domPos) return domPos;

  const crumbPos = readPositionFromBreadcrumbs();
  if (crumbPos) return crumbPos;

  const headings = document.querySelectorAll('h1, h2, h3');
  for (const el of headings) {
    if (el.closest('#job-autofill-dock, #job-autofill-copy-panel, #job-autofill-ai-panel, #job-autofill-log-panel')) continue;
    const text = cleanPositionName(el.textContent);
    if (looksLikePosition(text) && JOB_TITLE_HINT.test(text)) {
      return text;
    }
  }

  const labeled = (document.body.innerText || '').match(/(?:应聘职位|申请岗位|投递职位|应聘岗位|目标职位|申请职位|职位名称|岗位名称)[：:\s]+([^\n\r]{2,40})/);
  if (labeled) {
    const found = cleanPositionName(labeled[1].split(/[，,。；;（(]/)[0]);
    if (looksLikePosition(found) && !/职位名称|岗位名称/.test(found)) return found;
  }

  const titleParts = (document.title || '')
    .split(/[-_|—–\t]|\s+\/\s+/)
    .map(cleanPositionName)
    .filter(Boolean);
  for (const part of titleParts) {
    if (looksLikePosition(part) && JOB_TITLE_HINT.test(part)) return part;
  }

  // 表单输入值仅作最后的页面级兜底，避免把已填入的工作经历职位当成目标岗位。
  const formPos = readPositionFromFormInputs();
  if (formPos) return formPos;

  const cached = loadJobMeta();
  if (cached && looksLikePosition(cached.position) && !JUNK_POSITION_RE.test(cached.position)) {
    return cleanPositionName(cached.position);
  }

  const prof = profile || currentActiveProfile;
  if (options.allowProfileFallback !== false && prof?.jobIntention?.expectedPosition && looksLikePosition(prof.jobIntention.expectedPosition)) {
    return cleanPositionName(prof.jobIntention.expectedPosition);
  }

  return '网申岗位';
}

function cacheJobMetaFromPage() {
  const position = detectPositionName(null, { allowProfileFallback: false });
  const company = detectCompanyName();

  if (typeof appLog !== 'undefined') {
    appLog.info('content', 'job.cache', '缓存页面岗位信息', {
      company: company || '未检测到',
      position: position || '未检测到',
      url: window.location.href
    });
  }

  if ((position && position !== '未知岗位' && position !== '网申岗位') || (company && company !== '未知企业')) {
    saveJobMeta({ company, position });
  }
}
