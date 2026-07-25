#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app-v2.js"
README = ROOT / "README.md"
INDEX = ROOT / "index.html"
VALIDATE = ROOT / ".github" / "workflows" / "validate.yml"
RUNTIME = ROOT / "scripts" / "validate_api_runtime.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing expected block: {label}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_at = text.find(start)
    if start_at < 0:
        raise RuntimeError(f"Missing start marker: {label}")
    end_at = text.find(end, start_at)
    if end_at < 0:
        raise RuntimeError(f"Missing end marker: {label}")
    return text[:start_at] + replacement + text[end_at:]


app = APP.read_text(encoding="utf-8")

snapshot = r'''  function snapshot(slice) {
    if (slice?.precomputedSnapshot) {
      const data = slice.precomputedSnapshot;
      const visits = Number(data.visits) || Math.max(Number(data.tech?.visits) || 0, Number(data.ip?.visits) || 0);
      const rawAutomationVisits = Number(data.automationVisits);
      const automationVisits = Number.isFinite(rawAutomationVisits)
        ? Math.max(0, rawAutomationVisits)
        : data.automation ? 1 : 0;
      const rawAutomationShare = Number(data.automationShare);
      const automationShare = Number.isFinite(rawAutomationShare)
        ? Math.max(0, rawAutomationShare)
        : visits ? automationVisits / visits : 0;
      return { ...data, automationVisits, automationShare, automation: automationVisits > 0 };
    }
    const tech = finishBucket(slice.tech);
    const ip = finishBucket(slice.ip);
    const metrics = tech.visits ? tech : ip;
    const visits = Math.max(tech.visits, ip.visits);
    const topBrowser = topEntry(slice.browsers, tech.visits);
    const topResolution = topEntry(slice.resolutions, tech.visits);
    const topProfile = topEntry(slice.profiles, tech.visits);
    const topIp = topEntry(slice.ips, ip.visits);
    const topSubnet = topEntry(slice.subnets, ip.visits);
    const clientIdVisits = slice.clientIdVisits || 0;
    const uniqueClientIds = slice.clientIds.size;
    const topClientId = topEntry(slice.clientIds, clientIdVisits);
    const top10ClientShare = topShare(slice.clientIds, clientIdVisits, 10);
    const visitsPerClientId = uniqueClientIds ? clientIdVisits / uniqueClientIds : 0;
    const repeatClientVisitShare = clientIdVisits ? Math.max(0, clientIdVisits - uniqueClientIds) / clientIdVisits : 0;
    const clientIdCoverage = tech.visits ? Math.min(1, clientIdVisits / tech.visits) : 0;
    const unknownBrowserVisits = [...slice.browsers.entries()]
      .filter(([key]) => /не определ|unknown|undefined|other|другие/i.test(key))
      .reduce((sum, [, value]) => sum + value, 0);
    const automationVisits = [...slice.browsers.entries()]
      .filter(([key]) => /headless|phantom|selenium|webdriver|playwright|puppeteer/i.test(key))
      .reduce((sum, [, value]) => sum + value, 0);
    return {
      visits, tech, ip, metrics, topBrowser, topResolution, topProfile, topIp, topSubnet,
      clientIdVisits, uniqueClientIds, topClientId, top10ClientShare, visitsPerClientId, repeatClientVisitShare, clientIdCoverage,
      ipv6Share: ip.visits ? slice.ipv6Visits / ip.visits : 0,
      unknownBrowserShare: tech.visits ? unknownBrowserVisits / tech.visits : 0,
      automationVisits,
      automationShare: visits ? automationVisits / visits : 0,
      automation: automationVisits > 0
    };
  }
'''
app = replace_between(app, "  function snapshot(slice) {", "\n\n  function buildBase(sources) {", snapshot, "snapshot")

