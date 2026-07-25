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

  const formatDateTime = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? String(value || '—')
      : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
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
      ? `Данные обновлены ${formatDateTime(catalog.generatedAt)} · доступны по ${catalog.dataThrough || maxDate}`
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
      status('Выберите счётчик и период. Анализ выполняется по полным дневным агрегатам Logs API.', 'ready');
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
        label: `Logs API · ${counterLabel} · ${from} — ${to}`,
        generatedAt: catalog.generatedAt
      });
      status(
        `Готово: ${formatInt(rows.reduce((sum, row) => sum + (Number(row.visits) || 0), 0))} визитов, `
        + `${new Set(rows.map((row) => row.date)).size} дней, ${selected.length} ${selected.length === 1 ? 'счётчик' : 'счётчика'}.`,
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
