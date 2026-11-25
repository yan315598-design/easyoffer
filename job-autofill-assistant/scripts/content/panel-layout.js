// Keep desktop-only application forms inside the space left by a native side panel.
// The temporary stylesheet belongs to this document and never changes Chrome's site zoom.
function watchSidebarPageWidth(port) {
  let sheet;
  let observer;
  let timer;
  let originalSize = false;
  let closed = false;
  let lastStatus;
  const root = document.documentElement;

  function removeFit() {
    if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet);
    sheet = null;
  }

  function measure() {
    if (closed || !document.body) return;
    if (regionFillState?.phase === 'select') {
      regionFillState.afterSelection = schedule;
      return;
    }
    removeFit();
    const originalZoom = root.currentCSSZoom || parseFloat(getComputedStyle(root).zoom) || 1;
    const available = Math.min(window.innerWidth, Math.round(root.clientWidth * originalZoom));
    // Measure the document layout, excluding offscreen drawers, wide tables and carousels.
    const containers = [root, document.body, ...document.body.children].filter(el =>
      el === root || el === document.body || el.matches('main, article, section, form, [role="main"], #app, #root, #__next') ||
      (el.matches('div') && el.querySelector('main, form, input:not([type="hidden"]), textarea, select')));
    const main = document.querySelector('main, [role="main"], #app, #root, #__next');
    if (main && !containers.includes(main)) containers.push(main);
    const width = containers.reduce((max, el) => {
      const rect = el.getBoundingClientRect();
      if (rect.height < Math.min(innerHeight / 3, 180) || rect.bottom <= 0 || rect.top >= innerHeight ||
          Math.abs(rect.left) > available / 2 || rect.right < available / 2) return max;
      return Math.max(max, rect.width);
    }, available);
    const overflow = available > 0 && width > available + 8;
    if (overflow && !originalSize) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(`:root { zoom: ${originalZoom * (available - 1) / width} !important; }`);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    const status = overflow ? (sheet ? 'fitted' : 'original') : '';
    if (status !== lastStatus) {
      port.postMessage({ kind: 'pageFit', status, url: location.href });
      lastStatus = status;
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(measure, 100);
  }

  port.onMessage.addListener(message => {
    if (message.kind === 'nativePanel' && !observer) {
      window.addEventListener('resize', schedule);
      // Document width can also change when a SPA first mounts its application shell.
      let lastWidth;
      observer = new ResizeObserver(() => {
        const width = document.body?.getBoundingClientRect().width;
        if (width !== lastWidth) { lastWidth = width; schedule(); }
      });
      observer.observe(root);
      if (document.body) observer.observe(document.body);
      schedule();
    }
    if (message.kind === 'togglePageFit' && observer && message.url === location.href) {
      originalSize = !originalSize;
      measure();
    }
  });
  port.onDisconnect.addListener(() => {
    closed = true;
    clearTimeout(timer);
    window.removeEventListener('resize', schedule);
    observer?.disconnect();
    removeFit();
  });
}
