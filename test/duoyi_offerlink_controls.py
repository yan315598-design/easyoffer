"""Regression for OfferLink and Duoyi controls using synthetic application data."""

from playwright.sync_api import sync_playwright

from offerlink_regression import CHROME_MOCK, EXT, chrome_path, read_content_assets


def run_tests():
    _, scripts, _ = read_content_assets()
    tests = {}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=chrome_path(), headless=True)
        page = browser.new_page()
        page.route('**/*', lambda route: route.abort())
        page.add_init_script('window.__CAPYBARA_DEMO__ = {profiles: [], settings: {}};\n' + CHROME_MOCK)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def setup(url, html):
            page.route(url.split('#')[0], lambda route: route.fulfill(content_type='text/html; charset=utf-8', body=html))
            page.goto(url)
            for script in scripts:
                page.add_script_tag(path=str(EXT / script))

        def fill(profile, mode='incremental'):
            return page.evaluate('([profile, mode]) => fillForm(profile, {mode, openTimeoutMs: 150})', [profile, mode])

        setup('https://offerlink.tech/myResume', '''
            <div class="el-form-item"><label for="blood">血型</label><div class="el-select"><div class="el-select__wrapper">
                <input id="blood" role="combobox" aria-controls="bloodOptions" readonly><span class="el-select__selected-item is-transparent">请选择血型</span>
            </div></div></div>
            <div id="bloodOptions" class="el-select-dropdown" hidden><div role="option">A型</div><div role="option">AB型</div></div>
            <label for="origin">籍贯</label><div class="el-cascader" aria-describedby="regions"><input id="origin" aria-expanded="false" readonly></div>
            <label for="birthplace">出生地</label><input id="birthplace">
            <div id="regions" class="el-cascader__dropdown" hidden></div>
            <script>
                const blood = document.querySelector('#blood');
                const options = document.querySelector('#bloodOptions');
                blood.parentElement.onclick = () => options.hidden = false;
                for (const option of options.children) option.onclick = () => {
                    blood.nextElementSibling.textContent = option.textContent;
                    blood.nextElementSibling.classList.remove('is-transparent');
                    options.hidden = true;
                };
                const origin = document.querySelector('#origin');
                const panel = document.querySelector('#regions');
                const levels = ['中国', '广东省', '潮州市', '潮安区'];
                function appendLevel(level) {
                    const menu = document.createElement('ul');
                    menu.className = 'el-cascader-menu__list';
                    menu.innerHTML = `<li class="el-cascader-node" aria-haspopup="${level < 3}"><label><input type="radio"></label><span class="el-cascader-node__label">${levels[level]}</span></li>`;
                    menu.querySelector('span').onclick = () => { if (level < 3) appendLevel(level + 1); };
                    menu.querySelector('input').onchange = () => {
                        origin.value = levels.slice(0, level + 1).join(' / ');
                        origin.setAttribute('aria-expanded', 'false');
                        panel.hidden = true;
                    };
                    panel.append(menu);
                }
                origin.onclick = () => { panel.replaceChildren(); panel.hidden = false; origin.setAttribute('aria-expanded', 'true'); appendLevel(0); };
            </script>
        ''')
        fill({'basicInfo': {'bloodType': 'AB', 'hometown': '广东潮州潮安县', 'birthPlace': '广东佛山'}})
        tests['OfferLink blood type'] = page.locator('#blood + span').inner_text() == 'AB型'
        tests['OfferLink historic region'] = page.locator('#origin').input_value() == '中国 / 广东省 / 潮州市 / 潮安区'
        tests['OfferLink independent birthplace'] = page.locator('#birthplace').input_value() == '广东佛山'

        setup('https://xz.duoyi.com/v40/#/center', '''
            <style>.tec-radio__original { position:absolute; width:0; height:0; opacity:0; }</style>
            <form>
                <div class="tec-form-item"><label class="tec-form-item__label">性别：</label>
                    <div class="tec-radio-group" role="group"><label class="tec-radio"><input type="radio" class="tec-radio__original" value="1">男</label>
                    <label class="tec-radio"><input type="radio" class="tec-radio__original" value="2">女</label></div>
                </div>
                <div id="relatives" class="tec-form-item"><label class="tec-form-item__label">有无亲友（含男女友）在公司就职？</label>
                    <div class="tec-radio-group" role="group"><label class="tec-radio"><input type="radio" class="tec-radio__original">有</label>
                    <label class="tec-radio"><input type="radio" class="tec-radio__original">无</label></div>
                </div>
                <div class="tec-form-item"><label class="tec-form-item__label">民族</label><div class="tec-select__trigger"><input id="ethnicity" class="tec-select__input" placeholder="请选择民族" readonly></div></div>
                <div class="tec-form-item"><label class="tec-form-item__label">宗教信仰</label><div class="tec-select__trigger"><input id="religion" class="tec-select__input" readonly></div></div>
                <div class="tec-form-item"><label class="tec-form-item__label">政治面貌</label><div class="tec-select__trigger"><input id="politics" class="tec-select__input" readonly></div></div>
                <div class="tec-form-item"><label class="tec-form-item__label">证件号</label><div class="tec-select__trigger"><input id="idType" class="tec-select__input" readonly></div><input id="document" class="tec-input__inner" placeholder="请填写账号"></div>
                <div class="tec-form-item"><label class="tec-form-item__label">IM联系方式</label><div class="tec-select__trigger"><input id="imType" class="tec-select__input" readonly></div><input id="imAccount" class="tec-input__inner" placeholder="请填写账号"></div>
                <div class="tec-form-item"><label class="tec-form-item__label">户口地</label><div class="tec-cascade__trigger"><input id="hukou" class="tec-cascade__input" value="浏览器残留的搜索文本"></div></div>
                <div class="tec-form-item"><label class="tec-form-item__label">现住地</label><div class="tec-cascade__trigger"><input id="residence" class="tec-cascade__input"></div></div>
                <div class="tec-form-item"><label class="tec-form-item__label">童年时所在城市</label><div class="tec-cascade__trigger"><input id="childhood" class="tec-cascade__input"></div></div>
                <div class="tec-form-item"><label class="tec-form-item__label">个人特长</label><table><tbody>
                    <tr><td>个人特长</td><td>熟练程度</td></tr>
                    <tr class="main-list"><td><input id="skill" placeholder="请输入"></td><td><div class="tec-select__trigger"><input id="proficiency" class="tec-select__input" readonly></div></td></tr>
                </tbody></table></div>
                <div class="tec-form-item"><label class="tec-form-item__label">家庭关系</label><table><tbody>
                    <tr><td>姓名</td><td>与自己关系</td><td>年龄</td><td>职业</td><td>职位</td><td>工作单位</td></tr>
                    <tr class="main-list"><td><input id="father" placeholder="请输入"></td><td><div class="tec-select__trigger tec-select__trigger--has-select"><input class="tec-select__input" placeholder="父子" readonly></div></td><td><input id="fatherAge" type="number"></td><td><div class="tec-select__trigger"><input id="fatherJob" class="tec-select__input" readonly></div></td><td><input id="fatherPosition"></td><td><input id="fatherEmployer"></td></tr>
                    <tr class="main-list"><td><input id="mother" placeholder="请输入"></td><td><div class="tec-select__trigger tec-select__trigger--has-select"><input class="tec-select__input" placeholder="母子" readonly></div></td><td><input id="motherAge" type="number"></td><td><input id="motherJob"></td><td><input id="motherPosition"></td><td><input id="motherEmployer"></td></tr>
                </tbody></table></div>
            </form>
            <script>
                for (const [id, text] of Object.entries({ethnicity:'汉族', religion:'无宗教信仰', politics:'共青团员', idType:'内地身份证', imType:'微信号', proficiency:'熟练', fatherJob:'教师'})) {
                    const input = document.getElementById(id);
                    const trigger = input.parentElement;
                    const panel = document.createElement('div');
                    panel.className = 'tec-select__popper';
                    panel.hidden = true;
                    panel.innerHTML = `<div class="tec-select-dropdown__item"><span class="tec-select-dropdown__item-label">${text}</span></div>`;
                    document.body.append(panel);
                    trigger.onclick = () => { panel.hidden = false; trigger.classList.add('tec-select__trigger--focus'); };
                    panel.firstElementChild.onclick = () => {
                        trigger.classList.remove('tec-select__trigger--focus');
                        trigger.classList.add('tec-select__trigger--has-select');
                        input.placeholder = text;
                        panel.hidden = true;
                    };
                }
                for (const [id, city] of Object.entries({hukou:'佛山市', childhood:'广州市', residence:'深圳市'})) {
                    const input = document.getElementById(id);
                    const trigger = input.parentElement;
                    const panel = document.createElement('div');
                    panel.className = 'tec-cascade__popper';
                    panel.hidden = true;
                    document.body.append(panel);
                    const levels = ['广东省', city];
                    trigger.onclick = () => {
                        panel.hidden = false;
                        panel.replaceChildren();
                        trigger.classList.add('tec-cascade__trigger--focus');
                        appendLevel(0);
                    };
                    function commit() {
                        input.value = '';
                        input.placeholder = levels.join('-');
                        trigger.classList.add('tec-cascade__trigger--has-select');
                        trigger.classList.remove('tec-cascade__trigger--focus');
                        panel.hidden = true;
                    }
                    input.addEventListener('input', () => {
                        if (id !== 'residence' || input.value !== '深圳') return;
                        panel.innerHTML = '<ul><li class="tec-cascade-node__navigation">' +
                            '<span class="tec-cascade-node__label" title="广东省-深圳市">广东省-深圳市</span></li></ul>';
                        panel.querySelector('li').onclick = commit;
                    });
                    function appendLevel(depth) {
                        const menu = document.createElement('ul');
                        menu.className = 'tec-cascade-menu';
                        menu.innerHTML = `<li class="tec-cascade-node"><span class="tec-cascade-node__label">${levels[depth]}</span>${depth === 0 ? '<i class="tec-cascade-node__icon"></i>' : ''}</li>`;
                        menu.firstElementChild.onclick = () => {
                            if (depth === 0) { appendLevel(1); return; }
                            commit();
                        };
                        panel.append(menu);
                    }
                }
            </script>
        ''')
        profile = {
            'basicInfo': {'gender': '女', 'ethnicity': '汉', 'religion': '无', 'politicalStatus': '团员',
                          'idCardType': '身份证', 'idCard': '000000000000000000', 'wechat': 'example-wechat', 'qq': '000001',
                          'registeredAddress': '广东省佛山市南海区', 'childhoodCity': '广东广州',
                          'currentCity': '深圳', 'specialSkills': '旧技能', 'specialSkillProficiency': '熟练',
                          'relativesEmployed': '否'},
            'skills': ['摄影', '写作'],
            'familyMembers': [
                {'name': '测试母亲', 'relation': '母亲', 'age': '50', 'occupation': '会计', 'position': '主管', 'employer': '示例乙'},
                {'name': '测试父亲', 'relation': '父亲', 'age': '52', 'occupation': '教师', 'position': '讲师', 'employer': '示例甲'},
            ],
        }
        result = fill(profile)
        tests['Duoyi named question and nameless hidden radio'] = page.locator('.tec-radio input:checked').count() == 1 and page.locator('.tec-radio input:checked').input_value() == '2'
        tests['Duoyi ethnicity committed'] = page.locator('#ethnicity').get_attribute('placeholder') == '汉族'
        tests['Duoyi religion committed'] = page.locator('#religion').get_attribute('placeholder') == '无宗教信仰'
        tests['Duoyi politics committed'] = page.locator('#politics').get_attribute('placeholder') == '共青团员'
        tests['Compound document fields commit the type and number separately'] = (
            page.locator('#idType').get_attribute('placeholder') == '内地身份证' and
            page.locator('#document').input_value() == '000000000000000000'
        )
        tests['Compound contact fields pair the account with the confirmed type'] = (
            page.locator('#imType').get_attribute('placeholder') == '微信号' and
            page.locator('#imAccount').input_value() == 'example-wechat'
        )
        tests['Duoyi registered address and independent childhood city'] = (
            page.locator('#hukou').get_attribute('placeholder') == '广东省-佛山市' and
            page.locator('#childhood').get_attribute('placeholder') == '广东省-广州市' and
            page.locator('#residence').get_attribute('placeholder') == '广东省-深圳市'
        )
        tests['Duoyi skill and explicit proficiency'] = page.locator('#skill').input_value() == '摄影' and page.locator('#proficiency').get_attribute('placeholder') == '熟练'
        tests['Duoyi family columns and relation order'] = all(page.locator('#' + key).input_value() == value for key, value in {
            'father': '测试父亲', 'fatherAge': '52', 'fatherPosition': '讲师', 'fatherEmployer': '示例甲',
            'mother': '测试母亲', 'motherAge': '50', 'motherJob': '会计', 'motherPosition': '主管', 'motherEmployer': '示例乙',
        }.items()) and page.locator('#fatherJob').get_attribute('placeholder') == '教师'
        page.locator('#idType').evaluate("input => { input.placeholder = '海外证件'; }")
        page.locator('#document').fill('')
        fill(profile, 'incremental')
        tests['Different existing document type keeps the number blank'] = page.locator('#document').input_value() == ''
        tests['Duoyi declaration stays unselected'] = page.locator('#relatives input:checked').count() == 0 and not any(
            item.get('fieldType') == 'relativesEmployed' and item['status'] == 'filled' for item in result['results']
        )
        profile['basicInfo']['gender'] = '男'
        fill(profile)
        tests['Duoyi incremental preserves a confirmed choice'] = page.locator('.tec-radio input:checked').count() == 1 and page.locator('.tec-radio input:checked').input_value() == '2'
        page.evaluate('''() => {
            document.querySelector('#childhood').parentElement.classList.remove('tec-cascade__trigger--has-select');
            document.querySelector('#fatherJob').parentElement.classList.remove('tec-select__trigger--has-select');
        }''')
        tests['Duoyi table and known controls are excluded from AI guessing'] = page.evaluate('''() =>
            collectSmartFillFields().every(({el}) => !duoyiTableField(el) && el.id !== 'childhood')''')
        profile['declarations'] = [{'question': '有无亲友（含男女友）在公司就职？', 'answer': '否', 'hostname': 'xz.duoyi.com'}]
        page.evaluate('''() => {
            const observer = new MutationObserver(() => {
                const dialog = document.querySelector('#job-autofill-declaration-confirm');
                if (!dialog) return;
                observer.disconnect();
                [...dialog.querySelectorAll('button')].find(button => button.textContent.includes('确认')).click();
            });
            observer.observe(document.body, {childList:true});
        }''')
        page.evaluate('profile => fillForm(profile, {mode:"incremental", openTimeoutMs:150, declarationTimeoutMs:500})', profile)
        tests['Duoyi declaration honors explicit confirmation'] = page.locator('#relatives .tec-radio').last.locator('input').is_checked()
        tests['No page script errors'] = not errors
        if errors:
            print('\n'.join(errors))
        browser.close()
    for name, passed in tests.items():
        print(f'{"PASS" if passed else "FAIL"} {name}')
    print(f'passed={sum(tests.values())} failed={len(tests) - sum(tests.values())}')
    return all(tests.values())


if __name__ == '__main__':
    raise SystemExit(0 if run_tests() else 1)
