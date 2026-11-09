/* Local extension workspace. Existing résumé nodes keep their listeners and IDs. */
(() => {
  const pages = { product: '产品功能', profile: '我的简历', tracker: '求职工作台', help: '帮助中心', settings: '设置' };
  const articles = [
    ['install', '安装与更新', '装好后，把易offer固定在工具栏。在网申页面点图标，就能打开浏览器侧栏。', [
      '打开 Chrome 或 Edge 的扩展管理页，启用「开发者模式」，选择「加载已解压的扩展程序」。选中包含 manifest.json 的 job-autofill-assistant 文件夹。',
      '在工具栏的扩展菜单里固定易offer。打开一个招聘网页，点击易offer图标，等待侧栏显示「页面已就绪」。',
      '更新文件前，可在设置里导出一份 JSON 备份。替换扩展文件后，在扩展管理页点击重新加载，再刷新招聘网页。'
    ], '如果扩展管理页加载失败，检查是否选成了上一级目录。浏览器设置页、扩展商店和其他扩展自己的界面可以用资料速查复制后粘贴。'],
    ['import', '简历导入与解析', '导入后重点核对公司、岗位、经历类型和起止时间。它们会直接影响后续填入的内容。', [
      '打开「我的简历」，选中要更新的简历，再进入「简历源文件」。点击「上传 / 导入简历源文件」。',
      '已经配置 AI 时，可以点「AI 智能解析并自动填入资料」。如果你想从空白简历开始，也可以直接打开对应章节填写。',
      '检查解析结果。实习归到「实习经历」，全职工作归到「工作经历」。投不同方向时，可以先复制简历，再分别调整求职意向和经历顺序。'
    ], '扫描版 PDF 可能提取不到正文。遇到空白或乱码时，可以换一份能选中文字的 PDF 或 DOCX，也可以手动填写。'],
    ['ai', 'AI 配置', '普通填入和资料速查可以直接使用。AI 助填和 AI 简历解析需要配置模型服务。', [
      '打开「设置」，启用 AI，填写接口地址、API Key 和模型名称。模型名称以服务商给出的 ID 为准。',
      '点「测试连接」。测试成功后点击「保存设置」，等页面显示「已保存」。',
      '回到招聘网页，再使用「AI 助填」。涉及简历或开放题时，相关资料会发送到你配置的模型服务。请核对生成的答案与实际经历是否一致。'
    ], '密钥被拒绝时先检查是否复制了多余的空格。连接正常但模型不可用时，核对模型 ID 和密钥的权限。'],
    ['fill', '一键、增量与选区填入', '先在侧栏选对简历。网页上已经手填了一部分时，优先用「增量填入」。', [
      '刚打开空表单时，可以点「一键填入」。填写完成后，检查网页标红的必填项和附件上传状态。',
      '只想补空白项时点「增量填入」。需要把简历中剩余的经历也加到网页时，先勾选「增量填入时也补建条目」。',
      '只填某一段教育或实习经历时点「选区填入」。在网页上拖框，选择对应简历条目，再点「立即填入」。按 Esc 可以退出选区。'
    ], '遇到一个难填的字段，可以转到「资料速查」逐项补。招聘网站的保存和提交按钮由你点击。'],
    ['quick', '资料速查与点选补填', '适合补一个字段，比如毕业院校，也可以把一整段项目职责复制到长文本框。', [
      '在网页上点一下要填的输入框，或用 Tab 移到那个字段。看到侧栏显示「填入目标」后，先核对字段名。',
      '在「资料速查」输入关键词。搜索会跨分类查找，比如搜「导师」「生源地」或项目名称。长文本可以先点「查看全文」。',
      '点击资料旁边的「填入」，再看网页有没有收到内容。只想把资料放进剪贴板时，点击「复制」。',
      '想补同一条经历里的多个字段时，先在网页选中那一行，再点侧栏的「预览整条」。核对目标行和待填内容后确认。已有值会保留。',
      '找不到停用模块里的内容时，勾选「显示停用模块资料」，可以搜索和复制。'
    ], '切换过岗位或表单步骤后，请重新点选字段。给其他扩展的资料页填写时，在易offer侧栏搜索并复制，再到目标输入框按 Ctrl+V 或 ⌘V。'],
    ['date', '日期选择与补全', '点日期框打开月历。只记得年月时，可以先选到对应月份，再点「仅保存年月」。', [
      '点月历标题中的年份或月份可以快速跳转。用方向键在日历中移动，按 Enter 选中，按 Esc 关闭。',
      '仍在进行的经历可以从弹层底部选「至今」。没有固定有效期的证书可以选「长期」。',
      '如果网站要求完整日期，在简历的「日期待完善」里找到对应记录，核实后补充具体日，再回到网页重试。'
    ], '翻到没有原日期的月份时，例如非闰年的 2 月没有 29 日，月历会提示重新选日。你也可以只保存年月。'],
    ['controls', '下拉框与地区选择', '有些招聘网站需要点中选项才算填写。输入文字后，等候选列表出现，再选正确的一项。', [
      '先展开下拉框，看网站提供哪些选项。招聘网站的学历名称有时和简历里的写法不同，按实际学历选对应项。',
      '地区字段逐级检查省、市、区。如果网站只要求城市，选到城市即可。',
      '填写后点击表单里的其他字段，再检查选项是否仍显示。如果选项消失或出现必填提示，手动选择后再检查一次。'
    ], '如果网页没有你需要的选项，先查看招聘网站的填报说明。资料速查可以帮你找到原值，方便核对。'],
    ['entries', '多条经历与模块管理', '一个网站可能把实习和工作放在两个区，也可能把它们放在同一个列表。先检查网页结构，再选择填写方式。', [
      '在「我的简历」分别检查「实习经历」和「工作经历」。用上下移动按钮调整顺序，确保最想先展示的经历排在前面。',
      '如果网页只显示一条经历，而且新增按钮不可用，先补齐当前条目的必填信息，再按网站要求保存这条经历。',
      '如果只想填其中一条，用「选区填入」框选这条经历的输入框，再选同一条简历资料。'
    ], '侧栏找不到某项资料时，先确认当前简历和「模块管理」的勾选状态。重新启用模块后，原有内容会重新显示。'],
    ['pause', '暂停、继续和取消', '当网页弹出验证或要求人工确认时，可以暂停任务，先把当前网页处理好。', [
      '在侧栏任务区域点「暂停」。等插件处理完当前控件，再检查需要调整的字段。',
      '核对当前网页后，点「继续填入」。如果换了网页或步骤，建议在新页面重新开始。',
      '如果本轮无需继续，点「取消任务」。取消后，检查网页上已经写入的内容，需要时手动修改。'
    ], '侧栏显示完成后，最后核对日期、下拉选项和附件，再到招聘网站保存或提交。'],
    ['tracker', '记录岗位与跟进投递', '看到合适的岗位时可以先收藏。提交网申之后，再把工作台阶段改成「已投递」。', [
      '在侧栏顶部点「记录此岗位」。填入结束后，也可以从结果区使用同一个入口。',
      '在「核对当前岗位」抽屉里检查公司、职位和链接。默认阶段是「已收藏」。已经提交申请时，改选「已投递」，填写实际投递日期，再点「添加到工作台」。',
      '表格适合找岗位，看板适合扫一遍当前进度，仪表盘显示阶段分布和投递节奏。进入「面试中」后，可以选择待一面、待二面或待终面。',
      '面试结束后可注明结果，暂时不用跟进的岗位也可以归档。要恢复记录，用「已归档」筛选找到它，再点「恢复」。'
    ], '如果抽屉没有识别出公司或职位，手动补上即可。旧版带「待核实」标记的申请，请核实实际投递情况后再确认。'],
    ['backup', '备份、恢复与 CSV', '换设备、卸载扩展或移动安装目录前，请确认最新备份已保存。只想带走岗位清单时，可以在工作台导出 CSV。', [
      '打开「设置 → 数据备份与恢复」。可备份全部资料，也可选择简历和附件。授权独立目录后，保存修改会自动留下快照。',
      '导入前核对新增资料和同 ID 冲突。已有简历默认跳过，可以按份选择更新。',
      '在工作台导入 CSV 时，先核对预览。检查同 ID 冲突和同公司同职位的提示，再决定是否更新或作为独立记录保留。'
    ], '恢复 JSON 后，可以打开「我的简历」和「求职工作台」各抽查一条记录。CSV 只含工作台记录。']
  ];
  const helpCategories = {
    '开始使用': ['install', 'import', 'ai'],
    '填写与排查': ['fill', 'quick', 'date', 'controls', 'entries', 'pause'],
    '记录与数据': ['tracker', 'backup']
  };
  let current = 'profile', lastHash = location.hash || '#profile-overview', navigating = false;
  function node(tag, cls, text) { const e = document.createElement(tag); e.className = cls || ''; if (text) e.textContent = text; return e; }
  function link(text, target) { const a = node('a','shell-link',text); a.href = '#' + target; return a; }
  function init() {
    const nav = document.getElementById('navTabsPill');
    nav.querySelector('.tab-text').textContent = pages.profile;
    for (const key of ['product','tracker','help','settings']) { const a = link(pages[key],key); a.dataset.page = key; nav.append(a); }
    nav.prepend(nav.querySelector('[data-page="product"]'));
    document.getElementById('tabBtnProfile').dataset.page = 'profile';
    const main = document.querySelector('.main-container');
    for (const key of ['tracker','help','settings']) { const section = node('section','shell-page'); section.id = 'page-' + key; section.hidden = true; main.append(section); }
    const help = document.getElementById('page-help'); help.append(node('h1','','帮助中心'),node('p','shell-lead','从安装到投递。遇到某一项填不进去时，可以直接搜索字段或问题。'));
    const search=node('input','shell-search'); search.type='search'; search.placeholder='搜索教程与常见问题'; search.setAttribute('aria-label','搜索帮助'); help.append(search);
    const toc = node('nav', 'help-toc');
    toc.setAttribute('aria-label', '帮助目录');
    const content = node('div', 'help-articles');
    for (const [category, ids] of Object.entries(helpCategories)) {
      const group = node('div', 'help-category');
      group.append(node('h2', '', category));
      for (const id of ids) {
        const [, title, lead, steps, troubleshooting] = articles.find(article => article[0] === id);
        group.append(link(title, 'help-' + id));
        const article = node('article', 'shell-card');
        article.id = 'help-' + id;
        article.tabIndex = -1;
        article.dataset.search = [title, lead, ...steps, troubleshooting].join(' ').toLowerCase();
        const stepsList = node('ol', 'help-steps');
        for (const step of steps) stepsList.append(node('li', '', step));
        const tip = node('aside', 'help-tip');
        tip.append(node('h3', '', '遇到问题时'), node('p', '', troubleshooting));
        article.append(node('h2', '', title), node('p', 'help-intro', lead), stepsList, tip);
        content.append(article);
      }
      toc.append(group);
    }
    const empty = node('p', 'shell-card', '没有匹配的说明。试试搜索“日期”“选区”或“备份”。');
    empty.setAttribute('role', 'status');
    content.append(empty);
    function filterHelp() {
      const term = search.value.trim().toLowerCase();
      let matches = 0;
      for (const article of content.querySelectorAll('article')) {
        article.hidden = !article.dataset.search.includes(term);
        if (!article.hidden) matches++;
      }
      empty.hidden = matches > 0;
    }
    const layout = node('div', 'help-layout');
    layout.append(toc, content);
    help.append(layout);
    search.addEventListener('input', filterHelp);
    filterHelp();
    const settings=document.getElementById('page-settings'); settings.append(node('h1','','设置'),node('p','shell-lead','模型服务、外观与本地数据。'));
    settings.append(document.getElementById('section-ai'));
    const key = document.getElementById('aiApiKey');
    const toggle = node('button', 'shell-button key-toggle', '显示密钥');
    toggle.type = 'button';
    toggle.setAttribute('aria-controls', key.id);
    toggle.onclick = () => {
      key.type = key.type === 'password' ? 'text' : 'password';
      toggle.textContent = key.type === 'password' ? '显示密钥' : '隐藏密钥';
    };
    key.parentElement.append(toggle);
    const appearance=node('section','shell-card'); appearance.append(node('h2','','外观')); const theme=node('button','shell-button','切换浅色 / 深色'); theme.onclick=()=>document.getElementById('themeToggle').click(); appearance.append(theme); settings.append(appearance);
    const backup=node('section','shell-card'); backup.id='settings-backup'; backup.tabIndex=-1;
    backup.append(node('h2','','数据备份与恢复'),node('p','','可备份全部资料，或按简历选择导出。导入前可核对新增资料和同 ID 冲突。'),
      node('p','','更换浏览器、卸载扩展或移动安装目录前，请把最新备份存到独立目录。快照包含简历和附件，请存到自己的资料目录，避免放进公开仓库。'));
    const label=node('label'); const check=node('input'); check.type='checkbox';check.id='backupIncludeKey';label.append(check,document.createTextNode(' 在备份中包含 API Key'));backup.append(label);
    const keyStatus = node('p', '', '本次导出不含 API Key');
    keyStatus.setAttribute('role', 'status');
    check.addEventListener('change', () => {
      keyStatus.textContent = check.checked ? '本次导出将包含当前保存的 API Key' : '本次导出不含 API Key';
    });
    backup.append(keyStatus);
    const actions = document.querySelector('.rail-data-actions');
    actions.querySelector('#exportBackupBtn span').textContent = '全部备份';
    const partial = node('button','btn-nav-sub','选择内容导出'); partial.type = 'button';
    partial.onclick = () => exportBackup('partial');
    actions.insertBefore(partial, document.getElementById('importBackupBtn'));
    backup.append(actions,document.getElementById('importBackupFile'));settings.append(backup);
    const local = node('div', 'backup-directory-card');
    const localStatus = node('p', '', '正在检查备份目录…'); localStatus.setAttribute('role', 'status');
    const localActions = node('div', 'backup-directory-actions');
    let currentHandle;
    const renderBackupStatus = async () => {
      const status = (await chrome.storage.local.get('easyofferBackupStatus')).easyofferBackupStatus;
      const handle = await backupDirectory.get();
      currentHandle = handle;
      const granted = handle && await handle.queryPermission({mode:'readwrite'}) === 'granted';
      const last = status?.completedAt ? `最近成功备份 ${new Date(status.completedAt).toLocaleString()}。` : '尚未成功写入快照。';
      localStatus.textContent = handle ? `${handle.name} · ${last}${!granted ? '请重新授权备份目录。' : status?.error ? `有改动待备份。${status.error}` : status?.dirty ? '有改动待备份。' : ''}` : '选择独立目录后，保存修改时自动写入快照。';
      saveSnapshot.disabled = !handle;
      forget.disabled = !handle;
    };
    const refreshBackup = () => renderBackupStatus().catch(() => { localStatus.textContent = '无法读取备份目录，可以使用 JSON 下载。'; });
    const localButton = (label, action) => {
      const button = node('button','shell-button',label); button.type = 'button';
      button.onclick = async () => {
        button.disabled = true;
        try { await action(); }
        catch (error) { if (error.name !== 'AbortError') showToast(error.message, 'error'); }
        finally { button.disabled = false; await refreshBackup(); }
      };
      localActions.append(button);
      return button;
    };
    const writeSnapshot = async () => {
      const result = await sendMessage({ action: 'writeSnapshot' });
      if (!result?.success) throw new Error(result?.error || '备份失败');
      showToast('本地快照已保存', 'success');
    };
    const pick = localButton('选择备份目录', async () => {
      const handle = await showDirectoryPicker({ id:'easyoffer-backup', mode:'readwrite' });
      await backupDirectory.set(handle);
      await writeSnapshot();
    });
    const saveSnapshot = localButton('立即备份', async () => {
      const handle = currentHandle;
      if (!handle || await handle.requestPermission({mode:'readwrite'}) !== 'granted') throw new Error('请授权备份目录');
      await writeSnapshot();
    });
    const restore = localButton('从目录恢复', async () => {
      const handle = await showDirectoryPicker({ id:'easyoffer-backup', mode:'read' });
      const files = [];
      for await (const file of handle.values()) if (file.kind === 'file' && backupDirectory.isSnapshot(file.name)) files.push(file);
      files.sort((a,b) => b.name.localeCompare(a.name));
      if (!files.length) throw new Error('此目录没有易offer快照');
      const selected = await backupChoiceDialog('选择本地快照', '选择一份快照继续预览。', files.map((file,index) => ({ key: file.name, label: file.name, checked: index === 0 })), '预览');
      if (!selected) return;
      const matches = files.filter(file => selected[file.name]);
      if (matches.length !== 1) throw new Error('请选择一份快照');
      await importBackup(await matches[0].getFile());
    });
    const forget = localButton('停止自动备份', async () => { await backupDirectory.clear(); });
    pick.disabled = restore.disabled = typeof showDirectoryPicker !== 'function';
    local.append(node('h3','','本地备份目录'), localStatus, localActions); backup.append(local);
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && (changes.easyofferBackupStatus || changes.jobAutofillData || changes.yanyuSubmissionsV1)) void refreshBackup();
    });
    void refreshBackup();
    const save = node('button', 'shell-button', '保存设置');
    save.type = 'button';
    const status = node('span', 'settings-save-status');
    status.setAttribute('role', 'status');
    save.onclick = async () => {
      save.disabled = true;
      status.textContent = '保存中…';
      try {
        status.textContent = await flushProfileSave() ? '已保存' : '保存失败，请重试';
      } catch {
        status.textContent = '保存失败，请重试';
      } finally {
        save.disabled = false;
      }
    };
    const saveRow = node('div', 'settings-save-row');
    saveRow.append(save, status);
    document.getElementById('section-ai').append(saveRow);
    document.addEventListener('click',async e=>{ const a=e.target.closest('a[href^="#"],#tabBtnProfile');if(!a)return;const hash=a.id==='tabBtnProfile'?'#profile-overview':a.getAttribute('href');if(!hash)return;e.preventDefault();e.stopImmediatePropagation();await navigate(hash);},true);
    window.addEventListener('hashchange',()=>navigate(location.hash,true));
    document.addEventListener('yanyu-section-change', () => { lastHash = location.hash; });
    render(location.hash);
  }
  function render(hash) {
    const previous = current;
    current = /^#(product|tracker|help|settings)(?:-|$)/.exec(hash)?.[1] || (hash==='#section-ai'||hash==='#view-ai'?'settings':'profile');
    document.body.dataset.appPage=current;
    document.getElementById('view-profile').style.display=current==='profile'?'':'none';
    for(const k of ['product','tracker','help','settings'])document.getElementById('page-'+k).hidden=k!==current;
    document.querySelectorAll('[data-page]').forEach(a=>{a.classList.toggle('active',a.dataset.page===current); if(a.dataset.page===current)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(current==='settings'){const ai=document.getElementById('section-ai');document.getElementById('page-settings').append(ai);ai.classList.remove('is-module-hidden');ai.style.display='block';}
    if(current==='profile' && typeof showWorkspaceModule==='function'){const m=hash.match(/^#(section|view)-(.+)$/);showWorkspaceModule(m?.[2],m?.[1]==='section');}
    if (current === 'tracker' && previous !== 'tracker') {
      const tracker = document.getElementById('page-tracker');
      window.YanyuTracker.mount(tracker).catch(error => {
        tracker.replaceChildren(node('p', 'shell-card', '工作台加载失败，请重新进入。' + error.message));
      });
    }
    if (previous !== current || hash === '#' + current) window.scrollTo(0, 0);
    if (current === 'help' && hash.startsWith('#help-')) {
      const target = document.getElementById(hash.slice(1));
      if (target) {
        const search = document.querySelector('.shell-search');
        search.value = '';
        search.dispatchEvent(new Event('input'));
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start' });
      }
    }
    if (hash === '#product-workflow') {
      document.getElementById('workflow-title').focus({ preventScroll: true });
      document.getElementById('product-workflow').scrollIntoView({ block: 'start' });
    }
    if (hash === '#product-demo') {
      document.getElementById('product-demo-title').focus({ preventScroll: true });
      document.getElementById('product-demo').scrollIntoView({ block: 'start' });
    }
    if (hash === '#settings-backup') {
      const backup = document.getElementById('settings-backup');
      backup.focus({ preventScroll: true });
      backup.scrollIntoView({ block: 'start' });
    }
    lastHash=hash || '#profile-overview';
  }
  async function navigate(hash, external = false) {
    if (navigating) return;
    navigating = true;
    const previousHash = external ? lastHash : location.hash;
    try {
      if (savedAiSettingsFingerprint === null) {
        if (external) history.replaceState(null, '', previousHash || location.pathname);
        showToast('正在加载本地资料，请稍候再切换', 'info');
        return;
      }
      if (!await flushProfileSave()) {
        if (external) history.replaceState(null, '', previousHash || location.pathname);
        return;
      }
      if (!external && location.hash !== hash) history.pushState(null, '', hash);
      render(hash);
    } catch (error) {
      if (external) history.replaceState(null, '', previousHash || location.pathname);
      showToast('页面切换失败：' + error.message, 'error');
    } finally {
      navigating = false;
    }
  }
  document.addEventListener('DOMContentLoaded',init);
})();
