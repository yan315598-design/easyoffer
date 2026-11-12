import json
from options_workspace_regression import *
def run():
 server,origin=start_server()
 errors=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=chrome_path(),headless=True)
  context=browser.new_context(viewport={'width':1440,'height':900})
  context.add_init_script('window.__CAPYBARA_TEST_DATA__ = '+json.dumps(test_data())+';')
  context.add_init_script(CHROME_MOCK)
  context.add_init_script('chrome.storage.local.remove=async()=>{};')
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(origin+'/options/options.html');page.wait_for_selector('#profileOverview .overview-card')
  for route in ['product','tracker','help','settings','profile']:
   page.locator('[data-page="'+route+'"]').click();page.wait_for_timeout(300)
   assert page.locator('body').get_attribute('data-app-page')==route
   assert page.locator('#view-profile').is_visible()==(route=='profile')
   if route!='profile': assert page.locator('#page-'+route).is_visible()
   page.screenshot(path=str(OUT/('yanyu-new-'+route+'.png')),animations='disabled')
  page.locator('[data-page="settings"]').click();page.wait_for_timeout(200)
  assert page.locator('#section-ai').is_visible()
  page.locator('[data-page="help"]').click();page.locator('.shell-search').fill('日期')
  assert page.locator('#help-date').is_visible()
  page.set_viewport_size({'width':390,'height':800});page.wait_for_timeout(100)
  page.screenshot(path=str(OUT/'yanyu-new-mobile.png'))
  page.set_viewport_size({'width':1440,'height':900})
  page.locator('[data-page="product"]').click()
  page.locator('.product-secondary').click()
  page.wait_for_function("location.hash === '#product-demo' && document.activeElement.id === 'product-demo-title'")
  demo=page.locator('#product-demo')
  assert demo.get_attribute('data-stage')=='local'
  ai=demo.get_by_role('button',name='02 AI 助填')
  ai.focus();ai.press('Enter')
  assert ai.get_attribute('aria-pressed')=='true'
  assert demo.locator('[data-demo-field="answer"] .demo-field-status').inner_text()=='AI 草稿'
  route=demo.locator('.demo-signal[data-demo-route="ai"]')
  assert route.evaluate("(element) => getComputedStyle(element).animationName")=='product-signal'
  page.screenshot(path=str(OUT/'yanyu-product-ai-demo.png'),animations='disabled')
  page.locator('#product-workflow').scroll_into_view_if_needed();page.wait_for_timeout(350)
  page.locator('.capability-card').last.scroll_into_view_if_needed();page.wait_for_timeout(700)
  assert page.locator('.product-steps .is-revealed').count()==3
  assert page.locator('.capability-card.is-revealed').count()==5
  nav_inline_style=page.locator('.navbar').evaluate("(element) => { const current=element.style.cssText; element.style.position='absolute'; element.style.left='0'; element.style.right='0'; return current; }")
  page.screenshot(path=str(OUT/'yanyu-product-full.png'),full_page=True,animations='disabled')
  page.locator('.navbar').evaluate("(element, current) => { element.style.cssText=current; }",nav_inline_style)
  demo.get_by_role('button',name='03 人工核对').click()
  assert demo.locator('[data-demo-field="date"] .demo-field-status').inner_text()=='待补充'
  page.emulate_media(reduced_motion='reduce')
  ai.click()
  assert route.evaluate("(element) => getComputedStyle(element).animationName")=='none'
  assert page.locator('.product-float-resume').evaluate("(element) => getComputedStyle(element).animationName")=='none'
  page.set_viewport_size({'width':390,'height':850})
  page.locator('#themeToggle').click()
  demo.scroll_into_view_if_needed()
  assert page.locator('html').get_attribute('data-theme')=='dark'
  assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
  page.screenshot(path=str(OUT/'yanyu-product-ai-demo-narrow-dark.png'),animations='disabled')
  page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(100)
  page.screenshot(path=str(OUT/'yanyu-product-mobile-top-dark.png'),animations='disabled')
  nav_tops=page.locator('#navTabsPill [data-page]').evaluate_all("(elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top))")
  assert max(nav_tops)-min(nav_tops)<=1
  page.set_viewport_size({'width':320,'height':740});page.wait_for_timeout(100)
  assert page.evaluate("document.documentElement.scrollWidth === innerWidth")
  page.screenshot(path=str(OUT/'yanyu-product-320-dark.png'),animations='disabled')
  assert not errors, errors
  browser.close()
 server.shutdown()
 print('PASS app shell regression: all checks passed')
if __name__=='__main__':run()
