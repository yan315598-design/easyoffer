#!/usr/bin/env python3
"""yanyu 填充任务暂停 / 继续 / 取消 / 关闭的真实 Chromium 回归。

场景：
1. 正常创建 Dock，覆盖全局 fillField，让 #fullName 的写入等待测试控制的 Promise。
2. incremental 任务写入 fullName 期间点击 Dock 暂停：按钮变“继续”，当前字段完成后
   后续字段不得写入，任务不得结束。
3. 点击继续：同一任务完成，后续字段正确，结果不重复，activeFillTask 清空。
4. 受控任务暂停后取消：任务有界结束、activeFillTask 清空、暂停 Promise/resolver
   清理、按钮隐藏。
5. 任务暂停后点击 Dock 关闭：取消并释放、Dock 隐藏；yanyuSetDockVisible(true,true)
   恢复后启动的新任务不继承 paused。
6. 覆盖 prepareFormStructure 验证结构阶段的暂停检查点不会写入任何字段。
"""
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


def check(condition, message, detail=None):
    if not condition:
        suffix = "" if detail is None else f" | actual={detail!r}"
        raise AssertionError(f"{message}{suffix}")
    print(f"PASS {message}")


def wait_js(page, expression, message, timeout=20000):
    page.wait_for_function(expression, timeout=timeout)
    print(f"PASS {message}")


def arm_fill_gate(page):
    page.evaluate("() => window.__armFillGate()")


def release_fill_gate(page):
    page.evaluate("() => window.__releaseFillGate()")


def reset_form(page):
    page.evaluate(
        """() => {
          document.querySelectorAll('input, textarea, select').forEach(el => {
            if (el.type === 'radio' || el.type === 'checkbox') { el.checked = false; return; }
            el.value = '';
            el.style.backgroundColor = '';
            el.style.border = '';
            el.removeAttribute('data-job-autofill-manual');
            el.removeAttribute('title');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          });
          document.querySelectorAll('.job-autofill-manual-hint').forEach(el => el.remove());
        }"""
    )


def state(page):
    return page.evaluate(
        """() => {
          const host = document.getElementById('job-autofill-dock');
          const shadow = host && host.shadowRoot;
          const task = window.activeFillTask;
          const tasks = window.__tasks || [];
          const last = tasks[tasks.length - 1] || null;
          const pause = shadow && shadow.querySelector('[data-yy-pause]');
          const cancel = shadow && shadow.querySelector('[data-yy-cancel]');
          return {
            host: !!host,
            hostDisplay: host ? host.style.display : '',
            hostCollapsed: host ? host.getAttribute('collapsed') : '',
            paused: !!task && !!task.paused,
            running: !!task && !!task.running,
            stage: task ? task.stage : '',
            hasPausePromise: !!task && !!task.pausePromise,
            hasPauseResolve: !!task && !!task.pauseResolve,
            activeIsLast: !!task && !!last && task === last,
            taskSettled: !!window.__taskSettled,
            taskRejected: window.__taskRejected || '',
            lastFillResult: window.__lastFillResult || null,
            lastFillError: window.__lastFillError || null,
            pauseText: pause ? pause.textContent : '',
            pauseDisplay: pause ? getComputedStyle(pause).display : '',
            cancelDisplay: cancel ? getComputedStyle(cancel).display : '',
            dockRunning: !!(window.yanyuDockState && window.yanyuDockState.running),
            fillCalls: (window.__fillCalls || []).map(x => x.id),
            fullName: document.getElementById('fullName')?.value || '',
            phone: document.getElementById('phone')?.value || '',
            email: document.getElementById('email')?.value || '',
            taskCount: tasks.length,
            lastTask: last ? {
              running: !!last.running,
              paused: !!last.paused,
              hasPausePromise: !!last.pausePromise,
              hasPauseResolve: !!last.pauseResolve,
              aborted: !!(last.controller && last.controller.signal && last.controller.signal.aborted)
            } : null
          };
        }"""
    )


