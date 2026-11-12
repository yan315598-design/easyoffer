#!/usr/bin/env python3
"""yanyu 本地真实浏览器回归：慢下拉、异常后续跑、增量、选区和 Shadow DOM。"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import threading
import time
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright
from screenshot import CHROME_MOCK, demo_data

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "job-autofill-assistant"
FIXTURE = ROOT / "test/fixtures/yanyu-regression-form.html"
OUT = ROOT / "pictures"
CHROME_CANDIDATES = [
    os.environ.get("CHROME_PATH", ""),
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    str(Path.home() / ".local/bin/google-chrome"),
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/fixture", "/fixture.html"):
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


def assert_value(page, selector: str, expected: str, timeout: int = 15000):
    page.wait_for_function(
        "([selector, expected]) => document.querySelector(selector)?.value === expected",
        arg=[selector, expected], timeout=timeout,
    )
    print(f"PASS {selector} = {expected}")


def drag_region(page, selector: str, ctrl: bool = False):
    rect = page.locator(selector).bounding_box()
    if not rect:
        raise AssertionError(f"选区元素不可见: {selector}")
    x, y = rect["x"] + 8, rect["y"] + 8
    page.mouse.move(x, y)
    if ctrl:
        page.keyboard.down("Control")
    page.mouse.down()
    page.mouse.move(x + rect["width"] - 20, y + rect["height"] - 20, steps=8)
    page.mouse.up()
    if ctrl:
        page.keyboard.up("Control")


def choose_work_entry(page):
    page.locator('[data-yy-region-cat="workExperience"]').click()
    page.locator('[data-yy-region-entry][data-cat="workExperience"][data-yy-region-idx="0"]').click()
    page.locator("[data-yy-region-apply]").click()


def main():
    server, origin = start_server()
    OUT.mkdir(parents=True, exist_ok=True)
    data = demo_data()
    profile = data["profiles"][0]
    profile["basicInfo"]["state"] = "广东省"
    profile["basicInfo"]["city"] = "深圳市"
    profile["education"][0]["degree"] = "硕士研究生"
    profile["education"][0]["studentId"] = "20260001"
    profile["education"][0]["majorCategory"] = "工学"
    profile["jobIntention"]["expectedIndustry"] = "互联网"
    profile["jobIntention"]["currentSalary"] = "15k/月"
    profile["workExperience"][0]["industry"] = "软件和信息技术服务"
    profile["workExperience"][0]["referenceName"] = "测试证明人"
    profile["education"].append({
        **profile["education"][0], "id": "edu_regression_2", "school": "华南理工大学",
        "major": "金融学", "degree": "本科", "studentId": "20260002", "majorCategory": "经济学"
    })
    profile["familyMembers"] = [{
        "id": "family_regression", "name": "张父", "relation": "父亲", "birthDate": "1970-05-06",
        "politicalStatus": "群众", "homeAddress": "广东省深圳市"
    }]
    profile["trainings"] = [{
        "id": "training_regression", "name": "数据分析培训", "institution": "测试机构",
        "startDate": "2024-02", "endDate": "2024-03", "description": "数据可视化"
    }]
    payload = json.dumps(data, ensure_ascii=False)
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    scripts = manifest["content_scripts"][0]["js"]
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=chrome_path(), headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, locale="zh-CN")
        context.add_init_script(f"window.__CAPYBARA_DEMO__ = {payload};")
        context.add_init_script(CHROME_MOCK)
        page = context.new_page()
        page.on("pageerror", lambda error: console_errors.append(str(error)))
        try:
            page.goto(origin + "/fixture", wait_until="domcontentloaded")
            for rel in scripts:
                page.add_script_tag(path=str(EXT / rel))
            page.add_style_tag(path=str(EXT / "styles/content.css"))
            page.wait_for_selector("#job-autofill-dock", timeout=15000)
            page.wait_for_selector('[data-yy-action="fill"]', timeout=15000)
            border_style = page.locator('[data-yy-action="fill"]').evaluate("el => getComputedStyle(el).borderTopStyle")
            assert border_style != "dashed", f"Shadow DOM 样式被宿主页污染: {border_style}"
            print("PASS Shadow DOM 隔离宿主页 button 样式")
            page.screenshot(path=str(OUT / "yanyu-dock.png"), full_page=False)

            # 模拟扩展重载后的旧宿主残留：新脚本状态为空时必须能接管/重建并显示。
            page.evaluate("() => { yanyuDockState.host = null; yanyuDockState.shadow = null; }")
            restored = page.evaluate("() => yanyuSetDockVisible(true, true)")
            assert restored is True, "残留 Dock 导致 showDock 失败"
            page.wait_for_selector("#job-autofill-dock", state="visible")
            assert page.locator("#job-autofill-dock").evaluate("el => el.getAttribute('collapsed')") == "false"
            print("PASS 扩展重载后残留 Dock 可恢复显示")

            page.locator('[data-yy-action="fill"]').click()
            assert_value(page, "#fullName", "张子涵")
            assert_value(page, "#email", "zihan.zhang_dev@example.com")
            assert_value(page, "#degreeInput", "硕士研究生")
            assert_value(page, "#afterFailure", "后端开发工程师")
            assert_value(page, "#provinceInput", "广东省")
            assert_value(page, "#cityInput", "深圳市")
            assert_value(page, "#afterCascade", "校招官网")
            assert_value(page, "#expectedIndustry", "互联网")
            assert_value(page, "#currentSalary", "15k/月")
            assert_value(page, "#studentId", "20260001")
            assert_value(page, "#majorCategory", "工学")
            assert_value(page, "#school1", "北京航空航天大学")
            assert_value(page, "#school2", "华南理工大学")
            assert_value(page, "#studentId2", "20260002")
            assert_value(page, "#majorCategory2", "经济学")
            assert_value(page, "#familyBirthDate", "1970-05-06")
            assert_value(page, "#familyPoliticalStatus", "群众")
            assert_value(page, "#familyHomeAddress", "广东省深圳市")
            assert_value(page, "#trainingName", "数据分析培训")
            assert_value(page, "#trainingStart", "2024-02")
            assert_value(page, "#trainingEnd", "2024-03")
            assert_value(page, "#industry1", "软件和信息技术服务")
            assert_value(page, "#referenceName1", "测试证明人")
            assert_value(page, "#currentCity", "保留我")
            print("PASS 一键填入、慢组件、延迟级联与已有值保护")

            page.locator("#fullName").fill("手工修改姓名")
            page.locator("#email").fill("")
            page.locator('[data-yy-action="incremental"]').click()
            assert_value(page, "#email", "zihan.zhang_dev@example.com")
            assert_value(page, "#fullName", "手工修改姓名")
            print("PASS 增量只补空白且不覆盖")

            for selector in ["#company1", "#position1", "#company2", "#position2"]:
                page.locator(selector).fill("")
            page.locator('[data-yy-action="region"]').click()
            page.wait_for_selector("#job-autofill-region-overlay")
            drag_region(page, "#work-1")
            page.wait_for_selector("[data-yy-region-view]")
            assert page.locator("#job-autofill-dock").count() == 1, "选区应复用唯一 Dock host"
            assert page.locator("#job-autofill-region-panel").count() == 0, "不应再创建独立选区面板"
            time.sleep(0.35)
            page.screenshot(path=str(OUT / "yanyu-region-menu.png"), full_page=False)
            choose_work_entry(page)
            assert_value(page, "#company1", "字节跳动")
            assert_value(page, "#position1", "后端开发实习生")
            print("PASS 单区域工作经历选区填入")

            for selector in ["#company1", "#position1", "#company2", "#position2"]:
                page.locator(selector).fill("")
            page.locator('[data-yy-action="region"]').click()
            drag_region(page, "#work-1", ctrl=True)
            drag_region(page, "#work-2", ctrl=True)
            page.locator("[data-yy-region-finish]").click()
            page.wait_for_selector("[data-yy-region-view]")
            count_text = page.locator("[data-yy-region-summary]").inner_text()
            assert "2 个模块" in count_text, count_text
            choose_work_entry(page)
            assert_value(page, "#company1", "字节跳动")
            assert_value(page, "#company2", "字节跳动")
            print("PASS Ctrl 多区域、去重与统一条目填入")

            page.locator('[data-yy-action="region"]').click()
            page.wait_for_selector("#job-autofill-region-overlay")
            rect = page.locator("#work-1").bounding_box()
            page.mouse.move(rect["x"] + 20, rect["y"] + 20)
            page.mouse.down()
            page.mouse.move(rect["x"] + 160, rect["y"] + 100, steps=3)
            page.mouse.click(rect["x"] + 160, rect["y"] + 100, button="right")
            assert page.locator("#job-autofill-region-overlay").count() == 1
            page.keyboard.press("Escape")
            page.wait_for_selector("#job-autofill-region-overlay", state="detached")
            print("PASS 右键取消当前框与 Esc 完整清理")

            popup = context.new_page()
            popup.on("pageerror", lambda error: console_errors.append(f"popup: {error}"))
            popup.set_viewport_size({"width": 390, "height": 760})
            popup.goto(origin + "/popup/popup.html", wait_until="domcontentloaded")
            popup.wait_for_function("() => document.getElementById('selectedProfileName')?.textContent.includes('校招')")
            popup.screenshot(path=str(OUT / "yanyu-popup.png"), full_page=True)
            popup.locator("#themeToggle").click()
            assert popup.evaluate("() => document.documentElement.dataset.theme") == "dark", "Popup 深色主题切换失败"
            popup.wait_for_timeout(350)
            popup.screenshot(path=str(OUT / "yanyu-popup-dark.png"), full_page=True)
            popup.close()
            print("PASS Popup 加载当前简历并截图")

            options = context.new_page()
            options.on("pageerror", lambda error: console_errors.append(f"options: {error}"))
            options.set_viewport_size({"width": 1440, "height": 1000})
            options.goto(origin + "/options/options.html", wait_until="domcontentloaded")
            options.wait_for_function("() => document.getElementById('fullName')?.value === '张子涵'", timeout=15000)
            options.screenshot(path=str(OUT / "yanyu-options.png"), full_page=False)
            options.close()
            print("PASS 配置页加载既有资料并截图")

            assert not console_errors, f"浏览器 JS 异常: {console_errors}"
            print("PASS 无浏览器运行时异常")
        except Exception:
            print("DEBUG 当前字段值:", page.evaluate("""() => Object.fromEntries([
              'fullName','email','degreeInput','afterFailure','provinceInput','cityInput','afterCascade','currentCity'
            ].map(id => [id, document.getElementById(id)?.value]))"""))
            task = page.locator('[data-yy-task-summary]')
            if task.count():
                print("DEBUG 任务面板:", task.inner_text())
            rows = page.locator('.task-row')
            if rows.count():
                print("DEBUG 字段结果:", rows.all_inner_texts())
            print("DEBUG 页面异常:", console_errors)
            print("DEBUG 分区字段:", page.evaluate("""() => ['familyBirthDate','familyPoliticalStatus','familyHomeAddress','trainingName','trainingStart','trainingEnd'].map(id => {
              const el = document.getElementById(id);
              return { id, value: el?.value, section: el ? nearestSectionKind(el) : '',
                detection: el ? detectField(el)?.fieldType : '',
                entry: el ? extendedEntry(el, currentActiveProfile) : null };
            })"""))
            page.screenshot(path=str(OUT / "yanyu-browser-debug.png"), full_page=True)
            raise
        finally:
            context.close()
            browser.close()
            server.shutdown()


if __name__ == "__main__":
    main()
