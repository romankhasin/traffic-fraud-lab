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

const period = new Map([
  ['representative_source', {
    visits: 9002,
    clientIdVisits: 9002,
    coverage: 1,
    uniqueClientIds: 8102,
    top1Visits: 30,
    top1Share: 30 / 9002,
    top10Visits: 180,
    top10Share: 180 / 9002,
    visitsPerClientId: 9002 / 8102,
    repeatClientVisitShare: 900 / 9002,
    activeDays: 10,
    representative: true,
  }],
]);

const summaries = global.FraudLabApiHelpers.summarizeClientIds(rows, period);
const representative = summaries.get('representative_source');
if (!representative?.period || representative.period.top1Visits !== 30) {
  throw new Error(`Exact period metrics missing: ${JSON.stringify(representative)}`);
}
if (representative.daily.representativeDays !== 9) {
  throw new Error(`Expected 9 representative days, got ${representative.daily.representativeDays}`);
}
if (representative.daily.representativeThreshold !== 200) {
  throw new Error(`Expected threshold 200, got ${representative.daily.representativeThreshold}`);
}
if (representative.daily.maxTop1.date !== '2026-07-04' || representative.daily.maxTop1.value !== 0.05) {
  throw new Error(`Tiny day distorted top-1 maximum: ${JSON.stringify(representative.daily.maxTop1)}`);
}
if (representative.daily.maxTop10.date !== '2026-07-05' || representative.daily.maxTop10.value !== 0.15) {
  throw new Error(`Tiny day distorted top-10 maximum: ${JSON.stringify(representative.daily.maxTop10)}`);
}
if (representative.daily.maxTop1.sampleVisits !== 1000) {
  throw new Error(`Sample size was not preserved: ${JSON.stringify(representative.daily.maxTop1)}`);
}

const tinyOnly = summaries.get('tiny_only_source');
if (!tinyOnly || tinyOnly.daily.representativeDays !== 0 || tinyOnly.daily.maxTop1.date !== '') {
  throw new Error(`Tiny-only source should have no representative maxima: ${JSON.stringify(tinyOnly)}`);
}

console.log('Representative ClientID maxima validation passed');
