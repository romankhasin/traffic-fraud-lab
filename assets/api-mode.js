(() => {
  'use strict';

  const DATA_BASE = 'https://raw.githubusercontent.com/romankhasin/-level-group-dashboard/main/data/fraud/';
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    counters: $('#api-counter-list'),
    dateFrom: $('#api-date-from'),
    dateTo: $('#api-date-to'),
    analyze: $('#api-analyze-button'),
    status: $('#api-status'),
    generated: $('#api-generated')
  };

  if (!ui.counters || !ui.dateFrom || !ui.dateTo || !ui.analyze || !ui.status) return;

  let catalog = null;

  const formatInt = (value) => Math.round(Number(value) || 0).toLocaleString('ru-RU');
  const formatPct = (value, digits = 1) => `${((Number(value) || 0) * 100).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`;
  const formatDecimal = (value) => (Number(value) || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
  const formatSeconds = (value) => `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} сек.`;
  const formatDate = (value) => {
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(value || '—');
  };
  const formatDateTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value || '—')
      : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]));
  const shorten = (value, maximum = 110) => {
    const text = String(value || '—');
    return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
  };

  const DIMENSION_LABELS = {
    browser: 'Версия браузера',
    resolution: 'Разрешение экрана',
    os: 'Операционная система',
    deviceModel: 'Модель устройства',
    referrer: 'Referrer / домен',
    browserResolution: 'Браузер + разрешение',
    fingerprint: 'Технический слепок'
  };
  const PRIMARY_WARNING_DIMENSIONS = new Set(['browser', 'resolution', 'os', 'deviceModel', 'referrer']);

  const campaignFilterLabel = () => {
    const tokens = Array.isArray(catalog?.campaignFilter) && catalog.campaignFilter.length
      ? catalog.campaignFilter
      : ['prg', 'med', 'mrk'];
    return tokens.map((token) => String(token).toUpperCase()).join(', ');
  };

  const status = (message, kind = 'info') => {
    ui.status.className = `api-status api-status--${kind}`;
    ui.status.textContent = message;
  };

  const checkedCounters = () => [...ui.counters.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => Number(input.value))
    .filter(Number.isFinite);

  const updateButton = () => {
    const validPeriod = ui.dateFrom.value && ui.dateTo.value && ui.dateFrom.value <= ui.dateTo.value;
    ui.analyze.disabled = !catalog || !checkedCounters().length || !validPeriod;
  };

  const addDays = (dateText, amount) => {
    const date = new Date(`${dateText}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };

  const daysBetween = (from, to) => Math.round(
    (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000
  ) + 1;

  const monthsBetween = (from, to) => {
    const result = [];
    const cursor = new Date(`${from.slice(0, 7)}-01T12:00:00Z`);
    const end = new Date(`${to.slice(0, 7)}-01T12:00:00Z`);
    while (cursor <= end) {
      result.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return result;
  };

  const selectedFiles = (counter, from, to) => (counter.files || [])
    .filter((file) => file.from && file.to && file.to >= from && file.from <= to);

  const median = (values) => {
    const safe = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!safe.length) return 0;
    const middle = Math.floor(safe.length / 2);
    return safe.length % 2 ? safe[middle] : (safe[middle - 1] + safe[middle]) / 2;
  };

  const maxBy = (rows, getter, options = {}) => {
    const sampleGetter = options.sampleGetter || ((row) => row.visits);
    const keyGetter = options.keyGetter || (() => '');
    return rows.reduce((best, row) => {
      const value = Number(getter(row)) || 0;
      return !best || value > best.value
        ? {
            value,
            date: String(row.date || ''),
            sampleVisits: Number(sampleGetter(row)) || 0,
            key: String(keyGetter(row) || '')
          }
        : best;
    }, null) || { value: 0, date: '', sampleVisits: 0, key: '' };
  };

  const coverageLevel = (coverage) => {
    if (coverage >= .95) return 'высокое';
    if (coverage >= .65) return 'достаточное';
    if (coverage >= .35) return 'ограниченное';
    return 'низкое';
  };

  const summarizeDailyPeaks = (sourceRows) => {
    const peers = sourceRows.filter((row) => (
      (Number(row.clientIdVisits) || 0) >= 100
      && (Number(row.clientIdCoverage) || 0) >= .5
      && (Number(row.uniqueClientIds) || 0) >= 10
    ));
    const typicalClientIdVisits = median(peers.map((row) => row.clientIdVisits));
    const representativeThreshold = Math.max(200, typicalClientIdVisits * .15);
    const representativeRows = sourceRows.filter((row) => (
      (Number(row.clientIdVisits) || 0) >= representativeThreshold
      && (Number(row.clientIdCoverage) || 0) >= .5
      && (Number(row.uniqueClientIds) || 0) >= 10
    ));
    const options = { sampleGetter: (row) => row.clientIdVisits };
    return {
      representativeDays: representativeRows.length,
      representativeThreshold,
      maxVisitsPerClientId: maxBy(representativeRows, (row) => row.visitsPerClientId, options),
      maxTop1: maxBy(representativeRows, (row) => row.topClientId?.share, options),
      maxTop10: maxBy(representativeRows, (row) => row.top10ClientShare, options)
    };
  };

  const summarizeClientIds = (rows, periodSummaries = new Map()) => {
    const grouped = new Map();
    for (const row of rows || []) {
      const source = String(row.source || 'Не определено');
      if (!grouped.has(source)) grouped.set(source, []);
      grouped.get(source).push(row);
    }

    const summaries = new Map();
    for (const [source, sourceRows] of grouped.entries()) {
      const techVisits = sourceRows.reduce((sum, row) => sum + (Number(row.tech?.visits ?? row.visits) || 0), 0);
      const clientIdVisits = sourceRows.reduce((sum, row) => sum + (Number(row.clientIdVisits) || 0), 0);
      summaries.set(source, {
        hasClientIds: clientIdVisits > 0,
        fallbackCoverage: techVisits ? Math.min(1, clientIdVisits / techVisits) : 0,
        period: periodSummaries.get(source) || null,
        daily: summarizeDailyPeaks(sourceRows)
      });
    }
    return summaries;
  };

  const peakMetric = (label, metric, formatter) => metric.date
    ? `<p><b>${label}:</b> ${formatter(metric.value)} — ${formatDate(metric.date)}<br><small>Выборка: ${formatInt(metric.sampleVisits)} визитов с ClientID</small></p>`
    : `<p><b>${label}:</b> недостаточно репрезентативных дневных данных</p>`;

  const renderDailyPeaks = (daily) => `
    <p class="metric-section-heading metric-section-heading--peak"><b>Пиковые дневные значения</b></p>
    <p><small>Используются дни с покрытием ClientID от 50%, минимум 10 уникальными ClientID и не менее ${formatInt(daily.representativeThreshold)} визитов с ClientID.</small></p>
    <p><b>Репрезентативных дней:</b> ${formatInt(daily.representativeDays)}</p>
    ${peakMetric('Максимум визитов на ClientID', daily.maxVisitsPerClientId, formatDecimal)}
    ${peakMetric('Максимальная доля топ-1', daily.maxTop1, formatPct)}
    ${peakMetric('Максимальная доля топ-10', daily.maxTop10, formatPct)}`;


  const COOKIE_STATUS_LABELS = {
    on: 'Cookies включены',
    off: 'Cookies выключены',
    unknown: 'Статус не определён'
  };

  const renderCookieClientRow = (status, segment) => `
    <tr>
      <td><b>${COOKIE_STATUS_LABELS[status]}</b></td>
      <td>${formatInt(segment?.visits)}<br><small>${formatPct(segment?.share)} трафика</small></td>
      <td>${formatInt(segment?.clientIdVisits)}<br><small>${formatPct(segment?.coverage)} с ClientID</small></td>
      <td>${formatInt(segment?.uniqueClientIds)}</td>
      <td>${formatDecimal(segment?.visitsPerClientId)}</td>
      <td>${formatPct(segment?.top1Share)}<br><small>${formatInt(segment?.top1Visits)} визитов</small></td>
      <td>${formatPct(segment?.top10Share)}<br><small>${formatInt(segment?.top10Visits)} визитов</small></td>
      <td>${formatPct(segment?.repeatClientVisitShare)}</td>
    </tr>`;

  const renderCookieClientTable = (period) => {
    const segmented = period?.clientIdByCookie;
    if (!segmented) {
      return '<p class="method-note">Раздельный расчёт ClientID по статусу cookies ещё готовится.</p>';
    }
    const offShare = Number(segmented.off?.share) || 0;
    const unknownShare = Number(segmented.unknown?.share) || 0;
    const constrained = offShare + unknownShare > .15;
    const reliability = constrained
      ? `<div class="tech-method-alert tech-method-alert--warning"><b>Интерпретация общей уникальности ограничена.</b> ${formatPct(offShare)} визитов зафиксированы с cookies off, ещё ${formatPct(unknownShare)} — с неопределённым статусом. Сравнивайте концентрации отдельно по сегментам; наличие ClientID не гарантирует устойчивость идентификатора между визитами.</div>`
      : `<div class="tech-method-alert"><b>Надёжность анализа ClientID достаточная.</b> Доля cookies off и неизвестного статуса составляет ${formatPct(offShare + unknownShare)}.</div>`;
    return `
      ${reliability}
      <div class="table-wrap cookie-client-table-wrap">
        <table class="mini-table cookie-client-table">
          <thead><tr><th>Сегмент</th><th>Визиты</th><th>Получен ClientID</th><th>Уникальные ID</th><th>Визитов / ID</th><th>Топ-1</th><th>Топ-10</th><th>Повторные визиты</th></tr></thead>
          <tbody>${['on', 'off', 'unknown'].map((status) => renderCookieClientRow(status, segmented[status] || {})).join('')}</tbody>
        </table>
      </div>`;
  };

  const renderClientIdBlock = (summary, unavailableCounters) => {
    if (!summary.hasClientIds) {
      return '<h4>ClientID</h4><p>ClientID не найден в выбранных данных.</p>';
    }
    if (!summary.period) {
      const unavailable = unavailableCounters.length
        ? ` Периодные данные пока недоступны для: ${unavailableCounters.join(', ')}.`
        : '';
      return `
        <h4>ClientID</h4>
        <p class="metric-section-heading metric-section-heading--period"><b>За выбранный период</b></p>
        <p><b>Доля визитов с полученным ClientID:</b> ${formatPct(summary.fallbackCoverage)} — ${coverageLevel(summary.fallbackCoverage)}</p>
        <p>Точный расчёт концентраций и разделение по статусу cookies ещё готовятся.${unavailable}</p>
        ${renderDailyPeaks(summary.daily)}`;
    }

    const period = summary.period;
    const reliability = period.representative
      ? 'Объём достаточен для интерпретации концентраций.'
      : 'Объём или покрытие недостаточны для уверенной интерпретации концентраций.';
    return `
      <h4>ClientID</h4>
      <p class="metric-section-heading metric-section-heading--period"><b>За выбранный период</b></p>
      <p><b>Доля визитов с полученным ClientID:</b> ${formatPct(period.coverage)} — ${coverageLevel(period.coverage)}</p>
      <p><b>Визитов с ClientID:</b> ${formatInt(period.clientIdVisits)} из ${formatInt(period.visits)}</p>
      <p><b>Уникальных ClientID:</b> ${formatInt(period.uniqueClientIds)}</p>
      <p><b>Визитов на ClientID:</b> ${formatDecimal(period.visitsPerClientId)}</p>
      <p><b>Доля топ-1:</b> ${formatPct(period.top1Share)} <small>(${formatInt(period.top1Visits)} визитов)</small></p>
      <p><b>Доля топ-10:</b> ${formatPct(period.top10Share)} <small>(${formatInt(period.top10Visits)} визитов)</small></p>
      <p><b>Доля повторных визитов:</b> ${formatPct(period.repeatClientVisitShare)}</p>
      <p><b>Дней с трафиком:</b> ${formatInt(period.activeDays)}</p>
      <p>Полученный ClientID показывает наличие значения в Logs API, но не доказывает устойчивость идентификатора. ${reliability}</p>
      ${renderCookieClientTable(period)}
      ${renderDailyPeaks(summary.daily)}`;
  };

  const summarizeConcentrationDailyPeaks = (sourceRows) => {
    const peers = sourceRows.filter((row) => (Number(row.visits) || 0) >= 100);
    const typicalVisits = median(peers.map((row) => row.visits));
    const representativeThreshold = Math.max(200, typicalVisits * .15);
    const representativeRows = sourceRows.filter((row) => (Number(row.visits) || 0) >= representativeThreshold);
    return {
      representativeDays: representativeRows.length,
      representativeThreshold,
      maxTopIp: maxBy(representativeRows, (row) => row.topIp?.share),
      maxTopSubnet: maxBy(representativeRows, (row) => row.topSubnet?.share),
      maxTopBrowser: maxBy(representativeRows, (row) => row.topBrowser?.share, {
        keyGetter: (row) => row.topBrowser?.key
      }),
      maxTopProfile: maxBy(representativeRows, (row) => row.topProfile?.share, {
        keyGetter: (row) => row.topProfile?.key
      })
    };
  };

  const summarizeConcentrations = (rows, periodSummaries = new Map()) => {
    const grouped = new Map();
    for (const row of rows || []) {
      const source = String(row.source || 'Не определено');
      if (!grouped.has(source)) grouped.set(source, []);
      grouped.get(source).push(row);
    }
    return new Map([...grouped.entries()].map(([source, sourceRows]) => [source, {
      period: periodSummaries.get(source) || null,
      daily: summarizeConcentrationDailyPeaks(sourceRows)
    }]));
  };

  const hasExactConcentrations = (period) => Boolean(
    period
    && Number.isFinite(Number(period.topIpShare))
    && Number.isFinite(Number(period.topSubnetShare))
    && Number.isFinite(Number(period.topBrowserShare))
    && Number.isFinite(Number(period.topProfileShare))
  );

  const concentrationPeakMetric = (label, metric, showKey = false) => metric.date
    ? `<p><b>${label}:</b> ${showKey && metric.key ? `${escapeHtml(shorten(metric.key))} · ` : ''}${formatPct(metric.value)} — ${formatDate(metric.date)}<br><small>Выборка: ${formatInt(metric.sampleVisits)} визитов</small></p>`
    : `<p><b>${label}:</b> недостаточно репрезентативных дневных данных</p>`;

  const renderConcentrationPeakIntro = (daily) => `
    <p class="metric-section-heading metric-section-heading--peak"><b>Пиковые дневные значения</b></p>
    <p><small>Пики считаются только по дням с объёмом не менее ${formatInt(daily.representativeThreshold)} визитов. Даты могут не совпадать между собой и с аномальным днём по отказам или времени.</small></p>`;

  const renderNetworkBlock = (summary, unavailableCounters = []) => {
    const period = summary.period;
    const unavailable = unavailableCounters.length
      ? ` Периодные данные пока недоступны для: ${unavailableCounters.join(', ')}.`
      : '';
    const periodHtml = hasExactConcentrations(period)
      ? `
        <p class="metric-section-heading metric-section-heading--period"><b>За выбранный период</b></p>
        <p><b>Топ IP:</b> ${formatPct(period.topIpShare)} <small>(${formatInt(period.topIpVisits)} визитов)</small></p>
        <p><b>Топ подсеть:</b> ${formatPct(period.topSubnetShare)} <small>(${formatInt(period.topSubnetVisits)} визитов)</small></p>`
      : `
        <p class="metric-section-heading metric-section-heading--period"><b>За выбранный период</b></p>
        <p>Точный периодный расчёт IP и подсетей ещё готовится.${unavailable}</p>`;
    return `
      <h4>IP и подсети</h4>
      ${periodHtml}
      ${renderConcentrationPeakIntro(summary.daily)}
      ${concentrationPeakMetric('Максимальная доля топ-IP', summary.daily.maxTopIp)}
      ${concentrationPeakMetric('Максимальная доля топ-подсети', summary.daily.maxTopSubnet)}`;
  };

  const renderTechnicalBlock = (summary, unavailableCounters = []) => {
    const period = summary.period;
    const unavailable = unavailableCounters.length
      ? ` Периодные данные пока недоступны для: ${unavailableCounters.join(', ')}.`
      : '';
    const periodHtml = hasExactConcentrations(period)
      ? `
        <p class="metric-section-heading metric-section-heading--period"><b>За выбранный период</b></p>
        <p><b>Топ браузер:</b> ${escapeHtml(period.topBrowser || '—')} · ${formatPct(period.topBrowserShare)} <small>(${formatInt(period.topBrowserVisits)} визитов)</small></p>
        <p><b>Топ связка:</b> ${escapeHtml(shorten(period.topProfile || '—'))} · ${formatPct(period.topProfileShare)} <small>(${formatInt(period.topProfileVisits)} визитов)</small></p>`
      : `
        <p class="metric-section-heading metric-section-heading--period"><b>За выбранный период</b></p>
        <p>Точный периодный расчёт браузеров и технических профилей ещё готовится.${unavailable}</p>`;
    return `
      <h4>Технический профиль</h4>
      ${periodHtml}
      ${renderConcentrationPeakIntro(summary.daily)}
      ${concentrationPeakMetric('Максимальная доля топ-браузера', summary.daily.maxTopBrowser, true)}
      ${concentrationPeakMetric('Максимальная доля топ-связки', summary.daily.maxTopProfile, true)}`;
  };

  const emptyAggregate = () => ({
    visits: 0,
    bounceVisits: 0,
    durationSum: 0,
    pageViewsSum: 0,
    qualityVisits: 0,
    newVisits: 0,
    days: new Map()
  });

  const addDayStats = (target, day) => {
    target.visits += Number(day[1]) || 0;
    target.bounceVisits += Number(day[2]) || 0;
    target.durationSum += Number(day[3]) || 0;
    target.pageViewsSum += Number(day[4]) || 0;
    target.qualityVisits += Number(day[5]) || 0;
    target.newVisits += Number(day[6]) || 0;
    const current = target.days.get(day[0]) || [day[0], 0, 0, 0, 0, 0, 0];
    for (let index = 1; index <= 6; index += 1) current[index] += Number(day[index]) || 0;
    target.days.set(day[0], current);
  };

  const aggregateSliceGroups = (groups, from, to) => {
    const bySource = new Map();
    for (const raw of groups || []) {
      const source = String(raw.source || 'Не определено');
      const dimension = String(raw.dimension || '');
      const value = String(raw.value || 'Не определено');
      if (!dimension) continue;
      const sourceMap = bySource.get(source) || new Map();
      bySource.set(source, sourceMap);
      const key = `${dimension}\u0001${value}`;
      const aggregate = sourceMap.get(key) || {
        source,
        dimension,
        value,
        meta: { ...(raw.meta || {}) },
        ...emptyAggregate()
      };
      for (const day of raw.days || []) {
        if (!day[0] || day[0] < from || day[0] > to) continue;
        addDayStats(aggregate, day);
      }
      if (aggregate.visits > 0) sourceMap.set(key, aggregate);
    }
    return new Map([...bySource.entries()].map(([source, sourceMap]) => [source, [...sourceMap.values()]]));
  };

  const ratesOf = (stats) => {
    const visits = Number(stats?.visits) || 0;
    return {
      visits,
      bounce: visits ? (Number(stats.bounceVisits) || 0) / visits : 0,
      time: visits ? (Number(stats.durationSum) || 0) / visits : 0,
      depth: visits ? (Number(stats.pageViewsSum) || 0) / visits : 0,
      quality: visits ? (Number(stats.qualityVisits) || 0) / visits : 0,
      newShare: visits ? (Number(stats.newVisits) || 0) / visits : 0
    };
  };

  const baselineFromPeriod = (period) => period ? {
    visits: Number(period.visits) || 0,
    bounce: Number(period.bounce) || 0,
    time: Number(period.time) || 0,
    depth: Number(period.depth) || 0,
    quality: Number(period.quality) || 0,
    newShare: Number(period.newShare) || 0
  } : null;

  const signal = (code, label, current, baseline, formatter, deltaText) => ({
    code,
    label,
    current,
    baseline,
    formatter,
    deltaText
  });

  const qualitySignals = (rates, baseline) => {
    if (!baseline || baseline.visits <= 0) return [];
    const signals = [];
    const bounceDiff = rates.bounce - baseline.bounce;
    const bounceRelative = baseline.bounce ? Math.abs(bounceDiff) / baseline.bounce : 0;
    if (bounceRelative > .5 && Math.abs(bounceDiff) > .20) {
      signals.push(signal('bounce', 'отказы', rates.bounce, baseline.bounce, formatPct, `${bounceDiff >= 0 ? '+' : ''}${(bounceDiff * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} п.п.`));
    }

    const depthDiff = rates.depth - baseline.depth;
    const depthRelative = baseline.depth ? Math.abs(depthDiff) / baseline.depth : 0;
    const depthAbsoluteOk = baseline.depth >= 1.5 || Math.abs(depthDiff) > 1;
    if (depthRelative > 2 && depthAbsoluteOk) {
      signals.push(signal('depth', 'глубина', rates.depth, baseline.depth, formatDecimal, `${depthDiff >= 0 ? '+' : ''}${formatDecimal(depthDiff)}`));
    }

    const timeDiff = rates.time - baseline.time;
    const timeRelative = baseline.time ? Math.abs(timeDiff) / baseline.time : 0;
    const timeAbsoluteOk = baseline.time >= 90 || Math.abs(timeDiff) > 60;
    if (timeRelative > 2 && timeAbsoluteOk) {
      signals.push(signal('time', 'время', rates.time, baseline.time, formatSeconds, `${timeDiff >= 0 ? '+' : ''}${formatSeconds(timeDiff)}`));
    }

    const qualityDiff = rates.quality - baseline.quality;
    const conversionRelative = baseline.quality ? rates.quality / baseline.quality : Infinity;
    const conversionAbsoluteOk = baseline.quality >= .01 || qualityDiff > .02;
    if (qualityDiff > 0 && conversionRelative > 6 && conversionAbsoluteOk) {
      signals.push(signal('quality', 'конверсия', rates.quality, baseline.quality, formatPct, `+${formatPct(qualityDiff)}`));
    }
    return signals;
  };

  const groupWarning = (group, baseline, volumeOptions = {}) => {
    const rates = ratesOf(group);
    const minimumVisits = Number(volumeOptions.minimumVisits ?? 100);
    const minimumShare = Number(volumeOptions.minimumShare ?? .10);
    const denominator = Number(volumeOptions.denominator ?? baseline?.visits) || 0;
    const share = denominator ? rates.visits / denominator : 0;
    if (rates.visits < minimumVisits && share < minimumShare) return null;
    const signals = qualitySignals(rates, baseline);
    if (!signals.length) return null;
    return {
      ...group,
      rates,
      share,
      signals,
      level: signals.length >= 2 ? 'high' : 'review'
    };
  };

  const buildWarningModel = (source, groups, period, sourceDailyVisits = new Map()) => {
    const baseline = baselineFromPeriod(period);
    if (!baseline || baseline.visits <= 500) {
      return { source, baseline, warnings: [], browsers: [], groups: groups || [], sourceDailyVisits, unavailableReason: 'Для поиска срезов нужно более 500 визитов и точный периодный baseline.' };
    }
    const warnings = (groups || [])
      .filter((group) => PRIMARY_WARNING_DIMENSIONS.has(group.dimension))
      .map((group) => groupWarning(group, baseline))
      .filter(Boolean)
      .sort((a, b) => b.signals.length - a.signals.length || b.visits - a.visits)
      .slice(0, 20);

    const browsers = warnings
      .filter((warning) => warning.dimension === 'browser')
      .slice(0, 5)
      .map((browserWarning) => {
        const children = (groups || [])
          .filter((group) => group.dimension === 'browserResolution' && group.meta?.browser === browserWarning.value)
          .map((group) => groupWarning(group, browserWarning.rates, {
            minimumVisits: 50,
            minimumShare: .10,
            denominator: browserWarning.visits
          }))
          .filter(Boolean)
          .sort((a, b) => b.signals.length - a.signals.length || b.visits - a.visits)
          .slice(0, 5)
          .map((child) => {
            const fingerprints = (groups || [])
              .filter((group) => group.dimension === 'fingerprint'
                && group.meta?.browser === browserWarning.value
                && group.meta?.resolution === child.meta?.resolution)
              .map((group) => groupWarning(group, child.rates, {
                minimumVisits: 30,
                minimumShare: .10,
                denominator: child.visits
              }))
              .filter(Boolean)
              .sort((a, b) => b.signals.length - a.signals.length || b.visits - a.visits)
              .slice(0, 5);
            return { ...child, fingerprints };
          });
        return { ...browserWarning, children };
      });

    return { source, baseline, warnings, browsers, groups: groups || [], sourceDailyVisits };
  };

  const renderSignal = (item) => `<span class="warning-signal warning-signal--anomaly"><b>${escapeHtml(item.label)}:</b> <strong class="anomaly-value">${item.formatter(item.current)}</strong> vs ${item.formatter(item.baseline)} <em>${escapeHtml(item.deltaText)}</em></span>`;

  const sparklineSvg = (group, sourceDailyVisits) => {
    const points = [...(group.days || new Map()).entries()]
      .map(([date, day]) => ({ date, value: (Number(sourceDailyVisits.get(date)) || 0) ? (Number(day[1]) || 0) / Number(sourceDailyVisits.get(date)) : 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (points.length < 2) return '<span class="sparkline-empty">—</span>';
    const width = 132;
    const height = 34;
    const max = Math.max(...points.map((point) => point.value), .001);
    const coordinates = points.map((point, index) => {
      const x = points.length === 1 ? 0 : index * width / (points.length - 1);
      const y = height - (point.value / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const maxPoint = points.reduce((best, point) => point.value > best.value ? point : best, points[0]);
    return `<span class="mini-spark" title="Максимальная доля ${formatPct(maxPoint.value)} — ${formatDate(maxPoint.date)}"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Динамика доли среза"><polyline points="${coordinates}" fill="none" vector-effect="non-scaling-stroke"/></svg><small>макс. ${formatPct(maxPoint.value)}</small></span>`;
  };

  const renderWarningBlock = (model, unavailableCounters = []) => {
    if (!model?.baseline) {
      return `<h4>Отклонения относительно нормы источника</h4><p>Точный baseline ещё готовится.${unavailableCounters.length ? ` Недоступно для: ${escapeHtml(unavailableCounters.join(', '))}.` : ''}</p>`;
    }
    if (model.unavailableReason) {
      return `<h4>Отклонения относительно нормы источника</h4><p>${escapeHtml(model.unavailableReason)}</p>`;
    }
    if (!model.warnings.length) {
      return `<h4>Отклонения относительно нормы источника</h4><p>Срезов, одновременно прошедших условия по объёму и качеству, не найдено.</p><p><small>Проверяются группы от 100 визитов или от 10% трафика источника; baseline строится внутри этой же площадки.</small></p>`;
    }
    const rows = model.warnings.map((warning) => `
      <tr>
        <td><span class="warning-badge warning-badge--${warning.level}">${warning.level === 'high' ? 'Высокое' : 'Проверка'}</span><br><small>${escapeHtml(DIMENSION_LABELS[warning.dimension] || warning.dimension)}</small></td>
        <td><b>${escapeHtml(shorten(warning.value, 72))}</b></td>
        <td>${formatInt(warning.visits)}<br><small>${formatPct(warning.share)} источника</small></td>
        <td><div class="warning-signals">${warning.signals.map(renderSignal).join('')}</div></td>
        <td>${sparklineSvg(warning, model.sourceDailyVisits)}</td>
      </tr>`).join('');
    return `
      <h4>Отклонения относительно нормы источника</h4>
      <p><small>Срез сравнивается со средними показателями этой же площадки. Warning появляется только после проверки объёма и хотя бы одного сильного отклонения качества.</small></p>
      <div class="table-wrap warning-table-wrap"><table class="mini-table warning-table"><thead><tr><th>Уровень / срез</th><th>Значение</th><th>Масштаб</th><th>Что отличается</th><th>Динамика доли</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };

  const renderFingerprintList = (fingerprints) => {
    if (!fingerprints.length) return '';
    return `<ul class="fingerprint-list">${fingerprints.map((item) => `<li><b>${escapeHtml(shorten(item.value, 115))}</b> — ${formatInt(item.visits)} визитов (${formatPct(item.share)} родительского среза); ${item.signals.map((signalItem) => escapeHtml(signalItem.label)).join(', ')}</li>`).join('')}</ul>`;
  };

  const renderDrilldownBlock = (model) => {
    if (!model?.browsers?.length) {
      return '<h4>Локализация аномалий</h4><p>Выраженных browser-кластеров для раскрытия до разрешения и технического слепка не найдено.</p>';
    }
    return `
      <h4>Локализация аномалий</h4>
      <p><small>Логика раскрытия: версия браузера → разрешение → полный технический слепок. На каждом уровне показатели сравниваются уже с родительской группой, чтобы понять, где именно возникает отклонение.</small></p>
      <div class="drilldown-tree">${model.browsers.map((browser) => `
        <details open><summary><b>${escapeHtml(browser.value)}</b><span>${formatInt(browser.visits)} визитов · ${browser.signals.map((item) => escapeHtml(item.label)).join(', ')}</span></summary>
          ${browser.children.length ? browser.children.map((child) => `
            <div class="drilldown-child"><b>${escapeHtml(child.meta?.resolution || child.value)}</b><span>${formatInt(child.visits)} визитов · ${formatPct(child.share)} браузера · ${child.signals.map((item) => escapeHtml(item.label)).join(', ')}</span>${renderFingerprintList(child.fingerprints)}</div>`).join('') : '<p class="drilldown-empty">Отклонение относится ко всему браузеру и не локализовано на отдельном разрешении.</p>'}
        </details>`).join('')}</div>`;
  };


  const TECH_SEGMENT_ROWS = [
    ['cookieOn', 'Cookies включены'],
    ['cookieOff', 'Cookies выключены'],
    ['cookieUnknown', 'Статус cookies не определён'],
    ['missingReferrer', 'Referrer не определён'],
    ['resolutionUnavailable', 'Разрешение недоступно'],
    ['unknownMobileModel', 'Модель mobile/tablet не определена'],
    ['ipv6', 'IPv6']
  ];

  const TECH_INTERSECTION_ROWS = [
    ['cookieOffMissingReferrer', 'Cookies off + нет referrer'],
    ['cookieOffResolutionUnavailable', 'Cookies off + недоступно разрешение'],
    ['cookieOffUnknownMobileModel', 'Cookies off + неизвестна mobile/tablet-модель'],
    ['missingReferrerUnknownMobileModel', 'Нет referrer + неизвестна mobile/tablet-модель'],
    ['cookieOffMissingReferrerResolutionUnavailable', 'Cookies off + нет referrer + недоступно разрешение']
  ];

  const signedPp = (current, baseline) => {
    const delta = (Number(current) || 0) - (Number(baseline) || 0);
    return `${delta >= 0 ? '+' : ''}${(delta * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} п.п.`;
  };

  const signedNumber = (current, baseline, formatter) => {
    const delta = (Number(current) || 0) - (Number(baseline) || 0);
    return `${delta >= 0 ? '+' : '−'}${formatter(Math.abs(delta))}`;
  };

  const anomalyMetric = (value, formatter, active) => active
    ? `<strong class="anomaly-value">${formatter(value)}</strong>`
    : formatter(value);

  const segmentBehaviorHtml = (segment) => {
    if (!segment || !segment.visits) return '—';
    if (!segment.restVisits) return '<small>Нет сопоставимого остатка трафика</small>';
    const bounceAnomaly = segment.bounce >= .55 && segment.bounce - segment.restBounce >= .15;
    const timeAnomaly = (segment.time <= 15 && segment.restTime >= 45)
      || (segment.time >= Math.max(180, segment.restTime * 2.5));
    const depthAnomaly = segment.depth <= .6 * segment.restDepth
      || segment.depth >= Math.max(4, segment.restDepth * 2.5);
    const qualityAnomaly = segment.quality >= .02
      && segment.quality >= Math.max(segment.restQuality * 5, segment.restQuality + .02);
    return `
      <div class="tech-behavior">
        <span><b>Отказы:</b> ${anomalyMetric(segment.bounce, formatPct, bounceAnomaly)} vs ${formatPct(segment.restBounce)} <em class="${bounceAnomaly ? 'anomaly-delta' : ''}">${signedPp(segment.bounce, segment.restBounce)}</em></span>
        <span><b>Время:</b> ${anomalyMetric(segment.time, formatSeconds, timeAnomaly)} vs ${formatSeconds(segment.restTime)} <em class="${timeAnomaly ? 'anomaly-delta' : ''}">${signedNumber(segment.time, segment.restTime, formatSeconds)}</em></span>
        <span><b>Глубина:</b> ${anomalyMetric(segment.depth, formatDecimal, depthAnomaly)} vs ${formatDecimal(segment.restDepth)} <em class="${depthAnomaly ? 'anomaly-delta' : ''}">${signedNumber(segment.depth, segment.restDepth, formatDecimal)}</em></span>
        <span><b>Кач. конверсия:</b> ${anomalyMetric(segment.quality, formatPct, qualityAnomaly)} vs ${formatPct(segment.restQuality)} <em class="${qualityAnomaly ? 'anomaly-delta' : ''}">${signedPp(segment.quality, segment.restQuality)}</em></span>
      </div>`;
  };

  const segmentInsight = (segment) => {
    if (!segment?.visits || !segment.restVisits) return 'Недостаточно данных для сравнения поведения.';
    const bounceGap = Math.abs((Number(segment.bounce) || 0) - (Number(segment.restBounce) || 0));
    const timeRatio = Math.max(Number(segment.time) || 0, Number(segment.restTime) || 0)
      / Math.max(1, Math.min(Number(segment.time) || 0, Number(segment.restTime) || 0));
    const depthRatio = Math.max(Number(segment.depth) || 0, Number(segment.restDepth) || 0)
      / Math.max(.1, Math.min(Number(segment.depth) || 0, Number(segment.restDepth) || 0));
    const qualityGap = Math.abs((Number(segment.quality) || 0) - (Number(segment.restQuality) || 0));
    const signals = Number(bounceGap >= .20) + Number(timeRatio >= 2) + Number(depthRatio >= 2) + Number(qualityGap >= .02);
    if (signals >= 2) return 'Технический признак подтверждается несколькими поведенческими отличиями.';
    if (signals === 1) return 'Есть заметное поведенческое отличие — требуется проверка контекста.';
    return 'Поведение близко к остальному трафику; вероятна техническая особенность канала.';
  };

  const segmentPeriodHtml = (key, segment, period) => {
    if (!segment) return '—';
    const denominatorNote = key === 'unknownMobileModel'
      ? `<small>из ${formatInt(period.mobileTabletVisits)} mobile/tablet-визитов</small>`
      : `<small>из ${formatInt(segment.denominatorVisits || period.visits)} визитов</small>`;
    const suspiciousShare = key !== 'cookieOn' && Number(segment.share) >= .15;
    const shareHtml = suspiciousShare
      ? `<strong class="anomaly-value">${formatPct(segment.share)}</strong>`
      : formatPct(segment.share);
    return `${formatInt(segment.visits)} · ${shareHtml}<br>${denominatorNote}`;
  };

  const segmentDailyHtml = (segment) => {
    if (!segment) return '—';
    const typical = Number(segment.dailyTypicalShare) || 0;
    const maximum = Number(segment.dailyMaxShare) || 0;
    const peakAnomaly = maximum >= .20 && maximum >= Math.max(typical * 1.8, typical + .08);
    const peakShare = peakAnomaly
      ? `<strong class="anomaly-value">${formatPct(maximum)}</strong>`
      : formatPct(maximum);
    const peak = segment.dailyMaxDate
      ? `${peakShare} — ${formatDate(segment.dailyMaxDate)}<br><small>${formatInt(segment.dailyMaxVisits)} из ${formatInt(segment.dailyMaxSourceVisits)}</small>`
      : 'не было';
    return `<b>Обычно:</b> ${formatPct(typical)}<br><b>Пик:</b> ${peak}`;
  };

  const renderTechnicalSegmentRows = (rows, segments, period, includeZeroCookies = false) => rows
    .filter(([key]) => includeZeroCookies || Number(segments?.[key]?.visits) > 0)
    .map(([key, label]) => {
      const segment = segments?.[key] || null;
      return `
        <tr>
          <td><b>${escapeHtml(label)}</b><br><small>${escapeHtml(segmentInsight(segment))}</small></td>
          <td>${segmentPeriodHtml(key, segment, period)}</td>
          <td>${segmentBehaviorHtml(segment)}</td>
          <td>${segmentDailyHtml(segment)}</td>
        </tr>`;
    }).join('');

  const renderLegacyQualityBlock = (period) => {
    const rows = [
      ['Разрешение 0×0', period.zeroResolutionVisits, period.zeroResolutionShare],
      ['Разрешение не определено', period.unknownResolutionVisits, period.unknownResolutionShare],
      ['Браузер не определён', period.unknownBrowserVisits, period.unknownBrowserShare],
      ['ОС не определена', period.unknownOsVisits, period.unknownOsShare],
      ['Модель mobile/tablet не определена', period.unknownModelVisits, period.unknownModelShare],
      ['Referrer не определён', period.missingReferrerVisits, period.missingReferrerShare],
      ['IPv6', period.ipv6Visits, period.ipv6Share],
      ['Cookies выключены или статус отсутствует', period.cookieDisabledVisits, period.cookieDisabledShare]
    ].filter(([, visits]) => Number(visits) > 0)
      .map(([label, visits, share]) => `<tr><td>${escapeHtml(label)}</td><td>${formatInt(visits)}</td><td>${formatPct(share)}</td></tr>`)
      .join('');
    return `<h4>Качество технических данных</h4><p>Расширенный расчёт on/off/unknown, поведения и дневных пиков ещё готовится.</p>${rows ? `<div class="table-wrap"><table class="mini-table"><thead><tr><th>Показатель</th><th>Визиты</th><th>Доля</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`;
  };

  const renderQualityBlock = (period) => {
    if (!period) return '<h4>Качество технических данных</h4><p>Периодные показатели ещё готовятся.</p>';
    const segments = period.technicalSegments;
    if (!segments) return renderLegacyQualityBlock(period);

    const baseRows = renderTechnicalSegmentRows(TECH_SEGMENT_ROWS, segments, period, true);
    const intersectionRows = renderTechnicalSegmentRows(
      TECH_INTERSECTION_ROWS,
      period.technicalIntersections || segments,
      period,
      false
    );
    const zeroResolved = [
      ['браузер', period.unknownBrowserVisits],
      ['ОС', period.unknownOsVisits]
    ].filter(([, visits]) => !Number(visits)).map(([label]) => label);
    const resolutionDetail = `Разрешение недоступно: ${formatInt((Number(period.zeroResolutionVisits) || 0) + (Number(period.unknownResolutionVisits) || 0))} визитов, включая ${formatInt(period.zeroResolutionVisits)} как 0×0 и ${formatInt(period.unknownResolutionVisits)} без значения.`;
    return `
      <h4>Качество технических данных и поведение</h4>
      <p><small>Каждый технический сегмент сравнивается с остальным сопоставимым трафиком этой же площадки. Для неизвестной mobile/tablet-модели знаменатель и сравнение ограничены мобильными и планшетными визитами.</small></p>
      <div class="table-wrap tech-segment-table-wrap">
        <table class="mini-table tech-segment-table">
          <thead><tr><th>Технический сегмент</th><th>За период</th><th>Поведение сегмента vs остальное</th><th>Обычный день и пик</th></tr></thead>
          <tbody>${baseRows}</tbody>
        </table>
      </div>
      <p class="method-note">${escapeHtml(resolutionDetail)}${zeroResolved.length ? ` ${escapeHtml(zeroResolved.join(' и '))} определены во всех визитах.` : ''}</p>
      <h5>Пересечения технических признаков</h5>
      ${intersectionRows
        ? `<div class="table-wrap tech-segment-table-wrap"><table class="mini-table tech-segment-table"><thead><tr><th>Комбинация</th><th>За период</th><th>Поведение vs остальное</th><th>Обычный день и пик</th></tr></thead><tbody>${intersectionRows}</tbody></table></div>`
        : '<p>Заранее заданных пересечений с ненулевым объёмом не найдено.</p>'}`;
  };

  const behaviorItem = (label, visits, share, note) => `<div class="behavior-item"><strong>${formatInt(visits)}</strong><span>${escapeHtml(label)} · ${formatPct(share)}</span><small>${escapeHtml(note)}</small></div>`;

  const renderBehaviorBlock = (period) => {
    if (!period) return '<h4>Поведенческие паттерны</h4><p>Периодные показатели ещё готовятся.</p>';
    return `
      <h4>Поведенческие паттерны</h4>
      <p><small>Паттерны помогают расставить приоритеты для ручной проверки. Быстрая цель или повторный отказ не являются доказательством сами по себе.</small></p>
      <div class="behavior-grid">
        ${behaviorItem('ClientID с 5+ отказными визитами', period.repeatBounceClients5, period.repeatBounceClientShare, 'Повторяющийся отказной сценарий одного браузера.')}
        ${behaviorItem('Любая цель достигнута ≤15 секунд', period.fastAnyGoal15Visits, period.fastAnyGoal15Share, 'Проверить автоматические клики и служебные цели.')}
        ${behaviorItem('Любая цель достигнута за 15–30 секунд', period.fastAnyGoal30Visits, period.fastAnyGoal30Share, 'Погранично быстрые достижения целей.')}
        ${behaviorItem('Качественный звонок достигнут ≤15 секунд', period.fastQualityGoal15Visits, period.fastQualityGoal15Share, 'Особенно важно проверить корректность передачи офлайн-цели.')}
        ${behaviorItem('Качественный звонок достигнут за 15–30 секунд', period.fastQualityGoal30Visits, period.fastQualityGoal30Share, 'Сопоставить с логикой коллтрекинга и временем импорта.')}
        ${behaviorItem('3+ разных целей в одном визите', period.multiGoalVisits, period.multiGoalShare, 'Может указывать на нажатия по множеству элементов подряд.')}
      </div>`;
  };

  const sourceDailyVisitsMap = (rows) => {
    const result = new Map();
    for (const row of rows || []) {
      if (!result.has(row.source)) result.set(row.source, new Map());
      const map = result.get(row.source);
      map.set(row.date, (Number(map.get(row.date)) || 0) + (Number(row.visits) || 0));
    }
    return result;
  };

  const patchMetricBlocks = (
    rows,
    periodSummaries,
    unavailableCounters = [],
    sliceGroups = new Map(),
    sliceUnavailable = []
  ) => {
    const clientSummaries = summarizeClientIds(rows, periodSummaries);
    const concentrationSummaries = summarizeConcentrations(rows, periodSummaries);
    const dailyVisits = sourceDailyVisitsMap(rows);
    for (const card of document.querySelectorAll('.source-card')) {
      const sourceName = card.querySelector('summary h3')?.textContent?.trim();
      if (!sourceName) continue;
      const sections = [...card.querySelectorAll('section.detail')];

      const clientSection = sections.find((candidate) => candidate.querySelector('h4')?.textContent?.trim().startsWith('ClientID'));
      const clientSummary = clientSummaries.get(sourceName);
      if (clientSection && clientSummary) clientSection.innerHTML = renderClientIdBlock(clientSummary, unavailableCounters);

      const concentrationSummary = concentrationSummaries.get(sourceName);
      if (concentrationSummary) {
        const networkSection = sections.find((candidate) => candidate.querySelector('h4')?.textContent?.trim().startsWith('IP и подсети'));
        if (networkSection) networkSection.innerHTML = renderNetworkBlock(concentrationSummary, unavailableCounters);
        const technicalSection = sections.find((candidate) => candidate.querySelector('h4')?.textContent?.trim().startsWith('Технический профиль'));
        if (technicalSection) technicalSection.innerHTML = renderTechnicalBlock(concentrationSummary, unavailableCounters);
      }

      const grid = card.querySelector('.detail-grid');
      if (!grid) continue;
      grid.querySelectorAll?.('.api-extended-detail').forEach((element) => element.remove());
      const period = periodSummaries.get(sourceName) || null;
      const model = buildWarningModel(sourceName, sliceGroups.get(sourceName) || [], period, dailyVisits.get(sourceName) || new Map());
      const unavailable = [...new Set([...unavailableCounters, ...sliceUnavailable])];
      grid.insertAdjacentHTML('beforeend', `
        <section class="detail detail--wide api-extended-detail">${renderWarningBlock(model, unavailable)}</section>
        <section class="detail detail--wide api-extended-detail">${renderDrilldownBlock(model)}</section>
        <section class="detail detail--wide api-extended-detail">${renderQualityBlock(period)}</section>
        <section class="detail detail--wide api-extended-detail">${renderBehaviorBlock(period)}</section>`);
    }
  };

  window.FraudLabApiHelpers = Object.freeze({
    summarizeClientIds,
    summarizeDailyPeaks,
    renderClientIdBlock,
    summarizeConcentrations,
    summarizeConcentrationDailyPeaks,
    renderNetworkBlock,
    renderTechnicalBlock,
    aggregateSliceGroups,
    buildWarningModel,
    renderWarningBlock,
    renderDrilldownBlock,
    renderQualityBlock,
    renderBehaviorBlock
  });

  const renderCounters = () => {
    const counters = catalog?.counters || [];
    ui.counters.innerHTML = counters.map((counter, index) => `
      <label class="counter-option">
        <input type="checkbox" value="${counter.id}" ${index === 0 ? 'checked' : ''}>
        <span>
          <strong>${escapeHtml(counter.name || `Счётчик ${counter.id}`)}</strong>
          <small>${counter.id} · ${formatInt(counter.visits)} визитов · ${counter.from || '—'} — ${counter.to || '—'}</small>
        </span>
      </label>`).join('');

    const minDate = counters.map((counter) => counter.from).filter(Boolean).sort()[0] || '';
    const maxDate = counters.map((counter) => counter.to).filter(Boolean).sort().at(-1) || '';
    ui.dateFrom.min = minDate;
    ui.dateFrom.max = maxDate;
    ui.dateTo.min = minDate;
    ui.dateTo.max = maxDate;
    ui.dateTo.value = maxDate;
    ui.dateFrom.value = maxDate ? (addDays(maxDate, -13) < minDate ? minDate : addDays(maxDate, -13)) : '';
    ui.generated.textContent = catalog.generatedAt
      ? `Данные обновлены ${formatDateTime(catalog.generatedAt)} · доступны по ${catalog.dataThrough || maxDate} · campaign: ${campaignFilterLabel()}`
      : '';
    ui.counters.querySelectorAll('input').forEach((input) => input.addEventListener('change', updateButton));
    updateButton();
  };

  const fetchJson = async (path) => {
    const response = await fetch(`${DATA_BASE}${path}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };

  const loadCatalog = async () => {
    status('Проверяю доступные счётчики и периоды…');
    try {
      catalog = await fetchJson('catalog.json');
      if (!Array.isArray(catalog.counters) || !catalog.counters.length) {
        throw new Error('в каталоге пока нет подготовленных счётчиков');
      }
      renderCounters();
      status(`Выберите счётчик и период. В анализ входят только кампании, содержащие ${campaignFilterLabel()}.`, 'ready');
    } catch (error) {
      catalog = null;
      updateButton();
      status(`Первая API-выгрузка ещё готовится: ${error.message}. Ручная загрузка CSV ниже остаётся доступной.`, 'warning');
    }
  };

  const loadPeriodSummaries = async (selected, from, to) => {
    const multipleCounters = selected.length > 1;
    const summaries = new Map();
    const unavailable = [];
    await Promise.all(selected.map(async (counter) => {
      const info = counter.periodMetrics || counter.clientIdPeriods;
      const name = counter.name || `Счётчик ${counter.id}`;
      if (!info || from < info.from || to > info.to || daysBetween(from, to) > Number(info.maxDays || 0)) {
        unavailable.push(name);
        return;
      }
      const path = String(info.pathTemplate || '').replace('{from}', from);
      if (!path) {
        unavailable.push(name);
        return;
      }
      try {
        const payload = await fetchJson(path);
        const range = payload.ranges?.[to];
        if (!range) {
          unavailable.push(name);
          return;
        }
        for (const [source, summary] of Object.entries(range)) {
          summaries.set(multipleCounters ? `${source} · ${name}` : source, summary);
        }
      } catch (error) {
        unavailable.push(name);
      }
    }));
    return { summaries, unavailable: [...new Set(unavailable)] };
  };

  const loadSliceGroups = async (selected, from, to) => {
    const multipleCounters = selected.length > 1;
    const groups = [];
    const unavailable = [];
    await Promise.all(selected.map(async (counter) => {
      const info = counter.sliceMetrics;
      const name = counter.name || `Счётчик ${counter.id}`;
      if (!info || from < info.from || to > info.to || daysBetween(from, to) > Number(info.maxDays || 0)) {
        unavailable.push(name);
        return;
      }
      const availableMonths = new Set(info.months || []);
      const months = monthsBetween(from, to).filter((month) => !availableMonths.size || availableMonths.has(month));
      try {
        const payloads = await Promise.all(months.map((month) => fetchJson(String(info.pathTemplate || '').replace('{month}', month))));
        for (const payload of payloads) {
          for (const raw of payload.groups || []) {
            groups.push({
              ...raw,
              source: multipleCounters ? `${raw.source} · ${name}` : raw.source,
              counterId: counter.id,
              counterName: name
            });
          }
        }
      } catch (error) {
        unavailable.push(name);
      }
    }));
    return { groups, unavailable: [...new Set(unavailable)] };
  };

  const runApiAnalysis = async () => {
    const ids = checkedCounters();
    const from = ui.dateFrom.value;
    const to = ui.dateTo.value;
    if (!ids.length || !from || !to || from > to) return;

    const selected = (catalog.counters || []).filter((counter) => ids.includes(Number(counter.id)));
    const jobs = selected.flatMap((counter) => selectedFiles(counter, from, to)
      .map((file) => ({ counter, file })));
    if (!jobs.length) {
      status('Для выбранного периода ещё нет подготовленных API-файлов.', 'warning');
      return;
    }

    ui.analyze.disabled = true;
    status('Загружаю данные, baseline и безопасные срезы за выбранный период…');

    try {
      const [payloads, periodData, sliceData] = await Promise.all([
        Promise.all(jobs.map(async ({ counter, file }) => ({ counter, payload: await fetchJson(file.path) }))),
        loadPeriodSummaries(selected, from, to),
        loadSliceGroups(selected, from, to)
      ]);
      const multipleCounters = selected.length > 1;
      const rows = [];
      for (const { counter, payload } of payloads) {
        for (const sourceRow of payload.rows || []) {
          if (sourceRow.date < from || sourceRow.date > to) continue;
          const baseSource = String(sourceRow.source || 'Не определено');
          rows.push({
            ...sourceRow,
            source: multipleCounters ? `${baseSource} · ${counter.name || counter.id}` : baseSource,
            counterId: counter.id,
            counterName: counter.name || `Счётчик ${counter.id}`
          });
        }
      }
      if (!rows.length) throw new Error('после фильтрации периода не осталось дневных данных');
      if (!window.FraudLab?.analyzeApiRows) throw new Error('модуль анализа API не загрузился; обновите страницу');

      const counterLabel = selected.map((counter) => `${counter.name || 'Счётчик'} (${counter.id})`).join(', ');
      window.FraudLab.analyzeApiRows(rows, {
        mode: 'api',
        label: `Logs API · ${counterLabel} · ${from} — ${to} · campaign ${campaignFilterLabel()}`,
        generatedAt: catalog.generatedAt
      });
      const sliceGroups = aggregateSliceGroups(sliceData.groups, from, to);
      patchMetricBlocks(rows, periodData.summaries, periodData.unavailable, sliceGroups, sliceData.unavailable);
      const unavailable = [...new Set([...periodData.unavailable, ...sliceData.unavailable])];
      status(
        `Готово: ${formatInt(rows.reduce((sum, row) => sum + (Number(row.visits) || 0), 0))} визитов, `
        + `${new Set(rows.map((row) => row.date)).size} дней, ${selected.length} ${selected.length === 1 ? 'счётчик' : 'счётчика'} · campaign ${campaignFilterLabel()}.`,
        unavailable.length ? 'warning' : 'ready'
      );
    } catch (error) {
      status(`Не удалось выполнить API-анализ: ${error.message}`, 'error');
    } finally {
      updateButton();
    }
  };

  ui.dateFrom.addEventListener('change', updateButton);
  ui.dateTo.addEventListener('change', updateButton);
  ui.analyze.addEventListener('click', runApiAnalysis);

  loadCatalog();
})();