HARNESS_JS = r"""() => {
  window.__fillCalls = [];
  window.__tasks = [];
  window.__lastFillResult = null;
  window.__lastFillError = null;
  window.__taskSettled = false;
  window.__taskRejected = '';
  window.__taskPromise = null;
  window.__fillGate = { promise: Promise.resolve(), resolve: () => {}, entered: false, released: true, completed: false };
  window.__structureGate = null;

  window.__armFillGate = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    window.__fillGate = { promise, resolve, entered: false, released: false, completed: false };
    return true;
  };
  window.__releaseFillGate = () => {
    const gate = window.__fillGate;
    if (!gate) return false;
    gate.released = true;
    gate.resolve();
    return true;
  };
  window.__armStructureGate = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    window.__structureGate = { promise, resolve, entered: false, released: false };
    return true;
  };
  window.__releaseStructureGate = () => {
    const gate = window.__structureGate;
    if (!gate) return false;
    gate.released = true;
    gate.resolve();
    return true;
  };

  window.__origFillField = window.fillField;
  window.fillField = async function(el, value) {
    window.__fillCalls.push({ id: el && el.id ? el.id : '', value: String(value == null ? '' : value) });
    const gate = window.__fillGate;
    if (el && el.id === 'fullName') {
      gate.entered = true;
      await gate.promise;
    }
    const result = await window.__origFillField.apply(this, arguments);
    if (el && el.id === 'fullName') gate.completed = true;
    return result;
  };

  window.__origFillForm = window.fillForm;
  window.fillForm = async function(profile, options) {
    window.__lastFillResult = null;
    window.__lastFillError = null;
    try {
      const result = await window.__origFillForm.apply(this, arguments);
      window.__lastFillResult = result;
      return result;
    } catch (error) {
      window.__lastFillError = { name: (error && error.name) || '', message: (error && error.message) || String(error) };
      throw error;
    }
  };

  window.__origStartActiveFillTask = window.startActiveFillTask;
  window.startActiveFillTask = function(kind, mode) {
    const task = window.__origStartActiveFillTask.apply(this, arguments);
    window.__tasks.push(task);
    return task;
  };

  window.__origPrepareFormStructure = window.prepareFormStructure;
  window.prepareFormStructure = async function() {
    const gate = window.__structureGate;
    if (gate && !gate.released) {
      gate.entered = true;
      await gate.promise;
    }
    return window.__origPrepareFormStructure.apply(this, arguments);
  };

  window.__startTask = (mode) => {
    window.__fillCalls = [];
    window.__taskSettled = false;
    window.__taskRejected = '';
    window.__lastFillResult = null;
    window.__lastFillError = null;
    window.__taskPromise = window.runYanyuDockFill(mode);
    window.__taskPromise.then(() => {
      window.__taskSettled = true;
    }, (error) => {
      window.__taskSettled = true;
      window.__taskRejected = String((error && error.message) || error);
    });
    return true;
  };
}"""

RESULT_JS = r"""() => {
  const result = window.__lastFillResult || null;
  const rows = result && Array.isArray(result.results) ? result.results : [];
  const filledIds = rows.filter(row => row.status === 'filled' && row.element && row.element.id).map(row => row.element.id);
  const counts = {};
  filledIds.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  return {
    exists: !!result,
    cancelled: !!(result && result.cancelled),
    filledCount: result ? (Number(result.filledCount) || 0) : 0,
    failedCount: result ? (Number(result.failedCount) || 0) : 0,
    reviewCount: result ? (Number(result.reviewCount) || 0) : 0,
    error: result ? (result.error || '') : '',
    filledIds,
    duplicateFilledIds: Object.keys(counts).filter(id => counts[id] > 1)
  };
}"""


def build_profile(data: dict):
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
    return profile


