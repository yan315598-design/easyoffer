'use strict';

function chooseNewProfile(profiles, activeProfileId) {
  const existing = document.querySelector('.profile-create-dialog');
  if (existing) return Promise.resolve(null);
  const dialog = document.createElement('dialog');
  dialog.className = 'profile-create-dialog';
  dialog.setAttribute('aria-labelledby', 'profileCreateTitle');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="profileCreateTitle">新建简历</h2>
      <label for="newProfileName">简历名称</label>
      <input id="newProfileName" name="name" type="text" required maxlength="60" autofocus>
      <fieldset>
        <legend>创建方式</legend>
        <label><input type="radio" name="mode" value="empty" checked> 创建空简历</label>
        <label><input type="radio" name="mode" value="copy"> 复制已有简历</label>
      </fieldset>
      <div class="profile-create-source" hidden>
        <label for="newProfileSource">来源简历</label>
        <select id="newProfileSource" name="source"></select>
      </div>
      <div class="profile-create-actions">
        <button type="button" data-cancel>取消</button>
        <button type="submit">创建简历</button>
      </div>
    </form>`;
  const form = dialog.querySelector('form');
  const name = form.elements.namedItem('name');
  const source = form.elements.namedItem('source');
  const copy = form.querySelector('input[value="copy"]');
  copy.disabled = profiles.length === 0;
  name.value = `简历 ${profiles.length + 1}`;
  for (const profile of profiles) source.add(new Option(profile.name || '未命名简历', profile.id));
  if (profiles.some(profile => profile.id === activeProfileId)) source.value = activeProfileId;
  form.addEventListener('change', () => {
    dialog.querySelector('.profile-create-source').hidden = !copy.checked;
  });
  name.addEventListener('input', () => name.setCustomValidity(''));
  dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close());

  return new Promise(resolve => {
    let creation = null;
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!name.value.trim()) {
        name.setCustomValidity('请输入简历名称');
        name.reportValidity();
        return;
      }
      creation = { name: name.value.trim(), sourceProfileId: copy.checked ? source.value : undefined };
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(creation);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    name.select();
  });
}
