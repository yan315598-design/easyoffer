"""Exercise the same repeated-record engine with unrelated URLs and DOM layouts."""

from playwright.sync_api import sync_playwright

from offerlink_regression import CHROME_MOCK, EXT, chrome_path, read_content_assets


def run_tests():
    _, scripts, _ = read_content_assets()
    tests = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome_path(), headless=True)
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script('window.__CAPYBARA_DEMO__ = {profiles: [], settings: {}};\n' + CHROME_MOCK)

        def setup(url, html):
            page.route(url, lambda route: route.fulfill(content_type='text/html; charset=utf-8', body=html))
            page.goto(url)
            for script in scripts:
                page.add_script_tag(path=str(EXT / script))

        def fill(profile, mode='full', complete=False):
            return page.evaluate(
                '([profile, mode, completeRows]) => fillForm(profile, {mode, completeRows, openTimeoutMs: 150})',
                [profile, mode, complete],
            )

        education = {'education': [
            {'school': '南方示例大学', 'major': '统计学', 'degree': '本科'},
            {'school': '北方示例大学', 'major': '计算机', 'degree': '硕士'},
            {'school': '东部示例大学', 'major': '数学', 'degree': '博士'},
        ]}
        setup('https://forms-one.test/apply', '''
          <section data-profile-section="education"><h2>教育经历</h2><div id="rows">
            <div class="record-row"><label>学校<input class="school" value="北方示例大学"></label><label>专业<input class="major"></label></div>
          </div><button type="button" id="add">添加教育经历</button></section>
          <script>
            window.additions = [];
            document.querySelector('#add').onclick = () => {
              const rows = document.querySelector('#rows');
              window.additions.push(rows.lastElementChild.querySelector('.major').value);
              setTimeout(() => rows.insertAdjacentHTML('beforeend',
                '<div class="record-row"><label>学校<input class="school"></label><label>专业<input class="major"></label></div>'), 35);
            };
          </script>
        ''')
        fill(education, 'incremental')
        tests['incremental fills matching record without adding rows'] = page.locator('.major').evaluate_all('els => els.map(x => x.value)') == ['计算机']
        fill(education, 'incremental', True)
        tests['adds once per record and waits for previous fields'] = page.evaluate('window.additions') == ['计算机', '统计学']
        tests['maintains identity when existing rows are out of source order'] = page.locator('.school').evaluate_all('els => els.map(x => x.value)') == ['北方示例大学', '南方示例大学', '东部示例大学']
        fill(education)
        tests['retry does not duplicate rows'] = page.locator('.school').count() == 3
        page.locator('.school').last.fill('另一所学校')
        page.locator('.major').last.fill('')
        result = fill(education)
        tests['ambiguous existing identity is preserved'] = page.locator('.school').count() == 3 and page.locator('.major').last.input_value() == '' and any(
            row['reason'] == 'record_ambiguous' for row in result['results'])

        setup('https://forms-two.test/profile', '''
          <section><h2>技能证书</h2><article><label>技能证书<input id="certificate" maxlength="25"></label></article></section>
          <section><h2>竞赛获奖</h2><article>
            <label>竞赛名称<input id="competition"></label>
            <label>竞赛获奖等级<input id="grade" maxlength="25"></label>
          </article></section>
          <section><h2>其他荣誉</h2><article><label>荣誉名称<input id="honor"></label></article></section>
          <section><h2>IT技能</h2><article>
            <label>技能类别<select id="skill"><option value="">请选择</option><option>Python</option></select></label>
            <label>掌握程度<select id="level"><option value="">请选择</option><option>熟练</option></select></label>
          </article></section>
          <div class="el-form-item"><label for="blood">血型</label><div class="el-select"><div class="el-select__wrapper">
            <input id="blood" role="combobox" aria-controls="bloodOptions" readonly><span class="el-select__selected-item is-transparent">请选择血型</span>
          </div></div></div>
          <div id="bloodOptions" class="el-select-dropdown" hidden><div role="option">AB型</div></div>
          <script>
            const blood = document.getElementById('blood');
            const menu = document.getElementById('bloodOptions');
            blood.parentElement.onclick = () => menu.hidden = false;
            menu.firstElementChild.onclick = () => {
              blood.nextElementSibling.textContent = 'AB型';
              blood.nextElementSibling.classList.remove('is-transparent');
              menu.hidden = true;
              setTimeout(() => blood.nextElementSibling.textContent = '', 60);
            };
          </script>
        ''')
        result = fill({
            'basicInfo': {'bloodType': 'AB'},
            'skills': [{'name': 'Python', 'proficiency': '熟练'}],
            'certificates': [{'name': '示例资格证书'}],
            'awards': [
                {'name': '示例奖学金', 'category': '奖学金', 'level': '国家级'},
                {'name': '示例建模竞赛', 'category': '竞赛获奖', 'level': '国家级', 'grade': '二等奖'},
            ],
        })
        expected = {'certificate': '示例资格证书', 'competition': '示例建模竞赛', 'grade': '二等奖',
                    'honor': '示例奖学金', 'skill': 'Python', 'level': '熟练'}
        for field, value in expected.items():
            tests[f'isolates {field} from adjacent modules'] = page.locator('#' + field).input_value() == value
        tests['reverted selection is counted for review'] = any(row['reason'] == 'value_reset' for row in result['results'])

        setup('https://forms-two.test/contest-rows', '''
          <section><h2>竞赛奖励</h2><div id="rows"></div>
            <button type="button" id="add">添加竞赛奖励</button>
          </section>
          <script>
            function addRow() {
              const rows = document.querySelector('#rows');
              rows.insertAdjacentHTML('beforeend', '<article class="record-row"><div class="ant-form-item">' +
                '<label>竞赛名称<input class="contest"></label></div><label>竞赛获奖等级<input class="grade"></label></article>');
              const input = rows.lastElementChild.querySelector('.contest');
              input.addEventListener('input', () => setTimeout(() => {
                const group = input.closest('.ant-form-item');
                const invalid = input.value.length > 25;
                input.setAttribute('aria-invalid', String(invalid));
                group.classList.toggle('ant-form-item-has-error', invalid);
                group.querySelector('.ant-form-item-explain-error')?.remove();
                if (invalid) group.insertAdjacentHTML('beforeend', '<span class="ant-form-item-explain-error">最大长度为25</span>');
              }, 35));
            }
            document.querySelector('#add').onclick = addRow;
            addRow();
          </script>
        ''')
        contests = {'awards': [
            {'name': '2026年第十八届全国大学生示例数学建模竞赛国家级二等奖', 'category': '竞赛获奖', 'grade': '二等奖'},
            {'name': '示例研究生金融科技创新大赛', 'grade': '三等奖'},
            {'name': '示例奖学金', 'category': '奖学金'},
        ]}
        fill(contests)
        tests['uncategorized contest gets its own row and scholarship is excluded'] = page.locator('.contest').evaluate_all(
            'els => els.map(x => x.value)') == ['全国大学生示例数学建模竞赛', '示例研究生金融科技创新大赛']
        tests['contest title passes delayed website length validation'] = page.locator('.ant-form-item-has-error').count() == 0
        fill(contests)
        tests['shortened titles still match existing records on retry'] = page.locator('.contest').count() == 2
        tests['combined ranking only resolves when the relevant scopes agree'] = page.evaluate('''() =>
            educationRankOptionValue('成绩排名', '专业排名前２０％；班级排名前20%') === '前20%' &&
            educationRankOptionValue('专业排名', '专业排名前10%；班级排名前20%') === '前10%' &&
            educationRankOptionValue('成绩排名', '专业排名前10%；班级排名前20%') === '专业排名前10%；班级排名前20%'
        ''')

        setup('https://forms-three.test/dates', '''
          <section data-profile-section="education"><h2>教育经历</h2><article class="record-row">
            <label>学校<input id="school"></label>
            <div class="ant-form-item"><label>起止时间</label><div class="ant-picker ant-picker-range">
              <input id="start" readonly placeholder="开始日期"><input id="end" readonly placeholder="结束日期">
            </div></div>
          </article></section>
          <div class="ant-picker-dropdown" hidden>
            <table><tr><td title="2020-09-01">1</td><td title="2024-06-30">30</td></tr></table>
          </div>
          <script>
            const panel = document.querySelector('.ant-picker-dropdown');
            const start = document.getElementById('start');
            const end = document.getElementById('end');
            let pending;
            start.onclick = () => { pending = ''; panel.hidden = false; };
            for (const cell of panel.querySelectorAll('td')) cell.onclick = () => {
              if (!pending) { pending = cell.title; return; }
              start.value = pending; end.value = cell.title; panel.hidden = true;
            };
            document.body.addEventListener('mousedown', event => { if (event.target === document.body) panel.hidden = true; });
          </script>
        ''')
        result = fill({'education': [{'school': '示例大学', 'startDate': '2020-09-01', 'endDate': '2024-06-30'}]})
        tests['range commits both dates as a pair'] = (page.locator('#start').input_value(), page.locator('#end').input_value()) == ('2020-09-01', '2024-06-30')
        tests['range reports both confirmed endpoints'] = sum(row['status'] == 'filled' for row in result['results']) == 3
        page.locator('#start').evaluate("(el) => el.value = ''")
        page.locator('#end').evaluate("(el) => el.value = ''")
        result = fill({'education': [{'school': '示例大学', 'startDate': '2020-09', 'endDate': '2024-06'}]})
        tests['day-range refuses partial dates without fabricating days'] = not page.locator('#start').input_value() and any(
            row['reason'] == 'date_precision_required' for row in result['results'])

        setup('https://forms-four.test/confirm', '''
          <section data-profile-section="education"><h2>教育经历</h2>
            <div class="record-row"><label>学校<input id="school"></label></div>
            <button type="button" id="add">添加</button>
          </section>
          <dialog id="confirm"><p>请确认是否新增</p><button id="confirmAdd">确认</button></dialog>
          <script>
            window.addClicks = 0; window.confirmClicks = 0;
            document.querySelector('#add').onclick = () => { window.addClicks++; document.querySelector('dialog').showModal(); };
            document.querySelector('#confirmAdd').onclick = () => window.confirmClicks++;
          </script>
        ''')
        result = fill(education)
        tests['confirmation stops further additions and leaves control to the user'] = page.evaluate('[window.addClicks,window.confirmClicks]') == [1, 0] and page.locator('dialog').is_visible() and bool(result['manualFields'])
        setup('https://forms-five.test/controlled', '''
          <div class="ant-form-item">
            <div class="ant-form-item-label"><label for="school_value">最高学历学校</label></div>
            <div class="ant-form-item-control-input-content"><div class="ant-select"><div class="ant-select-selector">
              <input id="rc_select_1" role="combobox" aria-controls="rc_select_1_list" aria-expanded="false">
            </div></div></div>
          </div>
          <div class="ant-select-dropdown" hidden>
            <div id="rc_select_1_list" role="listbox" style="width:0;height:0;overflow:hidden"><div role="option">北方示例大学</div></div>
            <div class="ant-select-item-option">北方示例大学</div>
          </div>
          <div class="ant-form-item"><label for="highestMajor">最高学历专业</label><input id="highestMajor"></div>
          <div class="ant-form-item"><label for="highestDate">最高学历毕业日期</label><input type="month" id="highestDate"></div>
          <div class="ant-form-item"><div class="ant-form-item-label"><label>性别</label></div>
            <div class="ant-radio-group"><label><input type="radio" value="1">男</label><label><input type="radio" value="2">女</label></div>
          </div>
          <div class="resume-group"><h3>项目经历</h3><div id="projects"></div><button type="button" id="add">添加</button></div>
          <script>
            const field = document.getElementById('rc_select_1');
            const menu = document.querySelector('.ant-select-dropdown');
            field.parentElement.onmousedown = () => { menu.hidden = false; field.setAttribute('aria-expanded','true'); };
            menu.querySelector('.ant-select-item-option').onclick = () => {
              field.insertAdjacentHTML('afterend','<span class="ant-select-selection-item">北方示例大学</span>');
              menu.hidden = true;
              field.setAttribute('aria-expanded','false');
            };
            document.getElementById('add').onclick = () => document.getElementById('projects').insertAdjacentHTML('beforeend',
              '<article><label>项目名称<input></label></article>');
          </script>
        ''')
        result = fill({'basicInfo': {'gender': '女'}, 'education': [
            {'school': '南方示例大学', 'major': '统计学', 'degree': '本科'},
            {'school': '北方示例大学', 'major': '计算机', 'degree': '硕士', 'endDate': '2024-06'}],
            'projects': [{'name': '示例项目'}]})
        tests['Ant visual option commits when aria-owns points to a zero-sized list'] = page.locator('.ant-select-selection-item').count() == 1
        tests['highest education summary uses a single highest record'] = page.locator('#highestMajor').input_value() == '计算机' and page.locator('#highestDate').input_value() == '2024-06'
        tests['Ant radio uses the group question'] = page.locator('input[type=radio]').last.is_checked()
        tests['empty div section with a safe Add button can create its first record'] = page.locator('#projects input').count() == 1 and page.locator('#projects input').input_value() == '示例项目'
        setup('https://forms-six.test/double-calendar', '''
          <section data-profile-section="education"><h2>教育经历</h2><article class="record-row">
            <label>学校<input id="school"></label>
            <div class="ant-form-item"><label>起止时间</label><div class="ant-picker ant-picker-range">
              <input id="start" readonly placeholder="开始日期"><input id="end" readonly placeholder="结束日期">
            </div></div>
          </article></section>
          <div class="ant-picker-dropdown" hidden>
            <div class="ant-picker-panel"><span class="ant-picker-year-btn">2020年</span><span class="ant-picker-month-btn">9月</span>
              <button type="button" class="ant-picker-header-super-next-btn" style="visibility:hidden">隐藏的下一年</button>
              <table><tr><td title="2020-09-01" class="ant-picker-cell-in-view">1</td></tr></table>
            </div>
            <div class="ant-picker-panel">
              <button type="button" class="ant-picker-header-super-next-btn" id="next">下一年</button>
              <table id="endDates"><tbody></tbody></table>
            </div>
          </div>
          <script>
            const panel = document.querySelector('.ant-picker-dropdown');
            const start = document.getElementById('start');
            const end = document.getElementById('end');
            let pending = '';
            start.onclick = () => { panel.hidden = false; };
            panel.querySelector('td').onclick = () => { pending = '2020-09-01'; };
            document.getElementById('next').onclick = () => {
              panel.querySelector('.ant-picker-year-btn').textContent = '2021年';
              document.querySelector('#endDates tbody').innerHTML = '<tr><td title="2021-09-30" class="ant-picker-cell-in-view">30</td></tr>';
              document.querySelector('#endDates td').onclick = () => {
                start.value = pending; end.value = '2021-09-30'; panel.hidden = true;
              };
            };
          </script>
        ''')
        fill({'education': [{'school': '示例大学', 'startDate': '2020-09-01', 'endDate': '2021-09-30'}]})
        tests['dual calendar follows the visible right-hand navigation button'] = (
            page.locator('#start').input_value(), page.locator('#end').input_value()) == ('2020-09-01', '2021-09-30')
        setup('https://forms-seven.test/unavailable-lookup', '''
          <section data-profile-section="education"><h2>教育经历</h2>
            <div id="rows"></div><button type="button" id="add">添加</button>
          </section>
          <script>
            const row = '<div class="record-row"><label>学校<select class="school"><option value="">请选择</option></select></label>'
              + '<label>学历<select class="degree"><option value="">请选择</option><option>本科</option><option>硕士</option></select></label>'
              + '<label>开始日期<input type="date" class="date"></label></div>';
            document.getElementById('rows').innerHTML = row;
            document.getElementById('add').onclick = () => document.getElementById('rows').insertAdjacentHTML('beforeend', row);
          </script>
        ''')
        records = {'education': [
            {'school': '南方示例大学', 'degree': '本科', 'startDate': '2020-09-01'},
            {'school': '北方示例大学', 'degree': '硕士', 'startDate': '2024-09-01'},
        ]}
        fill(records)
        tests['a missing lookup leaves the value empty and other unique identity fields allow adding'] = (
            page.locator('.degree').evaluate_all('els => els.map(e => e.value)') == ['本科', '硕士'] and
            page.locator('.school').evaluate_all('els => els.map(e => e.value)') == ['', ''])
        fill(records)
        tests['retries reuse rows identified by two committed fields'] = page.locator('.record-row').count() == 2
        setup('https://forms-eight.test/late-options', '''
          <div class="ant-form-item"><label for="country">国家地区</label>
            <div class="ant-select"><div class="ant-select-selector">
              <input id="country" role="combobox" aria-controls="countries" aria-expanded="false">
            </div></div>
          </div>
          <div class="ant-select-dropdown" hidden><div id="countries" role="listbox" style="height:0;width:0;overflow:hidden"></div></div>
          <script>
            const country = document.querySelector('#country');
            const panel = document.querySelector('.ant-select-dropdown');
            country.parentElement.onmousedown = () => { panel.hidden = false; country.setAttribute('aria-expanded','true'); };
            country.addEventListener('input', () => {
              if (!country.value) return;
              setTimeout(() => {
                const option = document.createElement('div');
                option.className = 'ant-select-item-option';
                option.textContent = '中国';
                option.onclick = () => {
                  country.insertAdjacentHTML('afterend','<span class="ant-select-selection-item">中国</span>');
                  country.value = '';
                  panel.hidden = true;
                  country.setAttribute('aria-expanded','false');
                };
                panel.append(option);
              }, 220);
            });
          </script>
        ''')
        result = fill({'basicInfo': {'country': '中国'}})
        tests['an initially empty Ant select waits for an asynchronously loaded option'] = (
            page.locator('.ant-select-selection-item').count() == 1 and result.get('filledCount') == 1)
        setup('https://forms-nine.test/virtual-skill', '''
          <section><h2>IT技能</h2><article>
            <div class="ant-form-item"><label for="skill">技能类别</label>
              <div class="ant-select"><div class="ant-select-selector">
                <input id="skill" role="combobox" aria-controls="skill-list" aria-expanded="false" readonly>
              </div></div>
            </div>
            <label>掌握程度<select id="level"><option value="">请选择</option><option>精通</option></select></label>
          </article></section>
          <div class="ant-select-dropdown" hidden>
            <div id="skill-list" role="listbox" style="height:0;width:0;overflow:hidden"></div>
            <div class="rc-virtual-list-holder" style="height:100px;width:200px;overflow:auto">
              <div style="height:500px"><div id="options" style="position:sticky;top:0"></div></div>
            </div>
          </div>
          <script>
            const field = document.getElementById('skill');
            const panel = document.querySelector('.ant-select-dropdown');
            const holder = panel.querySelector('.rc-virtual-list-holder');
            const options = document.getElementById('options');
            function render() {
              const text = holder.scrollTop >= 255 ? 'PS' : 'Access';
              options.innerHTML = '<div class="ant-select-item-option">' + text + '</div>';
              options.firstElementChild.onclick = () => {
                field.insertAdjacentHTML('afterend','<span class="ant-select-selection-item">' + text + '</span>');
                field.setAttribute('aria-expanded', 'false');
                panel.hidden = true;
              };
            }
            field.parentElement.onmousedown = () => {
              field.setAttribute('aria-expanded', 'true');
              panel.hidden = false;
              render();
            };
            holder.addEventListener('scroll', render);
          </script>
        ''')
        result = fill({'skills': [{'name': 'Photoshop', 'proficiency': '精通'}]})
        tests['Ant virtual skills scroll to an off-screen equivalent and confirm proficiency'] = (
            page.locator('.ant-select-selection-item').all_text_contents() == ['PS'] and
            page.locator('#level').input_value() == '精通' and result.get('filledCount') == 2)
        tests['no page script errors'] = not errors
        browser.close()
    for label, passed in tests.items():
        print(f'{"PASS" if passed else "FAIL"} {label}')
    print(f'passed={sum(tests.values())} failed={sum(not passed for passed in tests.values())}')
    return all(tests.values())


if __name__ == '__main__':
    raise SystemExit(0 if run_tests() else 1)
