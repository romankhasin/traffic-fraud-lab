'use strict';

const fs = require('fs');
const vm = require('vm');

function makeElement() {
  return {
    value: '',
    disabled: false,
    className: '',
    textContent: '',
    innerHTML: '',
    min: '',
    max: '',
    addEventListener() {},
    querySelectorAll() { return []; },
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
};
global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const sourcePath = process.argv[2] || 'assets/api-mode.js';
vm.runInThisContext(fs.readFileSync(sourcePath, 'utf8'), { filename: sourcePath });

const helpers = global.FraudLabApiHelpers;
if (!helpers) throw new Error('FraudLabApiHelpers were not exposed');
for (const method of [
  'aggregateSliceGroups',
  'buildWarningModel',
  'renderWarningBlock',
  'renderDrilldownBlock',
  'renderQualityBlock',
  'renderBehaviorBlock',
]) {
  if (typeof helpers[method] !== 'function') throw new Error(`${method} was not exposed`);
}

const day = (date, visits, bounceRate, time, depth, qualityRate, newRate = 0.9) => [
  date,
  visits,
  Math.round(visits * bounceRate),
  Math.round(visits * time),
  Math.round(visits * depth),
  Math.round(visits * qualityRate),
  Math.round(visits * newRate),
];

const rawGroups = [
  {
    source: 'mts', dimension: 'browser', value: 'Chrome Mobile 134',
    days: [day('2026-07-01', 700, 0.04, 520, 7, 0.12), day('2026-07-02', 800, 0.05, 480, 7, 0.11)],
  },
  {
    source: 'mts', dimension: 'browserResolution', value: 'Chrome Mobile 134 · 485x501',
    meta: { browser: 'Chrome Mobile 134', resolution: '485x501' },
    days: [day('2026-07-01', 350, 0.96, 18, 1, 0), day('2026-07-02', 450, 0.97, 16, 1, 0)],
  },
  {
    source: 'mts', dimension: 'fingerprint', value: 'Chrome Mobile 134 · Android 11 · 2 · 485x501 · OPPO CPH2205',
    meta: { browser: 'Chrome Mobile 134', resolution: '485x501', os: 'Android 11', deviceModel: 'OPPO CPH2205' },
    days: [day('2026-07-01', 250, 0.02, 650, 9, 0.15), day('2026-07-02', 300, 0.01, 620, 9, 0.14)],
  },
  {
    source: 'mts', dimension: 'referrer', value: 'bad-publisher.example',
    days: [day('2026-07-01', 550, 0.05, 300, 6, 0.08), day('2026-07-02', 650, 0.06, 310, 6, 0.09)],
  },
  {
    source: 'mts', dimension: 'deviceModel', value: 'UnknownPhone X',
    days: [day('2026-07-01', 500, 0.95, 8, 1, 0), day('2026-07-02', 550, 0.94, 9, 1, 0)],
  },
  {
    source: 'mts', dimension: 'os', value: 'Android 11',
    days: [day('2026-07-01', 100, 0.40, 100, 2, 0.01), day('2026-07-02', 120, 0.41, 102, 2, 0.01)],
  },
];

const aggregated = helpers.aggregateSliceGroups(rawGroups, '2026-07-01', '2026-07-02');
const groups = aggregated.get('mts');
if (!groups || groups.length !== rawGroups.length) throw new Error(`Slice aggregation failed: ${JSON.stringify(groups)}`);

const period = {
  visits: 10000,
  bounce: 0.40,
  time: 100,
  depth: 2,
  quality: 0.01,
  newShare: 0.9,
  zeroResolutionVisits: 700,
  zeroResolutionShare: 0.07,
  unknownResolutionVisits: 100,
  unknownResolutionShare: 0.01,
  unknownBrowserVisits: 20,
  unknownBrowserShare: 0.002,
  unknownOsVisits: 30,
  unknownOsShare: 0.003,
  unknownModelVisits: 900,
  unknownModelShare: 0.09,
  missingReferrerVisits: 4200,
  missingReferrerShare: 0.42,
  ipv6Visits: 1200,
  ipv6Share: 0.12,
  cookieDisabledVisits: 350,
  cookieDisabledShare: 0.035,
  repeatBounceClients5: 42,
  repeatBounceClientShare: 0.006,
  fastAnyGoal3Visits: 40,
  fastAnyGoal3Share: 0.004,
  fastAnyGoal15Visits: 120,
  fastAnyGoal15Share: 0.012,
  fastAnyGoal30Visits: 180,
  fastAnyGoal30Share: 0.018,
  fastQualityGoal15Visits: 4,
  fastQualityGoal15Share: 0.0004,
  fastQualityGoal30Visits: 7,
  fastQualityGoal30Share: 0.0007,
  multiGoalVisits: 90,
  multiGoalShare: 0.009,
};
const dailyVisits = new Map([['2026-07-01', 5000], ['2026-07-02', 5000]]);
const model = helpers.buildWarningModel('mts', groups, period, dailyVisits);
if (model.warnings.length < 3) throw new Error(`Expected several warnings: ${JSON.stringify(model.warnings)}`);
if (!model.warnings.some((item) => item.dimension === 'referrer' && item.value === 'bad-publisher.example')) {
  throw new Error('Referrer warning was not found');
}
if (!model.browsers.length || !model.browsers[0].children.length || !model.browsers[0].children[0].fingerprints.length) {
  throw new Error(`Browser drill-down was not built: ${JSON.stringify(model.browsers)}`);
}

const warningHtml = helpers.renderWarningBlock(model, []);
if (!warningHtml.includes('Отклонения относительно нормы источника')
    || !warningHtml.includes('bad-publisher.example')
    || !warningHtml.includes('mini-spark')
    || !warningHtml.includes('vs')) {
  throw new Error(`Warning table is incomplete: ${warningHtml}`);
}
const drilldownHtml = helpers.renderDrilldownBlock(model);
if (!drilldownHtml.includes('Локализация аномалий')
    || !drilldownHtml.includes('485x501')
    || !drilldownHtml.includes('OPPO CPH2205')) {
  throw new Error(`Drill-down is incomplete: ${drilldownHtml}`);
}
const qualityHtml = helpers.renderQualityBlock(period);
if (!qualityHtml.includes('Качество технических данных') || !qualityHtml.includes('Разрешение 0×0') || !qualityHtml.includes('IPv6')) {
  throw new Error(`Technical data quality block is incomplete: ${qualityHtml}`);
}
const behaviorHtml = helpers.renderBehaviorBlock(period);
if (!behaviorHtml.includes('Поведенческие паттерны')
    || !behaviorHtml.includes('0–3 секунды')
    || !behaviorHtml.includes('4–15 секунд')
    || !behaviorHtml.includes('16–30 секунд')) {
  throw new Error(`Behavior block is incomplete: ${behaviorHtml}`);
}

console.log(`MI extension validation passed: ${model.warnings.length} warnings, ${model.browsers.length} browser drill-downs`);