def main():
    server, origin = start_server()
    data = demo_data()
    build_profile(data)
    payload = json.dumps(data, ensure_ascii=False)
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    scripts = manifest["content_scripts"][0]["js"]
    console_errors = []
    page = None
    context = None
    browser = None

    try:
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

            page.goto(origin + "/fixture", wait_until="domcontentloaded")
            for rel in scripts:
                page.add_script_tag(path=str(EXT / rel))
            page.add_style_tag(path=str(EXT / "styles/content.css"))
            page.wait_for_selector("#job-autofill-dock", timeout=15000)
            page.wait_for_selector('[data-yy-action="incremental"]', timeout=15000)
            print("PASS 真实 Chromium 加载 manifest content scripts 并创建 Dock")

            globals_state = page.evaluate(
                """() => ({
                  fillField: typeof window.fillField,
                  fillForm: typeof window.fillForm,
                  startActiveFillTask: typeof window.startActiveFillTask,
                  prepareFormStructure: typeof window.prepareFormStructure,
                  run: typeof window.runYanyuDockFill,
                  dockVisible: (() => {
                    const host = document.getElementById('job-autofill-dock');
                    return !!host && host.style.display !== 'none';
                  })()
                })"""
            )
            check(globals_state["fillField"] == "function", "全局 fillField 可覆盖")
            check(globals_state["fillForm"] == "function", "全局 fillForm 可包装")
            check(globals_state["startActiveFillTask"] == "function", "全局 startActiveFillTask 可包装")
            check(globals_state["prepareFormStructure"] == "function", "全局 prepareFormStructure 可包装")
            check(globals_state["run"] == "function", "全局 runYanyuDockFill 可调用")
            check(globals_state["dockVisible"] is True, "Dock 初始可见")

            page.evaluate(HARNESS_JS)
            print("PASS 已安装暂停/取消测试钩子（fillField、fillForm、startActiveFillTask、prepareFormStructure）")

            # ------------------------------------------------------------------
            # 场景 1/2：incremental 任务，fullName 写入受控；写入期间暂停。
            # ------------------------------------------------------------------
            reset_form(page)
            arm_fill_gate(page)
            task_count = state(page)["taskCount"]
            page.evaluate("() => window.__startTask('incremental')")
            wait_js(page, "() => !!window.__fillGate.entered", "fullName 的 fillField 已进入测试控制点", timeout=15000)
            wait_js(page, "() => !!window.activeFillTask && window.activeFillTask.running", "incremental 任务已运行")
            check(state(page)["taskCount"] == task_count + 1, "任务通过 runYanyuDockFill('incremental') 启动")

            page.locator('[data-yy-pause]').click()
            wait_js(
                page,
                "() => document.getElementById('job-autofill-dock')?.shadowRoot?.querySelector('[data-yy-pause]')?.textContent === '继续'",
                "暂停后 Dock 按钮文字变为“继续”",
            )
            paused_state = state(page)
            check(paused_state["paused"] is True, "activeFillTask.paused 为 true")
            check(paused_state["hasPausePromise"] is True, "暂停时建立了 pausePromise")
            check(paused_state["hasPauseResolve"] is True, "暂停时保存了 pauseResolve")
            check(paused_state["taskSettled"] is False, "暂停时任务 Promise 未完成")

            release_fill_gate(page)
            wait_js(
                page,
                "() => document.getElementById('fullName')?.value === '张子涵'",
                "释放当前字段后 fullName 写入完成",
                timeout=5000,
            )
            wait_js(page, "() => window.__fillGate.completed === true", "受控 fillField 已返回")
            page.wait_for_timeout(350)
            held_state = state(page)
            check(held_state["email"] == "", "#email 在暂停期间未被写入", held_state["email"])
            check(held_state["phone"] == "", "#phone 在暂停期间未被写入", held_state["phone"])
            check(held_state["fillCalls"] == ["fullName"], "暂停后只有 fullName 发生写入", held_state["fillCalls"])
            check(held_state["paused"] is True, "fullName 完成后任务仍保持暂停")
            check(held_state["taskSettled"] is False, "fullName 完成后任务 Promise 仍未完成")
            check(held_state["lastFillResult"] is None, "暂停期间没有生成任务结果")
            check(held_state["pauseText"] == "继续", "暂停保持期间按钮仍为“继续”")

            # ------------------------------------------------------------------
            # 场景 3：点击继续，同一任务完成，后续字段正确且结果不重复。
            # ------------------------------------------------------------------
            old_task_count = held_state["taskCount"]
            previous_task = page.evaluate("() => window.__tasks[window.__tasks.length - 1]")
            page.locator('[data-yy-pause]').click()
            wait_js(
                page,
                "() => document.getElementById('job-autofill-dock')?.shadowRoot?.querySelector('[data-yy-pause]')?.textContent === '暂停'",
                "继续后 Dock 按钮文字恢复为“暂停”",
            )
            resumed_state = state(page)
            check(resumed_state["paused"] is False, "继续后 activeFillTask.paused 为 false")
            check(resumed_state["hasPausePromise"] is False, "继续后 pausePromise 已释放")
            check(resumed_state["hasPauseResolve"] is False, "继续后 pauseResolve 已释放")
            check(resumed_state["taskSettled"] is False, "继续瞬间任务尚未完成")

            wait_js(page, "() => window.__taskSettled === true", "继续后同一任务最终完成", timeout=60000)
            done_state = state(page)
            result = page.evaluate(RESULT_JS)
            check(done_state["taskCount"] == old_task_count, "继续没有创建第二个任务")
            check(done_state["lastFillError"] is None, "继续后任务无拒绝错误", done_state["lastFillError"])
            check(result["exists"] is True, "继续后产生任务结果")
            check(result["cancelled"] is False, "任务结果未标记取消", result)
            check(result["error"] == "", "任务结果无错误", result["error"])
            check(result["filledCount"] >= 10, "任务完成填充了足够字段", result["filledCount"])
            check(result["duplicateFilledIds"] == [], "任务结果中没有重复的已填字段", result["duplicateFilledIds"])
            check(done_state["fullName"] == "张子涵", "fullName 结果正确", done_state["fullName"])
            check(done_state["email"] == "zihan.zhang_dev@example.com", "email 结果正确", done_state["email"])
            check(done_state["phone"] == "13812345678", "phone 结果正确", done_state["phone"])
            check("fullName" in result["filledIds"], "结果包含 fullName", result["filledIds"])
            check("email" in result["filledIds"], "结果包含 email", result["filledIds"])
            check(result["filledIds"].count("fullName") == 1, "fullName 在结果中只出现一次", result["filledIds"])
            check(done_state["fillCalls"].count("fullName") == 1, "fullName 只被实际写入一次", done_state["fillCalls"])
            check(
                page.evaluate("() => window.activeFillTask === null"),
                "任务完成后 activeFillTask 为空",
            )
            check(done_state["pauseDisplay"] == "none", "任务完成后暂停按钮隐藏", done_state["pauseDisplay"])
            check(done_state["cancelDisplay"] == "none", "任务完成后取消按钮隐藏", done_state["cancelDisplay"])
            check(done_state["dockRunning"] is False, "runYanyuDockFill 运行标记已复位")

            verify_state = page.evaluate(
                """() => ({
                  email: document.getElementById('email')?.value,
                  phone: document.getElementById('phone')?.value,
                  degree: document.getElementById('degreeInput')?.value,
                  afterFailure: document.getElementById('afterFailure')?.value,
                  province: document.getElementById('provinceInput')?.value,
                  city: document.getElementById('cityInput')?.value,
                  afterCascade: document.getElementById('afterCascade')?.value,
                  school1: document.getElementById('school1')?.value,
                  school2: document.getElementById('school2')?.value,
                  trainingName: document.getElementById('trainingName')?.value
                })"""
            )
            check(verify_state["degree"] == "硕士研究生", "degreeInput 结果正确", verify_state["degree"])
            check(verify_state["afterFailure"] == "后端开发工程师", "afterFailure 结果正确", verify_state["afterFailure"])
            check(verify_state["province"] == "广东省", "provinceInput 结果正确", verify_state["province"])
            check(verify_state["city"] == "深圳市", "cityInput 结果正确", verify_state["city"])
            check(verify_state["afterCascade"] == "校招官网", "afterCascade 结果正确", verify_state["afterCascade"])
            check(verify_state["school1"] == "北京航空航天大学", "school1 结果正确", verify_state["school1"])
            check(verify_state["school2"] == "华南理工大学", "school2 结果正确", verify_state["school2"])
            check(verify_state["trainingName"] == "数据分析培训", "trainingName 结果正确", verify_state["trainingName"])

            # ------------------------------------------------------------------
            # 场景 4：受控任务暂停后取消，验证有界结束与清理。
            # ------------------------------------------------------------------
            reset_form(page)
            arm_fill_gate(page)
            before_cancel_count = state(page)["taskCount"]
            page.evaluate("() => window.__startTask('incremental')")
            wait_js(page, "() => !!window.__fillGate.entered", "取消场景的 fullName 已进入受控写入", timeout=15000)
            wait_js(page, "() => !!window.activeFillTask && window.activeFillTask.running", "取消场景任务已运行")
            page.locator('[data-yy-pause]').click()
            wait_js(
                page,
                "() => document.getElementById('job-autofill-dock')?.shadowRoot?.querySelector('[data-yy-pause]')?.textContent === '继续'",
                "取消场景任务已暂停",
            )
            page.locator('[data-yy-cancel]').click()
            page.wait_for_timeout(120)
            cancel_state = state(page)
            check(cancel_state["taskCount"] == before_cancel_count + 1, "取消作用于当前真实任务")
            check(cancel_state["lastTask"]["aborted"] is True, "取消后任务 AbortSignal 已触发")
            check(cancel_state["paused"] is False, "取消立即释放 paused 标记")
            check(cancel_state["hasPausePromise"] is False, "取消后 pausePromise 已清理")
            check(cancel_state["hasPauseResolve"] is False, "取消后 pauseResolve 已清理")
            check(cancel_state["taskSettled"] is False, "取消后任务在字段返回前仍未结束")
            cancel_started = time.time()
            release_fill_gate(page)
            page.wait_for_function("() => window.__taskSettled === true", timeout=15000)
            cancel_elapsed = time.time() - cancel_started
            print(f"PASS 取消任务有界结束（释放字段后 {cancel_elapsed:.3f}s）")
            check(cancel_elapsed < 15, "取消任务在 15s 内有界结束", cancel_elapsed)
            cancelled_state = state(page)
            error = cancelled_state["lastFillError"] or {}
            check(error.get("name") == "AbortError", "取消以 AbortError 结束", error)
            check(cancelled_state["fullName"] == "张子涵", "取消时当前字段 fullName 已正常完成", cancelled_state["fullName"])
            check(cancelled_state["phone"] == "", "取消后 phone 未继续写入", cancelled_state["phone"])
            check(cancelled_state["email"] == "", "取消后 email 未继续写入", cancelled_state["email"])
            check(cancelled_state["fillCalls"] == ["fullName"], "取消后仅当前字段发生写入", cancelled_state["fillCalls"])
            check(page.evaluate("() => window.activeFillTask === null"), "取消结束后 activeFillTask 为空")
            check(cancelled_state["lastTask"]["running"] is False, "取消结束后任务 running 为 false")
            check(cancelled_state["lastTask"]["hasPausePromise"] is False, "取消结束后任务 pausePromise 为空")
            check(cancelled_state["lastTask"]["hasPauseResolve"] is False, "取消结束后任务 pauseResolve 为空")
            check(cancelled_state["pauseDisplay"] == "none", "取消结束后暂停按钮隐藏", cancelled_state["pauseDisplay"])
            check(cancelled_state["cancelDisplay"] == "none", "取消结束后取消按钮隐藏", cancelled_state["cancelDisplay"])
            check(cancelled_state["dockRunning"] is False, "取消后 runYanyuDockFill 运行标记复位")

            # ------------------------------------------------------------------
            # 场景 5：任务暂停后点击 Dock 关闭；恢复显示后新任务不继承 paused。
            # ------------------------------------------------------------------
            reset_form(page)
            arm_fill_gate(page)
            before_close_count = state(page)["taskCount"]
            page.evaluate("() => window.__startTask('incremental')")
            wait_js(page, "() => !!window.__fillGate.entered", "关闭场景的 fullName 已进入受控写入", timeout=15000)
            wait_js(page, "() => !!window.activeFillTask && window.activeFillTask.running", "关闭场景任务已运行")
            page.locator('[data-yy-pause]').click()
            wait_js(
                page,
                "() => document.getElementById('job-autofill-dock')?.shadowRoot?.querySelector('[data-yy-pause]')?.textContent === '继续'",
                "关闭场景任务已暂停",
            )
            page.locator('[data-yy-action="close"]').click()
            page.wait_for_timeout(120)
            closed_state = state(page)
            check(closed_state["hostDisplay"] == "none", "关闭后 Dock 隐藏", closed_state["hostDisplay"])
            check(closed_state["taskCount"] == before_close_count + 1, "关闭前的任务仍是同一真实任务")
            check(closed_state["lastTask"]["aborted"] is True, "关闭 Dock 触发任务取消")
            check(closed_state["paused"] is False, "关闭 Dock 立即释放 paused")
            check(closed_state["hasPausePromise"] is False, "关闭 Dock 后 pausePromise 已清理")
            check(closed_state["hasPauseResolve"] is False, "关闭 Dock 后 pauseResolve 已清理")
            release_fill_gate(page)
            page.wait_for_function("() => window.__taskSettled === true", timeout=15000)
            closed_done = state(page)
            check(page.evaluate("() => window.activeFillTask === null"), "关闭并释放后 activeFillTask 为空")
            check(closed_done["lastTask"]["running"] is False, "关闭后旧任务已结束")
            check(closed_done["dockRunning"] is False, "关闭后运行标记已复位")

            visible = page.evaluate("() => window.yanyuSetDockVisible(true, true)")
            check(visible is True, "yanyuSetDockVisible(true,true) 返回 true")
            page.wait_for_timeout(100)
            shown_state = state(page)
            check(shown_state["hostDisplay"] != "none", "恢复显示后 Dock 不再隐藏", shown_state["hostDisplay"])
            check(shown_state["hostCollapsed"] == "false", "恢复显示后 Dock 展开", shown_state["hostCollapsed"])
            check(page.evaluate("() => window.activeFillTask === null"), "恢复显示不会复活旧任务")

            previous_task_index = page.evaluate("() => window.__tasks.length - 1")
            new_task_index = state(page)["taskCount"]
            page.evaluate("() => window.__startTask('incremental')")
            wait_js(page, "() => !!window.activeFillTask && window.activeFillTask.running", "恢复显示后新任务已启动")
            new_task_state = state(page)
            check(new_task_state["taskCount"] == new_task_index + 1, "恢复显示后确实启动了新任务")
            check(new_task_state["activeIsLast"] is True, "activeFillTask 属于新任务")
            check(page.evaluate("() => window.__tasks[window.__tasks.length - 1] !== window.__tasks[window.__tasks.length - 2]"), "新任务是新的任务对象")
            check(new_task_state["paused"] is False, "新任务不继承 paused")
            check(new_task_state["hasPausePromise"] is False, "新任务没有继承 pausePromise")
            check(new_task_state["hasPauseResolve"] is False, "新任务没有继承 pauseResolve")
            check(new_task_state["lastTask"]["aborted"] is False, "新任务信号未被旧取消污染")
            check(new_task_state["pauseText"] == "暂停", "新任务暂停按钮显示“暂停”", new_task_state["pauseText"])
            wait_js(page, "() => window.__taskSettled === true", "恢复后的新任务正常完成", timeout=60000)
            reopened_done = state(page)
            reopened_result = page.evaluate(RESULT_JS)
            check(reopened_done["email"] == "zihan.zhang_dev@example.com", "新任务完成 email 写入", reopened_done["email"])
            check(reopened_done["phone"] == "13812345678", "新任务完成 phone 写入", reopened_done["phone"])
            check(reopened_result["cancelled"] is False, "新任务结果未取消", reopened_result)
            check(page.evaluate("() => window.activeFillTask === null"), "新任务完成后 activeFillTask 为空")
            check(reopened_done["pauseDisplay"] == "none", "新任务完成后暂停按钮隐藏", reopened_done["pauseDisplay"])
            check(new_task_index == previous_task_index + 1, "旧任务之后才启动新任务", (previous_task_index, new_task_index))

            # ------------------------------------------------------------------
            # 场景 6：结构阶段暂停（覆盖 prepareFormStructure，不依赖 AI 网络）。
            # ------------------------------------------------------------------
            reset_form(page)
            page.evaluate("() => window.__armStructureGate()")
            structure_index = state(page)["taskCount"]
            page.evaluate("() => window.__startTask('incremental')")
            wait_js(page, "() => !!window.__structureGate && window.__structureGate.entered === true", "prepareFormStructure 进入受控展开阶段", timeout=15000)
            wait_js(page, "() => !!window.activeFillTask && window.activeFillTask.running", "结构阶段任务已运行")
            page.locator('[data-yy-pause]').click()
            wait_js(
                page,
                "() => document.getElementById('job-autofill-dock')?.shadowRoot?.querySelector('[data-yy-pause]')?.textContent === '继续'",
                "结构阶段暂停后按钮变为“继续”",
            )
            structure_paused = state(page)
            check(structure_paused["stage"] == "structure", "暂停时任务处于 structure 阶段", structure_paused["stage"])
            check(structure_paused["paused"] is True, "结构阶段任务已暂停")
            check(structure_paused["fillCalls"] == [], "结构阶段暂停时没有字段写入", structure_paused["fillCalls"])
            check(structure_paused["taskSettled"] is False, "结构阶段暂停时任务未完成")

            page.evaluate("() => window.__releaseStructureGate()")
            wait_js(
                page,
                "() => !!window.activeFillTask && window.activeFillTask.paused && window.activeFillTask.stage === 'declarations'",
                "结构完成后任务停在 declarations 检查点",
                timeout=15000,
            )
            page.wait_for_timeout(300)
            structure_held = state(page)
            check(structure_held["fillCalls"] == [], "结构完成后的暂停期间仍无字段写入", structure_held["fillCalls"])
            check(structure_held["fullName"] == "", "结构阶段暂停期间 fullName 未写入", structure_held["fullName"])
            check(structure_held["email"] == "", "结构阶段暂停期间 email 未写入", structure_held["email"])
            check(structure_held["taskSettled"] is False, "结构阶段暂停期间任务仍未完成")
            check(state(page)["taskCount"] == structure_index + 1, "结构阶段只启动了一个任务")

            page.locator('[data-yy-pause]').click()
            wait_js(page, "() => window.__taskSettled === true", "结构阶段继续后任务完成", timeout=60000)
            structure_done = state(page)
            structure_result = page.evaluate(RESULT_JS)
            check(structure_done["fullName"] == "张子涵", "结构阶段继续后 fullName 正确", structure_done["fullName"])
            check(structure_done["email"] == "zihan.zhang_dev@example.com", "结构阶段继续后 email 正确", structure_done["email"])
            check(structure_result["cancelled"] is False, "结构阶段任务结果未取消", structure_result)
            check(structure_result["duplicateFilledIds"] == [], "结构阶段结果没有重复字段", structure_result["duplicateFilledIds"])
            check(page.evaluate("() => window.activeFillTask === null"), "结构阶段任务完成后 activeFillTask 为空")
            check(structure_done["pauseDisplay"] == "none", "结构阶段任务完成后暂停按钮隐藏", structure_done["pauseDisplay"])

            check(console_errors == [], "浏览器无运行时异常", console_errors)
            print("RESULT: PASS")
            context.close()
            browser.close()
            context = None
            browser = None
        return 0
    except Exception as error:
        print("RESULT: FAIL")
        print(f"FAIL 原因: {error}")
        if page is not None:
            try:
                print("DEBUG 状态:", json.dumps(state(page), ensure_ascii=False, default=str))
            except Exception as debug_error:
                print(f"DEBUG 状态采集失败: {debug_error}")
            try:
                print("DEBUG 页面异常:", json.dumps(console_errors, ensure_ascii=False))
            except Exception:
                pass
        raise
    finally:
        server.shutdown()
        server.server_close()
        print("CLEANUP 浏览器与 HTTP server 已关闭")


if __name__ == "__main__":
    raise SystemExit(main())
