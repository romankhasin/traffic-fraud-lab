'use strict';

const fs = require('fs');
const vm = require('vm');

function makeElement() {
  return {
    value: '', disabled: false, className: '', textContent: '', innerHTML: '', min: '', max: '',
    addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; },
    insertAdjacentHTML() {},
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
global.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

vm.runInThisContext(fs.readFileSync('assets/api-mode.js', 'utf8'), { filename: 'assets/api-mode.js' });
const helpers = global.FraudLabApiHelpers;
if (!helpers) throw new Error('FraudLabApiHelpers were not exposed');

const clientSegment = (visits, share, unique, visitsPerId) => ({
  visits, share, clientIdVisits: visits, coverage: 1, uniqueClientIds: unique,
  visitsPerClientId: visitsPerId, top1Visits: 2, top1Share: 2 / visits,
  top10Visits: 12, top10Share: 12 / visits, repeatClientVisitShare: .1,
});
const technical = (visits, share, bounce, time, depth, quality, date = '2026-07-14') => ({
  visits, share, denominatorVisits: 1000, bounce, time, depth, quality,
  restVisits: 1000 - visits, restBounce: .42, restTime: 80, restDepth: 1.8,
  restQuality: .004, dailyTypicalShare: share / 2, dailyMaxShare: Math.min(1, share * 2),
  dailyMaxDate: date, dailyMaxVisits: Math.round(visits / 2), dailyMaxSourceVisits: 500,
});
const period = {
  visits: 1000, clientIdVisits: 1000, coverage: 1, uniqueClientIds: 700,
  visitsPerClientId: 1.4, top1Share: .01, top1Visits: 10, top10Share: .04,
  top10Visits: 40, repeatClientVisitShare: .3, activeDays: 14, representative: true,
  mobileTabletVisits: 400, unknownBrowserVisits: 0, unknownOsVisits: 0,
  zeroResolutionVisits: 10, unknownResolutionVisits: 5,
  clientIdByCookie: {
    on: clientSegment(600, .6, 300, 2),
    off: clientSegment(350, .35, 340, 1.03),
    unknown: clientSegment(50, .05, 50, 1),
  },
  technicalSegments: {
    cookieOn: technical(600, .6, .35, 95, 2.1, .006),
    cookieOff: technical(350, .35, .70, 20, 1.1, .001),
    cookieUnknown: technical(50, .05, .45, 75, 1.7, .003),
    missingReferrer: technical(800, .8, .50, 60, 1.5, .002),
    resolutionUnavailable: technical(15, .015, .85, 5, 1, 0),
    unknownMobileModel: { ...technical(40, .10, .65, 30, 1.2, .001), denominatorVisits: 400 },
    ipv6: technical(100, .1, .40, 85, 1.9, .004),
  },
};
period.technicalIntersections = {
  cookieOffMissingReferrer: technical(300, .3, .75, 15, 1, 0),
  cookieOffResolutionUnavailable: technical(15, .015, .85, 5, 1, 0),
  cookieOffUnknownMobileModel: technical(30, .03, .72, 18, 1, 0),
  missingReferrerUnknownMobileModel: technical(35, .035, .68, 25, 1.1, .001),
  cookieOffMissingReferrerResolutionUnavailable: technical(12, .012, .90, 3, 1, 0),
};

const clientHtml = helpers.renderClientIdBlock({ hasClientIds: true, period, daily: {
  representativeThreshold: 200, representativeDays: 10,
  maxVisitsPerClientId: {}, maxTop1: {}, maxTop10: {},
}}, []);
if (!clientHtml.includes('Cookies выключены') || !clientHtml.includes('Интерпретация общей уникальности ограничена') || !clientHtml.includes('Доля визитов с полученным ClientID')) {
  throw new Error(`ClientID cookie segmentation is incomplete: ${clientHtml}`);
}

const qualityHtml = helpers.renderQualityBlock(period);
for (const expected of [
  'Качество технических данных и поведение',
  'Поведение сегмента vs остальное',
  'Обычный день и пик',
  'Cookies off + нет referrer',
  'mobile/tablet-визитов',
  '14.07.2026',
]) {
  if (!qualityHtml.includes(expected)) throw new Error(`Missing ${expected}: ${qualityHtml}`);
}

console.log('Cookie methodology UI validation passed');