period_block = r'''  function automationSignal(data) {
    const totalVisits = Math.max(0, Number(data.visits) || 0);
    const automationVisits = Math.max(0, Number(data.automationVisits) || 0);
    const automationShare = Number.isFinite(Number(data.automationShare))
      ? Math.max(0, Number(data.automationShare))
      : totalVisits ? automationVisits / totalVisits : 0;
    if (automationVisits >= 100 && automationShare >= .01) {
      return { points: 28, massive: true, reason: `${formatInt(automationVisits)} automation/headless-визитов (${formatPct(automationShare)})` };
    }
    if (automationVisits >= 20 && automationShare >= .001) {
      return { points: 14, massive: false, reason: `${formatInt(automationVisits)} automation/headless-визитов (${formatPct(automationShare)})` };
    }
    if (automationVisits >= 3 && automationShare >= .0001) {
      return { points: 5, massive: false, reason: `небольшая доля automation/headless-визитов: ${formatInt(automationVisits)} (${formatPct(automationShare, 2)})` };
    }
    return { points: 0, massive: false, reason: '' };
  }

  function capScoreByFamilies(score, families, { massAutomation = false } = {}) {
    const familyCount = families instanceof Set ? families.size : new Set(families || []).size;
    let cap = 100;
    if (familyCount <= 1) cap = massAutomation ? 70 : 40;
    else if (familyCount === 2) cap = 70;
    return Math.min(100, score, cap);
  }

  function scorePeriodSource(source, base) {
    const data = snapshot(source);
    const reasons = [];
    const families = new Set();
    let score = 0;
    const m = data.metrics;
    const addSignal = (points, family, reason) => {
      if (!points) return;
      score += points;
      families.add(family);
      if (reason) reasons.push(reason);
    };

    if (m.bounce >= .78 || m.bounce - base.bounce >= .28) addSignal(24, 'behavior', 'сильно повышенный отказ за период');
    else if (m.bounce >= .62 || m.bounce - base.bounce >= .18) addSignal(16, 'behavior', 'повышенный отказ за период');
    if (m.newShare >= .995) addSignal(9, 'quality', 'практически весь трафик новый');
    if (base.quality > 0 && m.quality < base.quality * .15 && data.visits >= 1500) addSignal(7, 'quality', 'почти нет качественных конверсий');
    if (base.primary > 0 && m.primary > base.primary * 4 && data.visits >= 500) addSignal(9, 'quality', 'аномально высокая первичная конверсия');

    const automation = automationSignal(data);
    addSignal(automation.points, 'technical', automation.reason);
    if (data.unknownBrowserShare >= .4) addSignal(15, 'technical', 'высокая доля неизвестных браузеров');
    else if (data.unknownBrowserShare >= .15) addSignal(7, 'technical', 'повышенная доля неизвестных браузеров');
    if (data.concentrationScope !== 'daily' && data.topProfile.share >= .7 && data.tech.visits >= 500) addSignal(19, 'technical', 'один технический профиль доминирует');
    else if (data.concentrationScope !== 'daily' && data.topProfile.share >= .45 && data.tech.visits >= 500) addSignal(11, 'technical', 'концентрация технического профиля');

    let networkScore = 0;
    let networkReason = '';
    if (data.concentrationScope !== 'daily' && data.topIp.share >= .2 && data.ip.visits >= 200) {
      networkScore = 24;
      networkReason = 'высокая концентрация одного IP';
    } else if (data.concentrationScope !== 'daily' && data.topIp.share >= .08 && data.ip.visits >= 200) {
      networkScore = 13;
      networkReason = 'концентрация одного IP';
    }
    if (data.concentrationScope !== 'daily' && data.topSubnet.share >= .35 && data.ip.visits >= 500 && 22 > networkScore) {
      networkScore = 22;
      networkReason = 'высокая концентрация подсети';
    } else if (data.concentrationScope !== 'daily' && data.topSubnet.share >= .18 && data.ip.visits >= 500 && 14 > networkScore) {
      networkScore = 14;
      networkReason = 'концентрация подсети';
    }
    addSignal(networkScore, 'network', networkReason);

    let clientIdScore = 0;
    const clientReasons = [];
    const enoughClientIds = data.concentrationScope !== 'daily' && data.clientIdVisits >= 300 && data.clientIdCoverage >= .5 && data.uniqueClientIds >= 20;
    if (enoughClientIds) {
      if (data.topClientId.share >= .3 && data.topClientId.value >= 100) { clientIdScore += 18; clientReasons.push(`один ClientID дал ${formatPct(data.topClientId.share)} визитов за период`); }
      else if (data.topClientId.share >= .15 && data.topClientId.value >= 50) { clientIdScore += 10; clientReasons.push('повышенная концентрация одного ClientID'); }
      if (data.top10ClientShare >= .8) { clientIdScore += 14; clientReasons.push(`топ-10 ClientID дали ${formatPct(data.top10ClientShare)} визитов`); }
      else if (data.top10ClientShare >= .6) { clientIdScore += 8; clientReasons.push('повышенная концентрация топ-10 ClientID'); }
      if (data.visitsPerClientId >= 12) { clientIdScore += 14; clientReasons.push(`в среднем ${data.visitsPerClientId.toFixed(1)} визита на ClientID`); }
      else if (data.visitsPerClientId >= 6) { clientIdScore += 8; clientReasons.push('много повторных визитов на один ClientID'); }
    }
    if (clientIdScore > 0) {
      score += Math.min(28, clientIdScore);
      families.add('identity');
      reasons.push(...clientReasons);
    }

    if (data.visits < 100) score = Math.min(score, 24);
    else if (data.visits < 500) score = Math.min(score, 44);
    score = capScoreByFamilies(score, families, { massAutomation: automation.massive });
    return {
      ...data,
      score: Math.min(100, Math.round(score)),
      reasons,
      families: [...families],
      massAutomation: automation.massive
    };
  }
'''
app = replace_between(app, "  function scorePeriodSource(source, base) {", "\n\n  function scoreDailyDays(source) {", period_block, "period score")

