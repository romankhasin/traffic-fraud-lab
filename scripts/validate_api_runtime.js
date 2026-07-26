'use strict';

const fs = require('fs');
const vm = require('vm');

function classList() {
  return { add() {}, remove() {}, toggle() {} };
}

function makeElement() {
  return {
    hidden: false,
    disabled: false,
    value: '',
    innerHTML: '',
    textContent: '',
    dataset: {},
    classList: classList(),
    addEventListener() {},
    scrollIntoView() {},
    querySelectorAll() { return []; },
    click() {},
  };
}

const elements = new Map();
const getElement = (selector) => {
  if (!elements.has(selector)) elements.set(selector, makeElement());
  return elements.get(selector);
};

global.window = global;
global.document = {
  querySelector: getElement,
  querySelectorAll() { return []; },
  createElement() { return makeElement(); },
};
global.Blob = class Blob {};
global.URL = {
  createObjectURL() { return 'blob:test'; },
  revokeObjectURL() {},
};
global.fetch = async () => ({ ok: false, status: 404 });

vm.runInThisContext(fs.readFileSync('assets/app-v2.js', 'utf8'), {
  filename: 'assets/app-v2.js',
});
vm.runInThisContext(fs.readFileSync('assets/api-mode.js', 'utf8'), {
  filename: 'assets/api-mode.js',
});

if (!global.FraudLab || typeof global.FraudLab.analyzeApiRows !== 'function') {
  throw new Error('FraudLab API was not exposed');
}
if (!global.FraudLabApiHelpers || typeof global.FraudLabApiHelpers.summarizeClientIds !== 'function') {
  throw new Error('ClientID API helpers were not exposed');
}

const rows = [];
const sources = ['stable_source', 'spike_source'];
for (const source of sources) {
  for (let day = 1; day <= 10; day += 1) {
    const anomaly = source === 'spike_source' && day === 9;
    const visits = anomaly ? 2800 : source === 'stable_source' ? 950 : 720;
    const bounce = anomaly ? 0 : source === 'stable_source' ? 0.34 : 0.52;
    const duration = anomaly ? 1200 : source === 'stable_source' ? 130 : 84;
    const clientIdVisits = source === 'stable_source' && day === 2 ? Math.round(visits * 0.5) : visits;
    const clientIds = anomaly ? 40 : Math.min(clientIdVisits, Math.round(visits * 0.92));
    const topClientShare = anomaly ? 0.4 : 0.01;
    rows.push({
      source,
      date: `2026-07-${String(day).padStart(2, '0')}`,
      visits,
      tech: { visits, users: Math.round(visits * 0.9), bounce, time: duration, newShare: 0.9, quality: 0.01, primary: 0 },
      ip: { visits, users: Math.round(visits * 0.9), bounce, time: duration, newShare: 0.9, quality: 0.01, primary: 0 },
      metrics: { visits, users: Math.round(visits * 0.9), bounce, time: duration, newShare: 0.9, quality: 0.01, primary: 0 },
      topBrowser: { key: 'chrome 149', value: Math.round(visits * 0.55), share: 0.55 },
      topResolution: { key: '1920x1080', value: Math.round(visits * 0.35), share: 0.35 },
      topProfile: { key: 'chrome · windows · desktop · 1920x1080', value: Math.round(visits * (anomaly ? 0.82 : 0.28)), share: anomaly ? 0.82 : 0.28 },
      topIp: { key: 'скрыто', value: Math.round(visits * (anomaly ? 0.3 : 0.01)), share: anomaly ? 0.3 : 0.01 },
      topSubnet: { key: 'скрыто', value: Math.round(visits * (anomaly ? 0.42 : 0.03)), share: anomaly ? 0.42 : 0.03 },
      clientIdVisits,
      uniqueClientIds: clientIds,
      topClientId: { key: 'скрыто', value: Math.round(clientIdVisits * topClientShare), share: topClientShare },
      top10ClientShare: anomaly ? 0.82 : 0.03,
      visitsPerClientId: clientIds ? clientIdVisits / clientIds : 0,
      repeatClientVisitShare: clientIdVisits ? Math.max(0, clientIdVisits - clientIds) / clientIdVisits : 0,
      clientIdCoverage: clientIdVisits / visits,
      ipv6Share: 0.2,
      unknownBrowserShare: 0,
      cookieEnabledShare: 1,
      visitRisk: {
        classifiedVisits: visits,
        highRiskVisits: anomaly ? 600 : 0,
        reviewVisits: anomaly ? 900 : 0,
        lowRiskVisits: anomaly ? visits - 1500 : visits,
        suspiciousVisits: anomaly ? 1500 : 0,
        suspiciousShare: anomaly ? 1500 / visits : 0,
        confidence: 'Высокая',
        comment: anomaly ? '1 500 визитов требуют внимания.' : 'Выраженных сочетаний признаков не найдено.',
        reasons: anomaly ? [{ code: 'repeated_clientid', label: 'повторные визиты одного ClientID', visits: 1500, shareOfSuspicious: 1 }] : [],
      },
      automationVisits: source === 'stable_source' && day === 1 ? 1 : 0,
      automationShare: source === 'stable_source' && day === 1 ? 1 / visits : 0,
      automation: source === 'stable_source' && day === 1,
      concentrationScope: 'daily',
      dataSource: 'yandex-metrica-logs-api',
    });
  }
}

