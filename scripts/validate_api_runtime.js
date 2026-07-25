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

vm.runInThisContext(fs.readFileSync('assets/app-v2.js', 'utf8'), {
  filename: 'assets/app-v2.js',
});

if (!global.FraudLab || typeof global.FraudLab.analyzeApiRows !== 'function') {
  throw new Error('FraudLab API was not exposed');
}

const rows = [];
const sources = ['stable_source', 'spike_source'];
for (const source of sources) {
  for (let day = 1; day <= 10; day += 1) {
    const anomaly = source === 'spike_source' && day === 9;
    const visits = anomaly ? 2800 : source === 'stable_source' ? 950 : 720;
    const bounce = anomaly ? 0 : source === 'stable_source' ? 0.34 : 0.52;
    const duration = anomaly ? 1200 : source === 'stable_source' ? 130 : 84;
    const clientIds = anomaly ? 40 : Math.round(visits * 0.92);
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
      clientIdVisits: visits,
      uniqueClientIds: clientIds,
      topClientId: { key: 'скрыто', value: Math.round(visits * topClientShare), share: topClientShare },
      top10ClientShare: anomaly ? 0.82 : 0.03,
      visitsPerClientId: visits / clientIds,
      repeatClientVisitShare: Math.max(0, visits - clientIds) / visits,
      clientIdCoverage: 1,
      ipv6Share: 0.2,
      unknownBrowserShare: 0,
      cookieEnabledShare: 1,
      automation: false,
      concentrationScope: 'daily',
      dataSource: 'yandex-metrica-logs-api',
    });
  }
}

const result = global.FraudLab.analyzeApiRows(rows, {
  mode: 'api',
  label: 'Runtime test',
});

if (result.sources !== 2 || result.days !== 20) {
  throw new Error(`Unexpected analysis size: ${JSON.stringify(result)}`);
}
if (getElement('#results').hidden) {
  throw new Error('Results remained hidden');
}
if (!getElement('#kpi-grid').innerHTML.includes('Logs API')) {
  throw new Error('API KPI was not rendered');
}
if (!getElement('#source-list').innerHTML.includes('ClientID — дневные максимумы')) {
  throw new Error('Daily concentration labels were not rendered');
}
if (!getElement('#summary-text').textContent.includes('Runtime test')) {
  throw new Error('API context was not rendered');
}

console.log(`Fraud API runtime validation passed: ${result.sources} sources, ${result.days} days`);
