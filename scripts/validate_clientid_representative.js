'use strict';

const fs = require('fs');
const vm = require('vm');

function makeElement() {
  return {
    disabled: false,
    value: '',
    textContent: '',
    className: '',
    addEventListener() {},
    querySelectorAll() { return []; },
  };
}

const elements = new Map();
global.window = global;
global.document = {
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  },
  querySelectorAll() { return []; },
};
global.fetch = async () => ({ ok: false, status: 404 });

global.FraudLab = { analyzeApiRows() {} };

vm.runInThisContext(fs.readFileSync('assets/api-mode.js', 'utf8'), {
  filename: 'assets/api-mode.js',
});

if (!global.FraudLabApiHelpers?.summarizeClientIds) {
  throw new Error('ClientID summary helper was not exposed');
}

const rows = [];
for (let day = 1; day <= 9; day += 1) {
  rows.push({
    source: 'representative_source',
    date: `2026-07-${String(day).padStart(2, '0')}`,
    visits: 1000,
    tech: { visits: 1000 },
    clientIdVisits: 1000,
    clientIdCoverage: 1,
    uniqueClientIds: 900,
    visitsPerClientId: 1000 / 900,
    topClientId: { share: day === 4 ? 0.05 : 0.02 },
    top10ClientShare: day === 5 ? 0.15 : 0.08,
  });
}
rows.push({
  source: 'representative_source',
  date: '2026-07-10',
  visits: 2,
  tech: { visits: 2 },
  clientIdVisits: 2,
  clientIdCoverage: 1,
  uniqueClientIds: 2,
  visitsPerClientId: 1,
  topClientId: { share: 0.5 },
  top10ClientShare: 1,
});
rows.push({
  source: 'tiny_only_source',
  date: '2026-07-01',
  visits: 2,
  tech: { visits: 2 },
  clientIdVisits: 2,
  clientIdCoverage: 1,
  uniqueClientIds: 2,
  visitsPerClientId: 1,
  topClientId: { share: 0.5 },
  top10ClientShare: 1,
});

const summaries = global.FraudLabApiHelpers.summarizeClientIds(rows);
const representative = summaries.get('representative_source');
if (!representative) throw new Error('Representative source summary missing');
if (representative.representativeDays !== 9) {
  throw new Error(`Expected 9 representative days, got ${representative.representativeDays}`);
}
if (representative.representativeThreshold !== 200) {
  throw new Error(`Expected threshold 200, got ${representative.representativeThreshold}`);
}
if (representative.maxTop1.date !== '2026-07-04' || representative.maxTop1.value !== 0.05) {
  throw new Error(`Tiny day distorted top-1 maximum: ${JSON.stringify(representative.maxTop1)}`);
}
if (representative.maxTop10.date !== '2026-07-05' || representative.maxTop10.value !== 0.15) {
  throw new Error(`Tiny day distorted top-10 maximum: ${JSON.stringify(representative.maxTop10)}`);
}
if (representative.maxTop1.sampleVisits !== 1000) {
  throw new Error(`Sample size was not preserved: ${JSON.stringify(representative.maxTop1)}`);
}

const tinyOnly = summaries.get('tiny_only_source');
if (!tinyOnly || tinyOnly.representativeDays !== 0 || tinyOnly.maxTop1.date !== '') {
  throw new Error(`Tiny-only source should have no representative maxima: ${JSON.stringify(tinyOnly)}`);
}

console.log('Representative ClientID maxima validation passed');