daily = r'''  function scoreDailyDays(source) {
    const rawDays = [...source.days.values()]
      .map((day) => ({ source: source.name, date: day.date, ...snapshot(day) }))
      .filter((day) => day.visits > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    return rawDays.map((day) => {
      const others = rawDays.filter((candidate) => candidate.date !== day.date);
      const sample = (getter) => others.map(getter).filter(Number.isFinite);
      const clientPeers = others.filter((item) => item.clientIdVisits >= 100 && item.clientIdCoverage >= .5 && item.uniqueClientIds >= 10);
      const clientSample = (getter) => clientPeers.map(getter).filter(Number.isFinite);
      const baseline = {
        visits: median(sample((item) => item.visits)),
        bounce: median(sample((item) => item.metrics.bounce)),
        time: median(sample((item) => item.metrics.time)),
        newShare: median(sample((item) => item.metrics.newShare)),
        quality: median(sample((item) => item.metrics.quality)),
        primary: median(sample((item) => item.metrics.primary)),
        topIp: median(sample((item) => item.topIp.share)),
        topSubnet: median(sample((item) => item.topSubnet.share)),
        topProfile: median(sample((item) => item.topProfile.share)),
        unknownBrowser: median(sample((item) => item.unknownBrowserShare)),
        clientIdVisits: median(clientSample((item) => item.clientIdVisits)),
        uniqueClientIds: median(clientSample((item) => item.uniqueClientIds)),
        topClientId: median(clientSample((item) => item.topClientId.share)),
        top10ClientShare: median(clientSample((item) => item.top10ClientShare)),
        visitsPerClientId: median(clientSample((item) => item.visitsPerClientId))
      };

      const reasons = [];
      const families = new Set();
      let score = 0;
      let massAutomation = false;
      const addSignal = (points, family, reason) => {
        if (!points) return;
        score += points;
        families.add(family);
        if (reason) reasons.push(reason);
      };
      const enoughDays = others.length >= 4;
      const minimumVisits = Math.max(50, baseline.visits * .12);
      const enoughVolume = day.visits >= minimumVisits;
      const ratio = (value, reference) => reference > 0 ? value / reference : 0;

      if (enoughDays && enoughVolume) {
        const visitRatio = ratio(day.visits, baseline.visits);
        const visitZ = robustZ(day.visits, sample((item) => item.visits), 10);
        if (visitRatio >= 2.5 && visitZ >= 3) addSignal(22, 'volume', `всплеск объёма: ×${visitRatio.toFixed(1)} к обычному дню`);
        else if (visitRatio >= 1.8 && visitZ >= 2.5) addSignal(13, 'volume', `повышенный объём: ×${visitRatio.toFixed(1)}`);

        const bounceSample = sample((item) => item.metrics.bounce);
        const bounceDiff = day.metrics.bounce - baseline.bounce;
        const bounceZ = robustZ(day.metrics.bounce, bounceSample, .02);
        const enoughBounceVolume = day.visits >= Math.max(100, baseline.visits * .15);
        if (bounceDiff >= .2 && bounceZ >= 2.5) addSignal(22, 'behavior', `отказы выше медианы на ${formatPct(bounceDiff)}`);
        else if (bounceDiff >= .12 && bounceZ >= 2.5) addSignal(15, 'behavior', `скачок отказов на ${formatPct(bounceDiff)}`);

        const bounceDrop = baseline.bounce - day.metrics.bounce;
        if (enoughBounceVolume && baseline.bounce >= .08 && bounceDrop >= .2 && bounceZ >= 3.5) {
          addSignal(6, 'behavior', `аномально низкие отказы как слабый подтверждающий сигнал: ${formatPct(day.metrics.bounce)} против ${formatPct(baseline.bounce)}`);
        } else if (enoughBounceVolume && baseline.bounce >= .08 && bounceDrop >= .12 && bounceZ >= 3) {
          addSignal(4, 'behavior', `низкие отказы как слабый подтверждающий сигнал: ниже медианы на ${formatPct(bounceDrop)}`);
        }

        const timeSample = sample((item) => item.metrics.time).filter((value) => value > 0);
        const timeRatio = ratio(day.metrics.time, baseline.time);
        const timeZ = robustZ(day.metrics.time, timeSample, 8);
        const enoughTimeHistory = timeSample.length >= 6;
        const enoughTimeVolume = day.visits >= Math.max(100, baseline.visits * .15);
        if (enoughTimeHistory && enoughTimeVolume && day.metrics.time > 0 && baseline.time >= 30 && timeRatio <= .45 && timeZ >= 3.5) {
          addSignal(24, 'behavior', `среднее время ${formatDuration(day.metrics.time)} против медианы ${formatDuration(baseline.time)} (${Math.round(timeRatio * 100)}% обычного)`);
        } else if (enoughTimeHistory && enoughTimeVolume && day.metrics.time > 0 && baseline.time >= 30 && timeRatio <= .6 && timeZ >= 3) {
          addSignal(14, 'behavior', `сильное падение среднего времени: ${Math.round(timeRatio * 100)}% медианы площадки`);
        } else if (enoughTimeHistory && enoughTimeVolume && day.metrics.time >= 600 && baseline.time >= 30 && timeRatio >= 3 && timeZ >= 3.5) {
          addSignal(24, 'behavior', `подозрительно высокое среднее время: ${formatDuration(day.metrics.time)} против медианы ${formatDuration(baseline.time)}`);
        } else if (enoughTimeHistory && enoughTimeVolume && day.metrics.time >= 300 && baseline.time >= 30 && timeRatio >= 2 && timeZ >= 3) {
          addSignal(14, 'behavior', `среднее время аномально выше медианы: ×${timeRatio.toFixed(1)}`);
        }

        const newDiff = day.metrics.newShare - baseline.newShare;
        if (newDiff >= .08 && robustZ(day.metrics.newShare, sample((item) => item.metrics.newShare), .015) >= 2.5) addSignal(8, 'quality', 'резкий рост доли новых посетителей');
        if (baseline.quality > 0 && day.metrics.quality <= baseline.quality * .25 && day.visits >= 300) addSignal(7, 'quality', 'качественные конверсии резко ниже обычного');
        if (baseline.primary > 0 && day.metrics.primary >= baseline.primary * 4 && day.visits >= 200) addSignal(7, 'quality', 'первичная конверсия резко выше обычного');

        let networkScore = 0;
        let networkReason = '';
        const ipDiff = day.topIp.share - baseline.topIp;
        if (day.topIp.share >= .2 && ipDiff >= .1) {
          networkScore = 20;
          networkReason = `один IP дал ${formatPct(day.topIp.share)} дневного трафика`;
        } else if (day.topIp.share >= .08 && robustZ(day.topIp.share, sample((item) => item.topIp.share), .02) >= 3) {
          networkScore = 11;
          networkReason = 'однодневный рост концентрации IP';
        }
        const subnetDiff = day.topSubnet.share - baseline.topSubnet;
        if (day.topSubnet.share >= .35 && subnetDiff >= .15 && 20 > networkScore) {
          networkScore = 20;
          networkReason = `одна подсеть дала ${formatPct(day.topSubnet.share)} трафика`;
        } else if (day.topSubnet.share >= .18 && robustZ(day.topSubnet.share, sample((item) => item.topSubnet.share), .025) >= 3 && 12 > networkScore) {
          networkScore = 12;
          networkReason = 'однодневный рост концентрации подсети';
        }
        addSignal(networkScore, 'network', networkReason);

        const profileDiff = day.topProfile.share - baseline.topProfile;
        if (day.topProfile.share >= .7 && profileDiff >= .15) addSignal(19, 'technical', `техпрофиль занял ${formatPct(day.topProfile.share)} трафика`);
        else if (day.topProfile.share >= .45 && robustZ(day.topProfile.share, sample((item) => item.topProfile.share), .025) >= 3) addSignal(11, 'technical', 'однодневная концентрация техпрофиля');

        let clientIdScore = 0;
        const clientReasons = [];
        const enoughClientHistory = clientPeers.length >= 6;
        const enoughClientVolume = day.clientIdVisits >= Math.max(200, baseline.clientIdVisits * .15) && day.clientIdCoverage >= .5 && day.uniqueClientIds >= 10;
        if (enoughClientHistory && enoughClientVolume) {
          const topClientDiff = day.topClientId.share - baseline.topClientId;
          const topClientZ = robustZ(day.topClientId.share, clientSample((item) => item.topClientId.share), .02);
          if (day.topClientId.share >= .25 && topClientDiff >= .12 && topClientZ >= 3.5 && day.topClientId.value >= 50) { clientIdScore += 18; clientReasons.push(`один ClientID дал ${formatPct(day.topClientId.share)} визитов в этот день`); }
          else if (day.topClientId.share >= .12 && topClientDiff >= .06 && topClientZ >= 3) { clientIdScore += 10; clientReasons.push('однодневный рост концентрации одного ClientID'); }
          const top10Diff = day.top10ClientShare - baseline.top10ClientShare;
          const top10Z = robustZ(day.top10ClientShare, clientSample((item) => item.top10ClientShare), .03);
          if (day.top10ClientShare >= .75 && top10Diff >= .2 && top10Z >= 3.5) { clientIdScore += 14; clientReasons.push(`топ-10 ClientID дали ${formatPct(day.top10ClientShare)} дневных визитов`); }
          else if (day.top10ClientShare >= .55 && top10Diff >= .12 && top10Z >= 3) { clientIdScore += 8; clientReasons.push('аномальная концентрация топ-10 ClientID'); }
          const visitsPerClientRatio = ratio(day.visitsPerClientId, baseline.visitsPerClientId);
          const visitsPerClientZ = robustZ(day.visitsPerClientId, clientSample((item) => item.visitsPerClientId), .5);
          if (day.visitsPerClientId >= 8 && visitsPerClientRatio >= 2.5 && visitsPerClientZ >= 3.5) { clientIdScore += 16; clientReasons.push(`аномально много повторов: ${day.visitsPerClientId.toFixed(1)} визита на ClientID`); }
          else if (day.visitsPerClientId >= 5 && visitsPerClientRatio >= 1.8 && visitsPerClientZ >= 3) { clientIdScore += 9; clientReasons.push('рост повторных визитов на ClientID'); }
        }
        if (clientIdScore > 0) {
          score += Math.min(28, clientIdScore);
          families.add('identity');
          reasons.push(...clientReasons);
        }

        const automation = automationSignal(day);
        massAutomation = automation.massive;
        addSignal(automation.points, 'technical', automation.reason);
        const unknownDiff = day.unknownBrowserShare - baseline.unknownBrowser;
        if (day.unknownBrowserShare >= .35 && unknownDiff >= .15) addSignal(14, 'technical', 'резкий рост неизвестных браузеров');
      }

      let confidence = 'Высокая';
      const coverage = Math.max(day.tech.visits, day.ip.visits) ? Math.min(day.tech.visits, day.ip.visits) / Math.max(day.tech.visits, day.ip.visits) : 0;
      const clientCoverage = Number(day.clientIdCoverage) || 0;
      if (!enoughDays || day.visits < 100 || !day.tech.visits || !day.ip.visits || clientCoverage < .35) confidence = 'Низкая';
      else if (others.length < 8 || day.visits < 500 || coverage < .65 || clientCoverage < .65) confidence = 'Средняя';

      if (!enoughDays || day.visits < 50) score = Math.min(score, 24);
      else if (day.visits < 100) score = Math.min(score, 44);
      score = capScoreByFamilies(score, families, { massAutomation });
      score = Math.min(100, Math.round(score));
      const risk = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';

      return {
        ...day,
        baseline,
        score,
        risk,
        confidence,
        reasons: [...new Set(reasons)],
        families: [...families],
        massAutomation,
        flaggedVisits: risk === 'low'
          ? 0
          : day.visitRisk
            ? Math.min(day.visits, Number(day.visitRisk.suspiciousVisits) || 0)
            : day.visits,
        month: day.date.slice(0, 7)
      };
    });
  }
'''
app = replace_between(app, "  function scoreDailyDays(source) {", "\n\n  function combineSource(source, base) {", daily, "daily score")

