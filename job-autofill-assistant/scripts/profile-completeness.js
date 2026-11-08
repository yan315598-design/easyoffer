// ============================================================================
// 共享简历完整度计算（popup 与 options 页面共用）
// ----------------------------------------------------------------------------
// 纯函数、无 DOM / chrome 依赖：
// - 浏览器经 <script> 引入后挂到全局 ProfileCompleteness（不进入 content manifest）
// - Node 端测试通过 module.exports 使用（test/run.mjs）
// 检查项与 popup 旧 calculateCompleteness 的 15 项一一对应（等权重），不虚构数据。
// ============================================================================

(function (global) {
  'use strict';

  var hasText = function (value) {
    return typeof value === 'string' ? value.trim() !== '' : value != null && value !== '';
  };

  var someEntry = function (list, predicate) {
    return Array.isArray(list) && list.some(function (item) { return !!item && predicate(item); });
  };

  // 每项检查：key 唯一标识；label 缺失提示文案；moduleKey 对应 options 工作区模块，
  // 用于缺失项快捷跳转（navigateWorkspace）；group 所属资料分组。
  var CHECKS = [
    // 基础信息（7 项）
    { key: 'basic.fullName', label: '姓名', moduleKey: 'basic', group: '基础信息',
      test: function (p) { return hasText(p.basicInfo && p.basicInfo.fullName); } },
    { key: 'basic.phone', label: '手机号', moduleKey: 'basic', group: '基础信息',
      test: function (p) { return hasText(p.basicInfo && p.basicInfo.phone); } },
    { key: 'basic.email', label: '邮箱', moduleKey: 'basic', group: '基础信息',
      test: function (p) { return hasText(p.basicInfo && p.basicInfo.email); } },
    { key: 'basic.gender', label: '性别', moduleKey: 'basic', group: '基础信息',
      test: function (p) { return hasText(p.basicInfo && p.basicInfo.gender); } },
    { key: 'basic.birthDate', label: '出生日期', moduleKey: 'basic', group: '基础信息',
      test: function (p) { return hasText(p.basicInfo && p.basicInfo.birthDate); } },
    { key: 'basic.politicalStatus', label: '政治面貌', moduleKey: 'basic', group: '基础信息',
      test: function (p) { return hasText(p.basicInfo && p.basicInfo.politicalStatus); } },
    { key: 'basic.hometown', label: '籍贯', moduleKey: 'basic', group: '基础信息',
      test: function (p) { return hasText(p.basicInfo && p.basicInfo.hometown); } },
    // 求职意向与外语能力（2 项）
    { key: 'intention.direction', label: '求职意向（期望职位/城市）', moduleKey: 'intention', group: '求职意向',
      test: function (p) { return hasText(p.jobIntention && p.jobIntention.expectedPosition) || hasText(p.jobIntention && p.jobIntention.expectedCity); } },
    { key: 'intention.language', label: '外语能力', moduleKey: 'languageCertificates', group: '外语能力',
      test: function (p) {
        var lang = p.languageSkills || {};
        return hasText(lang.cet4) || hasText(lang.cet6) || hasText(lang.ielts) || hasText(lang.toefl) ||
          someEntry(p.languageCertificates, function (item) {
            return ['language', 'name', 'score', 'proficiency', 'notes'].some(function (key) { return hasText(item[key]); });
          });
      } },
    // 教育经历（2 项）
    { key: 'education.school', label: '毕业院校', moduleKey: 'education', group: '教育经历',
      test: function (p) { return someEntry(p.education, function (e) { return hasText(e.school); }); } },
    { key: 'education.majorDegree', label: '专业与学历', moduleKey: 'education', group: '教育经历',
      test: function (p) { return someEntry(p.education, function (e) { return hasText(e.major) && hasText(e.degree); }); } },
    // 工作/实习经历（1 项）
    { key: 'work.company', label: '工作/实习单位', moduleKey: 'work', group: '工作/实习经历',
      test: function (p) { return someEntry(p.workExperience, function (w) { return hasText(w.company); }); } },
    // 项目经历（1 项）
    { key: 'projects.name', label: '项目经历', moduleKey: 'projects', group: '项目经历',
      test: function (p) { return someEntry(p.projects, function (item) { return hasText(item.name); }); } },
    // 技能标签（1 项）
    { key: 'skills.tags', label: '技能标签', moduleKey: 'skills', group: '技能与附件',
      test: function (p) { return Array.isArray(p.skills) && p.skills.length > 0; } },
    // 简历源文件（1 项）
    { key: 'resume.file', label: '简历源文件', moduleKey: 'parser', group: '技能与附件',
      test: function (p) { return !!(p.resumeFile || (p.attachments && p.attachments.resume)); } }
  ];

  /**
   * 计算简历完整度。
   * @param {object} profile 简历资料（popup 传 currentProfile；options 传表单快照，
   *   注意快照会剥离附件键，需调用方合并 currentProfile.attachments / resumeFile）
   * @returns {{percent: number, total: number, filled: number, missing: Array<{key: string, label: string, moduleKey: string, group: string}>}}
   */
  function computeProfileCompleteness(profile) {
    var missing = [];
    var filled = 0;
    var total = 0;
    for (var i = 0; i < CHECKS.length; i++) {
      var check = CHECKS[i];
      var enabled = profile && profile.moduleConfig && profile.moduleConfig.enabled || {};
      if (check.moduleKey === 'work' ? enabled.work === false && enabled.internship === false : enabled[check.moduleKey] === false) continue;
      total++;
      var ok = false;
      try {
        ok = !!check.test(profile || {});
      } catch (e) {
        ok = false;
      }
      if (ok) {
        filled++;
      } else {
        missing.push({ key: check.key, label: check.label, moduleKey: check.moduleKey, group: check.group });
      }
    }
    var percent = total > 0 ? Math.round((filled / total) * 100) : 0;
    return { percent: percent, total: total, filled: filled, missing: missing };
  }

  var api = {
    computeProfileCompleteness: computeProfileCompleteness,
    PROFILE_COMPLETENESS_CHECKS: CHECKS.map(function (check) {
      return { key: check.key, label: check.label, moduleKey: check.moduleKey, group: check.group };
    })
  };

  global.ProfileCompleteness = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
