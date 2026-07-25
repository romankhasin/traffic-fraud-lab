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

  const selectedFiles = (counter, from, to) => (counter.files || [])
    .filter((file) => file.from && file.to && file.to >= from && file.from <= to);

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
          uniqueClientIds: Number(row.uniqueClientIds) || 0
        }
      : best;
  }, null) || { value: 0, date: '', sampleVisits: 0, uniqueClientIds: 0 };

  const coverageLevel = (coverage) => {
    if (coverage >= .95) return 'высокое';
    if (coverage >= .65) return 'достаточное';
    if (coverage >= .35) return 'ограниченное';
    return 'низкое';
  };

  const summarizeClientIds = (rows) => {
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
      const coverageRows = sourceRows
        .map((row) => {
          const dayTechVisits = Number(row.tech?.visits ?? row.visits) || 0;
          const dayClientIdVisits = Number(row.clientIdVisits) || 0;
          return {
            date: String(row.date || ''),
            value: dayTechVisits ? Math.min(1, dayClientIdVisits / dayTechVisits) : 0,
            hasTechData: dayTechVisits > 0
          };
        })
        .filter((row) => row.hasTechData);
      const minCoverage = coverageRows.reduce((lowest, row) => (
        !lowest || row.value < lowest.value ? row : lowest
      ), null) || { value: 0, date: '' };

      const clientPeerRows = sourceRows.filter((row) => (
        (Number(row.clientIdVisits) || 0) >= 100
        && (Number(row.clientIdCoverage) || 0) >= .5
        && (Number(row.uniqueClientIds) || 0) >= 10
      ));
      const typicalClientIdVisits = median(clientPeerRows.map((row) => row.clientIdVisits));
      const representativeThreshold = Math.max(200, typicalClientIdVisits * .15);
      const representativeRows = sourceRows.filter((row) => (
        (Number(row.clientIdVisits) || 0) >= representativeThreshold
        && (Number(row.clientIdCoverage) || 0) >= .5
        && (Number(row.uniqueClientIds) || 0) >= 10
      ));

      summaries.set(source, {
        hasClientIds: clientIdVisits > 0,
        periodCoverage: techVisits ? Math.min(1, clientIdVisits / techVisits) : 0,
        lowCoverageDays: coverageRows.filter((row) => row.value < .65).length,
        minCoverage,
        maxUnique: maxBy(sourceRows, (row) => row.uniqueClientIds),
        representativeDays: representativeRows.length,
        representativeThreshold,
        maxVisitsPerClientId: maxBy(representativeRows, (row) => row.visitsPerClientId),
        maxTop1: maxBy(representativeRows, (row) => row.topClientId?.share),
        maxTop10: maxBy(representativeRows, (row) => row.top10ClientShare)
      });
    }
    return summaries;
  };

  const representativeMetric = (label, metric, formatter) => metric.date
    ? `<p><b>${label}:</b> ${formatter(metric.value)} — ${formatDate(metric.date)}<br><small>Выборка: ${formatInt(metric.sampleVisits)} визитов с ClientID</small></p>`
    : `<p><b>${label}:</b> недостаточно репрезентативных дневных данных</p>`;

  const patchClientIdBlocks = (rows) => {
    const summaries = summarizeClientIds(rows);
    for (const card of document.querySelectorAll('.source-card')) {
      const sourceName = card.querySelector('summary h3')?.textContent?.trim();
      const summary = summaries.get(sourceName);
      if (!summary) continue;
      const section = [...card.querySelectorAll('section.detail')]
        .find((candidate) => candidate.querySelector('h4')?.textContent?.trim().startsWith('ClientID'));
      if (!section) continue;
      if (!summary.hasClientIds) {
        section.innerHTML = '<h4>ClientID</h4><p>ClientID не найден в выбранных данных.</p>';
        continue;
      }

      section.innerHTML = `
        <h4>ClientID</h4>
        <p><b>Качество данных за период</b></p>
        <p><b>Покрытие ClientID:</b> ${formatPct(summary.periodCoverage)} — ${coverageLevel(summary.periodCoverage)}</p>
        <p><b>Дней с покрытием ниже 65%:</b> ${formatInt(summary.lowCoverageDays)}</p>
        <p><b>Минимальное дневное покрытие:</b> ${formatPct(summary.minCoverage.value)} — ${formatDate(summary.minCoverage.date)}</p>
        <p>Высокое покрытие повышает надёжность оценки и не является фрод-сигналом. Низкое покрытие снижает уверенность.</p>
        <p><b>Дневные максимумы</b></p>
        <p><b>Максимум уникальных:</b> ${formatInt(summary.maxUnique.value)} — ${formatDate(summary.maxUnique.date)}<br><small>Этот показатель отражает масштаб дня и рассчитывается по всем дням.</small></p>
        <p><b>Репрезентативных дней:</b> ${formatInt(summary.representativeDays)}</p>
        <p><small>Для концентраций учитываются дни с покрытием ClientID от 50%, минимум 10 уникальными ClientID и не менее ${formatInt(summary.representativeThreshold)} визитов с ClientID.</small></p>
        ${representativeMetric('Максимум визитов на ClientID', summary.maxVisitsPerClientId, formatDecimal)}
        ${representativeMetric('Максимальная доля топ-1', summary.maxTop1, formatPct)}
        ${representativeMetric('Максимальная доля топ-10', summary.maxTop10, formatPct)}
        <p>Максимумы могут относиться к разным датам.</p>`;
    }
  };

  window.FraudLabApiHelpers = Object.freeze({ summarizeClientIds });

  const renderCounters = () => {
    const counters = catalog?.counters || [];
    ui.counters.innerHTML = counters.map((counter, index) => `
      <label class="counter-option">
        <input type="checkbox" value="${counter.id}" ${index === 0 ? 'checked' : ''}>
        <span>
          <strong>${String(counter.name || `Счётчик ${counter.id}`).replace(/[&<>"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]))}</strong>
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

  const loadCatalog = async () => {
    status('Проверяю доступные счётчики и периоды…');
    try {
      const response = await fetch(`${DATA_BASE}catalog.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`каталог пока недоступен (${response.status})`);
      catalog = await response.json();
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

  const fetchJson = async (path) => {
    const response = await fetch(`${DATA_BASE}${path}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
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
    status(`Загружаю ${jobs.length} ${jobs.length === 1 ? 'месячный файл' : 'месячных файлов'}…`);

    try {
      const payloads = await Promise.all(jobs.map(async ({ counter, file }) => ({
        counter,
        payload: await fetchJson(file.path)
      })));
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
      if (!window.FraudLab?.analyzeApiRows) {
        throw new Error('модуль анализа API не загрузился; обновите страницу');
      }

      const counterLabel = selected.map((counter) => `${counter.name || 'Счётчик'} (${counter.id})`).join(', ');
      window.FraudLab.analyzeApiRows(rows, {
        mode: 'api',
        label: `Logs API · ${counterLabel} · ${from} — ${to} · campaign ${campaignFilterLabel()}`,
        generatedAt: catalog.generatedAt
      });
      patchClientIdBlocks(rows);
      status(
        `Готово: ${formatInt(rows.reduce((sum, row) => sum + (Number(row.visits) || 0), 0))} визитов, `
        + `${new Set(rows.map((row) => row.date)).size} дней, ${selected.length} ${selected.length === 1 ? 'счётчик' : 'счётчика'} · campaign ${campaignFilterLabel()}.`,
        'ready'
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