combine = r'''  function combineSource(source, base) {
    const period = scorePeriodSource(source, base);
    const days = scoreDailyDays(source);
    const anomalousDays = days.filter((day) => day.risk !== 'low').sort((a, b) => b.score - a.score || b.visits - a.visits);
    const maxDaily = anomalousDays[0]?.score || 0;
    let score = Math.max(period.score, maxDaily);
    if (anomalousDays.length >= 2) score = Math.min(100, score + Math.min(10, anomalousDays.length * 2));
    const families = new Set(period.families || []);
    for (const day of days) {
      if (day.score <= 0) continue;
      for (const family of day.families || []) families.add(family);
    }
    const massAutomation = Boolean(period.massAutomation || days.some((day) => day.massAutomation));
    score = Math.round(capScoreByFamilies(score, families, { massAutomation }));
    const risk = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
    const reasons = [...period.reasons];
    if (anomalousDays.length) reasons.unshift(`${anomalousDays.length} ${plural(anomalousDays.length, 'аномальный день', 'аномальных дня', 'аномальных дней')}; максимум ${anomalousDays[0].score}/100`);
    let confidence = 'Высокая';
    const clientCoverage = Number(period.clientIdCoverage) || 0;
    if (period.visits < 500 || days.length < 5 || !period.tech.visits || !period.ip.visits || clientCoverage < .35) confidence = 'Низкая';
    else if (period.visits < 3000 || days.length < 9 || clientCoverage < .65) confidence = 'Средняя';
    const action = risk === 'high'
      ? 'Сначала проверить отмеченные даты и кластеры внутри них. Запросить детализацию у площадки, не отключая весь источник автоматически.'
      : risk === 'medium'
        ? 'Сопоставить аномальные даты с размещениями, SSP, приложениями и изменениями кампании. Источник целиком пока не отключать.'
        : 'Оставить источник в мониторинге; новые дни будут сравниваться с его собственной устойчивой базой.';
    return {
      name: source.name,
      ...period,
      score,
      risk,
      confidence,
      reasons: [...new Set(reasons)],
      families: [...families],
      massAutomation,
      action,
      days,
      anomalousDays
    };
  }
'''
app = replace_between(app, "  function combineSource(source, base) {", "\n\n  function buildMonthly(dailyResults) {", combine, "combine source")

