/* The overview reads the same local records and stage names as the workbench. */
(() => {
  const byId = id => document.getElementById(id);
  const tracker = window.YanyuTracker;
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  const dayFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let version = 0;
  let nextRefresh;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function taskLink(task) {
    const link = element('a', '', 'home-task');
    link.href = task.href;
    const detail = element('div');
    detail.append(element('strong', task.title), element('span', task.detail));
    const arrow = element('span', '↗', 'home-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(element('span', task.when, 'home-task-time'), detail, arrow);
    return link;
  }

  function getAgenda(records, now) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tasks = [];
    const pending = [];
    for (const row of records) {
      if (row.status === '已结束') continue;
      const at = Date.parse(row.nextEventAt);
      const base = {
        title: [row.company, row.position].filter(Boolean).join(' · ') || '查看申请',
        href: row.id ? '#tracker-record-' + encodeURIComponent(row.id) : '#tracker'
      };
      if (Number.isFinite(at) && at >= now.getTime()) {
        const date = new Date(at);
        const day = date.toDateString() === now.toDateString() ? '今天' :
          date.toDateString() === tomorrow.toDateString() ? '明天' : dayFormat.format(date);
        tasks.push({ ...base, at, when: day, detail: timeFormat.format(date) + ' · ' + tracker.stageLabel(row) });
      } else if (!row.confirmed) {
        pending.push({ ...base, when: '待核实', detail: '核对岗位信息与当前阶段' });
      }
    }
    return tasks.sort((a, b) => a.at - b.at).concat(pending).slice(0, 3);
  }

  function render(records) {
    const now = new Date();
    const active = records.filter(row => !row.archived);
    const tasks = getAgenda(active, now);
    byId('home-date').textContent = dateFormat.format(now);
    byId('home-tasks').replaceChildren(...tasks.map(taskLink));
    if (!tasks.length) {
      byId('home-tasks').append(taskLink(active.length
        ? { when: '日程', title: '暂无待办安排', detail: '去工作台给申请添加下一场笔试或面试时间', href: '#tracker' }
        : { when: '开始', title: '记录第一份申请', detail: '填上公司、岗位和下一场安排，这里就会出现提醒', href: '#tracker-add' }));
    }
    const counts = tracker.stages.map(stage => active.filter(row => row.status === stage).length);
    const largest = Math.max(1, ...counts);
    byId('home-count').textContent = active.length + ' 个岗位';
    const stages = active.length ? tracker.stages : [];
    byId('home-stages').replaceChildren(...stages.map((stage, index) => {
      const link = element('a', '', 'home-stage');
      link.href = '#tracker-stage-' + encodeURIComponent(stage);
      link.setAttribute('aria-label', stage + '，' + counts[index] + ' 个岗位，查看记录');
      const bar = element('span', '', 'home-meter');
      bar.setAttribute('aria-hidden', 'true');
      const fill = element('i');
      fill.style.width = counts[index] / largest * 100 + '%';
      bar.append(fill);
      link.append(element('span', stage), bar, element('strong', String(counts[index])));
      return link;
    }));
    if (!active.length) {
      byId('home-stages').append(element('p', '记录申请后，可以在这里查看各阶段的岗位数量。', 'home-empty-progress'));
    }
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const next = Math.min(midnight.getTime(), ...tasks.filter(t => t.at).map(t => t.at));
    nextRefresh = setTimeout(refresh, Math.max(1000, next - now + 1000));
  }

  async function refresh() {
    clearTimeout(nextRefresh);
    const request = ++version;
    if (byId('page-product').hidden) return;
    try {
      const records = await tracker.readOverviewRecords();
      if (request === version && !byId('page-product').hidden) render(records);
    } catch {
      if (request !== version) return;
      byId('home-tasks').textContent = '暂时无法读取本机投递记录，请重新打开首页。';
      byId('home-stages').replaceChildren();
      byId('home-count').textContent = '';
    }
  }

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && (changes.yanyuSubmissionsV1 || changes.jobAutofillData)) refresh();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.EasyOfferHome = { refresh };

  const form = document.querySelector('.home-practice');
  const fields = [...form.querySelectorAll('[data-practice]')];
  const examples = {
    birthday: [['出生日期', '2001-06-18']],
    duty: [['校园调研项目', '负责访谈设计与需求分析'], ['数据分析项目', '整理业务指标并制作周报']]
  };
  const status = byId('home-practice-status');
  const choices = byId('home-choices');
  const reset = byId('home-reset');

  function select(field) {
    for (const input of fields) input.classList.toggle('is-target', input === field);
    const name = field.labels[0].textContent.trim();
    reset.disabled = false;
    status.textContent = '填入目标 · ' + name;
    choices.replaceChildren(...examples[field.dataset.practice].map(([label, value]) => {
      const button = element('button', '', 'home-choice');
      button.type = 'button';
      button.append(element('small', label), element('strong', value), element('span', '填入'));
      button.addEventListener('click', () => {
        field.value = value;
        status.textContent = '已将「' + value + '」填入' + name + '。';
      });
      return button;
    }));
  }

  for (const field of fields) {
    field.addEventListener('focus', () => select(field));
    field.addEventListener('click', () => select(field));
  }
  reset.addEventListener('click', () => {
    fields.forEach(field => { field.value = ''; field.classList.remove('is-target'); });
    choices.replaceChildren();
    status.textContent = '尚未选择输入框';
    reset.disabled = true;
  });
})();
