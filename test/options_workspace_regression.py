#!/usr/bin/env python3
"""options 页三栏工作区回归：概览/单模块编辑、折叠扩展字段持久化、增删、空模块添加、资料切换与响应式布局。

运行：python test/options_workspace_regression.py（无需外部网络，Chrome 走本地 http 服务 + storage mock）
"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import threading
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "job-autofill-assistant"
OUT = ROOT / "pictures"
STATE_KEY = "capybara-options-test-state"
P1 = "id_test_profile_main"
P2 = "id_test_profile_en"
CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    str(Path.home() / ".local/bin/google-chrome"),
]


def test_data() -> dict:
    """两份虚构资料：主资料内容丰富，第二份稀疏，用于切换验证。"""
    return {
        "version": "1.0.0",
        "activeProfileId": P1,
        "settings": {
            "aiEnabled": False, "aiProvider": "deepseek", "aiApiKey": "", "aiApiUrl": "",
            "aiModel": "deepseek-chat", "ocrApiKey": "", "uiTheme": "light",
        },
        "profiles": [
            {
                "id": P1, "name": "校招-后端开发",
                "basicInfo": {
                    "fullName": "张子涵", "firstName": "子涵", "lastName": "张", "gender": "男",
                    "birthDate": "2001-08-16", "phone": "13812345678", "email": "zihan.zhang_dev@example.com",
                    "politicalStatus": "共青团员", "ethnicity": "汉族", "hometown": "山东青岛",
                    "graduationDate": "2026-06", "currentCity": "北京市海淀区", "bloodType": "",
                    "homeProvince": "广东省", "homeCity": "深圳市", "homeDistrict": "南山区", "gaokaoScore": "600",
                },
                "jobIntention": {"expectedCity": "北京 / 上海", "expectedPosition": "后端开发工程师", "expectedSalary": "18k-25k"},
                "languageSkills": {"cet4": "580分", "cet6": "562分", "otherLanguages": "日语 N3、德语 B2"},
                "languageCertificates": [{"id": "old-cet6", "name": "大学英语六级（CET-6）", "score": "610"}],
                "education": [{"id": "id_test_edu_1", "school": "北京航空航天大学", "college": "计算机学院",
                               "major": "计算机科学与技术", "degree": "硕士", "degreeType": "普通全日制统招",
                               "schoolType": "985", "startDate": "2023-09", "endDate": "2026-06",
                               "gpa": "3.7/4.0", "rank": "前10%", "courses": "分布式系统", "description": ""}],
                "workExperience": [{"id": "id_test_work_1", "company": "字节跳动", "department": "推荐架构",
                                    "position": "后端开发实习生", "workType": "实习", "city": "北京",
                                    "startDate": "2025-06", "endDate": "2025-09", "description": "推荐服务接口开发", "achievements": ""}],
                "projects": [{"id": "id_test_proj_1", "name": "智能简历解析助手", "role": "负责人",
                              "projectType": "开源项目", "techStack": "Python, FastAPI", "startDate": "2025-03",
                              "endDate": "2025-08", "description": "简历结构化抽取", "responsibilities": "", "achievements": ""}],
                "awards": [{"id": "id_test_award_1", "name": "国家奖学金", "level": "国家级", "date": "2024-11"}],
                "familyMembers": [], "certificates": [], "papers": [], "patents": [], "openSource": [],
                "customAnswers": [], "declarations": [], "commonAnswers": {},
                "skills": ["Python", "FastAPI", "Docker"],
                "introTemplates": {"default": "硕士在读，关注推荐系统。", "custom": []},
                "hrGreeting": "",
            },
            {
                "id": P2, "name": "外企-英文版",
                "basicInfo": {"fullName": "李雷", "email": "lei.li_test@example.com", "phone": "13900002222"},
                "jobIntention": {"expectedPosition": "SDE Intern"},
                "languageSkills": {"ielts": "7.0"},
                "education": [{"id": "id_test_edu_2", "school": "复旦大学", "major": "软件工程", "degree": "本科",
                               "startDate": "2022-09", "endDate": "2026-06"}],
                "workExperience": [], "projects": [], "awards": [], "familyMembers": [], "certificates": [],
                "papers": [], "patents": [], "openSource": [], "customAnswers": [], "declarations": [],
                "commonAnswers": {}, "skills": [], "introTemplates": {"default": "", "custom": []}, "hrGreeting": "",
            },
        ],
        "submissions": [], "logs": [],
    }


# 与页面同源注入的 chrome mock：状态写入 localStorage，reload 后仍可读回，用于验证自动保存落盘
CHROME_MOCK = r"""
(() => {
  const FALLBACK = window.__CAPYBARA_TEST_DATA__;
  const KEY = 'capybara-options-test-state';
  let data = null;
  try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  if (!data) data = FALLBACK;
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };
  window.__deletedProfileIds = [];
  persist();
  const active = () => data.profiles.find((p) => p.id === data.activeProfileId) || data.profiles[0];
  const mergeUpdates = (profile, updates) => {
    for (const [key, value] of Object.entries(updates || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        profile[key] = { ...(profile[key] || {}), ...value };
      } else {
        profile[key] = value;
      }
    }
  };
  const reply = (action, payload) => {
    switch (action) {
      case 'getSettings': return { success: true, settings: data.settings };
      case 'updateSettings': Object.assign(data.settings, payload.settings || {}); persist(); return { success: true, settings: data.settings };
      case 'getAllProfiles': {
        if (window.__failNextGetAllProfiles) {
          window.__failNextGetAllProfiles = false;
          return { success: false, error: '模拟列表刷新失败' };
        }
        return { success: true, profiles: data.profiles, activeProfileId: data.activeProfileId };
      }
      case 'getActiveProfile': return { success: true, profile: active() };
      case 'getSubmissions': return { success: true, submissions: data.submissions };
      case 'updateProfile': {
        const profile = data.profiles.find((p) => p.id === payload.profileId);
        if (profile) {
          mergeUpdates(profile, payload.updates);
          if (payload.updates?.languageCertificates) delete profile.languageSkills;
          profile.updatedAt = new Date().toISOString();
          persist();
        }
        return { success: true };
      }
      case 'setActiveProfile': data.activeProfileId = payload.profileId; persist(); return { success: true };
      case 'addProfile': {
        const id = 'id_test_new_' + Date.now();
        const source = data.profiles.find(p => p.id === payload.sourceProfileId);
        const empty = { basicInfo: {}, jobIntention: {}, languageSkills: {},
          education: [], workExperience: [], projects: [], awards: [], familyMembers: [], certificates: [],
          papers: [], patents: [], openSource: [], customAnswers: [], declarations: [], commonAnswers: {},
          skills: [], introTemplates: { default: '', custom: [] } };
        data.profiles.push({ ...structuredClone(source || empty), id, name: payload.name });
        data.activeProfileId = id;
        persist();
        return { success: true, profileId: id };
      }
      case 'deleteProfile': {
        if (data.profiles.length <= 1) return { success: false, error: '至少需要保留一份资料' };
        window.__deletedProfileIds.push(payload.profileId);
        data.profiles = data.profiles.filter(p => p.id !== payload.profileId);
        if (data.activeProfileId === payload.profileId) data.activeProfileId = data.profiles[0].id;
        persist();
        return { success: true };
      }
      case 'exportData': return { success: true, data: JSON.stringify(data) };
      case 'getEditorIdentity': return { success: true, documentId: 'test-editor-1' };
      case 'getStorageInfo': return { success: true, info: { sizeInMB: '1.2', attachmentBytes: 102400 } };
      default: return { success: true };
    }
  };
  const storageLocal = {
    get(keys, cb) {
      let result = {};
      if (keys == null) result = { jobAutofillData: data, jobAutofillLogs: [] };
      else if (typeof keys === 'string') result = { [keys]: keys === 'jobAutofillData' ? data : (keys === 'jobAutofillLogs' ? [] : undefined) };
      else if (Array.isArray(keys)) keys.forEach((k) => { result[k] = k === 'jobAutofillData' ? data : (k === 'jobAutofillLogs' ? [] : undefined); });
      else if (typeof keys === 'object') {
        result = { ...keys };
        Object.keys(keys).forEach((k) => { if (k === 'jobAutofillData') result[k] = data; else if (k === 'jobAutofillLogs') result[k] = []; else if (k in { jobAutofillData: 1 }) result[k] = data; });
      }
      const done = typeof keys === 'function' ? keys : cb;
      if (typeof done === 'function') setTimeout(() => done(result), 0);
      return Promise.resolve(result);
    },
    set(obj, cb) { if (typeof cb === 'function') setTimeout(cb, 0); return Promise.resolve(); }
  };
  window.chrome = {
    runtime: {
      lastError: undefined,
      getURL: (p) => new URL(p, location.origin + '/').href,
      sendMessage: (payload, cb) => {
        const res = reply(payload && payload.action, payload || {});
        if (typeof cb === 'function') setTimeout(() => cb(res), 0);
        return Promise.resolve(res);
      },
      onMessage: { addListener() {}, removeListener() {} }
    },
    storage: { local: storageLocal, onChanged: { addListener() {}, removeListener() {} } },
    tabs: { query: async () => [], sendMessage() {}, create() {} }
  };
})();
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


