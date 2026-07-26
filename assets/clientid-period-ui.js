(() => {
  'use strict';

  const DATA_BASE = 'https://raw.githubusercontent.com/romankhasin/-level-group-dashboard/main/data/fraud/';
  const state = {
    rows: [],
    context: null,
    periodSummaries: new Map(),
    periodReady: false,
    unavailableCounters: [],
    requestToken: 0,
    patching: false,
  };

  const formatInt = (value) => Math.round(Number(value) || 0).toLocaleString('ru-RU');
  const formatPct = (value, digits = 1) => `${((Number(value) || 0) * 100).toLocaleString('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
  const formatDecimal = (value) => (Number(value) || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const formatDate = (value) => {
    const parts = String(value || '').split('-');
    return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(value || '—');
  };

  const coverageLevel = (coverage) => {
    if (coverage >= .95) return 'высокое';
    if (coverage >= .65) return 'достаточное';
    if (coverage >= .35) return 'ограниченное';
    return 'низкое';
  };

  const median = (values) => {
    const safe = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!safe.length) return 0;
    const middle = Math.floor(safe.length / 2);
    return safe.length % 2 ? safe[middle] : (safe[middle - 1] + safe[middle]) / 2;
  };

  const maxBy = (rows, getter) => rows.reduce((best, row) => {
    const value = Number(getter(row)) || 0;
    return !best || value > best.value
      ? {
          value,
          date: String(row.date || ''),
          sampleVisits: Number(row.clientIdVisits) || 0,
        }
      : best;
  }, null) || { value: 0, date: '', sampleVisits: 0 };

  const buildDailyPeaks = (rows) => {
    const grouped = new Map();
    for (const row of rows || []) {
      const source = String(row.source || 'Не определено');
      if (!grouped.has(source)) grouped.set(source, []);
      grouped.get(source).push(row);
    }

    const result = new Map();
    for (const [source, sourceRows] of grouped.entries()) {
      const peers = sourceRows.filter((row) => (
        (Number(row.clientIdVisits) || 0) >= 100
        && (Number(row.clientIdCoverage) || 0) >= .5
        && (Number(row.uniqueClientIds) || 0) >= 10
      ));
      const typicalVisits = median(peers.map((row) => row.clientIdVisits));
      const threshold = Math.max(200, typicalVisits * .15);
      const representative = sourceRows.filter((row) => (
        (Number(row.clientIdVisits) || 0) >= threshold
        && (Number(row.clientIdCoverage) || 0) >= .5
        && (Number(row.uniqueClientIds) || 0) >= 10
      ));
      result.set(source, {
        representativeDays: representative.length,
        threshold,
        maxTop1: maxBy(representative, (row) => row.topClientId?.share),
        maxTop10: maxBy(representative, (row) => row.top10ClientShare),
        maxVisitsPerClientId: maxBy(representative, (row) => row.visitsPerClientId),
      });
    }
    return result;
  };

  const peakMetric = (label, metric, formatter) => metric?.date
    ? `<p><b>${label}:</b> ${formatter(metric.value)} — ${formatDate(metric.date)}<br><small>Выборка: ${formatInt(metric.sampleVisits)} визитов с ClientID</small></p>`
    : `<p><b>${label}:</b> недостаточно репрезентативных дневных данных</p>`;

  const renderDailyPeaks = (daily) => {
    if (!daily) return '';
    return `
      <p><b>Пиковые дневные значения</b></p>
      <p><small>Используются только дни с покрытием ClientID от 50%, минимум 10 уникальными ClientID и не менее ${formatInt(daily.threshold)} визитов с ClientID.</small></p>
      <p><b>Репрезентативных дней:</b> ${formatInt(daily.representativeDays)}</p>
      ${peakMetric('Максимум визитов на ClientID', daily.maxVisitsPerClientId, formatDecimal)}
      ${peakMetric('Максимальная доля топ-1', daily.maxTop1, formatPct)}
      ${peakMetric('Максимальная доля топ-10', daily.maxTop10, formatPct)}`;
  };

  const renderClientIdHtml = (period, daily, unavailableCounters = []) => {
    if (!period) {
      const unavailable = unavailableCounters.length
        ? ` Периодные данные пока недоступны для: ${unavailableCounters.join(', ')}.`
        : '';
      return `
        <h4>ClientID</h4>
        <p><b>За выбранный период</b></p>
        <p>Точный периодный расчёт ещё готовится.${unavailable}</p>
        ${renderDailyPeaks(daily)}`;
    }

    const representativeNote = period.representative
      ? 'Объём достаточен для интерпретации концентраций.'
      : 'Объём или покрытие недостаточны для уверенной интерпретации концентраций.';
    return `
      <h4>ClientID</h4>
      <p><b>За выбранный период</b></p>
      <p><b>Покрытие ClientID:</b> ${formatPct(period.coverage)} — ${coverageLevel(period.coverage)}</p>
      <p><b>Визитов с ClientID:</b> ${formatInt(period.clientIdVisits)} из ${formatInt(period.visits)}</p>
      <p><b>Уникальных ClientID:</b> ${formatInt(period.uniqueClientIds)}</p>
      <p><b>Визитов на ClientID:</b> ${formatDecimal(period.visitsPerClientId)}</p>
      <p><b>Доля топ-1:</b> ${formatPct(period.top1Share)} <small>(${formatInt(period.top1Visits)} визитов)</small></p>
      <p><b>Доля топ-10:</b> ${formatPct(period.top10Share)} <small>(${formatInt(period.top10Visits)} визитов)</small></p>
      <p><b>Доля повторных визитов:</b> ${formatPct(period.repeatClientVisitShare)}</p>
      <p><b>Дней с трафиком:</b> ${formatInt(period.activeDays)}</p>
      <p>Высокое покрытие повышает надёжность оценки и не является фрод-сигналом. ${representativeNote}</p>
      ${renderDailyPeaks(daily)}`;
  };

  const fetchJson = async (path) => {
    const response = await fetch(`${DATA_BASE}${path}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  };

  const checkedCounterIds = () => [...document.querySelectorAll('#api-counter-list input[type="checkbox"]:checked')]
    .map((input) => Number(input.value))
    .filter(Number.isFinite);

  const loadPeriodSummaries = async (token) => {
    const from = document.querySelector('#api-date-from')?.value || '';
    const to = document.querySelector('#api-date-to')?.value || '';
    const ids = checkedCounterIds();
    if (!from || !to || !ids.length) return;

    const catalog = await fetchJson('catalog.json');
    const counters = (catalog.counters || []).filter((counter) => ids.includes(Number(counter.id)));
    const multipleCounters = counters.length > 1;
    const summaries = new Map();
    const unavailable = [];

    await Promise.all(counters.map(async (counter) => {
      const info = counter.clientIdPeriods;
      const name = counter.name || `Счётчик ${counter.id}`;
      if (!info || from < info.from || to > info.to) {
        unavailable.push(name);
        return;
      }
      const dayCount = Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1;
      if (dayCount > Number(info.maxDays || 0)) {
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
          const displaySource = multipleCounters ? `${source} · ${name}` : source;
          summaries.set(displaySource, summary);
        }
      } catch (error) {
        unavailable.push(name);
      }
    }));

    if (token !== state.requestToken) return;
    state.periodSummaries = summaries;
    state.unavailableCounters = [...new Set(unavailable)];
    state.periodReady = true;
    patchClientIdSections();
  };

  const patchClientIdSections = () => {
    if (state.patching || !state.periodReady || !state.rows.length) return;
    const sourceList = document.querySelector('#source-list');
    if (!sourceList?.children?.length) return;
    state.patching = true;
    try {
      const dailyPeaks = buildDailyPeaks(state.rows);
      for (const card of sourceList.querySelectorAll('.source-card')) {
        const sourceName = card.querySelector('summary h3')?.textContent?.trim();
        if (!sourceName) continue;
        const section = [...card.querySelectorAll('section.detail')]
          .find((candidate) => candidate.querySelector('h4')?.textContent?.trim().startsWith('ClientID'));
        if (!section) continue;
        section.innerHTML = renderClientIdHtml(
          state.periodSummaries.get(sourceName),
          dailyPeaks.get(sourceName),
          state.unavailableCounters,
        );
      }
    } finally {
      state.patching = false;
    }
  };

  if (window.FraudLab?.analyzeApiRows) {
    const originalAnalyzeApiRows = window.FraudLab.analyzeApiRows;
    window.FraudLab.analyzeApiRows = function analyzeApiRowsWithPeriod(rows, context) {
      state.rows = Array.isArray(rows) ? rows : [];
      state.context = context || null;
      const result = originalAnalyzeApiRows.call(this, rows, context);
      queueMicrotask(patchClientIdSections);
      return result;
    };
  }

  const analyzeButton = document.querySelector('#api-analyze-button');
  if (analyzeButton) {
    analyzeButton.addEventListener('click', () => {
      state.requestToken += 1;
      state.periodReady = false;
      state.periodSummaries = new Map();
      state.unavailableCounters = [];
      loadPeriodSummaries(state.requestToken).catch(() => {
        state.periodReady = true;
        state.unavailableCounters = ['выбранный счётчик'];
        patchClientIdSections();
      });
    });
  }

  const sourceList = document.querySelector('#source-list');
  if (sourceList && window.MutationObserver) {
    new MutationObserver(() => patchClientIdSections())
      .observe(sourceList, { childList: true, subtree: true });
  }

  window.FraudLabClientIdPeriodUi = Object.freeze({
    buildDailyPeaks,
    renderClientIdHtml,
  });
})();
