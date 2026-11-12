from pathlib import Path
from playwright.sync_api import expect, sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
    page=browser.new_page(viewport={"width": 360, "height": 490})
    page.set_content('''<style>.form-group{max-width:320px;margin:12px 0}</style>
        <section id="section-basic"><div class="item-card">
        <div class="form-group"><label>开始时间</label><input type="text" class="edu-start" value="2024-02-29"></div>
        <div class="form-group"><label>结束时间</label><input type="text" class="edu-end" value="至今"></div>
        </div><div class="form-group"><label>取得时间</label><input type="text" class="award-date" value="旧时间"></div>
        <div class="form-group"><label>证书有效期</label><input type="text" class="certificate-expiry"></div>
        </section>''')
    page.add_style_tag(path=str(ROOT/'job-autofill-assistant/options/date-controls.css'))
    page.add_script_tag(path=str(ROOT/'job-autofill-assistant/options/date-controls.js'))
    calendar=page.locator('#resumeCalendar')
    start=page.locator('.edu-start + .date-picker button')
    end=page.locator('.edu-end + .date-picker button')
    passed=0

    def check(condition):
        global passed
        assert condition
        passed+=1

    def jump(year, month):
        calendar.locator('[data-view=years]').click()
        choice=calendar.locator(f'[data-choice="{year}"]')
        while not choice.count():
            title=calendar.locator('[data-view=years]').inner_text()
            direction='上一组年份' if year < int(title.split('–')[0]) else '下一组年份'
            calendar.get_by_role('button',name=direction).click()
        choice.click()
        calendar.locator(f'[data-choice="{month}"]').click()

    start.press('Enter')
    expect(calendar.locator('[data-day="29"]')).to_be_focused()
    check(calendar.locator('[data-day]').count()==29)
    calendar.get_by_role('button',name='上一年').click()
    expect(calendar.get_by_role('status')).to_contain_text('没有原来的日期')
    check(calendar.locator('[data-day]').count()==28 and page.locator('.edu-start').input_value()=='2024-02-29')
    page.keyboard.press('Escape')
    expect(start).to_be_focused()
    check(not calendar.is_visible() and page.locator('.edu-start').input_value()=='2024-02-29')

    start.click()
    calendar.get_by_role('button',name='上一年').click()
    calendar.get_by_role('button',name='仅保存年月').click()
    check(page.locator('.edu-start').input_value()=='2023-02')
    check('原值：旧时间' in page.locator('.award-date + .date-picker').inner_text() and page.locator('.award-date').input_value()=='旧时间')

    end.click()
    jump(2022, 1)
    calendar.locator('[data-day="31"]').click()
    check(not page.evaluate('YanyuDates.validate()'))
    end.click()
    calendar.get_by_role('button',name='至今',exact=True).click()
    check(page.evaluate('YanyuDates.validate()') and page.locator('.edu-end').input_value()=='至今')

    expiry=page.locator('.certificate-expiry + .date-picker button')
    expiry.click()
    expect(calendar.get_by_role('button',name='长期')).to_be_visible()
    panel_bounds=calendar.bounding_box()
    check(panel_bounds['x']>=0 and panel_bounds['y']>=0 and panel_bounds['x']+panel_bounds['width']<=360 and panel_bounds['y']+panel_bounds['height']<=490)
    calendar.get_by_role('button',name='长期').click()
    check(page.locator('.certificate-expiry').input_value()=='长期')
    expiry.click()
    calendar.get_by_role('button',name='清空').click()
    check(page.locator('.certificate-expiry').input_value()=='')

    page.evaluate("document.querySelector('.edu-start').value='2025-06-10';YanyuDates.refresh()")
    start.click()
    expect(calendar.locator('[data-day="10"]')).to_be_focused()
    page.keyboard.press('End')
    page.keyboard.press('ArrowRight')
    page.keyboard.press('Enter')
    check(page.locator('.edu-start').input_value()=='2025-07-01')

    page.evaluate("document.querySelector('#section-basic').insertAdjacentHTML('beforeend','<div class=\"form-group\"><label>考试日期</label><input type=\"text\" data-ext-key=\"obtainedDate\" value=\"2026-09\"></div>')")
    expect(page.locator('[data-ext-key=obtainedDate] + .date-picker button')).to_have_text('2026-09')
    check(not page.locator('.edu-start').is_visible())
    print(f'Passed {passed}, Failed 0')
    browser.close()