def start_server():
    handler = partial(Handler, directory=str(EXT))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def chrome_path() -> str:
    for candidate in CHROME_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("找不到 Chrome/Edge，请设置 CHROME_PATH")


def wait_profile_field(page, profile_id: str, dotted_path: str, expected, timeout: int = 8000):
    """等待 mock 状态（localStorage）中某资料字段变为期望值，即自动保存确实落盘。"""
    page.wait_for_function(
        """([key, pid, path, expected]) => {
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            const data = JSON.parse(raw);
            const profile = (data.profiles || []).find((p) => p.id === pid);
            if (!profile) return false;
            let value = profile;
            for (const part of path.split('.')) value = value && value[part];
            return JSON.stringify(value) === JSON.stringify(expected);
        }""",
        arg=[STATE_KEY, profile_id, dotted_path, expected], timeout=timeout,
    )


def assert_no_horizontal_overflow(page, label: str):
    overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
    assert overflow <= 1, f"{label} 出现横向溢出 {overflow}px"
    print(f"PASS {label} 无横向溢出")


def ensure_overview(page):
    """重载后 URL hash 可能恢复为单模块视图，统一先回到概览再断言。"""
    page.wait_for_function(
        "() => document.getElementById('profileOverview')?.hidden === false "
        "|| document.getElementById('moduleBackBar')?.hidden === false",
        timeout=15000,
    )
    if page.evaluate("() => document.getElementById('profileOverview')?.hidden !== false"):
        page.locator("#backToOverviewBtn").click()
        page.wait_for_function("() => document.getElementById('profileOverview')?.hidden === false", timeout=10000)


