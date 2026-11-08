/* Shared date editor. Original inputs remain the persistence interface. */
(function (global) {
  'use strict';
  const daysInMonth = (year, month) => month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  function parse(value) {
    value = String(value || '').trim();
    if (!value) return { kind: 'empty' };
    if (['至今', '长期', '随时到岗', '毕业后', '2周内'].includes(value)) return { kind: 'special', value };
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
    if (!m || +m[1] < 1 || +m[2] < 1 || +m[2] > 12 || (m[3] && (+m[3] < 1 || +m[3] > daysInMonth(+m[1], +m[2])))) return { kind: 'invalid', value };
    return { kind: m[3] ? 'day' : 'month', year: +m[1], month: +m[2], day: m[3] ? +m[3] : '' };
  }
  const api = { parse, daysInMonth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) return;
  const controls = new Map();
  let timer;
  const candidates = 'input[type="text"],input:not([type])';
  function isDate(input) {
    return !input.closest('.date-picker') && (/(?:date|validUntil)$/i.test(input.dataset.extKey || input.id) || /(?:^|\s)(?:edu|work|proj)-(?:start|end)(?:\s|$)|(?:^|\s)(?:award|certificate)-date(?:\s|$)|certificate-expiry/.test(input.className));
  }
  const pad = value => String(value).padStart(2, '0');
  const monthValue = (year, month) => `${String(year).padStart(4, '0')}-${pad(month)}`;
  const firstWeekday = (year, month) => {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, 1);
    return date.getUTCDay();
  };
  const calendarIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="4" y="6" width="16" height="15" rx="2"/><path d="M8 4v4m8-4v4M4 11h16m-11 4h2m3 0h2"/></svg>';
  let panel, active;
  let year, month, day, yearStart, view;

  function closeCalendar(returnFocus = false) {
    if (!active) return;
    const trigger = active.trigger;
    panel.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    active = null;
    if (returnFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function positionCalendar() {
    if (!active || !panel.matches(':popover-open')) return;
    const anchor = active.trigger.getBoundingClientRect();
    if (!active.trigger.isConnected || !anchor.height || anchor.bottom < 0 || anchor.top > innerHeight) {
      closeCalendar();
      return;
    }
    const gap = 8;
    const { offsetTop: topEdge, offsetLeft: leftEdge, height, width } = window.visualViewport || {
      offsetTop: 0, offsetLeft: 0, height: innerHeight, width: innerWidth
    };
    panel.style.maxHeight = `${Math.max(0, height - gap * 2)}px`;
    panel.style.maxWidth = `${Math.max(0, width - gap * 2)}px`;
    const left = Math.min(Math.max(anchor.left, leftEdge + gap), leftEdge + width - panel.offsetWidth - gap);
    const below = anchor.bottom + gap;
    const above = anchor.top - panel.offsetHeight - gap;
    const bottomEdge = topEdge + height - gap;
    const top = below + panel.offsetHeight <= bottomEdge ? below : above >= topEdge + gap ? above : bottomEdge - panel.offsetHeight;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(topEdge + gap, top)}px`;
  }

  function renderCalendar(focusSelector) {
    const stored = parse(active.input.value);
    const today = new Date();
    const currentMonth = stored.year === year && stored.month === month;
    const yearTitle = view === 'years' ? `${yearStart}–${Math.min(yearStart + 11, active.maxYear)}` : `${year} 年`;
    const limit = daysInMonth(year, month);
    const start = firstWeekday(year, month);
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousDays = daysInMonth(month === 1 ? year - 1 : year, previousMonth);
    const yearBack = view === 'years' ? yearStart <= active.minYear : year <= active.minYear;
    const yearForward = view === 'years' ? yearStart + 11 >= active.maxYear : year >= active.maxYear;
    panel.innerHTML = `
      <header class="calendar-header">
        <button type="button" data-nav="-year" aria-label="${view === 'years' ? '上一组年份' : '上一年'}" ${yearBack ? 'disabled' : ''}>«</button>
        ${view === 'days' ? `<button type="button" data-nav="-month" aria-label="上个月" ${yearBack && month === 1 ? 'disabled' : ''}>‹</button>` : ''}
        <div class="calendar-title">
          <button type="button" data-view="years" aria-label="${yearTitle}，选择年份">${yearTitle}</button>
          ${view !== 'years' ? `<button type="button" data-view="months" aria-label="${month} 月，选择月份">${month} 月</button>` : ''}
        </div>
        ${view === 'days' ? `<button type="button" data-nav="+month" aria-label="下个月" ${yearForward && month === 12 ? 'disabled' : ''}>›</button>` : ''}
        <button type="button" data-nav="+year" aria-label="${view === 'years' ? '下一组年份' : '下一年'}" ${yearForward ? 'disabled' : ''}>»</button>
      </header>
      ${view === 'days' ? `<div class="calendar-week" aria-hidden="true">${[...'日一二三四五六'].map(label => `<span>${label}</span>`).join('')}</div>
        <div class="calendar-days" role="group" aria-label="${year} 年 ${month} 月">
          ${Array.from({ length: 42 }, (_, index) => {
            const value = index - start + 1;
            if (value < 1 || value > limit) return `<span class="calendar-outside" aria-hidden="true">${value < 1 ? previousDays + value : value - limit}</span>`;
            const isToday = year === today.getFullYear() && month === today.getMonth() + 1 && value === today.getDate();
            return `<button type="button" data-day="${value}" tabindex="${value === day ? 0 : -1}" aria-label="${year}年${month}月${value}日"
              aria-pressed="${currentMonth && stored.day === value}" ${isToday ? 'aria-current="date"' : ''}>${value}</button>`;
          }).join('')}
        </div>` : `<div class="calendar-choices" role="group" aria-label="${view === 'years' ? '选择年份' : '选择月份'}">
          ${Array.from({length: 12}, (_, i) => {
            const value = view === 'years' ? yearStart + i : i + 1;
            if (view === 'years' && value > active.maxYear) return '';
            return `<button type="button" data-choice="${value}" aria-pressed="${value === (view === 'years' ? year : month)}">${value}${view === 'years' ? ' 年' : ' 月'}</button>`;
          }).join('')}
        </div>`}
      ${view === 'days' && stored.day > limit ? '<p class="calendar-hint" role="status">这个月没有原来的日期，请重新选日或仅保存年月。</p>' : ''}
      <footer class="calendar-footer">
        ${active.specialValues.map(value => `<button type="button" data-special="${value}" aria-pressed="${stored.value === value}">${value}</button>`).join('')}
        <button type="button" class="calendar-month-action" data-save-month>仅保存年月</button>
        <button type="button" data-clear>清空</button>
      </footer>`;
    positionCalendar();
    if (focusSelector) {
      const button = panel.querySelector(focusSelector);
      (button && !button.disabled ? button : panel.querySelector('[data-day][tabindex="0"], [data-choice][aria-pressed="true"], [data-choice]'))?.focus({ preventScroll: true });
    }
  }

  function shiftMonth(offset) {
    const index = year * 12 + month - 1 + offset;
    const nextYear = Math.floor(index / 12);
    if (nextYear < active.minYear || nextYear > active.maxYear) return false;
    year = nextYear;
    month = index % 12 + 1;
    day = Math.min(day, daysInMonth(year, month));
    return true;
  }

  function commitDate(value) {
    const state = active;
    closeCalendar(true);
    state.input.value = value;
    state.sync();
    state.input.dispatchEvent(new Event('input', { bubbles: true }));
    state.input.dispatchEvent(new Event('change', { bubbles: true }));
    refreshPending();
  }

  function openCalendar(state) {
    if (active === state) {
      closeCalendar(true);
      return;
    }
    closeCalendar();
    active = state;
    const stored = parse(state.input.value);
    const today = new Date();
    year = stored.year || today.getFullYear();
    month = stored.month || today.getMonth() + 1;
    day = stored.day || (stored.month ? 1 : today.getDate());
    view = 'days';
    panel.setAttribute('aria-label', state.label + '日历');
    state.trigger.setAttribute('aria-expanded', 'true');
    panel.showPopover();
    renderCalendar('[data-day][tabindex="0"]');
  }

  function initCalendar() {
    panel = document.createElement('div');
    panel.id = 'resumeCalendar';
    panel.className = 'resume-calendar';
    panel.setAttribute('popover', 'manual');
    panel.setAttribute('role', 'dialog');
    document.body.append(panel);
    document.addEventListener('pointerdown', event => {
      if (active && !panel.contains(event.target) && !active.trigger.contains(event.target)) closeCalendar();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !active) return;
      event.preventDefault();
      closeCalendar(true);
    });
    panel.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button || !active) return;
      const { dataset } = button;
      if (dataset.day) return commitDate(`${monthValue(year, month)}-${pad(dataset.day)}`);
      if (dataset.special) return commitDate(dataset.special);
      if ('saveMonth' in dataset) return commitDate(monthValue(year, month));
      if ('clear' in dataset) return commitDate('');
      if (dataset.view) {
        view = dataset.view;
        yearStart = Math.min(Math.max(year - 5, active.minYear), Math.max(active.minYear, active.maxYear - 11));
        renderCalendar('[data-choice][aria-pressed="true"]');
      } else if (dataset.choice) {
        if (view === 'years') {
          year = Number(dataset.choice);
          view = 'months';
          renderCalendar('[data-choice][aria-pressed="true"]');
        } else {
          month = Number(dataset.choice);
          day = Math.min(day, daysInMonth(year, month));
          view = 'days';
          renderCalendar('[data-day][tabindex="0"]');
        }
      } else if (dataset.nav) {
        const direction = dataset.nav[0] === '+' ? 1 : -1;
        if (view === 'years') yearStart = Math.max(active.minYear, yearStart + direction * 12);
        else shiftMonth(direction * (dataset.nav.endsWith('year') ? 12 : 1));
        renderCalendar(`[data-nav="${dataset.nav}"]`);
      }
    });
    panel.addEventListener('keydown', event => {
      if (!active) return;
      if (!event.target.dataset.day) return;
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (Object.hasOwn(offsets, event.key)) {
        const next = day + offsets[event.key];
        const limit = daysInMonth(year, month);
        if (next < 1) {
          if (shiftMonth(-1)) day = daysInMonth(year, month) + next;
        } else if (next > limit) {
          if (shiftMonth(1)) day = next - limit;
        } else day = next;
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        shiftMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
      } else if (event.key === 'Home') day = 1;
      else if (event.key === 'End') day = daysInMonth(year, month);
      else return;
      event.preventDefault();
      renderCalendar('[data-day][tabindex="0"]');
    });
    panel.addEventListener('focusin', event => {
      const button = event.target.closest('[data-day]');
      if (!button) return;
      const prior = panel.querySelector('[data-day][tabindex="0"]');
      if (prior) prior.tabIndex = -1;
      button.tabIndex = 0;
      day = Number(button.dataset.day);
    });
    window.addEventListener('scroll', event => { if (!panel.contains(event.target)) positionCalendar(); }, { capture: true, passive: true });
    window.addEventListener('resize', positionCalendar);
    window.addEventListener('hashchange', () => closeCalendar());
    window.visualViewport?.addEventListener('resize', positionCalendar);
    window.visualViewport?.addEventListener('scroll', positionCalendar);
  }
  function enhance(input) {
    if (controls.has(input)) { const existing=controls.get(input); if(existing.lastValue!==input.value) existing.sync(); return; }
    const group = input.closest('.form-group') || input.parentElement;
    const label = group.querySelector('label')?.textContent.trim() || '日期';
    const wrapper = document.createElement('div'); wrapper.className = 'date-picker';
    const current = parse(input.value);
    const maxYear = Math.max(new Date().getFullYear() + (input.id === 'birthDate' ? 0 : 30), current.year || 0);
    const minYear = Math.min(1900, current.year || 1900);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'date-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', 'resumeCalendar');
    trigger.setAttribute('aria-expanded', 'false');
    const valueLabel = document.createElement('span');
    trigger.append(valueLabel);
    trigger.insertAdjacentHTML('beforeend', calendarIcon);
    const note = document.createElement('small'); note.className='date-picker-note'; note.setAttribute('aria-live','polite');
    wrapper.append(trigger, note);
    const key = `${input.dataset.extKey || ''} ${input.id} ${input.className}`;
    const specialValues = /availableDate/.test(key) ? ['随时到岗','毕业后','2周内'] : /expiry|validUntil/i.test(key) ? ['长期'] : /endDate|(?:edu|work|proj)-end/.test(key) ? ['至今'] : [];
    input.after(wrapper); input.hidden=true; input.classList.add('date-source');
    const state = { input, wrapper, trigger, specialValues, note, label, minYear, maxYear, sync };
    controls.set(input,state);
    function sync() {
      const p=parse(input.value);
      if (p.year) {
        state.minYear = Math.min(state.minYear, p.year);
        state.maxYear = Math.max(state.maxYear, p.year);
      }
      const unsupported = p.kind === 'invalid' || (p.kind === 'special' && !specialValues.includes(p.value));
      valueLabel.textContent = unsupported || p.kind === 'empty' ? '选择日期' : input.value;
      trigger.classList.toggle('is-placeholder', unsupported || p.kind === 'empty');
      trigger.setAttribute('aria-label', `${label}，${valueLabel.textContent}`);
      note.textContent = unsupported ? `原值：${input.value}，请选择日期修正。`
        : p.kind === 'month' ? '仅有年月，具体日可稍后补充。' : '';
      state.lastValue=input.value;
    }
    trigger.addEventListener('click', () => openCalendar(state));
    input.addEventListener('change', sync);
    sync();
  }
  let pending;
  function moduleFor(input) {
    const section = input.closest('section[id]')?.id.replace(/^section-/, '');
    const type = input.closest('.item-card')?.querySelector('.work-type')?.value;
    return section === 'work' && typeof isInternshipRecord === 'function' && isInternshipRecord({ workType: type }) ? 'internship' : section;
  }
  function focusState(state) {
    const module = moduleFor(state.input);
    if (module && typeof navigateWorkspace === 'function') navigateWorkspace(module, true);
    for (let el = state.input.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'DETAILS') el.open = true;
      if (el.classList.contains('item-card-body') && el.hidden) el.parentElement.querySelector('.item-collapse-btn')?.click();
      if (el.classList.contains('ext-collapse-body') && el.hidden) el.parentElement.querySelector('.ext-collapse-toggle')?.click();
    }
    state.wrapper.scrollIntoView({ block: 'center' });
    state.trigger.focus({ preventScroll: true });
  }
  function refreshPending() {
    if(!pending) return;
    const entries=[];
    for(const [input,state] of controls) {
      if(!input.isConnected) {controls.delete(input);continue;}
      const key = moduleFor(input);
      if (typeof resumeModuleEnabled === 'function' && !resumeModuleEnabled(currentProfile, key)) continue;
      const parsed=parse(input.value);
      const kind = parsed.kind === 'empty' ? '未填写'
        : parsed.kind === 'invalid' || (parsed.kind === 'special' && !state.specialValues.includes(parsed.value)) ? '格式异常'
          : parsed.kind === 'month' ? '仅有年月' : '';
      if (kind) entries.push({ state, kind, key });
    }
    pending.replaceChildren();
    const summary=document.createElement('summary');summary.textContent=`日期待完善 · ${entries.length} 项`;pending.append(summary);
    const description=document.createElement('p');description.textContent='仅有年月可以保存；网站要求完整日期时再补充。未填写的可选日期可留空。';pending.append(description);
    for(const {state,kind,key} of entries) {
      const card = state.input.closest('.item-card');
      const title = card?.querySelector('.item-card-header h4')?.textContent.trim();
      const section = typeof WORKSPACE_MODULE_TITLES !== 'undefined' ? WORKSPACE_MODULE_TITLES[key] : '';
      const button=document.createElement('button');button.type='button';
      button.textContent = [section, title, state.label, kind, state.input.value].filter(Boolean).join(' · ');
      button.addEventListener('click',()=>focusState(state));pending.append(button);
    }
  }
  function scan() {
    if (active && (!active.trigger.getClientRects().length || active.input.value !== active.lastValue)) closeCalendar();
    document.getElementById('section-dates')?.append(pending);
    for(const input of document.querySelectorAll(candidates)) if(isDate(input)) enhance(input);
    refreshPending();
  }
  api.validate = function() {
    api.error = '';
    for (const state of controls.values()) if (state.note.textContent === '结束时间不能早于开始时间') state.sync();
    for(const card of document.querySelectorAll('.item-card')) {
      const inputs=[...card.querySelectorAll('input')];
      const start=inputs.find(i=>i.dataset.extKey==='startDate'||/(?:^|\s)(edu|work|proj)-start(?:\s|$)/.test(i.className));
      const end=inputs.find(i=>i.dataset.extKey==='endDate'||/(?:^|\s)(edu|work|proj)-end(?:\s|$)/.test(i.className));
      if(!start||!end) continue;
      const a=parse(start.value),b=parse(end.value);
      if(['day','month'].includes(a.kind)&&['day','month'].includes(b.kind)) {
        const invalid = start.value.slice(0,7)>end.value.slice(0,7) || (a.kind==='day'&&b.kind==='day'&&start.value>end.value);
        if(invalid) {
          api.error = '结束时间不能早于开始时间';
          const state = controls.get(end);
          if (state) state.note.textContent = api.error;
          return false;
        }
      }
    }
    return true;
  };
  api.refresh=scan;
  global.YanyuDates=api;
  function init() {
    initCalendar();
    pending=document.createElement('details');pending.className='date-pending';pending.id='datePending';pending.open=true;
    const host=document.getElementById('section-basic'); if(host) host.prepend(pending);
    scan();
    new MutationObserver((mutations)=>{
      if(!mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&!n.closest?.('.date-picker,.date-pending,.resume-calendar')))) return;
      clearTimeout(timer);timer=setTimeout(scan,80);
    }).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);else init();
})(typeof window==='undefined'?globalThis:window);
