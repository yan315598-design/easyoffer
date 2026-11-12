import json
from options_workspace_regression import *

def run():
 server,origin=start_server()
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=chrome_path(),headless=True)
  context=browser.new_context(viewport={'width':1440,'height':900})
  context.add_init_script('window.__CAPYBARA_TEST_DATA__ = '+json.dumps(test_data())+';')
  context.add_init_script(CHROME_MOCK)
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(origin+'/options/options.html');page.wait_for_selector('#profileOverview .overview-card')
  page.evaluate("navigateWorkspace('modules')")
  assert page.locator('#section-modules').is_visible()
  assert page.locator('#section-modules input[type=checkbox]').count() == 22
  page.evaluate("async()=>{ currentProfile.moduleConfig=resumeModuleConfig(currentProfile); currentProfile.moduleConfig.enabled.projects=false; profileDirty=true; await saveProfile({silent:true}); refreshWorkspaceUi(); }")
  assert page.locator('#sidebarMenu [data-module=projects]').count()==0
  page.reload();page.wait_for_selector('#section-modules')
  assert page.evaluate('currentProfile.moduleConfig.enabled.projects') is False
  assert page.evaluate('currentProfile.projects.length') > 0
  page.evaluate("navigateWorkspace('internship',true); addWorkExperience();")
  assert page.locator('#workList > .item-card:visible').count() > 0
  assert page.locator('#workList > .item-card:visible .work-type').last.input_value() == '实习'
  page.evaluate("navigateWorkspace('introduction',true)")
  assert page.locator('#introduction').is_visible()
  page.evaluate("navigateWorkspace('aiTools',true)")
  field=page.locator('#section-aiTools [data-ext-key=aiTools]');assert field.count()==1
  field.fill('Synthetic AI evidence');page.evaluate('saveProfile({silent:true})')
  assert page.evaluate('collectProfileUpdates().commonAnswers.aiTools')=='Synthetic AI evidence'
  page.reload();page.wait_for_selector('#section-aiTools [data-ext-key=aiTools]')
  assert page.locator('#section-aiTools [data-ext-key=aiTools]').input_value()=='Synthetic AI evidence'
  assert not errors, errors
  browser.close()
 server.shutdown()
 print('PASS 10 FAIL 0')
if __name__=='__main__':run()