aggregate = r'''  function aggregateApiSnapshots(rows) {
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const visits = rows.reduce((sum, row) => sum + number(row.visits), 0);
    const techVisits = rows.reduce((sum, row) => sum + number(row.tech?.visits || row.visits), 0);
    const ipVisits = rows.reduce((sum, row) => sum + number(row.ip?.visits || row.visits), 0);
    const users = rows.reduce((sum, row) => sum + number(row.metrics?.users || row.visits), 0);
    const weighted = (getter, weightGetter = (row) => number(row.visits)) => {
      let total = 0;
      let weight = 0;
      for (const row of rows) {
        const rowWeight = weightGetter(row);
        total += number(getter(row)) * rowWeight;
        weight += rowWeight;
      }
      return weight ? total / weight : 0;
    };
    const metrics = {
      visits,
      users,
      bounce: weighted((row) => row.metrics?.bounce),
      time: weighted((row) => row.metrics?.time),
      newShare: weighted((row) => row.metrics?.newShare, (row) => number(row.metrics?.users || row.visits)),
      quality: weighted((row) => row.metrics?.quality),
      primary: weighted((row) => row.metrics?.primary)
    };
    const clientIdVisits = rows.reduce((sum, row) => sum + number(row.clientIdVisits), 0);
    const uniqueClientIds = Math.max(0, ...rows.map((row) => number(row.uniqueClientIds)));
    const automationVisits = rows.reduce((sum, row) => {
      const explicit = Number(row.automationVisits);
      return sum + (Number.isFinite(explicit) ? Math.max(0, explicit) : row.automation ? 1 : 0);
    }, 0);
    return {
      visits,
      tech: { ...metrics, visits: techVisits },
      ip: { ...metrics, visits: ipVisits },
      metrics,
      topBrowser: maxShareEntry(rows, 'topBrowser'),
      topResolution: maxShareEntry(rows, 'topResolution'),
      topProfile: maxShareEntry(rows, 'topProfile'),
      topIp: maxShareEntry(rows, 'topIp'),
      topSubnet: maxShareEntry(rows, 'topSubnet'),
      clientIdVisits,
      uniqueClientIds,
      topClientId: maxShareEntry(rows, 'topClientId'),
      top10ClientShare: Math.max(0, ...rows.map((row) => number(row.top10ClientShare))),
      visitsPerClientId: Math.max(0, ...rows.map((row) => number(row.visitsPerClientId))),
      repeatClientVisitShare: weighted((row) => row.repeatClientVisitShare, (row) => number(row.clientIdVisits)),
      clientIdCoverage: techVisits ? Math.min(1, clientIdVisits / techVisits) : 0,
      ipv6Share: weighted((row) => row.ipv6Share, (row) => number(row.ip?.visits || row.visits)),
      unknownBrowserShare: weighted((row) => row.unknownBrowserShare, (row) => number(row.tech?.visits || row.visits)),
      cookieEnabledShare: weighted((row) => row.cookieEnabledShare),
      visitRisk: aggregateVisitRisk(rows),
      automationVisits,
      automationShare: visits ? automationVisits / visits : 0,
      automation: automationVisits > 0,
      concentrationScope: 'daily',
      dataSource: 'yandex-metrica-logs-api'
    };
  }
'''
app = replace_between(app, "  function aggregateApiSnapshots(rows) {", "\n\n  function buildApiSources(rows) {", aggregate, "API aggregate")
APP.write_text(app, encoding="utf-8")