const periodSummaries = new Map([
  ['stable_source', {
    visits: 9500,
    clientIdVisits: 9025,
    coverage: 0.95,
    uniqueClientIds: 8200,
    top1Visits: 45,
    top1Share: 45 / 9025,
    top10Visits: 310,
    top10Share: 310 / 9025,
    visitsPerClientId: 9025 / 8200,
    repeatClientVisitShare: (9025 - 8200) / 9025,
    activeDays: 10,
    representative: true,
  }],
]);

const clientIdSummaries = global.FraudLabApiHelpers.summarizeClientIds(rows, periodSummaries);
const stableClientId = clientIdSummaries.get('stable_source');
if (!stableClientId?.period || stableClientId.period.top1Visits !== 45) {
  throw new Error(`Exact period summary was not attached: ${JSON.stringify(stableClientId)}`);
}
if (stableClientId.daily.representativeDays !== 10 || !stableClientId.daily.maxTop1.date) {
  throw new Error(`Representative daily peaks are invalid: ${JSON.stringify(stableClientId.daily)}`);
}
const clientHtml = global.FraudLabApiHelpers.renderClientIdBlock(stableClientId, []);
if (!clientHtml.includes('За выбранный период') || !clientHtml.includes('Доля топ-1') || !clientHtml.includes('Пиковые дневные значения')) {
  throw new Error(`Selected-period ClientID block was not rendered: ${clientHtml}`);
}

const result = global.FraudLab.analyzeApiRows(rows, {
  mode: 'api',
  label: 'Runtime test',
});

if (result.sources !== 2 || result.days !== 20) {
  throw new Error(`Unexpected analysis size: ${JSON.stringify(result)}`);
}
if (getElement('#results').hidden) throw new Error('Results remained hidden');
if (!getElement('#kpi-grid').innerHTML.includes('Logs API')) throw new Error('API KPI was not rendered');
if (!getElement('#source-list').innerHTML.includes('Оценка конкретных визитов')) throw new Error('Visit-level risk summary was not rendered');
if (!getElement('#source-list').innerHTML.includes('повторные визиты одного ClientID')) throw new Error('Visit-level reason was not rendered');
if (!getElement('#kpi-grid').innerHTML.includes('Подозрительные визиты')) throw new Error('Refined suspicious visits KPI was not rendered');
if (!getElement('#summary-text').textContent.includes('Runtime test')) throw new Error('API context was not rendered');

console.log(`Fraud API runtime validation passed: ${result.sources} sources, ${result.days} days`);