def main():
    server, origin = start_server()
    OUT.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(test_data(), ensure_ascii=False)
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=chrome_path(), headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        context.add_init_script(f"window.__CAPYBARA_TEST_DATA__ = {payload};")
        context.add_init_script(CHROME_MOCK)
        page = context.new_page()
        page.on("pageerror", lambda error: console_errors.append(str(error)))

        try:
            # —— 1. 默认简历概览：中栏只读，模块表单隐藏但不销毁 ——
            page.goto(origin + "/options/options.html", wait_until="domcontentloaded")
            page.wait_for_selector("#profileOverview .overview-card", timeout=15000)
            page.wait_for_function("() => !document.getElementById('profileOverview').hidden", timeout=15000)
            assert page.locator("#profileOverview").inner_text().count("张子涵") >= 1, "概览应显示姓名"
            assert "北京航空航天大学" in page.locator("#profileOverview").inner_text(), "概览应显示教育摘要"
            assert page.evaluate("() => document.getElementById('section-basic').classList.contains('is-module-hidden')"), \
                "概览态基础信息模块应隐藏"
            assert page.evaluate("() => document.getElementById('fullName')?.value === '张子涵'"), "隐藏模块的表单值仍在"
            assert page.locator("#sidebarMenu [data-module='overview']").count() == 1, "侧栏应有概览入口"
            print("PASS 默认进入只读简历概览，编辑表单隐藏不销毁")
            page.screenshot(path=str(OUT / "options-workspace-overview.png"), full_page=False)

            # 概览 DOM 不落入 *List 容器、不复用 item-card
            assert page.evaluate(
                "() => !document.getElementById('profileOverview') || "
                "(!document.getElementById('profileOverview').closest('[id$=\"List\"]') && "
                "document.querySelectorAll('#profileOverview .item-card').length === 0)"
            ), "概览 DOM 不应进入 *List 或复用 item-card"
            print("PASS 概览 DOM 独立于 item-card / *List 收集链路")

            # —— 2. 概览 → 基础编辑 → 返回 ——
            page.locator("#profileOverview [data-edit-module='basic']").click()
            page.wait_for_function(
                "() => !document.getElementById('section-basic').classList.contains('is-module-hidden') && document.getElementById('profileOverview').hidden"
            )
            assert not page.locator("#moduleBackBar").is_hidden(), "编辑态应显示返回概览条"
            assert page.evaluate("() => document.getElementById('fullName')?.value === '张子涵'")
            assert page.evaluate("() => document.getElementById('section-education').classList.contains('is-module-hidden')"), \
                "其他模块应保持隐藏"
            print("PASS 概览点击编辑进入基础信息单模块编辑")

            # 低频扩展字段默认折叠（血型等不在首屏摊开），键仍存在
            assert page.locator("#section-basic .ext-collapse").count() == 1, "basicInfo 扩展字段应有折叠区"
            assert page.evaluate("() => document.querySelector('#section-basic .ext-collapse-body').hidden"), "折叠区默认收起"
            assert page.locator("#section-basic [data-ext-key='bloodType']").count() == 1, "血型字段键位保留"
            for hidden_key in ["honor", "specialSkills", "jobSources", "foreignCitizenship", "relativesEmployed", "personalPromise"]:
                assert page.locator(f"#section-basic [data-ext-key='{hidden_key}']").count() == 0, f"重复/声明字段应隐藏入口: {hidden_key}"
            assert page.locator("#section-basic .ext-collapse-toggle").inner_text().startswith("专项个人资料")
            assert page.locator("#englishName, #wechat, #idCardType, #sourcePlace, #registeredAddress, #leagueJoinDate").count() == 6
            assert page.locator("#sourcePlace").is_visible() and page.locator("#leagueJoinDate + .date-picker").is_visible()
            assert not page.locator("#partyJoinDate + .date-picker").is_visible()

            page.locator("#backToOverviewBtn").click()
            page.wait_for_function("() => !document.getElementById('profileOverview').hidden")
            assert page.evaluate("() => document.getElementById('section-basic').classList.contains('is-module-hidden')")
            assert page.evaluate("() => location.hash === '#profile-overview'"), "返回概览后 hash 应同步"
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("() => !document.getElementById('profileOverview').hidden", timeout=10000)
            print("PASS 返回概览恢复只读视图并在重载后保持")

            # —— 3. 折叠区隐藏字段编辑 → 600ms 自动保存 → 重载仍在 ——
            page.locator("#profileOverview [data-edit-module='basic']").click()
            page.locator("#section-basic .ext-collapse-toggle").click()
            page.wait_for_function("() => !document.querySelector('#section-basic .ext-collapse-body').hidden")
            page.locator("#section-basic [data-ext-key='bloodType']").fill("A")
            wait_profile_field(page, P1, "basicInfo.bloodType", "A")
            print("PASS 折叠区隐藏字段经 600ms 自动保存写入资料")

            page.reload(wait_until="domcontentloaded")
            ensure_overview(page)
            page.locator("#profileOverview [data-edit-module='basic']").click()
            page.locator("#section-basic .ext-collapse-toggle").click()
            page.wait_for_function("() => !document.querySelector('#section-basic .ext-collapse-body').hidden")
            assert page.locator("#section-basic [data-ext-key='bloodType']").input_value() == "A", "重载后折叠字段值应保留"
            print("PASS 重载后折叠区字段值保留（只折叠不删键）")
            page.screenshot(path=str(OUT / "options-workspace-basic-edit.png"), full_page=False)
            assert page.locator("#homeAddress").input_value() == "广东省深圳市南山区"
            assert page.locator("[data-ext-key^='gaokao'], [data-ext-key='homeDistrict'], #ocrApiKey").count() == 0
            page.locator("#homeAddress").fill("浙江省杭州市西湖区示例路 1 号")
            page.locator("#finishModuleEditBtn").click()
            page.wait_for_function("() => location.hash === '#view-basic'")
            assert "浙江省杭州市西湖区示例路 1 号" in page.locator("#profileOverview").inner_text()
            print("PASS 家庭地址合并并在保存后回到只读查看")

            # —— 4. 求职新增字段与教育高级字段：真实保存、折叠和条目展开 ——
            page.locator("#sidebarMenu [data-module='intention']").click()
            page.locator("#profileOverview [data-edit-module='intention']").click()
            page.locator("#expectedIndustry").fill("金融科技")
            assert page.locator("#acceptAdjustment + .apple-select-wrapper, label[for='acceptAdjustment']").first.is_visible()
            page.locator(".optional-job-fields summary").click()
            page.locator("#currentSalary").fill("15k/月")
            wait_profile_field(page, P1, "jobIntention.expectedIndustry", "金融科技")
            wait_profile_field(page, P1, "jobIntention.currentSalary", "15k/月")
            print("PASS 期望行业与当前薪资自动保存")

            page.locator("#sidebarMenu [data-module='education']").click()
            page.locator("#profileOverview [data-edit-module='education']").click()
            page.wait_for_function("() => !document.getElementById('section-education').classList.contains('is-module-hidden')")
            education_card = page.locator("#educationList .item-card").first
            assert education_card.locator("[data-ext-key='gpaScale']").is_visible(), "绩点满分应和 GPA 一起可见"
            education_supplement = education_card.locator(".ext-collapse").filter(has_text="学籍与证明")
            assert education_supplement.locator(".ext-collapse-body").evaluate("el => el.hidden"), "学籍与证明应默认折叠"
            education_supplement.locator(".ext-collapse-toggle").click()
            education_card.locator("[data-ext-key='studentId']").fill("20260001")
            wait_profile_field_contains(page, P1, "education.studentId", "20260001")
            education_card.locator(".item-collapse-btn").click()
            assert education_card.locator(".item-card-body").evaluate("el => el.hidden"), "教育条目应可收起"
            education_card.locator(".item-collapse-btn").click()
            assert not education_card.locator(".item-card-body").evaluate("el => el.hidden"), "教育条目应可重新展开"
            page.screenshot(path=str(OUT / "options-workspace-education.png"), full_page=False)
            print("PASS 教育高级字段保存与条目收起/展开")

            page.locator("#sidebarMenu [data-module='languageCertificates']").click()
            page.locator("#profileOverview [data-edit-module='languageCertificates']").click()
            language_section = page.locator("#section-languageCertificates")
            language_cards = language_section.locator(".item-card")
            assert language_cards.count() == 4, "两条旧六级冲突、四级和旧小语种备注应全部保留"
            assert language_cards.nth(1).locator("[data-ext-key='score']").input_value() == "580分"
            assert language_cards.nth(3).locator("[data-ext-key='notes']").input_value() == "日语 N3、德语 B2"
            language_cards.nth(0).get_by_role("button", name="设为单项成绩默认").click()
            wait_profile_field(page, P1, "languageCertificates.0.preferred", "是")
            language_section.get_by_role("button", name="＋ 雅思").click()
            new_language = language_cards.last
            assert new_language.locator("[data-ext-key='language']").input_value() == "英语"
            assert new_language.locator("[data-ext-key='name']").input_value() == "IELTS"
            new_language.locator("[data-ext-key='score']").fill("7.5")
            exam_date = new_language.locator("[data-ext-key='obtainedDate'] + .date-picker button")
            exam_date.click()
            calendar = page.locator("#resumeCalendar")
            calendar.locator("[data-view=years]").click()
            calendar.locator("[data-choice='2025']").click()
            calendar.locator("[data-choice='3']").click()
            calendar.get_by_role("button", name="仅保存年月").click()
            page.locator("#finishModuleEditBtn").click()
            wait_profile_field(page, P1, "languageCertificates.4.score", "7.5")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("() => document.getElementById('profileOverview').innerText.includes('7.5')")
            assert "2025-03" in page.locator("#profileOverview").inner_text()
            assert language_cards.nth(0).locator(".language-preference").get_attribute("aria-pressed") == "true"
            print("PASS 外语卡片保留旧冲突、快捷新增并保存重载")

            page.locator("#sidebarMenu [data-module='awards']").click()
            page.locator("#profileOverview [data-edit-module='awards']").click()
            award_card = page.locator("#awardsList .item-card").first
            for key in ["grade", "issuer", "description"]:
                assert award_card.locator(f"[data-ext-key='{key}']").is_visible(), f"奖项常用字段应直接可见: {key}"
            assert not award_card.locator("[data-ext-key='rank']").is_visible()
            award_card.locator("[data-ext-key='issuer']").fill("示例颁奖机构")
            wait_profile_field(page, P1, "awards.0.issuer", "示例颁奖机构")
            print("PASS 奖项常用字段直接编辑并保存")

            # —— 5. 教育经历增删 ——
            page.locator("#sidebarMenu [data-module='education']").click()
            page.locator("#profileOverview [data-edit-module='education']").click()
            page.wait_for_function("() => !document.getElementById('section-education').classList.contains('is-module-hidden')")
            before = page.locator("#educationList .item-card").count()
            page.locator("#addEducationBtn").click()
            page.wait_for_function(
                "(expected) => document.querySelectorAll('#educationList .item-card').length === expected",
                arg=before + 1, timeout=8000,
            )
            page.locator("#educationList .item-card").last.locator(".edu-school").fill("测试大学（虚构）")
            page.locator("#educationList .item-card").last.locator(".btn-delete").click()
            page.locator(".apple-modal-overlay .btn-modal-confirm").click()
            page.wait_for_function(
                "(expected) => document.querySelectorAll('#educationList .item-card').length === expected",
                arg=before, timeout=8000,
            )
            print("PASS 教育经历新增后删除（含确认弹窗）")

            for module, button_id, list_id, field, title in (
                ("education", "addEducationBtn", "educationList", ".edu-school", "第二所示例大学"),
                ("internship", "addWorkBtn", "workList", ".work-company", "第二家实习单位"),
                ("projects", "addProjectBtn", "projectList", ".proj-name", "第二条示例项目"),
            ):
                page.locator(f"#sidebarMenu [data-module='{module}']").click()
                page.locator(f"#profileOverview [data-edit-module='{module}']").click()
                page.locator(f"#{button_id}").click()
                cards = page.locator(f"#{list_id} .item-card:visible")
                cards.last.locator(field).fill(title)
                cards.last.locator("[data-move-entry='up']").click()
                assert cards.first.locator(field).input_value() == title
                assert not cards.first.locator("[data-move-entry='up']").is_enabled()
                page.locator("#finishModuleEditBtn").click()
                rows = page.locator("#profileOverview .experience-preview")
                assert rows.first.locator("h4").inner_text() == title
                rows.first.locator("[data-move-entry='down']").click()
                assert rows.last.locator("h4").inner_text() == title
                rows.last.locator("[data-move-entry='up']").click()
                page.wait_for_function("() => !profileDirty")
                page.reload(wait_until="domcontentloaded")
                assert rows.first.locator("h4").inner_text() == title
            print("PASS 教育、实习、项目在编辑与查看态可排序并在重载后保留")

            # —— 5. 空模块主动添加：论文初始不在主导航，经“添加更多模块”启用 ——
            assert page.locator("#sidebarMenu [data-module='papers']").count() == 0, "空论文模块不应出现在主导航"
            assert not page.locator("#sidebarMore").is_hidden(), "侧栏应显示“添加更多模块”分组"
            page.locator("#sidebarMoreToggle").click()
            page.locator("#sidebarMoreList [data-add-module='papers']").click()
            page.wait_for_function("() => !document.getElementById('section-papers').classList.contains('is-module-hidden')")
            assert page.locator("#sidebarMenu [data-module='papers']").count() == 1, "启用后论文应进入主导航"
            page.locator("#section-papers .btn-add-entry").click()
            page.wait_for_selector("#section-papers [data-ext-list='papers'] .item-card", timeout=8000)
            print("PASS 空模块经“添加更多模块”主动添加并进入编辑")

            # 显式启用的空模块在刷新后保留
            page.wait_for_timeout(900)
            page.reload(wait_until="domcontentloaded")
            ensure_overview(page)
            assert page.locator("#sidebarMenu [data-module='papers']").count() == 1, "已启用的论文模块应保留"
            page.goto(origin + "/options/options.html#section-papers")
            page.locator("#section-papers .btn-add-entry").click()
            page.wait_for_selector("#section-papers [data-ext-key='name']", timeout=8000)
            page.locator("#section-papers [data-ext-key='name']").last.fill("测试论文：分布式简历解析")
            wait_profile_field_contains(page, P1, "papers.name", "测试论文：分布式简历解析")
            page.reload(wait_until="domcontentloaded")
            ensure_overview(page)
            assert page.locator("#sidebarMenu [data-module='papers']").count() == 1, "有业务数据后论文模块常驻主导航"
            assert "测试论文" in page.locator("#profileOverview").inner_text(), "概览应出现论文摘要卡"
            print("PASS 论文填入业务数据后常驻导航并进入概览")

            # 在校职务作为可选模块：添加、保存并在重载后保留
            page.locator("#sidebarMoreToggle").click()
            page.locator("#sidebarMoreList [data-add-module='campusPositions']").click()
            page.locator("#section-campusPositions .btn-add-entry").click()
            page.wait_for_selector("#section-campusPositions [data-ext-key='organization']", timeout=8000)
            page.locator("#section-campusPositions [data-ext-key='organization']").fill("测试学生组织")
            page.locator("#section-campusPositions [data-ext-key='title']").fill("办公室主任")
            wait_profile_field_contains(page, P1, "campusPositions.organization", "测试学生组织")
            page.reload(wait_until="domcontentloaded")
            ensure_overview(page)
            assert page.locator("#sidebarMenu [data-module='campusPositions']").count() == 1, "在校职务有数据后应保留在导航"
            assert "测试学生组织" in page.locator("#profileOverview").inner_text(), "概览应显示在校职务"
            print("PASS 在校职务可选模块添加、持久化与概览")

            # —— 6. AI 完成路径刷新概览/右栏；重复附件渲染不叠加；切换资料清理孤儿模块 ——
            page.evaluate("""() => fillParsedData({
              basicInfo: { fullName: 'AI 新姓名', idCard: '110101199001011234' },
              workExperience: [
                { company: '甲公司', position: '后端实习生', startDate: '2025-01', endDate: '2025-03' },
                { company: '乙公司', position: '算法实习生', startDate: '2025-04', endDate: '2025-06' }
              ],
              papers: [{ name: 'AI 新增论文', publisher: '测试会议', date: '2026-01' }]
            })""")
            page.wait_for_function("() => document.getElementById('profileOverview')?.textContent.includes('AI 新姓名')", timeout=10000)
            assert "AI 新增论文" in page.locator("#profileOverview").inner_text(), "AI 完成后概览应出现新论文"
            assert page.locator("#idCard").input_value() == "110101199001011234", "AI 解析证件号应回填到表单"
            assert "工作 2" in page.locator("#railProfileMeta").inner_text(), "AI 完成后右栏工作计数应刷新"
            print("PASS AI 解析完成路径同步概览与右栏计数")

            page.evaluate("() => { renderAttachmentPanel(); renderAttachmentPanel(); renderAttachmentPanel(); }")
            page.wait_for_timeout(600)
            assert page.locator("#attachmentPanel .attachment-storage-info").count() == 1, "重复渲染只能保留一份存储信息"
            print("PASS 重复附件渲染不叠加异步存储信息")

            page.locator("#sidebarMenu [data-module='papers']").click()
            page.locator("#profileOverview [data-edit-module='papers']").click()
            page.wait_for_function("() => !document.getElementById('section-papers').classList.contains('is-module-hidden')")

            # —— 7. 资料切换：右栏常驻简历列表切到第二份资料 ——
            page.locator("#navProfileDropdownMenu .nav-dropdown-item", has_text="外企-英文版").click()
            page.wait_for_function(
                "() => document.getElementById('railProfileName')?.textContent === '外企-英文版'", timeout=10000,
            )
            page.wait_for_function("() => document.getElementById('profileOverview')?.textContent.includes('李雷')", timeout=10000)
            assert page.evaluate("() => document.getElementById('fullName')?.value === '李雷'"), "切换后表单应加载第二份资料"
            assert not page.locator("#profileOverview").is_hidden(), "空论文资料切换后应回到概览"
            assert page.evaluate("() => location.hash === '#profile-overview'"), "孤儿模块清理后 hash 应为概览"
            assert page.evaluate("() => document.getElementById('section-papers').classList.contains('is-module-hidden')"), "空论文表单不应成为孤儿编辑页"
            print("PASS 右栏下拉切换简历资料并刷新概览、清理空模块")
            page.screenshot(path=str(OUT / "options-workspace-switched.png"), full_page=False)

            # —— 7. 布局退化：1024 与 390 ——
            page.set_viewport_size({"width": 1024, "height": 800})
            page.wait_for_timeout(250)
            assert_no_horizontal_overflow(page, "1024px")
            main_box = page.locator(".profile-main").bounding_box()
            rail_box = page.locator("#profileRail").bounding_box()
            assert rail_box and main_box and rail_box["y"] >= main_box["y"], "1024px 右栏应换行到主列下方"
            print("PASS 1024px 两栏退化、右栏换行")

            page.set_viewport_size({"width": 390, "height": 760})
            page.wait_for_timeout(250)
            assert_no_horizontal_overflow(page, "390px")
            assert page.locator("#sidebarMenu").is_visible(), "390px 侧栏导航应可见"
            mobile_menu = page.locator("#sidebarMenu").evaluate("""element => ({
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              overflowY: getComputedStyle(element).overflowY
            })""")
            assert mobile_menu["overflowY"] == "visible" and mobile_menu["scrollHeight"] <= mobile_menu["clientHeight"] + 1, f"390px 模块菜单不应裁切或嵌套滚动: {mobile_menu}"
            assert page.locator("#profileOverview").is_visible(), "390px 概览应可见"
            assert page.locator("#profileRail").is_visible(), "390px 右栏操作应可见"
            mobile_grid = page.evaluate("""() => {
              const grid = document.querySelector('.overview-grid');
              const main = document.querySelector('.profile-main');
              const card = document.querySelector('.overview-card');
              if (!grid || !main || !card) return { ok: false };
              const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
              const mainBox = main.getBoundingClientRect();
              const cardBox = card.getBoundingClientRect();
              return { ok: columns === 1 && Math.abs(cardBox.left - mainBox.left) < 2 && cardBox.width >= mainBox.width - 2,
                columns, mainWidth: mainBox.width, cardWidth: cardBox.width };
            }""")
            assert mobile_grid["ok"], f"390px 概览卡应单列且占满中栏: {mobile_grid}"
            page.screenshot(path=str(OUT / "options-workspace-390.png"), full_page=False, animations="disabled")
            print("PASS 390px 单列退化、模块完整显示且无溢出")

            page.set_viewport_size({"width": 320, "height": 740})
            page.wait_for_timeout(200)
            assert_no_horizontal_overflow(page, "320px")
            page.screenshot(path=str(OUT / "options-workspace-320.png"), full_page=False, animations="disabled")
            print("PASS 320px 工作区无溢出")

            page.set_viewport_size({"width": 1440, "height": 900})
            page.wait_for_timeout(250)
            assert_no_horizontal_overflow(page, "1440px")
            rail_box = page.locator("#profileRail").bounding_box()
            main_box = page.locator(".profile-main").bounding_box()
            assert rail_box["x"] > main_box["x"], "1440px 右栏应回到主列右侧（三栏）"
            print("PASS 1440px 三栏布局恢复")

            assert page.locator("#tabBtnKanban, #tabBtnHelp, #tabBtnLogs").count() == 0
            page.evaluate("() => { location.hash = 'kanban'; }")
            page.wait_for_selector("#profileOverview", state="visible")
            print("PASS 旧看板链接回到简历资料")

            before = page.locator("#profileOverview .overview-name").inner_text()
            page.locator("#addProfileBtn").click()
            create = page.locator(".profile-create-dialog")
            create.get_by_label("简历名称").fill("复制测试简历")
            create.get_by_label("复制已有简历").check()
            assert create.get_by_label("来源简历").is_visible()
            create.get_by_role("button", name="创建简历").click()
            page.wait_for_function("() => document.querySelector('.ov-wb-resume-name')?.textContent === '复制测试简历'")
            assert page.locator("#profileOverview .overview-name").inner_text() == before
            print("PASS 复制简历后切换到独立副本")

            page.locator("#profileOverview [data-create-profile]").click()
            create.get_by_label("简历名称").fill("空白测试简历")
            assert create.get_by_label("创建空简历").is_checked()
            create.get_by_role("button", name="创建简历").click()
            page.wait_for_function("() => document.querySelector('.ov-wb-resume-name')?.textContent === '空白测试简历'")
            assert page.locator("#profileOverview .overview-name").inner_text() == "未填写姓名"
            print("PASS 创建空简历不带入原资料")

            delete_profile = page.locator("#deleteProfileRailBtn")
            assert delete_profile.is_enabled(), "多份简历时右栏删除入口应可用"
            delete_profile.click()
            page.evaluate("() => deleteCurrentProfile()")
            assert page.locator(".apple-modal-overlay").count() == 1, "重复激活删除入口只能打开一个确认框"
            assert delete_profile.is_disabled(), "确认与删除期间入口应禁用"
            assert "空白测试简历" in page.locator(".apple-modal-subtitle").inner_text()
            page.get_by_role("button", name="取消").click()
            assert delete_profile.is_enabled(), "取消删除后应恢复入口"
            assert page.locator(".ov-wb-resume-name").inner_text() == "空白测试简历", "取消删除不应切换或移除简历"
            page.evaluate("() => { window.__failNextGetAllProfiles = true; }")
            delete_profile.click()
            page.get_by_role("button", name="确定删除").click()
            page.wait_for_function("""() => {
              const data = JSON.parse(localStorage.getItem('capybara-options-test-state') || 'null');
              return data && !data.profiles.some(profile => profile.name === '空白测试简历');
            }""")
            page.wait_for_function("() => document.getElementById('toast')?.textContent.includes('资料已删除，但列表刷新失败')")
            assert page.evaluate("() => window.__deletedProfileIds.length") == 1, "重复激活入口不能产生第二个删除请求"
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#profileOverview .overview-card", timeout=15000)
            assert page.locator("#navProfileDropdownMenu").get_by_text("空白测试简历", exact=True).count() == 0
            print("PASS 右栏删除入口支持防重入、取消、二次确认、删除后刷新及刷新失败提示")

            page.locator("#tabBtnProfile").click()
            page.wait_for_function("() => location.hash === '#profile-overview'")

            ensure_overview(page)
            page.locator("#themeToggle").click()
            page.wait_for_function("() => document.documentElement.dataset.theme === 'dark'")
            page.wait_for_timeout(350)
            page.screenshot(path=str(OUT / "options-workspace-dark-overview.png"), full_page=False)
            page.set_viewport_size({"width": 390, "height": 760})
            page.wait_for_timeout(200)
            assert_no_horizontal_overflow(page, "390px 深色")
            page.screenshot(path=str(OUT / "options-workspace-dark-390.png"), full_page=False)
            print("PASS 深浅主题切换与 390px 深色布局")

            page.evaluate("""() => {
              const key = 'capybara-options-test-state';
              const data = JSON.parse(localStorage.getItem(key));
              data.profiles = data.profiles.slice(0, 1);
              data.activeProfileId = data.profiles[0].id;
              localStorage.setItem(key, JSON.stringify(data));
            }""")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("() => document.getElementById('deleteProfileRailBtn')?.disabled")
            assert page.locator("#deleteProfileRailBtn").is_disabled(), "最后一份简历必须禁用删除入口"
            assert "至少需要保留一份简历" in page.locator("#deleteProfileRailBtn").get_attribute("title")
            print("PASS 最后一份简历禁用删除并显示原因")

            assert not console_errors, f"浏览器 JS 异常: {console_errors}"
            print("PASS 无浏览器运行时异常")
        except Exception:
            page.screenshot(path=str(OUT / "options-workspace-debug.png"), full_page=True)
            print("DEBUG 页面异常:", console_errors)
            raise
        finally:
            context.close()
            browser.close()
            server.shutdown()


def wait_profile_field_contains(page, profile_id: str, dotted_path: str, fragment: str, timeout: int = 9000):
    """列表类字段（如 papers[].name）只需包含断言，不比对整体结构。"""
    page.wait_for_function(
        """([key, pid, path, frag]) => {
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            const data = JSON.parse(raw);
            const profile = (data.profiles || []).find((p) => p.id === pid);
            if (!profile) return false;
            const listName = path.split('.')[0];
            const field = path.split('.')[1];
            const list = profile[listName];
            return Array.isArray(list) && list.some((item) => String(item && item[field] || '').includes(frag));
        }""",
        arg=[STATE_KEY, profile_id, dotted_path, fragment], timeout=timeout,
    )


if __name__ == "__main__":
    main()
