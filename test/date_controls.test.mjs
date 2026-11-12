import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const dates=require('../job-autofill-assistant/options/date-controls.js');
const cases=[['2024-02-29','day'],['2023-02-29','invalid'],['1900-02-29','invalid'],['2000-02-29','day'],['2026-04-31','invalid'],['2026-09','month'],['2026-00','invalid'],['2026-13','invalid'],['2026-09-00','invalid'],['','empty'],['至今','special'],['长期','special'],['毕业后','special'],['二零二六年九月','invalid'],['0000-01','invalid']];
for(const [value,kind] of cases) assert.equal(dates.parse(value).kind,kind);
console.log(`Passed ${cases.length}, Failed 0`);
