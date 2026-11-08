// ============================================================================
// 数据存储管理模块 - 优化版
// 基于参考项目的最佳实践，增加错误处理和性能优化
// ============================================================================

class StorageManager {
  constructor() {
    this.storageKey = 'jobAutofillData';
    this.saveDebounceTimer = null;
    this.saveDebounceDelay = 500; // 防抖延迟500ms
  }

  // 获取默认空资料模板
  getEmptyProfile() {
    const profile = {
      id: this.generateId(),
      name: '默认资料',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),

      // 基本信息
      basicInfo: {
        fullName: '',
        firstName: '',
        lastName: '',
        middleName: '',
        phone: '',
        phoneType: '', // Mobile, Home, Work
        email: '',
        gender: '',
        birthDate: '',
        idCard: '',

        // 背景与身份（国企/央企/体制内/大厂高频）
        politicalStatus: '', // 中共党员, 中共预备党员, 共青团员, 群众, 民主党派
        ethnicity: '',       // 民族 (如: 汉族)
        hometown: '',        // 籍贯 / 生源地 (如: 山东青岛)
        graduationDate: '',  // 毕业时间 (如: 2026-06)

        // 紧急联系人
        emergencyContact: '',
        emergencyPhone: '',
        emergencyRelation: '',

        // 地址信息
        address: '',      // 完整地址
        street: '',       // 街道
        city: '',         // 城市
        state: '',        // 省/州
        country: '',      // 国家
        zipCode: '',      // 邮编
        location: '',     // 简化地址

        // 社交链接
        linkedin: '',
        github: '',
        website: '',
        twitter: '',

        // 补充信息（国企/银行/大厂高频）
        maritalStatus: '',     // 婚姻状况 (未婚, 已婚, 离异)
        currentCity: '',       // 现居住城市 (如: 上海) — 与籍贯/户籍分离

        // 塔塔网申对齐扩展字段（键名与 profile-schema.js 保持一致；旧资料由 normalizeProfile 回填空串）
        englishName: '',               // 英文名
        wechat: '',                    // 微信号
        qq: '',                        // QQ号
        idCardType: '',                // 证件类型 (如: 身份证)
        bloodType: '',                 // 血型
        registeredAddressType: '',     // 户籍类型 (如: 居民户/农业户)
        religion: '',                  // 宗教信仰 (如: 无/佛教)
        honor: '',                     // 荣誉奖励
        specialSkills: '',             // 特长
        openToWork: '',                // 求职状态 (如: 求职中/在职)
        permanentResidencePermit: '',  // 居住证号
        jobSources: '',                // 招聘信息来源 (如: 官网/内推)
        foreignCitizenship: '',        // 是否取得外国国籍 (否)
        relativesEmployed: '',         // 亲属在目标单位任职 (否)
        yearsOfWork: '',               // 工作年限
        lastNamePinyin: '',            // 姓拼音
        firstNamePinyin: '',           // 名拼音
        namePinyinFull: '',            // 姓名全拼
        personalPromise: ''            // 个人声明/承诺 (是)
      },

      // 求职意向与偏好
      jobIntention: {
        expectedCity: '',      // 期望城市 (如: 北京, 上海, 深圳)
        expectedPosition: '',  // 期望岗位 (如: 前端开发工程师)
        expectedSalary: '',    // 期望薪资
        availableDate: '',     // 到岗时间 (如: 随时到岗, 2026年7月)
        referralCode: '',      // 内推码 / 推荐人
        recruitSource: '',     // 招聘渠道 (如: 校招官网, 内推, 牛客网, 同学推荐)
        willingToTravel: ''    // 是否愿意出差/驻外 (愿意, 不愿意, 视情况而定)
      },

      // 语言能力与成绩
      languageSkills: {
        cet4: '',              // 英语四级 (如: 580 或 通过)
        cet6: '',              // 英语六级 (如: 560 或 通过)
        ielts: '',             // 雅思成绩 (如: 7.5)
        toefl: '',             // 托福成绩 (如: 105)
        otherLanguages: ''     // 其他外语 (如: 日语N1)
      },

      // 家庭成员（华为/银行系/国企必填）
      familyMembers: [
        {
          id: this.generateId(),
          name: '',            // 成员姓名
          relation: '',        // 与本人关系 (父亲, 母亲, 配偶, 兄弟姐妹)
          employer: '',        // 工作单位
          position: '',        // 职务
          phone: ''            // 联系电话
        }
      ],

      // 荣誉与竞赛奖励
      awards: [
        {
          id: this.generateId(),
          name: '',            // 奖项名称 (如: 国家奖学金)
          level: '',           // 获奖级别 (国家级, 省部级, 校级, 院系级)
          date: ''             // 获奖时间 (如: 2024-11)
        }
      ],

      // 教育经历（可动态添加）
      education: [
        {
          id: this.generateId(),
          school: '',          // 学校全称
          college: '',         // 学院/院系 (如: 计算机学院)
          major: '',           // 专业全称
          degree: '',          // 学历 (大专/本科/硕士/博士)
          degreeType: '',      // 培养方式 (普通全日制统招, 非全日制, 留学生)
          schoolType: '',      // 院校层次 (985, 211, 双一流, 普通本科, 专科)
          startDate: '',       // 入学时间
          endDate: '',         // 毕业时间
          gpa: '',             // GPA成绩 (如: 3.8/4.0)
          rank: '',            // 专业排名 (如: 前5%, 1/120)
          courses: '',         // 主修核心课程
          description: ''
        }
      ],

      // 工作/实习经历
      workExperience: [
        {
          id: this.generateId(),
          company: '',         // 公司全称
          department: '',      // 所属部门 / 业务线
          position: '',        // 职位名称
          workType: '',        // 工作性质 (实习, 正式, 兼职)
          city: '',            // 工作城市
          startDate: '',       // 开始时间
          endDate: '',         // 结束时间 (或至今)
          description: '',     // 工作职责 (STAR原则)
          achievements: ''     // 核心量化成果 / 业务产出
        }
      ],

      // 项目经历
      projects: [
        {
          id: this.generateId(),
          name: '',            // 项目名称
          role: '',            // 担任角色
          projectType: '',     // 项目类型 (商业项目, 科研课题, 竞赛项目, 开源项目)
          techStack: '',       // 技术栈 / 关键工具 (如: React, Go, Redis)
          startDate: '',       // 开始时间
          endDate: '',         // 结束时间
          projectUrl: '',      // 项目链接 / Demo
          description: '',     // 项目描述 / 背景
          responsibilities: '',// 个人职责与难点攻关
          achievements: ''     // 项目成果 / 产出量化
        }
      ],

      // 可选经历模块：空数组不进入主导航，用户可按需添加
      campusPositions: [],
      campusActivities: [],
      trainings: [],
      languageCertificates: [],

      // 技能标签
      skills: [],

      // 证书（兼容旧版字符串数组）
      certificates: [
        {
          id: this.generateId(),
          name: '',            // 证书名称
          code: '',            // 证书编号
          issuer: '',          // 颁发机构
          date: '',            // 取得日期
          expiryDate: ''       // 有效期至
        }
      ],

      // 自我介绍模板
      introTemplates: {
        default: '',
        custom: []
      },

      // HR沟通打招呼自荐语（BOSS/智联速聊）
      hrGreeting: '',

      // 简历文件（base64或URL）
      resumeFile: null,
      resumeFileName: ''
    };
    return this.normalizeProfile(profile, profile);
  }

  // 生成唯一ID
  generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // 初始化存储（首次使用）
  async initialize() {
    try {
      const data = await this.loadAll();
      if (!data || !data.profiles || data.profiles.length === 0) {
        const defaultData = {
          version: '1.0.0', // 数据版本
          profiles: [this.getEmptyProfile()],
          activeProfileId: null,
          settings: {
            aiEnabled: false,
            aiProvider: 'deepseek',
            aiApiKey: '',
            aiApiUrl: '',
            aiModel: '',
            aiSmartFill: true,
            uiTheme: '',
            autoFillOnPageLoad: false,
            highlightFilledFields: true
          },
          createdAt: new Date().toISOString()
        };
        defaultData.activeProfileId = defaultData.profiles[0].id;
        await this.saveAll(defaultData);
        console.log('[存储] 初始化完成');
        return defaultData;
      }
      await this.migrateAttachments(data);
      console.log('[存储] 加载现有数据');
      return data;
    } catch (error) {
      console.error('[存储] 初始化失败:', error);
      throw error;
    }
  }

  // 加载所有数据 - 增强错误处理
  async loadAll() {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get([this.storageKey, "yanyuSubmissionsV1"], (result) => {
          if (chrome.runtime.lastError) {
            console.error('[存储] 加载失败:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }

          const data = result[this.storageKey];
          if (data && Array.isArray(result.yanyuSubmissionsV1)) data.submissions = result.yanyuSubmissionsV1;

          // 数据校验
          if (data && this.validateData(data)) {
            const normalized = this.fixData(data);
            console.log('[存储] 数据加载成功，大小:', JSON.stringify(normalized).length, '字节');
            resolve(normalized);
          } else if (data) {
            console.warn('[存储] 数据格式异常，尝试修复');
            const fixed = this.fixData(data);
            resolve(fixed);
          } else {
            resolve(null);
          }
        });
      } catch (error) {
        console.error('[存储] 加载异常:', error);
        reject(error);
      }
    });
  }

  // 保存所有数据 - 增强错误处理和容量检测
  async saveAll(data, submissionRows) {
    return new Promise((resolve, reject) => {
      try {
        // 添加更新时间戳
        data.updatedAt = new Date().toISOString();

        chrome.storage.local.set({ [this.storageKey]: data, ...(Array.isArray(submissionRows) ? { yanyuSubmissionsV1: submissionRows } : {}) }, () => {
          if (chrome.runtime.lastError) {
            console.error('[存储] 保存失败:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
            return;
          }
          console.log('[存储] 保存成功');
          resolve();
        });
      } catch (error) {
        console.error('[存储] 保存异常:', error);
        reject(error);
      }
    });
  }

  // 防抖保存 - 避免频繁写入
  async saveAllDebounced(data) {
    this.latestDebouncedData = data;
    return new Promise((resolve, reject) => {
      this.pendingSaves = this.pendingSaves || [];
      this.pendingSaves.push({ resolve, reject });
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = setTimeout(async () => {
        const batch = this.pendingSaves;
        this.pendingSaves = [];
        const toSave = this.latestDebouncedData;
        try {
          const result = await this.saveAll(toSave);
          batch.forEach((p) => p.resolve(result));
        } catch (error) {
          batch.forEach((p) => p.reject(error));
        }
      }, this.saveDebounceDelay);
    });
  }

  // 数据验证
  validateData(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.profiles)) return false;
    if (!data.settings || typeof data.settings !== 'object') return false;
    return true;
  }

  // 数据修复
  fixData(data) {
    if (!Array.isArray(data.profiles)) data.profiles = [];
    if (!data.settings || typeof data.settings !== 'object') data.settings = {};
    delete data.settings.ocrApiKey;
    // 旧数据没有 AI 智能补填开关，默认开启
    if (typeof data.settings.aiSmartFill !== 'boolean') data.settings.aiSmartFill = true;
    data.profiles = data.profiles.map(profile => this.normalizeProfile(profile));
    if (!data.activeProfileId && data.profiles.length > 0) {
      data.activeProfileId = data.profiles[0].id;
    }
    return data;
  }

  normalizeProfile(profile, template) {
    template = template || this.getEmptyProfile();
    for (const section of ['basicInfo', 'jobIntention', 'languageSkills', 'commonAnswers']) {
      profile[section] = { ...template[section], ...extendedDefaults(section), ...profile[section] };
    }
    profile.moduleConfig = resumeModuleConfig(profile);
    profile.basicInfo.homeAddress = familyResidence(profile.basicInfo).homeAddress;
    for (const key of ['gaokaoDate', 'gaokaoScore', 'gaokaoSubjects']) delete profile.basicInfo[key];
    profile.languageCertificates = profileLanguageEntries(profile);
    // 已迁移的成绩以卡片为准，删除卡片或修改成绩时不会重新导入旧值。
    for (const key of [...LEGACY_LANGUAGE_SCORES, 'otherLanguages']) delete profile.languageSkills[key];
    for (const section of profileListKeys) {
      profile[section] = (Array.isArray(profile[section]) ? profile[section] : []).map(item => ({
        ...template[section]?.[0], ...extendedDefaults(section), id: this.generateId(),
        ...(typeof item === 'string' ? { name: item, code: '', issuer: '', date: '', expiryDate: '' } : item)
      }));
    }
    profile.skills = Array.isArray(profile.skills) ? profile.skills : [];
    profile.attachments = { resume: null, idPhoto: null, lifePhoto: null, works: [], ...profile.attachments };
    profile.introTemplates = { default: '', custom: [], ...profile.introTemplates };
    return profile;
  }

  // 获取当前激活的资料
  async getActiveProfile() {
    try {
      const data = await this.loadAll();
      if (!data || !data.activeProfileId) return null;
      const profile = data.profiles.find(p => p.id === data.activeProfileId);
      if (!profile) {
        console.warn('[存储] 未找到激活的资料，使用第一个');
        return data.profiles[0] || null;
      }
      return profile;
    } catch (error) {
      console.error('[存储] 获取激活资料失败:', error);
      return null;
    }
  }

  // 获取所有资料列表
  async getAllProfiles() {
    try {
      const data = await this.loadAll();
      return data?.profiles || [];
    } catch (error) {
      console.error('[存储] 获取资料列表失败:', error);
      return [];
    }
  }

  // 添加新资料
  async addProfile(name = '新资料', sourceProfileId) {
    const copiedAttachments = [];
    try {
      const data = await this.loadAll();
      const identity = this.getEmptyProfile();
      const source = sourceProfileId ? data.profiles.find(profile => profile.id === sourceProfileId) : null;
      if (sourceProfileId && !source) throw new Error('要复制的简历已不存在');
      const newProfile = source ? JSON.parse(JSON.stringify(source)) : identity;
      Object.assign(newProfile, {
        id: identity.id,
        name: typeof name === 'string' && name.trim() ? name.trim() : '新资料',
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt
      });
      if (source) {
        delete newProfile.lastUsedAt;
        for (const section of profileListKeys) {
          newProfile[section] = newProfile[section].map(item => ({ ...item, id: this.generateId() }));
        }
        const refs = new Map();
        for (const ref of this.attachmentRefs(source)) {
          if (refs.has(ref.id)) continue;
          const file = await attachmentStore.get(ref.id);
          if (!file) throw new Error('原简历有附件无法读取');
          const copy = await this.writeAttachment(await attachmentStore.encode(file));
          copiedAttachments.push(copy.id);
          refs.set(ref.id, copy);
        }
        for (const kind of ['resume', 'idPhoto', 'lifePhoto']) {
          newProfile.attachments[kind] = refs.get(source.attachments[kind]?.id) || null;
        }
        newProfile.attachments.works = source.attachments.works.map(ref => refs.get(ref.id));
      }
      data.profiles.push(newProfile);
      data.activeProfileId = newProfile.id;
      await this.saveAll(data);
      console.log('[存储] 新增资料:', name);
      return newProfile.id;
    } catch (error) {
      await Promise.allSettled(copiedAttachments.map(id => attachmentStore.remove(id)));
      console.error('[存储] 添加资料失败:', error);
      throw error;
    }
  }

  // 更新资料
  async updateProfile(profileId, updates) {
    try {
      const data = await this.loadAll();
      const index = data.profiles.findIndex(p => p.id === profileId);
      if (index !== -1) {
        updates.updatedAt = new Date().toISOString();
        data.profiles[index] = this.normalizeProfile(mergeProfile(data.profiles[index], updates));
        await this.saveAll(data);
        console.log('[存储] 更新资料:', profileId);
        return true;
      }
      console.warn('[存储] 未找到资料:', profileId);
      return false;
    } catch (error) {
      console.error('[存储] 更新资料失败:', error);
      throw error;
    }
  }

  // 删除资料
  async deleteProfile(profileId) {
    try {
      const data = await this.loadAll();
      if (data.profiles.length <= 1) {
        console.warn('[存储] 至少保留一份资料');
        return false;
      }
      const removed = data.profiles.find(p => p.id === profileId);
      data.profiles = data.profiles.filter(p => p.id !== profileId);
      if (data.activeProfileId === profileId) {
        data.activeProfileId = data.profiles[0].id;
      }
      await this.saveAll(data);
      if (removed) await Promise.all(this.attachmentRefs(removed).map(ref => attachmentStore.remove(ref.id).catch(console.warn)));
      console.log('[存储] 删除资料:', profileId);
      return true;
    } catch (error) {
      console.error('[存储] 删除资料失败:', error);
      throw error;
    }
  }

  // 切换激活资料
  async setActiveProfile(profileId) {
    try {
      const data = await this.loadAll();
      if (data.profiles.find(p => p.id === profileId)) {
        data.activeProfileId = profileId;
        await this.saveAll(data);
        console.log('[存储] 切换资料:', profileId);
        return true;
      }
      console.warn('[存储] 资料不存在:', profileId);
      return false;
    } catch (error) {
      console.error('[存储] 切换资料失败:', error);
      throw error;
    }
  }

  // 获取设置
  async getSettings() {
    try {
      const data = await this.loadAll();
      return data?.settings || {};
    } catch (error) {
      console.error('[存储] 获取设置失败:', error);
      return {};
    }
  }

  // 更新设置
  async updateSettings(updates) {
    try {
      const data = await this.loadAll();
      data.settings = { ...data.settings, ...updates };
      await this.saveAll(data);
      console.log('[存储] 更新设置');
    } catch (error) {
      console.error('[存储] 更新设置失败:', error);
      throw error;
    }
  }

  // 添加教育经历
  async addEducation(profileId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.education.push({
          id: this.generateId(),
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
        });
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 添加教育经历失败:', error);
      throw error;
    }
  }

  // 删除教育经历
  async deleteEducation(profileId, eduId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.education = profile.education.filter(e => e.id !== eduId);
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 删除教育经历失败:', error);
      throw error;
    }
  }

  // 添加工作经历
  async addWorkExperience(profileId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.workExperience.push({
          id: this.generateId(),
          company: '',
          department: '',
          position: '',
          workType: '',
          city: '',
          startDate: '',
          endDate: '',
          description: '',
          achievements: ''
        });
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 添加工作经历失败:', error);
      throw error;
    }
  }

  // 删除工作经历
  async deleteWorkExperience(profileId, workId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.workExperience = profile.workExperience.filter(w => w.id !== workId);
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 删除工作经历失败:', error);
      throw error;
    }
  }

  // 添加项目经历
  async addProject(profileId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.projects.push({
          id: this.generateId(),
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
        });
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 添加项目经历失败:', error);
      throw error;
    }
  }

  // 删除项目经历
  async deleteProject(profileId, projectId) {
    try {
      const data = await this.loadAll();
      const profile = data.profiles.find(p => p.id === profileId);
      if (profile) {
        profile.projects = profile.projects.filter(p => p.id !== projectId);
        await this.saveAll(data);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[存储] 删除项目经历失败:', error);
      throw error;
    }
  }

  // ============================================================================
  // 投递历史记录管理
  // ============================================================================

  // Applications use a separate key so profile saves cannot overwrite tracker changes.
  async getSubmissions() {
    const data = await this.loadAll();
    return Array.isArray(data?.submissions) ? data.submissions : [];
  }

  async mutateSubmissions(mutator) {
    const run = async () => {
      const rows = await this.getSubmissions();
      const result = mutator(rows);
      await new Promise((resolve, reject) => chrome.storage.local.set({ yanyuSubmissionsV1: rows }, () => chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()));
      return result;
    };
    return globalThis.navigator?.locks ? navigator.locks.request('yanyu-submissions', run) : run();
  }

  async addSubmission(values) {
    return this.mutateSubmissions(rows => {
      const record = { ...values, id: this.generateId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      rows.unshift(record);
      return record;
    });
  }

  async updateSubmission(id, updates) {
    return this.mutateSubmissions(rows => {
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return false;
      rows[index] = { ...rows[index], ...updates, id, updatedAt: new Date().toISOString() };
      return true;
    });
  }

  async deleteSubmission(id) {
    return this.mutateSubmissions(rows => {
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    });
  }

  attachmentRefs(profile) {
    const a = profile.attachments || {};
    return [a.resume, a.idPhoto, a.lifePhoto, ...(a.works || [])].filter(Boolean);
  }

  async writeAttachment(file) {
    const blob = attachmentStore.decode(file);
    const record = { id: this.generateId(), name: file.name, blob };
    await attachmentStore.put(record);
    const check = await attachmentStore.get(record.id);
    const expected = new Uint8Array(await blob.arrayBuffer());
    const actual = check && new Uint8Array(await check.blob.arrayBuffer());
    if (!actual || actual.length !== expected.length || actual.some((byte, i) => byte !== expected[i])) {
      await attachmentStore.remove(record.id);
      throw new Error('附件写入核对失败');
    }
    return { id: record.id, name: file.name, size: blob.size, type: blob.type };
  }

  async migrateAttachments(data) {
    for (const profile of data.profiles) {
      if (!profile.resumeFile?.startsWith('data:')) continue;
      try {
        const ref = await this.writeAttachment({ name: profile.resumeFileName || 'resume.pdf', dataUrl: profile.resumeFile });
        const previous = { ...profile, attachments: { ...profile.attachments } };
        profile.attachments.resume = ref;
        profile.resumeFile = null;
        profile.resumeFileName = '';
        try { await this.saveAll(data); }
        catch (error) { Object.assign(profile, previous); await attachmentStore.remove(ref.id); throw error; }
      } catch (error) { console.warn('[附件] 迁移未完成，保留旧附件:', error.message); }
    }
  }

  async saveAttachment(profileId, kind, file, replaceId) {
    if (!['resume', 'idPhoto', 'lifePhoto', 'works'].includes(kind)) throw new Error('未知附件用途');
    const data = await this.loadAll();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('资料不存在');
    const old = kind === 'works' ? profile.attachments.works.find(f => f.id === replaceId) : profile.attachments[kind];
    if (kind === 'works' && replaceId && !old) throw new Error('原附件不存在');
    if (/Photo$/.test(kind) && !attachmentStore.decode(file).type.startsWith('image/')) throw new Error('照片附件必须是图片');
    const ref = await this.writeAttachment(file);
    if (kind === 'works') profile.attachments.works = [...profile.attachments.works.filter(f => f.id !== replaceId), ref];
    else profile.attachments[kind] = ref;
    if (kind === 'resume') { profile.resumeFile = null; profile.resumeFileName = ''; }
    try { await this.saveAll(data); }
    catch (error) { await attachmentStore.remove(ref.id); throw error; }
    if (old) await attachmentStore.remove(old.id).catch(console.warn);
    return profile.attachments;
  }

  async getAttachment(profileId, id) {
    const data = await this.loadAll();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile || !this.attachmentRefs(profile).some(f => f.id === id)) throw new Error('附件引用不存在');
    const file = await attachmentStore.get(id);
    if (!file) throw new Error('附件内容不存在');
    return attachmentStore.encode(file);
  }

  async deleteAttachment(profileId, kind, id) {
    if (!['resume', 'idPhoto', 'lifePhoto', 'works'].includes(kind)) throw new Error('未知附件用途');
    const data = await this.loadAll();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile) throw new Error('资料不存在');
    const old = kind === 'works' ? profile.attachments.works.find(f => f.id === id) : profile.attachments[kind];
    if (kind === 'works') profile.attachments.works = profile.attachments.works.filter(f => f.id !== id);
    else profile.attachments[kind] = null;
    if (kind === 'resume') { profile.resumeFile = null; profile.resumeFileName = ''; }
    await this.saveAll(data);
    if (old) await attachmentStore.remove(old.id).catch(console.warn);
    return profile.attachments;
  }

  // 导出数据（备份）- 只导出当前激活的资料
  async exportData() {
    try {
      const data = await this.loadAll();
      const activeProfile = data.profiles.find(p => p.id === data.activeProfileId);
      if (!activeProfile) {
        throw new Error('未找到当前激活的资料');
      }

      // 只导出当前激活的资料
      const attachmentContents = {};
      for (const ref of this.attachmentRefs(activeProfile)) {
        const file = await attachmentStore.get(ref.id);
        if (!file) throw new Error(`附件丢失：${ref.name}`);
        attachmentContents[ref.id] = await attachmentStore.encode(file);
      }

      const exportData = {
        version: '2.0.0',
        createdAt: data.createdAt,
        profiles: [activeProfile],  // 只包含当前激活的资料
        activeProfileId: activeProfile.id,
        settings: data.settings || {},
        submissions: data.submissions || [],
        attachmentContents
      };

      return JSON.stringify(exportData, null, 2);
    } catch (error) {
      console.error('[存储] 导出数据失败:', error);
      throw error;
    }
  }

  // 导入数据（恢复）- 将导入的资料添加到现有资料列表
  async importData(jsonString) {
    try {
      const importedData = JSON.parse(jsonString);
      if (!this.validateData(importedData)) {
        throw new Error('数据格式不正确');
      }
      if (!importedData.profiles.length || importedData.profiles.some(p => !p || typeof p !== 'object' || typeof p.id !== 'string') ||
          new Set(importedData.profiles.map(p => p.id)).size !== importedData.profiles.length ||
          (importedData.activeProfileId && !importedData.profiles.some(p => p.id === importedData.activeProfileId))) throw new Error('资料 ID 不正确');
      if (importedData.version && !['1.0.0', '2.0.0'].includes(importedData.version)) throw new Error('不支持此备份版本');

      // 加载现有数据
      const existingData = await this.loadAll();

      const pending = [];
      for (const profile of importedData.profiles) {
        for (const key of profileListKeys) if (profile[key] != null && (!Array.isArray(profile[key]) || profile[key].some(item => !item || (typeof item !== 'object' && !(key === 'certificates' && typeof item === 'string'))))) throw new Error(`资料列表格式不正确：${key}`);
        for (const key of ['basicInfo', 'jobIntention', 'languageSkills', 'commonAnswers', 'attachments']) if (profile[key] != null && (typeof profile[key] !== 'object' || Array.isArray(profile[key]))) throw new Error(`资料格式不正确：${key}`);
        if (profile.attachments?.works && !Array.isArray(profile.attachments.works)) throw new Error('作品附件格式不正确');
        for (const ref of this.attachmentRefs(profile)) {
          const file = importedData.attachmentContents?.[ref.id];
          if (!file || ref.name !== file.name || ref.size !== file.size || ref.type !== file.type) throw new Error('附件引用核对失败');
          if (attachmentStore.decode(file).type !== file.type) throw new Error('附件类型核对失败');
          pending.push({ ref, file });
        }
        if (profile.resumeFile?.startsWith('data:')) attachmentStore.decode({ name: profile.resumeFileName || 'resume.pdf', dataUrl: profile.resumeFile });
      }

      const created = [];
      try {
        // 写入附件并更新引用
        for (const { ref, file } of pending) {
          const replacement = await this.writeAttachment(file);
          created.push(replacement.id);
          Object.assign(ref, replacement);
        }

        // 检查并处理ID冲突
        const existingIds = new Set(existingData.profiles.map(p => p.id));
        const newProfiles = [];

        for (const importedProfile of importedData.profiles) {
          if (existingIds.has(importedProfile.id)) {
            // ID冲突，生成新ID
            const timestamp = Date.now();
            const random = Math.random().toString(36).substring(2, 11);
            const newId = `id_${timestamp}_${random}`;
            console.log(`[存储] 资料ID冲突，从 ${importedProfile.id} 改为 ${newId}`);
            importedProfile.id = newId;
          }
          newProfiles.push(importedProfile);
        }

        // 合并资料列表
        existingData.profiles.push(...newProfiles);

        // 设置激活资料为新导入的第一个
        if (newProfiles.length > 0) {
          existingData.activeProfileId = newProfiles[0].id;
        }

        // Restore profile and tracker changes in one storage write; keep existing IDs.
        const restore = async () => {
          const rows = await this.getSubmissions();
          const ids = new Set(rows.map(row => row.id));
          for (const row of Array.isArray(importedData.submissions) ? importedData.submissions : []) {
            if (row && typeof row.id === 'string' && !ids.has(row.id)) { rows.push(row); ids.add(row.id); }
          }
          await this.saveAll(this.fixData(existingData), rows);
        };
        if (globalThis.navigator?.locks) await navigator.locks.request('yanyu-submissions', restore);
        else await restore();
      } catch (error) {
        await Promise.all(created.map(id => attachmentStore.remove(id)));
        throw error;
      }
      console.log('[存储] 导入数据成功');
      return true;
    } catch (error) {
      console.error('[存储] 导入数据失败:', error);
      throw error;
    }
  }

  // 清空所有数据（危险操作）
  async clearAll() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove([this.storageKey, "yanyuSubmissionsV1"], () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          console.log('[存储] 清空所有数据');
          resolve();
        }
      });
    });
  }

  // 获取存储使用情况
  async getStorageInfo() {
    const bytes = await new Promise(resolve => chrome.storage.local.getBytesInUse(this.storageKey, resolve));
    const attachmentBytes = (await attachmentStore.all()).reduce((sum, file) => sum + file.blob.size, 0);
    const estimate = await navigator.storage.estimate();
    return { bytes, attachmentBytes, sizeInMB: ((bytes + attachmentBytes) / 1024 / 1024).toFixed(2),
      localQuota: chrome.storage.local.QUOTA_BYTES, originUsage: estimate.usage, originQuota: estimate.quota };
  }
}

const storageManager = new StorageManager();
