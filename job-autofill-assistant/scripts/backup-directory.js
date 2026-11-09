// The extension pages and service worker share this database by extension origin.
const backupDirectory = {
  async access(mode, operation) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('easyoffer-backup-directory', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('handles');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('handles', mode);
        const request = operation(transaction.objectStore('handles'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  },
  get() { return this.access('readonly', store => store.get('directory')); },
  set(handle) { return this.access('readwrite', store => store.put(handle, 'directory')); },
  clear() { return this.access('readwrite', store => store.delete('directory')); },
  filename() { return `easyoffer-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.json`; },
  isSnapshot(name) { return /^easyoffer-\d{4}-\d{2}-\d{2}T[\d-]+Z-[\da-f]{8}\.json$/.test(name); },
  async write(handle, data) {
    const name = this.filename();
    const file = await handle.getFileHandle(name, { create: true });
    let writer;
    try {
      writer = await file.createWritable();
      await writer.write(data);
      await writer.close();
      if (await (await file.getFile()).text() !== data) throw new Error('备份文件未通过写入核对');
      return name;
    } catch (error) {
      try { await writer?.abort(); } catch {}
      try { await handle.removeEntry(name); } catch {}
      throw error;
    }
  }
};
