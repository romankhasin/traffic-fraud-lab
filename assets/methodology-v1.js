(() => {
  'use strict';

  const CONFIG = Object.freeze({
    minimumPercentVisits: 30,
    minimumBehaviorVisits: 100,
    minimumConcentrationVisits: 500,
    minimumClientIdVisits: 100,
    minimumUniqueClientIds: 100,
    minimumBaselineDays: 4,
    cookieOffLimit: 0.15,
    topIpShare: 0.03,
    topSubnetShare: 0.08,
    topResolutionShare: 0.25,
    browserMedianMultiplier: 1.7,
    osMedianMultiplier: 1.7,
    bounceDelta: 0.20,
    timeRatio: 0.60,
    visitsPerClientHigh: 1.8,
    visitsPerClientChurn: 1.02,
    fastGoal3Share: 0.60,
    multiGoalShare: 0.40
  });

  const FAMILY_ORDER = ['identity', 'technical', 'behavior', 'conversion'];
  const FAMILY_LABELS = Object.freeze({
    identity: 'Идентификаторы и сети',
    technical: 'Техническая однородность',
    behavior: 'Поведение',
    conversion: 'Конверсионный паттерн'
  });
  const VERDICTS = Object.freeze([
    { key: 'normal', label: 'Норма', action: 'Ничего не отключать. Продолжить обычный мониторинг.' },
    { key: 'observe', label: 'Наблюдать', action: 'Зафиксировать источник и вернуться к нему после накопления новых дней.' },
    { key: 'check', label: 'Проверить', action: 'Запросить у площадки детализацию по отмеченным датам и подразмещениям.' },
    { key: 'limit', label: 'Ограничить', action: 'Рассмотреть сокращение бюджета после ручной проверки. Автоматически источник не отключать.' }
  ]);

  const cache = {
    periodPayloads: [],
    slicePayloads: [],
    lastModel: null,
    originalFetch: window.fetch.bind(window),
    originalAnalyze: window.FraudLab?.analyzeApiRows?.bind(window.FraudLab) || null
  };

  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, number(value)));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));
  const formatInt = (value) => Math.round(number(value)).toLocaleString('ru-RU');
  const formatPct = (value, digits = 1) => `${(number(value) * 100).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`;
  const formatDecimal = (value, digits = 2) => number(value).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
  const formatDuration = (value) => {
    const seconds = Math.max(0, Math.round(number(value)));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
  };
  const formatDate = (value) => {
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(value || '—');
  };
  const median = (values) => {
    const safe = values.map(number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!safe.length) return 0;
    const middle = Math.floor(safe.length / 2);
    return safe.length % 2 ? safe[middle] : (safe[middle - 1] + safe[middle]) / 2;
  };
  const quantile = (values, q) => {
    const safe = values.map(number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!safe.length) return 0;
    return safe[Math.min(safe.length - 1, Math.max(0, Math.floor((safe.length - 1) * q)))];
  };
  const ratio = (value, base) => number(base) > 0 ? number(value) / number(base) : 0;
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const verdictFromLevel = (level) => VERDICTS[Math.max(0, Math.min(3, Math.round(number(level))))];

  function captureFetch() {
    window.fetch = async (...args) => {
      const response = await cache.originalFetch(...args);
      const url = String(args[0]?.url || args[0] || '');
      if (response.ok && (url.includes('/clientid-periods/') || url.includes('/slices/'))) {
        try {
          const payload = await response.clone().json();
          const target = url.includes('/clientid-periods/') ? cache.periodPayloads : cache.slicePayloads;
          target.push({ url, payload, capturedAt: Date.now() });
          if (target.length > 20) target.splice(0, target.length - 20);
        } catch (_) {}
      }
      return response;
    };
  }

  function selectedRange() {
    return {
      from: document.querySelector('#api-date-from')?.value || '',
      to: document.querySelector('#api-date-to')?.value || ''
    };
  }

  function counterNames(rows) {
    const map = new Map();
    for (const row of rows || []) {
      if (row.counterId != null) map.set(String(row.counterId), String(row.counterName || row.counterId));
    }
    return map;
  }

  function periodSummaryMap(rows, to) {
    const counters = counterNames(rows);
    const multipleCounters = counters.size > 1;
    const result = new Map();
    for (const item of cache.periodPayloads) {
      const payload = item.payload || {};
      const range = payload.ranges?.[to];
      if (!range) continue;
      const counterId = String(payload.counterId ?? '');
      const suffix = counters.get(counterId) || '';
      for (const [source, summary] of Object.entries(range)) {
        const key = multipleCounters && suffix ? `${source} · ${suffix}` : source;
        result.set(key, summary);
      }
    }
    return result;
  }

  function sliceDailyMap(rows, from, to) {
    const counters = counterNames(rows);
    const multipleCounters = counters.size > 1;
    const totals = new Map(rows.map((row) => [`${row.source}\u0000${row.date}`, number(row.visits)]));
    const result = new Map();
    for (const item of cache.slicePayloads) {
      const payload = item.payload || {};
      const counterId = String(payload.counterId ?? '');
      const suffix = counters.get(counterId) || '';
      for (const group of payload.groups || []) {
        if (!['os', 'browser', 'resolution'].includes(group.dimension)) continue;
        const source = multipleCounters && suffix ? `${group.source} · ${suffix}` : group.source;
        for (const day of group.days || []) {
          const date = String(day?.[0] || '');
          if (!date || date < from || date > to) continue;
          const visits = number(day?.[1]);
          const key = `${source}\u0000${date}`;
          const total = totals.get(key) || 0;
          if (!result.has(key)) result.set(key, {});
          const current = result.get(key)[group.dimension];
          if (!current || visits > current.value) {
            result.get(key)[group.dimension] = {
              key: String(group.value || '—'), value: visits, share: total ? visits / total : 0
            };
          }
        }
      }
    }
    return result;
  }

  function baselineFor(day, peers, projectPeers, sliceMap) {
    const validPeers = peers.filter((candidate) => candidate.date !== day.date);
    const projectDayPeers = projectPeers.filter((candidate) => candidate.date === day.date && candidate.source !== day.source);
    const choose = (getter, minimum = CONFIG.minimumBaselineDays) => {
      const own = validPeers.map(getter).map(number).filter(Number.isFinite);
      if (own.length >= minimum) return { value: median(own), basis: 'собственная история', days: own.length };
      const project = projectDayPeers.map(getter).map(number).filter(Number.isFinite);
      return { value: median(project), basis: 'сопоставимые источники дня', days: project.length };
    };
    const slice = (row, dimension) => sliceMap.get(`${row.source}\u0000${row.date}`)?.[dimension]?.share || 0;
    return {
      visits: choose((row) => row.visits),
      bounce: choose((row) => row.metrics?.bounce),
      time: choose((row) => row.metrics?.time),
      visitsPerClientId: choose((row) => row.visitsPerClientId),
      topBrowser: choose((row) => row.topBrowser?.share),
      topResolution: choose((row) => row.topResolution?.share),
      topOs: choose((row) => slice(row, 'os')),
      cookieEnabled: choose((row) => row.cookieEnabledShare)
    };
  }

  function family(status, reasons = [], note = '') {
    return { status, triggered: status === 'triggered', available: status !== 'na', reasons: unique(reasons), note };
  }

  function evaluateIdentity(day, base) {
    const visits = number(day.visits);
    const cookieOff = 1 - clamp(day.cookieEnabledShare, 0, 1);
    const networkAvailable = visits >= CONFIG.minimumConcentrationVisits;
    const clientAvailable = (
      cookieOff <= CONFIG.cookieOffLimit
      && number(day.clientIdCoverage) >= 0.5
      && number(day.clientIdVisits) >= CONFIG.minimumClientIdVisits
      && number(day.uniqueClientIds) >= CONFIG.minimumUniqueClientIds
    );
    const reasons = [];
    if (networkAvailable && number(day.topIp?.share) > CONFIG.topIpShare) {
      reasons.push(`топ-IP: ${formatInt(day.topIp?.value)} из ${formatInt(visits)} визитов (${formatPct(day.topIp?.share)})`);
    }
    if (networkAvailable && number(day.topSubnet?.share) > CONFIG.topSubnetShare) {
      reasons.push(`топ-/24 или /64: ${formatInt(day.topSubnet?.value)} из ${formatInt(visits)} визитов (${formatPct(day.topSubnet?.share)})`);
    }
    if (clientAvailable) {
      const average = number(day.visitsPerClientId);
      if (average > CONFIG.visitsPerClientHigh) {
        reasons.push(`в среднем ${formatDecimal(average)} визита на ClientID при ${formatInt(day.uniqueClientIds)} уникальных ID`);
      }
      if (number(day.topClientId?.value) > Math.max(15 * average, 15)) {
        reasons.push(`максимум ${formatInt(day.topClientId?.value)} визитов с одного ClientID — более чем в 15 раз выше среднего`);
      }
      const ownBase = number(base.visitsPerClientId.value);
      const volumeRatio = ratio(visits, base.visits.value);
      if (average < CONFIG.visitsPerClientChurn && ownBase >= 1.05 && volumeRatio >= 1.5) {
        reasons.push(`повторность упала до ${formatDecimal(average, 3)} визита на ClientID при росте объёма ×${formatDecimal(volumeRatio, 1)}`);
      }
    }
    if (!networkAvailable && !clientAvailable) {
      const limitations = [];
      if (visits < CONFIG.minimumConcentrationVisits) limitations.push(`для концентраций нужно ≥ ${formatInt(CONFIG.minimumConcentrationVisits)} визитов`);
      if (cookieOff > CONFIG.cookieOffLimit) limitations.push(`cookies off: ${formatPct(cookieOff)} > ${formatPct(CONFIG.cookieOffLimit, 0)}`);
      else limitations.push(`ClientID: покрытие ${formatPct(day.clientIdCoverage)}, ${formatInt(day.uniqueClientIds)} уникальных`);
      return family('na', [], limitations.join(' · '));
    }
    return family(reasons.length ? 'triggered' : 'clean', reasons,
      clientAvailable ? `ClientID репрезентативен; cookies off ${formatPct(cookieOff)}` : `ClientID ограничен; сетевые концентрации проверены`);
  }

  function evaluateTechnical(day, base, sliceMap) {
    const visits = number(day.visits);
    if (visits < CONFIG.minimumConcentrationVisits) {
      return family('na', [], `для дневной концентрации нужно ≥ ${formatInt(CONFIG.minimumConcentrationVisits)} визитов`);
    }
    const reasons = [];
    const browserBase = number(base.topBrowser.value);
    const resolutionBase = number(base.topResolution.value);
    const os = sliceMap.get(`${day.source}\u0000${day.date}`)?.os || null;
    const osBase = number(base.topOs.value);
    if (browserBase > 0 && number(day.topBrowser?.share) > CONFIG.browserMedianMultiplier * browserBase) {
      reasons.push(`${day.topBrowser?.key || 'топ браузер+версия'}: ${formatInt(day.topBrowser?.value)} из ${formatInt(visits)} (${formatPct(day.topBrowser?.share)}) против медианы ${formatPct(browserBase)}`);
    }
    if (number(day.topResolution?.share) > CONFIG.topResolutionShare) {
      reasons.push(`${day.topResolution?.key || 'топ-разрешение'}: ${formatInt(day.topResolution?.value)} из ${formatInt(visits)} (${formatPct(day.topResolution?.share)})`);
    }
    if (os && osBase > 0 && number(os.share) > CONFIG.osMedianMultiplier * osBase) {
      reasons.push(`${os.key}: ${formatInt(os.value)} из ${formatInt(visits)} (${formatPct(os.share)}) против медианы ${formatPct(osBase)}`);
    }
    if (number(day.automationShare) >= 0.05 && number(day.automationVisits) >= 20) {
      reasons.push(`automation/headless: ${formatInt(day.automationVisits)} из ${formatInt(visits)} (${formatPct(day.automationShare)})`);
    }
    return family(reasons.length ? 'triggered' : 'clean', reasons,
      `проверены браузер+версия и разрешение${os ? ', ОС' : ''}; база — ${base.topBrowser.basis}`);
  }

  function evaluateBehavior(day, base) {
    const visits = number(day.visits);
    const historyAvailable = base.bounce.days >= CONFIG.minimumBaselineDays && base.time.days >= CONFIG.minimumBaselineDays;
    if (visits < CONFIG.minimumBehaviorVisits || !historyAvailable) {
      return family('na', [], visits < CONFIG.minimumBehaviorVisits
        ? `для поведения нужно ≥ ${formatInt(CONFIG.minimumBehaviorVisits)} визитов`
        : `нужно минимум ${CONFIG.minimumBaselineDays} сравнительных дня`);
    }
    const bounce = number(day.metrics?.bounce);
    const time = number(day.metrics?.time);
    const bounceBase = number(base.bounce.value);
    const timeBase = number(base.time.value);
    const bounceDelta = bounce - bounceBase;
    const timeRatio = ratio(time, timeBase);
    const candidates = [];
    if (bounceDelta > CONFIG.bounceDelta) {
      candidates.push({ severity: bounceDelta / CONFIG.bounceDelta, reason: `отказы ${formatPct(bounce)} против медианы ${formatPct(bounceBase)} (+${formatPct(bounceDelta)})` });
    }
    if (timeBase > 0 && timeRatio < CONFIG.timeRatio) {
      candidates.push({ severity: CONFIG.timeRatio / Math.max(timeRatio, 0.01), reason: `время ${formatDuration(time)} против медианы ${formatDuration(timeBase)} (${Math.round(timeRatio * 100)}% базы)` });
    }
    candidates.sort((a, b) => b.severity - a.severity);
    const chosen = candidates[0];
    return family(chosen ? 'triggered' : 'clean', chosen ? [chosen.reason] : [],
      `отказы и время считаются одним семейством; база — ${base.bounce.basis}`);
  }

  function dailyConversionFields(day) {
    const pick = (...names) => names.map((name) => day?.[name]).find((value) => value != null);
    return {
      fast3Visits: number(pick('fastAnyGoal3Visits', 'fastGoal3Visits')),
      fast3Share: number(pick('fastAnyGoal3Share', 'fastGoal3Share')),
      multiVisits: number(pick('multiGoalVisits')),
      multiShare: number(pick('multiGoalShare')),
      hasData: ['fastAnyGoal3Visits', 'fastAnyGoal3Share', 'multiGoalVisits', 'multiGoalShare'].some((name) => day?.[name] != null)
    };
  }

  function evaluateConversion(day) {
    const data = dailyConversionFields(day);
    if (!data.hasData || number(day.visits) < CONFIG.minimumPercentVisits) {
      return { family: family('na', [], data.hasData ? `для процентов нужно ≥ ${CONFIG.minimumPercentVisits} визитов` : 'дневные корзины целей ещё не опубликованы'), measurement: [] };
    }
    const reasons = [];
    const measurement = [];
    if (data.multiShare > CONFIG.multiGoalShare) {
      reasons.push(`3+ разных целей: ${formatInt(data.multiVisits)} из ${formatInt(day.visits)} визитов (${formatPct(data.multiShare)})`);
    }
    if (data.fast3Share > CONFIG.fastGoal3Share) {
      measurement.push(`цели за 0–3 секунды: ${formatInt(data.fast3Visits)} из ${formatInt(day.visits)} визитов (${formatPct(data.fast3Share)}) — вероятна автосрабатывающая разметка`);
    }
    return { family: family(reasons.length ? 'triggered' : 'clean', reasons, '0–3 секунды вынесены в качество измерения и не считаются фродом'), measurement };
  }

  function evaluateDay(day, peers, allRows, sliceMap) {
    const base = baselineFor(day, peers, allRows, sliceMap);
    const conversion = evaluateConversion(day);
    const families = {
      identity: evaluateIdentity(day, base),
      technical: evaluateTechnical(day, base, sliceMap),
      behavior: evaluateBehavior(day, base),
      conversion: conversion.family
    };
    const triggered = FAMILY_ORDER.filter((name) => families[name].triggered);
    const available = FAMILY_ORDER.filter((name) => families[name].available);
    const level = Math.min(3, triggered.length);
    const volumeRatio = ratio(day.visits, base.visits.value);
    return {
      ...day,
      baseline: base,
      families,
      triggered,
      available,
      familyCount: triggered.length,
      availableCount: available.length,
      level,
      verdict: available.length < 2 ? { key: 'insufficient', label: 'Недостаточно данных', action: 'Накопить выборку; отсутствие возможности проверить не считать признаком чистоты.' } : verdictFromLevel(level),
      measurement: conversion.measurement,
      volumeRatio,
      volumePriority: volumeRatio >= 4 ? 'Высокий' : volumeRatio >= 2 ? 'Повышенный' : 'Обычный'
    };
  }

  function periodDiagnostics(summary) {
    if (!summary) return { available: false, measurement: [], conversion: [] };
    const measurement = [];
    const conversion = [];
    if (number(summary.fastAnyGoal3Share) > CONFIG.fastGoal3Share) {
      measurement.push(`цели за 0–3 секунды: ${formatInt(summary.fastAnyGoal3Visits)} из ${formatInt(summary.visits)} визитов (${formatPct(summary.fastAnyGoal3Share)})`);
    }
    if (number(summary.multiGoalShare) > CONFIG.multiGoalShare) {
      conversion.push(`3+ разных целей: ${formatInt(summary.multiGoalVisits)} из ${formatInt(summary.visits)} визитов (${formatPct(summary.multiGoalShare)})`);
    }
    return { available: true, measurement, conversion, summary };
  }

  function aggregateSource(source, days, periodSummary, highVolumeThreshold) {
    const evaluableDays = days.filter((day) => day.availableCount >= 2);
    const anomalousDays = evaluableDays.filter((day) => day.familyCount > 0);
    const maxDay = [...evaluableDays].sort((a, b) => b.familyCount - a.familyCount || b.visits - a.visits)[0] || null;
    let level = maxDay?.level || 0;
    const anomalyShare = evaluableDays.length ? anomalousDays.length / evaluableDays.length : 0;
    if (evaluableDays.length >= 5 && anomalyShare > 0.30) level = Math.min(3, level + 1);
    else if (evaluableDays.length >= 5 && anomalyShare < 0.10) level = Math.max(0, level - 1);
    const visits = days.reduce((sum, day) => sum + number(day.visits), 0);
    const familyPeaks = Object.fromEntries(FAMILY_ORDER.map((name) => {
      const matching = days.filter((day) => day.families[name].triggered).sort((a, b) => b.visits - a.visits);
      const available = days.filter((day) => day.families[name].available).length;
      return [name, { day: matching[0] || null, triggeredDays: matching.length, availableDays: available }];
    }));
    const diagnostics = periodDiagnostics(periodSummary);
    const confidence = Math.max(0, ...days.map((day) => day.availableCount));
    const verdict = confidence < 2
      ? { key: 'insufficient', label: 'Недостаточно данных', action: 'Накопить выборку; не трактовать н/д как отсутствие фрода.' }
      : verdictFromLevel(level);
    const priority = visits >= highVolumeThreshold || days.some((day) => day.volumeRatio >= 4) ? 'Высокий' : visits >= highVolumeThreshold * 0.4 ? 'Средний' : 'Обычный';
    return {
      source, days, visits, evaluableDays, anomalousDays, anomalyShare, maxDay, level, verdict, familyPeaks,
      diagnostics, availableCount: confidence, priority
    };
  }

  function buildModel(rows) {
    const { from, to } = selectedRange();
    const cleanRows = (rows || []).filter((row) => row?.date && number(row.visits) > 0);
    const sliceMap = sliceDailyMap(cleanRows, from, to);
    const periodMap = periodSummaryMap(cleanRows, to);
    const grouped = new Map();
    for (const row of cleanRows) {
      if (!grouped.has(row.source)) grouped.set(row.source, []);
      grouped.get(row.source).push(row);
    }
    const evaluatedDays = [];
    for (const [source, sourceRows] of grouped.entries()) {
      sourceRows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (const day of sourceRows) evaluatedDays.push(evaluateDay(day, sourceRows, cleanRows, sliceMap));
    }
    const volumeThreshold = quantile([...grouped.values()].map((sourceRows) => sourceRows.reduce((sum, row) => sum + number(row.visits), 0)), 0.75);
    const sources = [...grouped.keys()].map((source) => aggregateSource(
      source,
      evaluatedDays.filter((day) => day.source === source),
      periodMap.get(source),
      volumeThreshold
    )).sort((a, b) => {
      const priorityRank = { 'Высокий': 3, 'Средний': 2, 'Обычный': 1 };
      return b.level - a.level || (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) || b.visits - a.visits;
    });
    return { rows: cleanRows, days: evaluatedDays, sources, from, to, volumeThreshold };
  }

  function familyStatusHtml(item) {
    const icon = item.status === 'triggered' ? '⚠' : item.status === 'clean' ? '✓' : '—';
    const label = item.status === 'triggered' ? 'сработало' : item.status === 'clean' ? 'проверено, отклонений нет' : 'нет данных';
    return `<span class="method-family-status method-family-status--${item.status}"><b>${icon}</b>${label}</span>`;
  }

  function renderFamilyCard(name, peak) {
    const label = FAMILY_LABELS[name];
    if (!peak.availableDays) {
      return `<article class="method-family method-family--na"><h5>${escapeHtml(label)}</h5>${familyStatusHtml(family('na'))}<p>Правило н/д: подходящей выборки нет.</p></article>`;
    }
    if (!peak.day) {
      return `<article class="method-family method-family--clean"><h5>${escapeHtml(label)}</h5>${familyStatusHtml(family('clean'))}<p>Проверено ${formatInt(peak.availableDays)} дней, отклонений нет.</p></article>`;
    }
    const dayFamily = peak.day.families[name];
    return `<article class="method-family method-family--triggered"><h5>${escapeHtml(label)}</h5>${familyStatusHtml(dayFamily)}<p><b>${formatDate(peak.day.date)}</b> · выборка ${formatInt(peak.day.visits)} визитов</p><ul>${dayFamily.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul><small>Сработало дней: ${formatInt(peak.triggeredDays)} из ${formatInt(peak.availableDays)} проверенных.</small></article>`;
  }

  function sourceCard(source, index) {
    const measurement = unique([
      ...source.days.flatMap((day) => day.measurement || []),
      ...source.diagnostics.measurement
    ]);
    const conversionPeriod = source.diagnostics.conversion || [];
    const maxText = source.maxDay
      ? `${formatInt(source.maxDay.familyCount)} семейства одновременно · ${formatDate(source.maxDay.date)} · ${formatInt(source.maxDay.visits)} визитов`
      : 'нет дня с достаточной полнотой проверки';
    return `<details class="method-source method-source--${source.verdict.key}" ${index < 5 || source.level >= 2 ? 'open' : ''}>
      <summary>
        <div><span class="method-eyebrow">Источник</span><h4>${escapeHtml(source.source)}</h4><p>${escapeHtml(maxText)}</p></div>
        <div class="method-source-verdict"><span>Приоритет ${escapeHtml(source.priority.toLowerCase())}</span><strong>${escapeHtml(source.verdict.label)}</strong></div>
      </summary>
      <div class="method-source-body">
        <div class="method-source-metrics">
          <div><strong>${formatInt(source.visits)}</strong><span>визитов</span></div>
          <div><strong>${formatInt(source.anomalousDays.length)} из ${formatInt(source.evaluableDays.length)}</strong><span>аномальных дней</span></div>
          <div><strong>${formatPct(source.anomalyShare)}</strong><span>системность</span></div>
          <div><strong>${formatInt(source.availableCount)} из 4</strong><span>семейств доступно</span></div>
        </div>
        <div class="method-family-grid">${FAMILY_ORDER.map((name) => renderFamilyCard(name, source.familyPeaks[name])).join('')}</div>
        ${measurement.length ? `<div class="method-alert method-alert--measurement"><b>Качество измерения — отдельно от фрода</b><ul>${measurement.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p>Сначала проверить настройку целей; этот блок не повышает фрод-вердикт.</p></div>` : ''}
        ${conversionPeriod.length ? `<div class="method-alert"><b>Периодная конверсионная диагностика</b><ul>${conversionPeriod.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p>Пока показатель не опубликован по дням, он показывается отдельно и не объединяется с сигналами других дат.</p></div>` : ''}
        <div class="method-action"><b>Действие</b><p>${escapeHtml(source.verdict.action)}</p><p>Запрашивать детализацию по конкретным датам; сравнивать с соседним периодом того же источника.</p></div>
      </div>
    </details>`;
  }

  function render(model) {
    cache.lastModel = model;
    const results = document.querySelector('#results');
    if (!results) return;
    results.querySelector('#independent-methodology-panel')?.remove();

    const totalVisits = model.sources.reduce((sum, source) => sum + source.visits, 0);
    const verdictCounts = Object.fromEntries(['normal', 'observe', 'check', 'limit', 'insufficient'].map((key) => [key, model.sources.filter((source) => source.verdict.key === key).length]));
    const anomalyDays = model.days.filter((day) => day.familyCount > 0 && day.availableCount >= 2);
    const incomplete = model.sources.filter((source) => source.availableCount < 3).length;
    const dailyRows = [...anomalyDays].sort((a, b) => b.familyCount - a.familyCount || b.visits - a.visits).slice(0, 120);

    const panel = document.createElement('section');
    panel.id = 'independent-methodology-panel';
    panel.className = 'methodology-results';
    panel.innerHTML = `
      <div class="methodology-head">
        <div><span class="section-kicker">Новая методология</span><h2>Независимые семейства сигналов</h2><p>Вердикт формируется по числу семейств, сработавших в один день. Объём влияет только на приоритет проверки. Ошибки целей вынесены отдельно.</p></div>
        <div class="methodology-badge">Без score<br><strong>0–4 семейства</strong></div>
      </div>
      <div class="method-kpis">
        <article><span>Визиты</span><strong>${formatInt(totalVisits)}</strong><small>${formatInt(model.sources.length)} источников</small></article>
        <article><span>Проверить / ограничить</span><strong>${formatInt(verdictCounts.check + verdictCounts.limit)}</strong><small>${formatInt(verdictCounts.limit)} с наиболее сильным сигналом</small></article>
        <article><span>Аномальные дни</span><strong>${formatInt(anomalyDays.length)}</strong><small>семейства совпали внутри одной даты</small></article>
        <article><span>Неполная проверка</span><strong>${formatInt(incomplete)}</strong><small>доступно менее 3 из 4 семейств</small></article>
      </div>
      <div class="method-note"><b>Интерпретация:</b> «0 из 0» и «0 из 4» — разные результаты. Н/д не считается чистым сигналом. Ни один вердикт не отключает источник автоматически.</div>
      <section class="methodology-table-section">
        <h3>Рейтинг источников</h3>
        <div class="table-wrap"><table class="methodology-table"><thead><tr><th>Источник</th><th>Визиты</th><th>Макс. семейств в один день</th><th>Аномальные дни</th><th>Полнота</th><th>Приоритет</th><th>Вердикт</th></tr></thead><tbody>
          ${model.sources.map((source) => `<tr><td><a href="#method-source-${escapeHtml(slug(source.source))}">${escapeHtml(source.source)}</a></td><td>${formatInt(source.visits)}</td><td>${formatInt(source.maxDay?.familyCount || 0)} из 4${source.maxDay ? `<small>${formatDate(source.maxDay.date)} · ${formatInt(source.maxDay.visits)} визитов</small>` : ''}</td><td>${formatInt(source.anomalousDays.length)} из ${formatInt(source.evaluableDays.length)}<small>${formatPct(source.anomalyShare)}</small></td><td>${formatInt(source.availableCount)} из 4</td><td>${escapeHtml(source.priority)}</td><td><span class="method-verdict method-verdict--${source.verdict.key}">${escapeHtml(source.verdict.label)}</span></td></tr>`).join('')}
        </tbody></table></div>
      </section>
      <section class="methodology-table-section">
        <h3>Конкретные даты для запроса площадкам</h3>
        <div class="table-wrap"><table class="methodology-table"><thead><tr><th>Дата</th><th>Источник</th><th>Визиты</th><th>Семейства</th><th>Полнота</th><th>Объём</th><th>Дневной вывод</th></tr></thead><tbody>
          ${dailyRows.length ? dailyRows.map((day) => `<tr><td>${formatDate(day.date)}</td><td>${escapeHtml(day.source)}</td><td>${formatInt(day.visits)}<small>обычно ${formatInt(day.baseline.visits.value)}</small></td><td>${day.triggered.map((name) => escapeHtml(FAMILY_LABELS[name])).join('<br>')}</td><td>${formatInt(day.availableCount)} из 4</td><td>${escapeHtml(day.volumePriority)}${day.volumeRatio ? `<small>×${formatDecimal(day.volumeRatio, 1)} к базе</small>` : ''}</td><td><span class="method-verdict method-verdict--${day.verdict.key}">${escapeHtml(day.verdict.label)}</span></td></tr>`).join('') : '<tr><td colspan="7">Дней с независимыми сигналами и достаточной выборкой не найдено.</td></tr>'}
        </tbody></table></div>
      </section>
      <section class="method-source-list">${model.sources.map((source, index) => sourceCard(source, index).replace('class="method-source ', `id="method-source-${slug(source.source)}" class="method-source `)).join('')}</section>`;

    const anchor = results.querySelector('#conclusion') || results.firstElementChild;
    anchor.insertAdjacentElement('afterend', panel);
    replaceLegacySummary(model, verdictCounts, anomalyDays);
    hideLegacyOutputs(results);
    updateMethodologyCopy();
    installStyles();
  }

  function replaceLegacySummary(model, verdictCounts, anomalyDays) {
    const kpis = document.querySelector('#kpi-grid');
    if (kpis) {
      kpis.innerHTML = [
        ['Всего визитов', formatInt(model.sources.reduce((sum, source) => sum + source.visits, 0)), `${model.sources.length} источников`],
        ['Норма', formatInt(verdictCounts.normal), '0 независимых семейств'],
        ['Наблюдать', formatInt(verdictCounts.observe), '1 семейство'],
        ['Проверить', formatInt(verdictCounts.check), '2 семейства или системность'],
        ['Ограничить', formatInt(verdictCounts.limit), '3–4 семейства; только после ручной проверки'],
        ['Н/д', formatInt(verdictCounts.insufficient), 'недостаточно доступных семейств']
      ].map(([label, value, note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
    }
    const conclusion = document.querySelector('#conclusion');
    if (conclusion) {
      conclusion.innerHTML = `<strong>Общий вывод</strong>${escapeHtml(`Найдено ${anomalyDays.length} дневных срезов с хотя бы одним независимым семейством сигналов. Проверить или ограничить после ручной верификации: ${verdictCounts.check + verdictCounts.limit} источников. Объём не начисляет сигналы, а только определяет очерёдность проверки.`)}`;
    }
    const summary = document.querySelector('#summary-text');
    if (summary) summary.textContent = `Период ${formatDate(model.from)} — ${formatDate(model.to)}. Вердикты рассчитаны по одновременным дневным семействам, без суммирования баллов.`;
  }

  function hideLegacyOutputs(results) {
  for (const section of results.querySelectorAll('.results-subsection')) section.hidden = true;
  const sourceList = results.querySelector('#source-list');
  if (!sourceList) return;
  sourceList.hidden = false;
  sourceList.classList.add('methodology-support-list');
  let heading = results.querySelector('#support-diagnostics-head');
  if (!heading) {
    heading = document.createElement('div');
    heading.id = 'support-diagnostics-head';
    heading.className = 'support-diagnostics-head';
    heading.innerHTML = '<span class="section-kicker">Дополнительная диагностика</span><h2>IP, подсети, ClientID и технические срезы</h2><p>Эти карточки сохраняют подробные безопасные агрегаты текущего дашборда. Старый score и повизитный риск скрыты; основной вердикт находится в блоке независимых семейств выше.</p>';
    sourceList.insertAdjacentElement('beforebegin', heading);
  }
  for (const card of sourceList.querySelectorAll('.source-card')) {
    card.open = false;
    card.classList.add('methodology-support-card');
    const score = card.querySelector('.source-score');
    if (score) score.hidden = true;
    const summaryNote = card.querySelector('summary p');
    if (summaryNote) summaryNote.textContent = 'Подробные безопасные агрегаты: IP/подсети, ClientID, браузеры, ОС, разрешения и технические сегменты.';
    const metricStrip = card.querySelector('.metric-strip');
    if (metricStrip) metricStrip.hidden = true;
    const dailyDetail = card.querySelector('.daily-detail');
    if (dailyDetail) dailyDetail.hidden = true;
    for (const section of card.querySelectorAll('.detail')) {
      const title = section.querySelector('h4')?.textContent?.trim() || '';
      section.hidden = /score|оценка конкретных визитов|рекомендация/i.test(title);
    }
  }
}

  function updateMethodologyCopy() {
    const heroLead = document.querySelector('.hero__lead');
    if (heroLead) heroLead.textContent = 'Выберите счётчик и период. Инструмент проверит каждый источник по независимым дневным семействам сигналов и покажет конкретные даты для запроса площадкам.';
    const chips = document.querySelector('.hero__chips');
    if (chips) chips.innerHTML = '<span>Источник × день</span><span>4 независимых семейства</span><span>Медиана к медиане</span><span>Объём = приоритет</span><span>Н/д ≠ норма</span><span>Без автоблокировки</span>';
    const method = document.querySelector('#methodology');
    if (method) method.innerHTML = `
      <div class="section-head"><div><span class="section-kicker">Методика</span><h2>Как формируется вердикт</h2><p>Семейства считаются отдельно для каждой даты. Внутри семейства берётся максимум отклонения, а не сумма связанных метрик.</p></div></div>
      <div class="method-grid">
        <article><span>01</span><h3>Гейты</h3><p>Проценты и концентрации участвуют только при достаточной выборке. Невыполнимое правило получает статус н/д.</p></article>
        <article><span>02</span><h3>Семейства</h3><p>Идентификаторы, техническая однородность, поведение и конверсионный паттерн. Отказы и время — одно семейство.</p></article>
        <article><span>03</span><h3>Вердикт</h3><p>0 — норма, 1 — наблюдать, 2 — проверить, 3–4 — ограничить после ручной проверки.</p></article>
        <article><span>04</span><h3>Системность</h3><p>Более 30% аномальных дней повышают вывод на ступень, менее 10% — понижают. Объём задаёт приоритет, но не улику.</p></article>
      </div>
      <div class="method-note"><strong>Важно:</strong> цели за 0–3 секунды показываются как возможная ошибка разметки и не повышают фрод-вердикт. Автоматическое отключение источников запрещено.</div>`;
    const manualDivider = document.querySelector('.manual-divider');
    if (manualDivider) manualDivider.textContent = 'Ручная загрузка — резервный режим с прежней эвристикой';
    const manualLead = document.querySelector('#upload-section .section-head p');
    if (manualLead) manualLead.textContent = 'Используйте этот вариант для сторонних счётчиков или локальных файлов. Новая методология независимых семейств полностью применяется в основном API-режиме; ручной режим временно сохраняет прежний расчёт.';
    const manualNote = document.querySelector('.actions-row__note');
    if (manualNote) manualNote.textContent = 'Ручной режим — технический fallback. Не используйте его score как автоматическое решение об отключении источника.';
    const footer = document.querySelector('footer .footer-inner span:last-child');
    if (footer) footer.textContent = 'Версия 1.0 · независимые семейства · дневной вердикт без score';
  }

  function slug(value) {
    return String(value || 'unknown').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  }

  function exportNewCsv(model) {
    const headers = ['Дата', 'Источник', 'Визиты', 'Обычный объём', 'Объём к базе', 'Сработало семейств', 'Доступно семейств', 'Идентификаторы', 'Техническое', 'Поведение', 'Конверсии', 'Качество измерения', 'Вердикт'];
    const rows = model.days.map((day) => [
      day.date, day.source, day.visits, day.baseline.visits.value, day.volumeRatio,
      day.familyCount, day.availableCount,
      day.families.identity.reasons.join('; ') || (day.families.identity.available ? 'проверено, отклонений нет' : 'н/д'),
      day.families.technical.reasons.join('; ') || (day.families.technical.available ? 'проверено, отклонений нет' : 'н/д'),
      day.families.behavior.reasons.join('; ') || (day.families.behavior.available ? 'проверено, отклонений нет' : 'н/д'),
      day.families.conversion.reasons.join('; ') || (day.families.conversion.available ? 'проверено, отклонений нет' : 'н/д'),
      day.measurement.join('; '), day.verdict.label
    ]);
    const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `traffic-fraud-families-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function bindExport() {
    document.querySelector('#export-button')?.addEventListener('click', (event) => {
      if (!cache.lastModel) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exportNewCsv(cache.lastModel);
    }, true);
  }

  function installStyles() {
    if (document.querySelector('#methodology-v1-styles')) return;
    const style = document.createElement('style');
    style.id = 'methodology-v1-styles';
    style.textContent = `
      .methodology-results{display:grid;gap:22px;margin:24px 0 34px}.methodology-head{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}.methodology-head h2{margin:4px 0 8px}.methodology-head p{margin:0;max-width:850px}.methodology-badge{min-width:180px;padding:18px;border-radius:18px;background:#171717;color:#fff;text-align:center;line-height:1.35}.methodology-badge strong{font-size:20px}.method-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.method-kpis article{background:#fff;border:1px solid #e7e1d9;border-radius:16px;padding:16px}.method-kpis span,.method-kpis small{display:block;color:#6d675f}.method-kpis strong{display:block;font-size:26px;margin:7px 0}.methodology-table-section,.method-source{background:#fff;border:1px solid #e7e1d9;border-radius:20px;padding:20px}.methodology-table-section h3{margin-top:0}.methodology-table td small{display:block;margin-top:4px;color:#777}.method-verdict{display:inline-flex;padding:7px 10px;border-radius:999px;font-weight:700;white-space:nowrap}.method-verdict--normal{background:#e8f6ed;color:#21633b}.method-verdict--observe{background:#fff5d8;color:#765800}.method-verdict--check{background:#ffead8;color:#8a4100}.method-verdict--limit{background:#ffe1e1;color:#8a2020}.method-verdict--insufficient{background:#ececec;color:#555}.method-source-list{display:grid;gap:14px}.method-source{padding:0;overflow:hidden}.method-source summary{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:20px;cursor:pointer}.method-source summary h4{font-size:21px;margin:3px 0}.method-source summary p{margin:0;color:#666}.method-eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#777}.method-source-verdict{text-align:right}.method-source-verdict span{display:block;font-size:12px;color:#777}.method-source-verdict strong{font-size:19px}.method-source-body{border-top:1px solid #ece7e0;padding:20px;display:grid;gap:18px}.method-source-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.method-source-metrics div{background:#f7f5f2;border-radius:14px;padding:13px}.method-source-metrics strong,.method-source-metrics span{display:block}.method-source-metrics strong{font-size:19px}.method-source-metrics span{font-size:12px;color:#6e6962;margin-top:4px}.method-family-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.method-family{border:1px solid #e7e1d9;border-radius:16px;padding:15px}.method-family h5{font-size:15px;margin:0 0 9px}.method-family p{margin:9px 0}.method-family ul,.method-alert ul{padding-left:18px;margin:9px 0}.method-family small{color:#777}.method-family-status{display:inline-flex;align-items:center;gap:7px;padding:5px 8px;border-radius:999px;font-size:12px;font-weight:700}.method-family-status--triggered{background:#ffe8d9;color:#8a4100}.method-family-status--clean{background:#e8f6ed;color:#21633b}.method-family-status--na{background:#ececec;color:#555}.method-alert,.method-action,.method-note{border-radius:15px;padding:15px;background:#f7f5f2}.method-alert--measurement{background:#fff5d8}.method-action{background:#eef2f7}.method-action p:last-child{margin-bottom:0}.support-diagnostics-head{margin:34px 0 14px}.support-diagnostics-head h2{margin:5px 0 8px}.support-diagnostics-head p{margin:0;max-width:900px;color:#666}.methodology-support-list{display:grid!important;gap:14px}.methodology-support-card summary{background:#fff}.methodology-support-card .source-body{background:#fff}@media(max-width:900px){.method-kpis,.method-source-metrics,.method-family-grid{grid-template-columns:1fr 1fr}.methodology-head{display:block}.methodology-badge{margin-top:14px}}@media(max-width:580px){.method-kpis,.method-source-metrics,.method-family-grid{grid-template-columns:1fr}.method-source summary{align-items:flex-start}.method-source-verdict{min-width:120px}.methodology-table{font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  function selfTest() {
    const baseDay = {
      source: 'test', date: '2026-07-01', visits: 1000,
      metrics: { bounce: 0.4, time: 100 },
      topIp: { value: 10, share: 0.01 }, topSubnet: { value: 30, share: 0.03 },
      topClientId: { value: 3, share: 0.003 }, topBrowser: { key: 'Chrome 149', value: 400, share: 0.4 },
      topResolution: { key: '1920x1080', value: 200, share: 0.2 },
      clientIdVisits: 1000, uniqueClientIds: 900, visitsPerClientId: 1.11, clientIdCoverage: 1,
      cookieEnabledShare: 1, automationVisits: 0, automationShare: 0
    };
    const peers = Array.from({ length: 6 }, (_, index) => ({ ...baseDay, date: `2026-06-${String(index + 1).padStart(2, '0')}` }));
    const bad = { ...baseDay, date: '2026-07-02', visits: 4000, metrics: { bounce: 0.75, time: 30 } };
    const result = evaluateDay(bad, [...peers, bad], [...peers, bad], new Map());
    if (!result.families.behavior.triggered || result.families.behavior.reasons.length !== 1) throw new Error('behavior family must trigger once');
    if (result.triggered.includes('volume')) throw new Error('volume must not be a family');
    const tiny = evaluateDay({ ...baseDay, visits: 20, clientIdVisits: 20, uniqueClientIds: 20 }, peers, peers, new Map());
    if (tiny.verdict.key !== 'insufficient') throw new Error('small sample must be insufficient');
  }

  function installAnalyzerWrapper() {
    if (!cache.originalAnalyze || !window.FraudLab) return;
    window.FraudLab = Object.freeze({
      ...window.FraudLab,
      analyzeApiRows(rows, options = {}) {
        const result = cache.originalAnalyze(rows, options);
        window.setTimeout(() => {
          try { render(buildModel(rows)); }
          catch (error) {
            console.error('Independent methodology overlay failed', error);
            const status = document.querySelector('#api-status');
            if (status) status.textContent += ` · Новая методология: ${error.message}`;
          }
        }, 80);
        return result;
      }
    });
  }

  try {
    selfTest();
    captureFetch();
    installAnalyzerWrapper();
    bindExport();
    installStyles();
    updateMethodologyCopy();
  } catch (error) {
    console.error('Methodology v1 initialization failed', error);
  }
})();