readme = README.read_text(encoding="utf-8")
readme = replace_once(readme, "## Что умеет версия 0.7", "## Что умеет версия 0.8", "README version")
readme = replace_once(
    readme,
    "- рассчитывает дневной risk score от 0 до 100 и уверенность оценки;\n",
    "- рассчитывает дневной risk score от 0 до 100 и уверенность оценки;\n"
    "- учитывает количество и долю automation/headless-визитов, а не единичный факт их появления;\n"
    "- считает IP и подсеть одним сетевым семейством и не начисляет двойной штраф за один кластер;\n"
    "- ограничивает итоговый score, если сработало только одно или два независимых семейства признаков;\n"
    "- использует низкий bounce только как слабый подтверждающий сигнал;\n"
    "- использует покрытие ClientID для уверенности оценки, но не как самостоятельный фрод-штраф;\n",
    "README stage 1 bullets",
)
README.write_text(readme, encoding="utf-8")

index = INDEX.read_text(encoding="utf-8")
index = replace_once(
    index,
    "          <span>Медиана + MAD</span>\n",
    "          <span>Медиана + MAD</span>\n          <span>Объёмная значимость сигналов</span>\n          <span>Мультисигнальный score</span>\n",
    "hero scoring chips",
)
INDEX.write_text(index, encoding="utf-8")

