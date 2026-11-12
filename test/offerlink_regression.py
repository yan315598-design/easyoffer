#!/usr/bin/env python3
"""OfferLink myResume 本地真实浏览器回归：折叠模块、条目新增、多条目映射与逐条保存停止。

运行方式（只访问本机 HTTP server，不访问外网、不提交、不保存）：
    python test/offerlink_regression.py

依赖：本机 Chrome/Edge + Python Playwright；可用 CHROME_PATH 指定浏览器。
"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import sys
import threading
import time
import traceback
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

# 复用既有回归脚本的 Chrome mock 与 demo 数据构造方式；不启动 screenshot.main()
from screenshot import CHROME_MOCK, demo_data

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "job-autofill-assistant"
FIXTURE = ROOT / "test/fixtures/offerlink-regression-form.html"
HOST = "offerlink.tech"
ROUTE = "/myResume"
STRUCTURE_SCRIPT = "scripts/content/structure.js"
CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    str(Path.home() / ".local/bin/google-chrome"),
]

FILL_JS = """async ([profile, mode]) => {
  if (typeof fillForm !== 'function') throw new Error('fillForm 未定义');
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('fillForm 超时（60s）')), 60000));
  const result = await Promise.race([fillForm(profile, { mode }), timeout]);
  return {
    filledCount: result?.filledCount,
    mode: result?.mode,
    cancelled: !!result?.cancelled,
    skippedCount: result?.skippedCount,
    reviewCount: result?.reviewCount,
    failedCount: result?.failedCount,
    durationMs: result?.durationMs,
    structure: result?.structure || null,
    manualFields: result?.manualFields || [],
    results: (result?.results || []).map((item) => ({
      fieldType: item.fieldType,
      label: item.label,
      status: item.status,
      reason: item.reason,
      value: item.value
    })),
    error: result?.error || '',
    isChat: !!result?.isChat
  };
}"""


class FixtureHandler(http.server.SimpleHTTPRequestHandler):
    """本地 server：/myResume 返回固定 fixture；其余路径服务扩展静态文件（图标等）。"""

    def do_GET(self):
        if self.path.split("?", 1)[0] in (ROUTE, "/myResume.html", "/fixture"):
            body = FIXTURE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, format, *args):
        return


def start_server():
    factory = partial(FixtureHandler, directory=str(EXT))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), factory)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://{HOST}:{server.server_address[1]}"


def chrome_path() -> str:
    for candidate in CHROME_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    raise SystemExit("找不到 Chrome/Edge，请设置 CHROME_PATH")


def read_content_assets():
    manifest_path = EXT / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"找不到 manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("content_scripts") or []
    scripts = []
    styles = []
    for entry in entries:
        scripts.extend(entry.get("js") or [])
        styles.extend(entry.get("css") or [])
    return manifest, scripts, styles


def build_demo_data():
    data = demo_data()
    profile = data["profiles"][0]
    profile["name"] = "OfferLink 回归测试资料（虚构）"
    profile["basicInfo"] = {
        "fullName": "林知远",
        "firstName": "知远",
        "lastName": "林",
        "phone": "13800000000",
        "email": "lin.zhiyuan@example.com",
        "gender": "男",
        "birthDate": "2002-01-15",
        "politicalStatus": "共青团员",
        "ethnicity": "汉族",
        "hometown": "浙江杭州",
        "sourcePlace": "广东深圳罗湖区",
        "registeredAddress": "广东深圳未知区",
        "graduationDate": "2026-06",
        "currentCity": "北京市海淀区",
        "state": "北京市",
        "city": "北京市",
        "country": "中国",
        "location": "北京市海淀区",
        "homeProvince": "浙江省",
        "homeCity": "杭州市",
        "homeDistrict": "西湖区",
        "homeAddress": "浙江省杭州市西湖区文三路100号2幢301室",
        "street": "北京市海淀区学院路37号院6号楼",
        "wechat": "lin_test_2026",
    }
    profile["jobIntention"] = {
        "expectedCity": "北京市",
        "expectedPosition": "后端开发工程师",
        "expectedSalary": "18k-25k",
        "availableDate": "2026年7月",
        "recruitSource": "校招官网",
    }
    profile["education"] = [
        {
            "id": "edu_offerlink_1",
            "school": "示例大学",
            "college": "计算机学院",
            "major": "计算机科学与技术",
            "degree": "硕士研究生",
            "gpa": "3.9/5.0",
            "studentId": "TEST2026001",
            "majorCategory": "工学",
            "schoolProvince": "北京市",
            "schoolCity": "北京市",
            "schoolDistrict": "海淀区",
        },
        {
            "id": "edu_offerlink_2",
            "school": "虚构理工大学",
            "college": "经济学院",
            "major": "金融学",
            "degree": "本科",
            "gpa": "4.1/5.0",
            "studentId": "TEST2026002",
            "majorCategory": "经济学",
            "schoolProvince": "上海市",
            "schoolCity": "上海市",
            "schoolDistrict": "杨浦区",
        },
    ]
    profile["projects"] = [
        {
            "id": "proj_offerlink_1",
            "name": "项目甲：离线简历解析服务",
            "role": "项目负责人",
            "startDate": "2025-03",
            "endDate": "2025-08",
            "description": "项目甲描述：构建离线简历解析服务。",
            "responsibilities": "项目甲职责：负责服务拆分与模型评测。",
            "achievements": "项目甲业绩：解析准确率提升20%。",
            "techStack": "Python, FastAPI",
        },
        {
            "id": "proj_offerlink_2",
            "name": "项目乙：数据指标看板",
            "role": "核心开发",
            "startDate": "2024-09",
            "endDate": "2025-01",
            "description": "项目乙描述：搭建数据指标看板。",
            "responsibilities": "项目乙职责：负责数据管道与前端联调。",
            "achievements": "项目乙业绩：查询延迟降低35%。",
            "techStack": "TypeScript, React",
        },
    ]
    profile["certificates"] = [
        {
            "id": "cert_offerlink_1",
            "name": "软件设计师",
            "date": "2024-05-25",
            "level": "中级",
            "code": "CERT-2024-0001",
            "issuer": "工业和信息化部教育与考试中心",
            "description": "证书描述一：软件设计师中级。",
        },
        {
            "id": "cert_offerlink_2",
            "name": "云计算工程师",
            "date": "2025-06-10",
            "level": "高级",
            "code": "CERT-2025-0002",
            "issuer": "中国电子学会",
            "description": "证书描述二：云计算高级。",
        },
    ]
    profile["languageSkills"] = {
        "cet4": "590分",
        "cet6": "558分",
        "ielts": "6.0",
        "toefl": "",
        "otherLanguages": "日语 N3",
    }
    profile["languageCertificates"] = [
        {
            "id": "lang_offerlink_1",
            "name": "大学英语六级（CET-6）",
            "level": "CET-6",
            "score": "612",
            "obtainedDate": "2023-12-16",
            "proficiency": "熟练",
            "listeningSpeaking": "良好",
            "readingWriting": "优秀",
        },
        {
            "id": "lang_offerlink_2",
            "name": "雅思（IELTS）",
            "level": "7.5",
            "score": "7.5",
            "obtainedDate": "2025-03-08",
            "proficiency": "熟练",
            "listeningSpeaking": "流利",
            "readingWriting": "良好",
        },
    ]
    profile["trainings"] = [
        {
            "id": "training_offerlink_1",
            "name": "数据分析培训",
            "institution": "示例培训机构",
            "startDate": "2024-02",
            "endDate": "2024-03",
            "description": "数据可视化与统计分析。",
        },
        {
            "id": "training_offerlink_2",
            "name": "云计算培训",
            "institution": "虚构培训中心",
            "startDate": "2025-02",
            "endDate": "2025-04",
            "description": "容器与云原生基础。",
        },
    ]
    profile["workExperience"] = []
    profile["awards"] = []
    profile["familyMembers"] = []
    profile["skills"] = ["Python", "FastAPI", "TypeScript"]
    profile["introTemplates"] = {"default": "虚构测试自我介绍。", "custom": []}
    data["activeProfileId"] = profile["id"]
    data["settings"]["autoFillOnPageLoad"] = False
    return data, profile


def load_fixture_page(context, origin, scripts, styles, errors=None, label="page"):
    page = context.new_page()
    page.set_default_timeout(15000)
    if errors is not None:
        page.on("pageerror", lambda error: errors.append(f"{label}: {error}"))
    page.goto(origin + ROUTE, wait_until="domcontentloaded", timeout=30000)
    for rel in styles:
        page.add_style_tag(path=str(EXT / rel))
    for rel in scripts:
        page.add_script_tag(path=str(EXT / rel))
    page.wait_for_function("() => typeof fillForm === 'function'", timeout=15000)
    page.wait_for_selector("#job-autofill-dock", timeout=15000)
    return page


def run_fill(page, profile, mode):
    return page.evaluate(FILL_JS, [profile, mode])


def value_of(page, selector):
    return page.evaluate("(selector) => document.querySelector(selector)?.value ?? null", selector)


def expect_value(page, selector, expected, context):
    actual = value_of(page, selector)
    if actual != expected:
        raise AssertionError(f"{context}：{selector} = {actual!r}，期望 {expected!r}")


def item_counts(page):
    return page.evaluate(
        """() => ({
          education: document.querySelectorAll('#education .experience-item').length,
          projects: document.querySelectorAll('#projectExperience .experience-item').length,
          certificates: document.querySelectorAll('#certificates .experience-item').length,
          languages: document.querySelectorAll('#languageSkills .experience-item').length,
          trainings: document.querySelectorAll('#trainings .experience-item').length
        })"""
    )


def section_state(page, section_id):
    return page.evaluate(
        """(id) => {
          const section = document.getElementById(id);
          const header = section?.querySelector('.section-header');
          const firstInput = section?.querySelector('input,textarea,select');
          return {
            exists: !!section,
            collapsed: !!section?.classList.contains('is-collapsed'),
            expanded: header?.getAttribute('aria-expanded') || '',
            firstFieldVisible: !!firstInput && firstInput.getBoundingClientRect().height > 0
          };
        }""",
        section_id,
    )


def danger_state(page):
    return page.evaluate(
        """() => ({
          counters: { ...(window.__offerlinkDangerClicks || {}) },
          clicks: [...(window.__offerlinkButtonClicks || [])]
        })"""
    )


def assert_danger_untouched(page, phase):
    state = danger_state(page)
    expected = {"save": 0, "cancel": 0, "delete": 0, "confirm": 0}
    if state["counters"] != expected:
        raise AssertionError(f"{phase}：危险按钮被点击，计数 {state['counters']!r}")
    forbidden = ("保存并同步", "取消", "删除", "确定")
    hit = [text for text in state["clicks"] if any(word in text for word in forbidden)]
    if hit:
        raise AssertionError(f"{phase}：出现危险按钮点击 {hit!r}")
    return state


def snapshot_values(page):
    ids = [
        "homeProvince", "homeCity", "homeDistrict", "schoolProvince", "schoolCity",
        "schoolDistrict", "street", "homeAddress", "school1", "studentId1", "majorCategory1",
        "gpa1", "school2", "studentId2", "majorCategory2", "gpa2", "projectName1",
        "projectRole1", "projectDescription1", "projectResponsibilities1", "projectAchievements1",
        "projectName2", "projectDescription2", "certName1", "certDate1", "certCode1",
        "certName2", "certDate2", "certCode2", "langName1", "langScore1", "langDate1",
        "langName2", "langScore2", "langDate2", "trainingName1"
    ]
    return page.evaluate(
        """(ids) => Object.fromEntries(ids.map((id) => {
          const el = document.getElementById(id);
          return [id, el ? el.value : null];
        }))""",
        ids,
    )


def print_failure_debug(page, result_full, errors):
    print("DEBUG 页面异常:", errors)
    if not page:
        return
    try:
        print("DEBUG url:", page.url)
    except Exception as error:
        print("DEBUG url 读取失败:", error)
    for label, getter in (
        ("danger", lambda: danger_state(page)),
        ("counts", lambda: item_counts(page)),
        ("certificate-section", lambda: section_state(page, "certificates")),
        ("values", lambda: snapshot_values(page)),
        ("range-detection", lambda: page.evaluate("""() => ['projectDateRange1','projectDateRange2'].map(id => {
          const el = document.getElementById(id);
          return { id, value: el?.value, field: el ? detectField(el) : null, ignored: el ? isIgnoredInput(el) : true,
            visible: el ? isElementTrulyVisible(el) : false, section: el ? nearestSectionKind(el) : '' };
        })""")),
    ):
        try:
            print(f"DEBUG {label}:", getter())
        except Exception as error:
            print(f"DEBUG {label} 读取失败:", error)
    if result_full:
        print("DEBUG fill 摘要:", {
            key: result_full.get(key)
            for key in ("filledCount", "durationMs", "structure", "failedCount", "reviewCount", "error")
        })
        non_filled = [item for item in result_full.get("results", []) if item.get("status") != "filled"]
        print("DEBUG 非 filled 字段:", non_filled[:40])


def main():
    started = time.perf_counter()
    if not FIXTURE.exists():
        print(f"FAIL fixture 不存在: {FIXTURE}")
        return 2
    if not EXT.exists():
        print(f"FAIL 扩展目录不存在: {EXT}")
        return 2

    manifest, scripts, styles = read_content_assets()
    if STRUCTURE_SCRIPT not in scripts:
        print(f"FAIL manifest 未注册 {STRUCTURE_SCRIPT}")
        print(f"  当前 content_scripts JS 顺序: {scripts}")
        print("  fillForm 将无法调用 prepareFormStructure：折叠的证书模块不会展开，项目/证书条目也不会按资料新增。")
        print("  本测试按约定直接失败，不会手动注入 structure.js 掩盖 manifest 缺口。")
        print("  修复：把 \"scripts/content/structure.js\" 加入 job-autofill-assistant/manifest.json 的 content_scripts[].js（建议位于 fill-engine.js 之前）后重跑。")
        return 2

    data, profile = build_demo_data()
    payload = json.dumps(data, ensure_ascii=False)
    chrome = chrome_path()
    server, origin = start_server()
    errors = []
    page = None
    result_full = None
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=chrome,
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--no-proxy-server",
                    f"--host-resolver-rules=MAP {HOST} 127.0.0.1",
                ],
            )
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, locale="zh-CN")
            context.add_init_script(f"window.__CAPYBARA_DEMO__ = {payload};")
            context.add_init_script(CHROME_MOCK)
            try:
                page = load_fixture_page(context, origin, scripts, styles, errors=errors, label="full")
                print(f"PASS manifest 按顺序加载 {len(scripts)} 个 JS、{len(styles)} 个 CSS，包括 {STRUCTURE_SCRIPT}")
                if page.evaluate("() => typeof prepareFormStructure") != "function":
                    raise AssertionError("structure.js 已在 manifest，但页面中未加载出 prepareFormStructure")

                initial_counts = item_counts(page)
                cert_initial = section_state(page, "certificates")
                more_before = page.locator("#expandBasicMore").get_attribute("aria-expanded")
                if initial_counts != {"education": 2, "projects": 1, "certificates": 1, "languages": 2, "trainings": 1}:
                    raise AssertionError(f"fixture 初始条目数异常: {initial_counts}")
                if not cert_initial["collapsed"] or cert_initial["expanded"] != "false" or cert_initial["firstFieldVisible"]:
                    raise AssertionError(f"证书模块初始应折叠: {cert_initial}")
                if more_before != "false" or page.locator("#street").is_visible():
                    raise AssertionError("基本信息更多字段初始应隐藏")
                print("PASS 初始状态：证书折叠、更多个人信息字段隐藏、条目数符合 fixture")

                # 隐藏语言分区标题，验证 data-profile-section 仍能阻止普通证书日期串用。
                page.evaluate("() => document.querySelector('#languageSkills .section-title')?.remove()")
                result_full = run_fill(page, profile, "full")
                if result_full.get("error"):
                    raise AssertionError(f"fillForm 返回错误: {result_full['error']}")
                if result_full.get("mode") != "full" or result_full.get("cancelled"):
                    raise AssertionError(f"fillForm 模式/取消状态异常: {result_full.get('mode')} / {result_full.get('cancelled')}")
                if not isinstance(result_full.get("durationMs"), (int, float)) or result_full["durationMs"] < 0:
                    raise AssertionError(f"durationMs 缺失或非法: {result_full.get('durationMs')!r}")
                structure = result_full.get("structure")
                if not isinstance(structure, dict):
                    raise AssertionError(f"fillForm 结果缺少 structure: {structure!r}")
                for key in ("expanded", "added", "failed", "manual", "totalMs"):
                    if key not in structure:
                        raise AssertionError(f"structure 缺少 {key}: {structure!r}")
                if not isinstance(structure.get("totalMs"), (int, float)):
                    raise AssertionError(f"structure.totalMs 非法: {structure.get('totalMs')!r}")
                if result_full.get("filledCount", 0) <= 0:
                    raise AssertionError(f"fillForm 未填入任何字段: {result_full!r}")
                print(
                    "PASS fillForm 返回 durationMs/structure："
                    f"durationMs={result_full['durationMs']}, expanded={structure['expanded']}, "
                    f"added={structure['added']}, failed={structure['failed']}, totalMs={structure['totalMs']}"
                )

                cert_after = section_state(page, "certificates")
                if cert_after["collapsed"] or cert_after["expanded"] != "true" or not cert_after["firstFieldVisible"]:
                    raise AssertionError(f"折叠证书模块未被展开: {cert_after}")
                if page.get_attribute("#expandBasicMore", "aria-expanded") != "true" or not page.locator("#street").is_visible():
                    raise AssertionError("更多个人信息字段未被展开")
                print("PASS 折叠证书模块与更多个人信息字段均已展开")
                expect_value(page, "#widgetBirthday", "2002-01-15", "日期跳年与月份选择")
                if page.locator("#widgetGender + .el-select__selected-item").inner_text() != "男":
                    raise AssertionError("性别下拉应选中组件显示值")
                expect_value(page, "#widgetStudentOrigin", "中国 / 广东省 / 深圳市 / 罗湖区", "地区选中完整路径")
                expect_value(page, "#widgetBadRegion", "", "无匹配区县不得写入搜索词或选中上级")
                expect_value(page, "#widgetBirthPlace", "", "籍贯不能填入出生地")
                for field in ("生日", "性别", "生源地"):
                    rows = [row for row in result_full["results"] if row["label"] == field]
                    if len(rows) != 1 or rows[0]["status"] != "filled":
                        raise AssertionError(f"{field} 必须按控件选中结果统计一次：{rows!r}")
                print("PASS Element Plus 日期、下拉回读、地区级联及独立地址语义")

                after_counts = item_counts(page)
                expected_counts = {"education": 2, "projects": 2, "certificates": 2, "languages": 2, "trainings": 1}
                if after_counts != expected_counts:
                    raise AssertionError(f"新增条目数量异常: {after_counts}，期望 {expected_counts}")
                added_by_dom = (after_counts["projects"] - initial_counts["projects"]) + (after_counts["certificates"] - initial_counts["certificates"])
                if structure["added"] != added_by_dom or structure["added"] != 2:
                    raise AssertionError(f"structure.added 与新增条目不符: {structure['added']} / DOM {added_by_dom}")
                if structure["failed"] != 1 or not any("trainings" in str(item) for item in structure.get("manual") or []):
                    raise AssertionError(f"逐条保存模块未按失败停止: failed={structure['failed']}, manual={structure.get('manual')!r}")
                if structure["expanded"] < 2:
                    raise AssertionError(f"展开次数不足（证书 + 更多字段）: {structure['expanded']}")
                print("PASS 项目/证书新增数量准确，逐条保存模块停止新增并记录失败")

                basic = profile["basicInfo"]
                edu1, edu2 = profile["education"]
                for selector, expected, label in (
                    ("#homeProvince", basic["homeProvince"], "家庭所在地区"),
                    ("#homeCity", basic["homeCity"], "家庭所在城市"),
                    ("#homeDistrict", basic["homeDistrict"], "家庭所在区县"),
                    ("#schoolProvince", edu1["schoolProvince"], "学校所在地区"),
                    ("#schoolCity", edu1["schoolCity"], "学校所在城市"),
                    ("#schoolDistrict", edu1["schoolDistrict"], "学校所在区县"),
                    ("#street", basic["street"], "详细地址"),
                    ("#homeAddress", basic["homeAddress"], "家庭地址"),
                ):
                    expect_value(page, selector, expected, label)
                print("PASS 家庭/学校/详细地址/家庭地址各自正确")

                for selector, expected, label in (
                    ("#school1", edu1["school"], "第一段学校"),
                    ("#studentId1", edu1["studentId"], "第一段学号"),
                    ("#majorCategory1", edu1["majorCategory"], "第一段专业分类"),
                    ("#gpa1", edu1["gpa"], "第一段 GPA"),
                    ("#school2", edu2["school"], "第二段学校"),
                    ("#studentId2", edu2["studentId"], "第二段学号"),
                    ("#majorCategory2", edu2["majorCategory"], "第二段专业分类"),
                    ("#gpa2", edu2["gpa"], "第二段 GPA"),
                ):
                    expect_value(page, selector, expected, label)
                if value_of(page, "#school1") == value_of(page, "#school2"):
                    raise AssertionError("两段教育经历学校相同，无法验证不串卡片")
                print("PASS 两段教育经历写入正确且未串卡片")

                for index, project in enumerate(profile["projects"], start=1):
                    expect_value(page, f"#projectName{index}", project["name"], f"项目{index}名称")
                    expect_value(page, f"#projectRole{index}", project["role"], f"项目{index}角色")
                    expected_range = f"{project['startDate']} 至 {project['endDate']}"
                    if value_of(page, f"#projectDateRange{index}") != expected_range:
                        print("DEBUG range live:", page.evaluate("""id => { const el = document.getElementById(id); return {
                          value: el?.value, detection: el ? detectField(el) : null, ignored: el ? isIgnoredInput(el) : true,
                          visible: el ? isElementTrulyVisible(el) : false, section: el ? nearestSectionKind(el) : '',
                          results: window.__lastFillResult?.results?.filter(row => row.element === el) || []
                        }; }""", f"projectDateRange{index}"))
                    expect_value(page, f"#projectDateRange{index}", expected_range, f"项目{index}完整起止日期")
                    expect_value(page, f"#projectResponsibilities{index}", project["responsibilities"], f"项目{index}职责")
                    expect_value(page, f"#projectAchievements{index}", project["achievements"], f"项目{index}业绩")
                    description = value_of(page, f"#projectDescription{index}") or ""
                    if not description.strip():
                        raise AssertionError(f"项目{index}详细信息为空")
                    if project["description"] not in description:
                        raise AssertionError(f"项目{index}详细信息未包含资料描述: {description!r}")
                print("PASS 两条项目写入正确，第二条与详细信息均有值")

                for index, certificate in enumerate(profile["certificates"], start=1):
                    for field, selector in (
                        ("name", f"#certName{index}"),
                        ("date", f"#certDate{index}"),
                        ("level", f"#certLevel{index}"),
                        ("code", f"#certCode{index}"),
                        ("issuer", f"#certIssuer{index}"),
                        ("description", f"#certDescription{index}"),
                    ):
                        expect_value(page, selector, certificate[field], f"证书{index} {field}")
                print("PASS 两条证书写入正确（含折叠展开后的第二张卡片）")

                languages = profile["languageCertificates"]
                for index, language in enumerate(languages, start=1):
                    for field, selector in (
                        ("name", f"#langName{index}"),
                        ("level", f"#langLevel{index}"),
                        ("score", f"#langScore{index}"),
                        ("obtainedDate", f"#langDate{index}"),
                        ("proficiency", f"#langProficiency{index}"),
                        ("listeningSpeaking", f"#langListening{index}"),
                        ("readingWriting", f"#langWriting{index}"),
                    ):
                        expect_value(page, selector, language[field], f"语言{index} {field}")
                lang_score = value_of(page, "#langScore1")
                lang_date = value_of(page, "#langDate1")
                lang_score2 = value_of(page, "#langScore2")
                lang_date2 = value_of(page, "#langDate2")
                gpa = profile["education"][0]["gpa"]
                legacy_cet6 = profile["languageSkills"]["cet6"]
                cert_dates = {certificate["date"] for certificate in profile["certificates"]}
                if lang_score == gpa or lang_score == legacy_cet6 or lang_score2 == gpa or lang_score2 == legacy_cet6:
                    raise AssertionError(f"英语成绩串用了 GPA/旧 languageSkills: {lang_score!r}, {lang_score2!r}")
                if lang_date in cert_dates or lang_date2 in cert_dates:
                    raise AssertionError(f"英语取得日期串用了普通证书日期: {lang_date!r}, {lang_date2!r}")
                if lang_score != languages[0]["score"] or lang_date != languages[0]["obtainedDate"]:
                    raise AssertionError(f"英语字段不是来自 languageCertificates: score={lang_score!r}, date={lang_date!r}")
                print(f"PASS 英语字段仅取 languageCertificates：成绩={lang_score!r}/{lang_score2!r}，日期={lang_date!r}/{lang_date2!r}，不等于 GPA={gpa!r}/CET6={legacy_cet6!r}/证书日期={sorted(cert_dates)!r}")

                confirm_visible = page.locator("#entryConfirmModal").is_visible()
                if not confirm_visible:
                    raise AssertionError("逐条保存确认弹窗未出现")
                if value_of(page, "#trainingName1") != profile["trainings"][0]["name"]:
                    raise AssertionError("培训第一张卡片未填充")
                if page.locator("#trainingName2").count() != 0:
                    raise AssertionError("逐条保存模块不应新增卡片")
                state = assert_danger_untouched(page, "full")
                if state["clicks"].count("添加培训经历") != 1:
                    raise AssertionError(f"逐条保存模块应只点击一次添加并停止: {state['clicks']!r}")
                print(f"PASS 逐条保存模块停止新增且未点确定，危险按钮计数={state['counters']}")

                if page.url != origin + ROUTE:
                    raise AssertionError(f"页面发生了跳转/提交: {page.url}")
                if page.evaluate("(expected) => window.__CAPYBARA_DEMO__.submissions.length === expected", len(data["submissions"])) is not True:
                    raise AssertionError("投递记录被真实保存")
                if errors:
                    raise AssertionError(f"full 页面 JS 异常: {errors}")
                print("PASS 无页面跳转、无真实保存、无浏览器运行时异常")

                page2 = load_fixture_page(context, origin, scripts, styles, errors=errors, label="incremental")
                before2 = item_counts(page2)
                cert_before2 = section_state(page2, "certificates")
                if not cert_before2["collapsed"]:
                    raise AssertionError("incremental 前证书模块应折叠")
                page2.locator("#school1").fill(profile["education"][1]["school"])
                page2.locator("#projectItems .experience-item").evaluate("(card) => card.classList.add('is-collapsed-item')")
                page2.evaluate("""() => {
                  const section = document.createElement('div');
                  section.className = 'form-section';
                  section.id = 'workExperience';
                  section.innerHTML = `
                    <div class="experience-item">
                      <label for="workCompany">公司名称</label><input id="workCompany" placeholder="请输入公司名称">
                      <label for="workPosition">职位名称</label><input id="workPosition" placeholder="请输入职位名称">
                      <label for="workProof">证明人电话</label><input id="workProof">
                    </div>
                    <div class="experience-item">
                      <label for="existingCompany">公司名称</label><input id="existingCompany" value="其他机构">
                      <label for="existingProof">证明人电话</label><input id="existingProof">
                    </div>`;
                  document.querySelector('main').append(section);
                }""")
                profile["workExperience"] = [{
                    "company": "示例公司", "position": "示例岗位", "workType": "全职", "referencePhone": "01000000000",
                }]
                result_inc = run_fill(page2, profile, "incremental")
                if result_inc.get("error"):
                    raise AssertionError(f"incremental fillForm 返回错误: {result_inc['error']}")
                if result_inc.get("mode") != "incremental" or result_inc.get("cancelled"):
                    raise AssertionError(f"incremental 模式/取消状态异常: {result_inc.get('mode')} / {result_inc.get('cancelled')}")
                if result_inc.get("filledCount", 0) <= 0:
                    raise AssertionError(f"incremental 未填入任何字段: {result_inc!r}")
                structure_inc = result_inc.get("structure")
                if not isinstance(structure_inc, dict):
                    raise AssertionError(f"incremental 结果缺少 structure: {structure_inc!r}")
                if structure_inc.get("added") != 0 or structure_inc.get("failed") != 0:
                    raise AssertionError(f"incremental 不应新增/失败条目: {structure_inc!r}")
                if structure_inc.get("expanded", 0) < 2:
                    raise AssertionError(f"incremental 未展开证书与更多字段: {structure_inc!r}")
                cert_after2 = section_state(page2, "certificates")
                if cert_after2["collapsed"] or cert_after2["expanded"] != "true" or not cert_after2["firstFieldVisible"]:
                    raise AssertionError(f"incremental 未展开证书模块: {cert_after2}")
                after2 = item_counts(page2)
                if after2 != before2:
                    raise AssertionError(f"incremental 不应新增条目: before={before2}, after={after2}")
                for selector in ("#projectName2", "#certName2", "#trainingName2"):
                    if page2.locator(selector).count() != 0:
                        raise AssertionError(f"incremental 不应出现新增条目控件: {selector}")
                if page2.locator("#entryConfirmModal").is_visible():
                    raise AssertionError("incremental 不应触发逐条保存确认弹窗")
                expect_value(page2, "#homeProvince", profile["basicInfo"]["homeProvince"], "incremental 家庭所在地区")
                expect_value(page2, "#projectName1", profile["projects"][0]["name"], "incremental 第一段项目")
                expect_value(page2, "#certName1", profile["certificates"][0]["name"], "incremental 第一张证书")
                expect_value(page2, "#studentId1", profile["education"][1]["studentId"], "已有学校按内容定位资料")
                expect_value(page2, "#studentId2", profile["education"][0]["studentId"], "空教育卡片取剩余条目")
                expect_value(page2, "#workProof", "01000000000", "证明人电话独立于本人电话")
                expect_value(page2, "#workCompany", "示例公司", "公司名称输入框可填写")
                expect_value(page2, "#workPosition", "示例岗位", "职位名称输入框可填写")
                expect_value(page2, "#existingProof", "", "无法对应已有公司时保留空白")
                print("PASS 经历卡片按已有名称对齐，证明人电话与本人电话隔离")
                state2 = assert_danger_untouched(page2, "incremental")
                if state2["clicks"].count("添加培训经历") != 0:
                    raise AssertionError(f"incremental 不应点击添加培训: {state2['clicks']!r}")
                if errors:
                    raise AssertionError(f"incremental 页面 JS 异常: {errors}")
                print(
                    "PASS incremental 展开证书但未新增条目："
                    f"filled={result_inc['filledCount']}, expanded={structure_inc['expanded']}, added=0，条目数={after2}"
                )

                page3 = load_fixture_page(context, origin, scripts, styles, errors=errors, label="calendar-pause")
                page3.evaluate("""() => {
                  birthday.addEventListener('focus', event => {
                    event.stopImmediatePropagation();
                    window.calendarWaiting = true;
                  }, { capture: true, once: true });
                  window.releaseCalendar = () => {
                    birthdayPicker.hidden = false;
                    birthday.parentElement.setAttribute('aria-expanded', 'true');
                  };
                  window.calendarFill = fillForm({ basicInfo: { birthDate: '2002-01-15' } },
                    { mode: 'incremental', openTimeoutMs: 180, fieldTimeoutMs: 300 });
                }""")
                page3.wait_for_function("() => window.calendarWaiting === true")
                pause = page3.locator("[data-yy-pause]")
                pause.click()
                page3.evaluate("() => window.releaseCalendar()")
                page3.wait_for_timeout(420)
                expect_value(page3, "#widgetBirthday", "", "暂停后日期未写入")
                if pause.inner_text() != "继续":
                    raise AssertionError("暂停期间按钮应保持可继续")
                pause.click()
                page3.evaluate("() => window.calendarFill")
                expect_value(page3, "#widgetBirthday", "2002-01-15", "继续后同一日历写入")
                if errors:
                    raise AssertionError(f"日历暂停页面 JS 异常: {errors}")
                print("PASS 等待日历时可暂停，暂停时间不消耗字段超时")
                page4 = load_fixture_page(context, origin, scripts, styles, errors=errors, label="experience-dates")
                before = page4.evaluate("""async () => {
                  const section = document.createElement('div');
                  section.className = 'form-section';
                  section.id = 'awards';
                  section.innerHTML = '<div class="experience-item"><label for="awardMonth">获奖时间</label><input id="awardMonth" type="date"></div>';
                  document.querySelector('main').append(section);
                  const campus = document.createElement('div');
                  campus.className = 'form-section';
                  campus.id = 'campusActivities';
                  campus.innerHTML = [1, 2].map(n => `
                    <div class="experience-item">
                      <label for="campusName${n}">活动名称</label><input id="campusName${n}">
                      <label for="campusDate${n}">开始日期</label><input type="date" id="campusDate${n}">
                    </div>`).join('');
                  document.querySelector('main').append(campus);
                  const profile = { basicInfo: { birthDate: '2002-01', homeAddress: '广东省深圳市南山区示例路1号' },
                    awards: [{ name: '示例奖项', date: '2026-09' }],
                    campusActivities: [{ name: '示例活动甲', startDate: '2025-05' }, { name: '示例活动乙', startDate: '2026-02' }] };
                  const result = await fillForm(profile, { mode: 'incremental' });
                  return {value: document.querySelector('#awardMonth').value, statuses: result.results.map(row =>
                    [row.element?.id, row.status, row.reason])};
                }""")
                assert before["value"] == "", "只有年月时应保留日期控件空白"
                assert page4.locator('[data-yy-month-start]').count() == 0
                for field in ["awardMonth", "campusDate1", "campusDate2", "widgetBirthday"]:
                    assert not any(row[0] == field and row[1] == "filled" for row in before["statuses"]), field
                expect_value(page4, "#widgetBirthday", "", "生日保留年月精度")
                expect_value(page4, "#homeProvince", "广东省", "从家庭现居地址识别省份")
                expect_value(page4, "#homeCity", "深圳市", "从家庭现居地址识别城市")
                expect_value(page4, "#homeDistrict", "南山区", "从家庭现居地址识别区县")
                expect_value(page4, "#homeAddress", "广东省深圳市南山区示例路1号", "填写完整家庭现居地址")
                expect_value(page4, "#campusName1", "示例活动甲", "校园活动第一条")
                expect_value(page4, "#campusName2", "示例活动乙", "校园活动第二条")
                expect_value(page4, "#campusDate1", "", "校园活动第一条日期待补全")
                expect_value(page4, "#campusDate2", "", "校园活动第二条日期待补全")
                if errors:
                    raise AssertionError(f"日期精度页面 JS 异常: {errors}")
                print("PASS 只有年月时完整日期控件保持空白，校园活动按卡片填写")

                language_page = load_fixture_page(context, origin, scripts, styles, errors=errors, label="language-cards")
                language_result = language_page.evaluate("""async () => {
                  const section = document.querySelector('#languageSkills');
                  section.innerHTML = ['ielts', ''].map((selected, index) => `
                    <div class="experience-item">
                      <label for="exam${index}">水平</label>
                      <select id="exam${index}">
                        <option value="">请选择</option><option value="cet4">CET-4（四级）</option>
                        <option value="ielts" ${selected ? 'selected' : ''}>IELTS（雅思）</option>
                      </select>
                      <label for="score${index}">成绩</label><input id="score${index}" type="number">
                      <label for="examDate${index}">证书获取时间</label><input id="examDate${index}" type="date">
                    </div>`).join('');
                  const basic = document.querySelector('#basicInfo');
                  basic.insertAdjacentHTML('beforeend', '<label for="singleCET4">大学英语四级成绩</label><input id="singleCET4" type="number">');
                  const profile = { languageCertificates: [
                    { language: '日语', name: 'JLPT N1', score: '132' },
                    { language: '英语', name: 'CET-4', score: '408分', obtainedDate: '2023-06-17' },
                    { language: '英语', name: 'IELTS', score: '7.5', obtainedDate: '2025-03-08' }
                  ] };
                  return fillForm(profile, { mode: 'incremental' });
                }""")
                assert not language_result.get("error") and not errors
                expect_value(language_page, "#exam0", "ielts", "已有雅思选项按考试对齐")
                expect_value(language_page, "#score0", "7.5", "雅思成绩")
                expect_value(language_page, "#examDate0", "2025-03-08", "雅思日期")
                expect_value(language_page, "#exam1", "cet4", "四级匹配带括号选项")
                expect_value(language_page, "#score1", "408", "英语卡片不使用日语成绩")
                expect_value(language_page, "#singleCET4", "408", "独立四级数字成绩框")
                print("PASS OfferLink 英语卡片与独立成绩框使用同一条资料")
            finally:
                context.close()
                browser.close()
        elapsed = time.perf_counter() - started
        print(f"PASS OfferLink 回归通过（full + incremental），总耗时 {elapsed:.2f}s")
        return 0
    except Exception as error:
        print(f"FAIL {type(error).__name__}: {error}")
        print_failure_debug(page, result_full, errors)
        traceback.print_exc()
        return 1
    finally:
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
