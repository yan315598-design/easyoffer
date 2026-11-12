import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const context={window:{},crypto:webcrypto};
vm.runInNewContext(fs.readFileSync(new URL('../job-autofill-assistant/options/tracker.js',import.meta.url),'utf8'),context);
const api=context.window.YanyuTracker;
let passed=0;
function test(fn){fn();passed++;}
test(()=>assert.equal(api.normalize({id:'a',status:'在投'}).status,'已投递'));
test(()=>assert.equal(api.normalize({id:'a',status:'面试'}).confirmed,false));
test(()=>assert.equal(api.normalize({id:'a',status:'未知'}).legacyStatus,'未知'));
test(()=>assert.equal(api.normalize({id:'a',status:'Offer',confirmed:true}).confirmed,true));
test(()=>assert.equal(api.csvParse('company,position\n"a,b","c""d"')[1][1],'c"d'));
test(()=>assert.throws(()=>api.csvParse('"unfinished')));
test(()=>{const parsed=api.csvParse(api.csvSerialize([{company:'公司',position:'岗位',notes:'line1\nline2'}]).replace(/^\uFEFF/,''));assert.equal(parsed[1][parsed[0].indexOf('notes')],'line1\nline2');});
test(()=>assert.ok(api.csvSerialize([{company:'=HYPERLINK("evil")'}]).includes("'=HYPERLINK")));
test(() => {
  const record = api.normalize({ id: 'old-round', status: '待一面', confirmed: false });
  assert.equal(record.status, '面试中');
  assert.equal(record.interviewRound, '待一面');
  assert.equal(record.id, 'old-round');
  assert.equal(record.confirmed, false);
  assert.equal(JSON.stringify(api.normalize(record)), JSON.stringify(record));
});
test(() => {
  const [record] = api.csvRecords(api.csvSerialize([{
    id: 'r2', company: '=示例公司', position: '实习', status: '面试中', interviewRound: '待终面',
    history: [{ from: '待二面', to: '待终面', at: '2026-11-08' }]
  }]));
  assert.equal(record.company, '=示例公司');
  assert.equal(record.interviewRound, '待终面');
  assert.equal(record.history[0].to, '待终面');
});
test(() => {
  const [record] = api.csvRecords("company,position,status,schemaVersion\n'=示例公司,实习,已投递,1");
  assert.equal(record.company, '=示例公司');
  assert.equal(record.status, '已投递');
  assert.equal(record.schemaVersion, 2);
});
console.log(`通过 ${passed}，失败 0`);
