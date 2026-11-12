"""Run with Playwright Chromium installed. An optional argument selects the screenshot directory."""
import sys
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from browser_regression import EXT, start_server
from screenshot import demo_data


def run(output=None):
    server, origin = start_server()
    passed = 0

    def check(condition, description):
        nonlocal passed
        assert condition, description
        passed += 1

    def screenshot(page, filename):
        if output:
            output.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(output / filename), animations="disabled")

    try:
        with TemporaryDirectory(prefix="yanyu-sidepanel-") as directory, sync_playwright() as pw:
            copy_target = Path(directory) / "copy-target"
            copy_target.mkdir()
            (copy_target / "manifest.json").write_text(json.dumps({
                "manifest_version": 3, "name": "Copy target fixture", "version": "1.0",
                "background": {"service_worker": "fixture.js"},
            }), encoding="utf-8")
            (copy_target / "fixture.js").write_text("chrome.runtime.onInstalled.addListener(() => {});", encoding="utf-8")
            (copy_target / "index.html").write_text('<meta charset="utf-8"><label>姓名 <input id="fullName"></label>', encoding="utf-8")
            extensions = f"{EXT},{copy_target}"
            context = pw.chromium.launch_persistent_context(
                str(Path(directory) / "profile"), channel="chromium", headless=True,
                viewport={"width": 1440, "height": 900},
                args=[f"--disable-extensions-except={extensions}", f"--load-extension={extensions}"],
            )
            errors = []
            try:
                worker = next((worker for worker in context.service_workers if worker.url.endswith("/scripts/background.js")), None)
                if not worker:
                    worker = context.wait_for_event("serviceworker", predicate=lambda worker: worker.url.endswith("/scripts/background.js"))
                fixture_worker = next((worker for worker in context.service_workers if worker.url.endswith("/fixture.js")), None)
                if not fixture_worker:
                    fixture_worker = context.wait_for_event("serviceworker", predicate=lambda worker: worker.url.endswith("/fixture.js"))
                extension_origin = worker.url.split("/scripts/")[0]
                behavior = worker.evaluate("() => chrome.sidePanel.getPanelBehavior()")
                options = worker.evaluate("() => chrome.sidePanel.getOptions({})")
                check(behavior["openPanelOnActionClick"] and options["path"] == "popup/popup.html", "原生侧栏配置")

                data = demo_data()
                profile = data["profiles"][0]
                profile["basicInfo"].update(fullName="林示例", lastName="林", firstName="示例",
                                            email="yanyu-fixture@example.test", birthDate="2000-02")
                profile["moduleConfig"] = {"version": 1, "enabled": {"projects": False}}
                data["settings"].update(aiEnabled=False, uiTheme="light")
                data["activeProfileId"] = profile["id"]
                previous = [{"id": "legacy-round", "company": "演示科技", "position": "系统分析实习",
                             "status": "待一面", "confirmed": False, "archived": False}]
                worker.evaluate("data => chrome.storage.local.set(data)", {
                    "jobAutofillData": data, "yanyuSubmissionsV1": previous,
                })
                job = context.pages[0]
                job.goto(origin + "/fixture")
                job.evaluate("""() => {
                    const script = document.createElement('script');
                    script.type = 'application/ld+json';
                    script.textContent = JSON.stringify({'@type': 'JobPosting', title: '前端工程实习',
                        hiringOrganization: {name: '演示科技'}, employmentType: 'INTERN'});
                    document.head.append(script);
                }""")
                panel = context.new_page()
                panel.set_viewport_size({"width": 405, "height": 930})
                panel.on("pageerror", lambda error: errors.append(str(error)))
                panel.goto(extension_origin + "/popup/popup.html")
                job.bring_to_front()
                expect(panel.locator("#pageStatus")).to_have_class("page-status is-ready")
                expect(job.locator("#job-autofill-dock")).to_be_hidden()
                check(True, "连接成功时网页无悬浮卡片")

                job.locator("#fullName").focus()
                expect(panel.locator("#quickTarget strong")).to_contain_text("姓名")
                panel.locator("#quickSearch").fill("林示例")
                expect(panel.get_by_role("button", name="填入姓名", exact=True)).to_be_enabled()
                panel.get_by_role("button", name="填入姓名", exact=True).evaluate("(button) => button.click()")
                expect(job.locator("#fullName")).to_have_value("林示例")
                check(True, "键盘聚焦目标并点选补填")
                panel.locator("#quickSearch").fill(profile["projects"][0]["name"])
                expect(panel.locator("#quickResults")).to_contain_text("没有找到相关资料")
                check(True, "禁用项目模块不会出现在资料速查")
                panel.locator("#quickAll").check()
                expect(panel.locator("#quickResults")).to_contain_text(profile["projects"][0]["name"])
                expect(panel.locator("#quickResults [data-write]")).to_have_count(0)
                panel.locator("#quickAll").uncheck()
                check(True, "完整资料视图对停用模块仅提供复制")

                job.evaluate("""() => {
                    document.body.insertAdjacentHTML('beforeend', '<section data-profile-section="education"><h2>教育经历</h2>' +
                      '<div class="record-row"><label>学校<input id="previewSchool"></label><label>专业<input id="previewMajor"></label></div></section>');
                }""")
                job.locator("#previewSchool").focus()
                panel.locator("#quickSearch").fill(profile["education"][0]["school"])
                expect(panel.locator("#quickTarget")).to_contain_text("教育经历")
                whole = panel.get_by_role("button", name="预览整条", exact=True).first
                whole.evaluate("(button) => button.click()")
                preview = panel.locator("#quickEntryPreview")
                expect(preview).to_be_visible()
                expect(job.locator("#previewSchool")).to_be_empty()
                screenshot(panel, "easyoffer-quick-preview.png")
                preview.get_by_role("button", name="取消").click()
                expect(job.locator("#previewSchool")).to_be_empty()
                whole.evaluate("(button) => button.click()")
                preview.get_by_role("button", name="确认填入").evaluate("(button) => button.click()")
                expect(job.locator("#previewSchool")).to_have_value(profile["education"][0]["school"])
                expect(job.locator("#previewMajor")).to_have_value(profile["education"][0]["major"])
                check(True, "整条预览取消无写入，确认后写入同一行")

                job.locator("#birthDate").focus()
                panel.locator("#quickSearch").fill("出生日期")
                expect(panel.locator("#quickTarget strong")).to_contain_text("出生日期")
                panel.get_by_role("button", name="填入出生日期", exact=True).evaluate("(button) => button.click()")
                expect(panel.locator("#quickNotice")).to_contain_text("需要完整日期")
                expect(job.locator("#birthDate")).to_be_empty()
                check(True, "仅有年月无法填入完整日期控件，侧栏提示补日")

                job.evaluate("""() => {
                    const password = document.createElement('input');
                    password.type = 'password';
                    document.body.append(password);
                    password.focus();
                }""")
                expect(panel.get_by_role("button", name="填入出生日期", exact=True)).to_be_disabled()
                check(True, "聚焦受保护字段时清除上一目标")
                job.locator("#fullName").focus()
                expect(panel.locator("#quickTarget strong")).to_contain_text("姓名")
                panel.locator("#quickSearch").fill("")
                screenshot(panel, "yanyu-sidebar.png")
                panel.set_viewport_size({"width": 300, "height": 860})
                check(panel.evaluate("document.documentElement.scrollWidth === innerWidth"), "窄侧栏无页面横向溢出")
                panel.set_viewport_size({"width": 405, "height": 930})

                other = context.new_page()
                other.goto(origin + "/fixture?second")
                other.bring_to_front()
                expect(panel.locator("#pageStatus")).to_have_class("page-status is-ready")
                expect(panel.get_by_role("button", name="填入姓名", exact=True)).to_be_disabled()
                expect(other.locator("#fullName")).to_be_empty()
                check(True, "切换标签页后旧字段失效")

                protected = context.new_page()
                protected.goto("chrome://extensions/")
                protected.bring_to_front()
                expect(panel.locator("#pageStatus")).to_have_class("page-status is-restricted")
                panel.locator("#quickSearch").fill("林示例")
                expect(panel.get_by_role("button", name="复制姓名", exact=True)).to_be_enabled()
                expect(panel.locator("#fillBtn")).to_be_disabled()
                check(True, "浏览器内置页从首次打开就能查找和复制资料")
                foreign_url = fixture_worker.url.replace("/fixture.js", "/index.html")
                protected.goto(foreign_url)
                protected.bring_to_front()
                expect(panel.locator("#quickTarget strong")).to_have_text("复制后粘贴")
                expect(panel.locator("#pageStatus")).to_have_class("page-status is-restricted")
                panel.evaluate("""() => {
                    Object.defineProperty(navigator.clipboard, 'writeText', {
                        value: async value => { window.__copiedFixtureValue = value; }, configurable: true
                    });
                }""")
                panel.get_by_role("button", name="复制姓名", exact=True).evaluate("(button) => button.click()")
                expect(panel.locator("#quickNotice")).to_have_text("已复制姓名")
                expect(protected.locator("#fullName")).to_be_empty()
                check(panel.evaluate("window.__copiedFixtureValue") == "林示例", "其他扩展界面可取剪贴板文本，目标字段留给用户粘贴")
                screenshot(panel, "yanyu-protected-page.png")
                protected.close()
                panel.locator("#quickSearch").fill("")

                job.bring_to_front()
                expect(panel.locator("#pageStatus")).to_have_class("page-status is-ready")
                panel.locator("#aiFillBtn").evaluate("(button) => button.click()")
                expect(panel.locator("#captureResultBtn")).to_be_visible(timeout=20000)
                check(worker.evaluate("async () => (await chrome.storage.local.get('yanyuSubmissionsV1')).yanyuSubmissionsV1.length") == 1,
                      "AI 助填入口结束后，工作台仍只有原记录")
                with context.expect_page() as preview:
                    panel.locator("#captureResultBtn").evaluate("(button) => button.click()")
                workbench = preview.value
                workbench.on("pageerror", lambda error: errors.append(str(error)))
                drawer = workbench.get_by_role("dialog", name="核对当前岗位")
                expect(drawer).to_be_visible()
                expect(drawer.locator("[name=company]")).to_have_value("演示科技")
                expect(drawer.locator("[name=position]")).to_have_value("前端工程实习")
                expect(drawer.locator("[name=status]")).to_have_value("已收藏")
                check(True, "岗位解析与默认阶段")
                screenshot(workbench, "yanyu-application-drawer.png")
                drawer.get_by_role("button", name="取消", exact=True).click()
                check(workbench.locator(".tracker-table tbody tr").count() == 1, "取消预览没有新增记录")
                workbench.close()

                job.bring_to_front()
                expect(panel.locator("#pageStatus")).to_have_class("page-status is-ready")
                with context.expect_page() as preview:
                    panel.locator("#captureJobBtn").evaluate("(button) => button.click()")
                workbench = preview.value
                workbench.on("pageerror", lambda error: errors.append(str(error)))
                drawer = workbench.get_by_role("dialog", name="核对当前岗位")
                drawer.locator("[name=status]").select_option("已投递")
                drawer.locator("[name=date]").fill("2026-11-08")
                drawer.get_by_role("button", name="添加到工作台").click()
                expect(workbench.locator(".tracker-table tbody tr")).to_have_count(2)
                expect(workbench.locator(".tracker-stats > div").nth(1).locator("strong")).to_have_text("1")
                check(True, "同公司不同职位保存成功，待核实旧记录未计入已确认投递")

                workbench.get_by_role("button", name="编辑 演示科技 · 系统分析实习").click()
                editor = workbench.get_by_role("dialog", name="编辑申请")
                expect(editor.locator("[name=status]")).to_have_value("面试中")
                expect(editor.locator("[name=interviewRound]")).to_have_value("待一面")
                editor.locator("[name=interviewRound]").select_option("待二面")
                editor.get_by_role("button", name="保存修改").click()
                expect(workbench.locator(".tracker-stage", has_text="待二面")).to_be_visible()
                workbench.get_by_role("button", name="编辑 演示科技 · 系统分析实习").click()
                editor.get_by_text("阶段变更历史").click()
                expect(editor.get_by_text("待一面 → 待二面", exact=False)).to_be_visible()
                editor.press("Escape")
                check(True, "迁移面试细状态，变更历史可查看")
                screenshot(workbench, "yanyu-tracker-table.png")

                workbench.get_by_role("button", name="看板", exact=True).click()
                expect(workbench.locator(".tracker-board")).to_be_visible()
                workbench.get_by_role("button", name="仪表盘", exact=True).click()
                expect(workbench.locator(".tracker-dashboard")).to_be_visible()
                workbench.locator(".tracker-filters [name=q]").fill("没有匹配")
                expect(workbench.locator(".tracker-count")).to_have_text("0 条记录")
                expect(workbench.locator(".tracker-stats > div").nth(1).locator("strong")).to_have_text("0")
                workbench.locator(".tracker-filters [name=q]").fill("")
                screenshot(workbench, "yanyu-tracker-dashboard.png")
                check(True, "表格、看板、仪表盘及统计共用筛选")

                workbench.get_by_role("button", name="表格", exact=True).click()
                workbench.locator(".tracker-table tr", has_text="前端工程实习").get_by_role("button", name="归档").click()
                expect(workbench.locator(".tracker-count")).to_have_text("1 条记录")
                workbench.locator("[name=archive]").select_option("archive")
                workbench.get_by_role("button", name="恢复", exact=True).click()
                expect(workbench.locator(".tracker-count")).to_have_text("0 条记录")
                workbench.locator("[name=archive]").select_option("active")
                expect(workbench.locator(".tracker-count")).to_have_text("2 条记录")
                check(True, "归档与恢复共用当前筛选")

                workbench.set_viewport_size({"width": 390, "height": 830})
                workbench.locator("#themeToggle").click()
                expect(workbench.locator("html")).to_have_attribute("data-theme", "dark")
                check(workbench.evaluate("document.documentElement.scrollWidth === innerWidth"), "窄屏仅在表格区域滚动")
                screenshot(workbench, "yanyu-tracker-dark-narrow.png")
                workbench.locator("#themeToggle").click()
                workbench.set_viewport_size({"width": 1440, "height": 900})

                workbench.locator('[data-page="help"]').click()
                workbench.locator(".shell-search").fill("点选补填")
                expect(workbench.locator("#help-quick ol")).to_contain_text("预览整条")
                expect(workbench.locator("#help-quick .help-tip")).to_be_visible()
                screenshot(workbench, "yanyu-help.png")
                check(not errors, errors)

                workbench.goto(extension_origin + "/options/options.html#section-basic")
                birthday = workbench.locator("#birthDate + .date-picker button")
                expect(birthday).to_be_visible()
                birthday.click()
                calendar = workbench.locator("#resumeCalendar")
                expect(calendar).to_be_visible()
                expect(calendar.locator("[data-view=years]")).to_have_text("2000 年")
                expect(calendar.get_by_role("button", name="仅保存年月")).to_be_visible()
                check(workbench.locator('#sidebarMenu .sidebar-link').evaluate_all(
                    "links => links.slice(-3).map(link => link.dataset.module)"
                ) == ["dates", "modules", "actions"], "模块管理紧邻保存删除")
                screenshot(workbench, "yanyu-resume-calendar.png")
                workbench.keyboard.press("Escape")
                workbench.set_viewport_size({"width": 390, "height": 700})
                birthday.click()
                bounds = calendar.bounding_box()
                check(bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= 390 and bounds["y"] >= 0 and bounds["y"] + bounds["height"] <= 700,
                      "实际简历编辑页窄窗口的月历保持在视口内")
                screenshot(workbench, "yanyu-resume-calendar-narrow.png")
                workbench.keyboard.press("Escape")

                workbench.evaluate("""() => {
                    document.addEventListener('click', () => {
                        chrome.windows.getCurrent(win => {
                            chrome.sidePanel.open({windowId: win.id});
                        });
                    }, {once: true});
                }""")
                workbench.mouse.click(5, 5)
                workbench.wait_for_function("""async () => {
                    const panels = await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL']});
                    return panels.some(panel => panel.documentUrl.endsWith('/popup/popup.html'));
                }""")
                check(True, "真实浏览器创建原生 SIDE_PANEL 上下文")
            finally:
                context.close()
    finally:
        server.shutdown()
        server.server_close()
    print(f"PASS {passed} FAIL 0")


if __name__ == "__main__":
    run(Path(sys.argv[1]) if len(sys.argv) > 1 else None)