runtime = RUNTIME.read_text(encoding="utf-8")
runtime = replace_once(
    runtime,
    "      automation: false,\n",
    "      automationVisits: source === 'stable_source' && day === 1 ? 1 : 0,\n"
    "      automationShare: source === 'stable_source' && day === 1 ? 1 / visits : 0,\n"
    "      automation: source === 'stable_source' && day === 1,\n",
    "runtime automation fixture",
)
RUNTIME.write_text(runtime, encoding="utf-8")

validate = VALIDATE.read_text(encoding="utf-8")
validate = replace_once(validate, 'grep -q "Что умеет версия 0.7" README.md', 'grep -q "Что умеет версия 0.8" README.md', "validate version")
validate = replace_once(
    validate,
    "          grep -q \"score += Math.min(28, clientIdScore)\" assets/app-v2.js\n",
    "          grep -q \"score += Math.min(28, clientIdScore)\" assets/app-v2.js\n"
    "          grep -q \"function automationSignal\" assets/app-v2.js\n"
    "          grep -q \"function capScoreByFamilies\" assets/app-v2.js\n"
    "          grep -q \"automationVisits\" assets/app-v2.js\n"
    "          grep -q \"аномально низкие отказы как слабый подтверждающий сигнал\" assets/app-v2.js\n"
    "          grep -q \"addSignal(networkScore, 'network'\" assets/app-v2.js\n"
    "          grep -q \"clientCoverage < .35\" assets/app-v2.js\n"
    "          grep -q \"Объёмная значимость сигналов\" index.html\n"
    "          grep -q \"Мультисигнальный score\" index.html\n",
    "validate stage 1",
)
VALIDATE.write_text(validate, encoding="utf-8")
print("Applied scoring stage 1 UI changes")
