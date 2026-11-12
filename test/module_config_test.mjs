import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../job-autofill-assistant/scripts/profile-schema.js',import.meta.url),'utf8'),ctx);
vm.runInContext(fs.readFileSync(new URL('../job-autofill-assistant/scripts/profile-completeness.js',import.meta.url),'utf8'),ctx);
let passed=0;
function test(fn){fn();passed++;}
const profile={id:'p1',basicInfo:{fullName:'Name'},workExperience:[{id:'w',workType:'全职',company:'Work'},{id:'i',workType:'实习',company:'Intern'},{id:'u',company:'Unknown'}],projects:[{id:'p',name:'Project'}],introTemplates:{default:'Intro'},languageCertificates:[{name:'CET4',score:'500'}],languageSkills:{cet4:'500'},commonAnswers:{aiTools:'AI tools',hobbies:'hobbies'},skills:['JS'],familyMembers:[{name:'Family'}],moduleConfig:{version:1,enabled:{internship:false,projects:false,languageCertificates:false,introduction:false,commonAnswers:false}}};
test(()=>{const p=ctx.profileForFilling(profile);assert.equal(p.workExperience.length,2);assert.equal(p.workExperience[1].id,'u');assert.equal(p.projects.length,0);assert.equal(p.languageCertificates.length,0);assert.equal(Object.keys(p.languageSkills).length,0);assert.equal(p.commonAnswers.aiTools,'AI tools');assert.equal(p.commonAnswers.hobbies,undefined);assert.equal(Object.keys(p.introTemplates).length,0);});
test(()=>{ctx.profileForFilling(profile);assert.equal(profile.workExperience.length,3);assert.equal(profile.projects.length,1);assert.equal(profile.introTemplates.default,'Intro');});
test(()=>{const p=structuredClone(profile);p.moduleConfig.enabled.work=false;assert.equal(ctx.profileForFilling(p).workExperience.length,0);});
test(()=>{const p=structuredClone(profile);p.moduleConfig.enabled.aiTools=false;assert.equal(ctx.profileForFilling(p).commonAnswers.aiTools,undefined);});
test(()=>{const config=ctx.resumeModuleConfig(profile);config.enabled.projects=true;assert.equal(profile.moduleConfig.enabled.projects,false);assert.equal(config.version,1);});
test(()=>{assert.equal(ctx.ProfileCompleteness.computeProfileCompleteness({}).total,15);assert.equal(ctx.ProfileCompleteness.computeProfileCompleteness({moduleConfig:{enabled:{work:false,internship:false,skills:false,projects:false,languageCertificates:false}}}).total,11);});
test(()=>{const once=ctx.profileForFilling(profile);assert.equal(JSON.stringify(ctx.profileForFilling(once)),JSON.stringify(once));});
console.log(`PASS ${passed} FAIL 0`);
