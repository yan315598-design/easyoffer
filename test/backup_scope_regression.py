"""Test backup downloads, conflict previews, and directory snapshots with an unpacked extension."""

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright

from offerlink_regression import EXT


def run(output):
    passed = 0

    def check(condition, label):
        nonlocal passed
        assert condition, label
        passed += 1

    with TemporaryDirectory(prefix="easyoffer-backup-test-") as temp, sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(temp, channel="chromium", headless=True, accept_downloads=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"], viewport={"width": 1240, "height": 900})
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            origin = worker.url.split("/scripts/")[0]
            page = context.pages[0]
            page.goto(origin + "/options/options.html#settings")
            page.wait_for_function("typeof sendMessage === 'function'")
            page.evaluate("""async () => {
              const send = request => chrome.runtime.sendMessage(request);
              await send({action:'importData', data:JSON.stringify({version:'2.0.0', activeProfileId:'synthetic-a',
                profiles:[{id:'synthetic-a',name:'备份样本甲',skills:['Python','Excel'],basicInfo:{specialSkillProficiency:'熟练'},
                  familyMembers:[{id:'family-1',name:'示例家人',occupation:'教师',employer:'示例学校',position:'班主任',birthDate:'1975-08-01'}]},
                  {id:'synthetic-b',name:'备份样本乙',awards:[{id:'award-1',name:'示例奖项'}]}],
                submissions:[{id:'application-1',company:'示例公司',position:'示例岗位'}],
                settings:{aiApiKey:'synthetic-key-only',uiTheme:'light'}}),
                options:{restoreSettings:true,restoreApiKey:true}});
              for (const [id, body] of [['synthetic-a','fixture-a'],['synthetic-b','fixture-b']]) {
                const file = {name:id+'.txt',type:'text/plain',size:body.length,dataUrl:'data:text/plain;base64,'+btoa(body)};
                const result = await send({action:'saveAttachment', profileId:id, kind:'resume', file});
                if (!result.success) throw new Error(result.error);
              }
            }""")
            page.reload()
            expect(page.get_by_role("heading", name="数据备份与恢复")).to_be_visible()
            page.get_by_role("button", name="全部备份").click()
            dialog = page.locator(".backup-choice-dialog")
            with page.expect_download() as downloaded:
                dialog.get_by_role("button", name="下载 JSON").click()
            payload = json.loads(downloaded.value.path().read_text(encoding="utf-8"))
            check({'synthetic-a', 'synthetic-b'} <= {p['id'] for p in payload['profiles']}, 'all profiles')
            check(len(payload['submissions']) == 1 and 'aiApiKey' not in payload['settings'], 'full scope and key exclusion')
            check({file['name'] for file in payload['attachmentContents'].values()} == {'synthetic-a.txt','synthetic-b.txt'}, 'attachments across all profiles')
            skills = next(p['skills'] for p in payload['profiles'] if p['id'] == 'synthetic-a')
            check([s['name'] for s in skills] == ['Python', 'Excel'] and skills[0]['proficiency'] == '熟练' and not skills[1]['proficiency'], 'legacy skill migration')
            page.goto(origin + "/options/options.html#view-skills")
            cards = page.locator("#profileOverview [data-module='skills'] .experience-preview")
            expect(cards).to_have_count(2)
            expect(cards.first).to_contain_text("Python")
            cards.last.locator("[data-move-entry='up']").click()
            expect(cards.first).to_contain_text("Excel")
            page.wait_for_function("""async () => {
              const state = (await chrome.storage.local.get('jobAutofillData')).jobAutofillData;
              return state.profiles.find(profile => profile.id === 'synthetic-a').skills[0].name === 'Excel';
            }""")
            check(True, 'structured skill reorder persists')
            if output:
                output.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(output / "easyoffer-skills.png"), animations="disabled")
            page.goto(origin + "/options/options.html#section-skills")
            name = page.get_by_role("combobox", name="技能名称", exact=True).first
            expect(name).to_have_value("Excel")
            check(name.evaluate("""input => {
              const field = input.closest('.form-group');
              const label = field.querySelector('label');
              const box = input.getBoundingClientRect();
              return box.width >= field.clientWidth - 2 && box.height >= 36 &&
                Math.abs(label.getBoundingClientRect().left - box.left) < 2;
            }"""), 'skill editor uses full-width labelled inputs')
            name.fill('MySQ')
            menu = page.get_by_role("listbox", name="技能名称选项")
            expect(menu.get_by_role("option", name="MySQL", exact=True)).to_be_visible()
            if output:
                page.screenshot(path=str(output / "easyoffer-it-skill-picker.png"), animations="disabled", style="#toast {visibility:hidden}")
            name.press('ArrowDown')
            name.press('Enter')
            check(name.input_value() == 'MySQL' and not menu.is_visible(), 'skill search and keyboard selection')
            level = page.get_by_role("combobox", name="掌握程度", exact=True).first
            level.click()
            page.get_by_role("listbox", name="掌握程度选项").get_by_role("option", name="良好", exact=True).click()
            check(level.input_value() == '良好', 'proficiency selection')
            custom = page.get_by_role("combobox", name="技能名称", exact=True).last
            custom.fill('示例企业内部工具')
            custom.press('Enter')
            check(custom.input_value() == '示例企业内部工具' and not menu.is_visible(), 'custom skill stays editable')
            if output:
                page.screenshot(path=str(output / "easyoffer-skills-editor.png"), animations="disabled", style="#toast {visibility:hidden}")
            page.set_viewport_size({"width": 390, "height": 900})
            check(page.evaluate("document.documentElement.scrollWidth <= innerWidth"), 'skill editor fits narrow viewport')
            page.set_viewport_size({"width": 1240, "height": 900})
            page.goto(origin + "/options/options.html#section-family")
            family = page.locator('#familyList .item-card').first
            expect(family.get_by_label('职业', exact=True)).to_have_value('教师')
            expect(family.get_by_label('工作单位', exact=True)).to_have_value('示例学校')
            expect(family.get_by_label('职务', exact=True)).to_have_value('班主任')
            check(family.locator('label').all_text_contents() == [
                '姓名', '与本人关系', '联系电话', '职业', '工作单位', '职务', '出生日期', '年龄', '政治面貌', '家庭所在地'
            ] and family.locator('[data-ext-collapse="familyMembers"]').count() == 0, 'family fields visible and in order')
            family.get_by_label('职业', exact=True).fill('中学教师')
            page.wait_for_function("""async () => {
              const {jobAutofillData: state} = await chrome.storage.local.get('jobAutofillData');
              return state.profiles.find(profile => profile.id === 'synthetic-a').familyMembers[0].occupation === '中学教师';
            }""")
            check(True, 'combined family card preserves save behavior')
            if output:
                page.screenshot(path=str(output / "easyoffer-family-editor.png"), animations="disabled", style="#toast {visibility:hidden}")
            page.goto(origin + "/options/options.html#settings")

            page.get_by_role("button", name="选择内容导出").click()
            for box in dialog.get_by_role("checkbox").all():
                box.uncheck()
            dialog.get_by_role("checkbox", name="备份样本乙").check()
            if output:
                output.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(output / "easyoffer-backup-selection.png"), animations="disabled")
            with page.expect_download() as downloaded:
                dialog.get_by_role("button", name="下载 JSON").click()
            partial = json.loads(downloaded.value.path().read_text(encoding="utf-8"))
            check([p['id'] for p in partial['profiles']] == ['synthetic-b'] and partial['activeProfileId'] == 'synthetic-b', 'selected profile')
            check(not partial['submissions'] and not partial['settings'] and not partial['attachmentContents'], 'partial optional data excluded')

            partial['profiles'][0]['name'] = '改名后的备份样本乙'
            file = {'name': 'backup.json', 'mimeType': 'application/json', 'buffer': json.dumps(partial).encode()}
            page.locator("#importBackupFile").set_input_files(file)
            expect(dialog.get_by_role("checkbox", name="更新已有简历「改名后的备份样本乙」")).not_to_be_checked()
            dialog.get_by_role("button", name="确认导入").click()
            expect(page.get_by_text("恢复完成 · 新增 0 · 更新 0 · 跳过 1")).to_be_visible()
            check(True, 'import conflict default skip')
            page.locator("#importBackupFile").set_input_files(file)
            dialog.get_by_role("checkbox", name="更新已有简历「改名后的备份样本乙」").check()
            dialog.get_by_role("button", name="确认导入").click()
            expect(page.get_by_text("恢复完成 · 新增 0 · 更新 1 · 跳过 0")).to_be_visible()
            check(True, 'explicit update')
            check(page.evaluate("""async () => {
              const data = JSON.parse((await chrome.runtime.sendMessage({action:'exportData'})).data);
              return data.profiles.find(profile => profile.id === 'synthetic-b').attachments.resume.name === 'synthetic-b.txt';
            }"""), 'partial import preserves attachment')

            # OPFS supplies a real directory handle while keeping the test inside its temporary browser profile.
            snapshot = page.evaluate("""async () => {
              const handle = await navigator.storage.getDirectory();
              await backupDirectory.set(handle);
              const outcome = await chrome.runtime.sendMessage({action:'writeSnapshot'});
              const file = await (await handle.getFileHandle(outcome.filename)).getFile();
              return JSON.parse(await file.text());
            }""")
            check(snapshot['profiles'] and 'aiApiKey' not in snapshot['settings'], 'verified snapshot excludes key')
            expect(page.get_by_text("最近成功备份", exact=False)).to_be_visible()
            page.evaluate("""async () => {
              const data = (await chrome.storage.local.get('jobAutofillData')).jobAutofillData;
              data.profiles.find(profile => profile.id === 'synthetic-b').name = '自动快照样本';
              await chrome.storage.local.set({jobAutofillData:data});
            }""")
            page.wait_for_function("""async () => {
              const status = (await chrome.storage.local.get('easyofferBackupStatus')).easyofferBackupStatus;
              const handle = await backupDirectory.get();
              const file = await (await handle.getFileHandle(status.filename)).getFile();
              return JSON.parse(await file.text()).profiles.some(profile => profile.name === '自动快照样本');
            }""", timeout=10000, polling=200)
            check(True, 'auto snapshot captures changes')
        finally:
            context.close()
    print(f"PASS {passed} FAIL 0")


if __name__ == "__main__":
    run(Path(sys.argv[1]) if len(sys.argv) > 1 else None)
