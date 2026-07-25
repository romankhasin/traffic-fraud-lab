(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const FIELD_DEFS = {
    date: ['дата визита','дата','день визита','день','visit date','visitdate','date','day'],
    source: ['utm source','utmsource','источник трафика','источник','площадка','source'],
    campaign: ['utm campaign','utmcampaign','кампания','campaign'],
    ip: ['ip адрес','ip-адрес','ip address','ipaddress','ip'],
    clientId: ['client id','clientid','client id яндекс метрика','идентификатор клиента','id клиента','ид клиента','ym s clientid','ym s client id'],
    visits: ['визиты','визитов','visits','sessions','сеансы'],
    users: ['посетители','пользователи','users','visitors'],
    bounce: ['отказы','показатель отказов','bounce rate','bouncerate','bounce'],
    time: ['время на сайте','среднее время на сайте','длительность визита','avg visit duration','avgvisitduration','time on site','duration'],
    newShare: ['доля новых посетителей','новые посетители','new users share','new visitors','newshare'],
    browser: ['версия браузера','полная версия браузера','браузер','browser version','browser'],
    os: ['операционная система детально','операционная система (детально)','операционная система','os version','operating system','os'],
    device: ['модель устройства','тип устройства','устройство','device model','device type','device'],
    resolution: ['разрешение экрана','разрешение','screen resolution','resolution'],
    qualityConversion: ['конверсия (первично-качественные звонки uis)','первично-качественные звонки','качественные звонки','quality calls','qualified calls','quality conversion'],
    primaryConversion: ['конверсия (первичные звонки uis)','первичные звонки','primary calls','primary conversion']
  };

  const MIN_SOURCE_VISITS = 20;

  const LABELS = {
    date: 'Дата', source: 'Источник', ip: 'IP', clientId: 'ClientID', visits: 'Визиты', users: 'Посетители', bounce: 'Отказы', time: 'Время',
    newShare: 'Новые', browser: 'Браузер', os: 'ОС', device: 'Устройство', resolution: 'Разрешение',
    qualityConversion: 'Качественные', primaryConversion: 'Первичные'
  };

  const REQUIRED = {
    ip: ['date', 'source', 'ip', 'visits'],
    tech: ['date', 'source', 'visits']
  };

  const state = {
    ipRows: null,
    techRows: null,
    ipMap: null,
    techMap: null,
    results: [],
    dailyResults: [],
    monthlyResults: [],
    analysisContext: '',
    dataMode: 'manual',
    riskFilter: 'all',
    query: ''
  };

  const ui = {
    ipFile: $('#ip-file'),
    techFile: $('#tech-file'),
    analyze: $('#analyze-button'),
    reset: $('#reset-button'),
    demo: $('#demo-button'),
    results: $('#results'),
    validation: $('#validation'),
    export: $('#export-button'),
    search: $('#source-search'),
    table: $('#source-table'),
    list: $('#source-list'),
    kpis: $('#kpi-grid'),
    conclusion: $('#conclusion'),
    summary: $('#summary-text'),
    dailyTable: $('#daily-table'),
    monthlyTable: $('#monthly-table'),
    dailySummary: $('#daily-summary')
  };

  function normalize(value) {
    return String(value ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[()\[\]{}]/g, ' ')
      .replace(/[_./\\-]+/g, ' ')
      .replace(/[^a-zа-я0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function detectMap(headers) {
    const normalized = headers.map((header) => ({ original: header, normalized: normalize(header) }));
    const map = {};
    for (const [field, aliases] of Object.entries(FIELD_DEFS)) {
      const normalizedAliases = aliases.map(normalize);
      let match = normalized.find((item) => normalizedAliases.includes(item.normalized));
      if (!match) {
        match = normalized.find((item) => normalizedAliases.some((alias) => alias.length > 3 && (item.normalized.includes(alias) || alias.includes(item.normalized))));
      }
      if (match) map[field] = match.original;
    }
    return map;
  }

  function coerceClientIdsToText(rows, map) {
    if (!map.clientId) return;
    for (const row of rows) {
      const value = row[map.clientId];
      row[map.clientId] = value == null ? '' : String(value).trim();
    }
  }

  function countCsvDelimiter(record, delimiter) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < record.length; index += 1) {
      const char = record[index];
      if (char === '"') {
        if (quoted && record[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && char === delimiter) count += 1;
    }
    return count;
  }

  function detectCsvDelimiter(text) {
    const header = text.split(/\r?\n/, 1)[0] || '';
    return [';', ',', '\t']
      .map((delimiter) => ({ delimiter, count: countCsvDelimiter(header, delimiter) }))
      .sort((a, b) => b.count - a.count)[0]?.delimiter || ';';
  }

  function parseCsvRows(text) {
    let source = String(text || '').replace(/^\uFEFF/, '');
    const separator = source.match(/^sep=(.)\r?\n/i);
    const delimiter = separator ? separator[1] : detectCsvDelimiter(source);
    if (separator) source = source.slice(separator[0].length);

    const table = [];
    let row = [];
    let value = '';
    let quoted = false;

    const pushValue = () => {
      row.push(value);
      value = '';
    };
    const pushRow = () => {
      pushValue();
      if (row.some((cell) => String(cell).trim() !== '')) table.push(row);
      row = [];
    };

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) pushValue();
      else if (char === '\n') pushRow();
      else if (char !== '\r') value += char;
    }
    if (value || row.length) pushRow();

    const headers = (table.shift() || []).map((header, index) => String(header).trim() || `Колонка ${index + 1}`);
    return table.map((cells) => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] ?? '')])));
  }

  async function readRows(file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    let rows;
    if (extension === 'csv') {
      rows = parseCsvRows(await file.text());
    } else {
      if (!window.XLSX) throw new Error('Не загрузилась библиотека чтения Excel. Проверьте интернет и обновите страницу.');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      if (!workbook.SheetNames.length) throw new Error('В файле не найдено листов.');
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
    }
    if (!rows.length) throw new Error('Файл пустой или таблица не распознана.');
    return rows;
  }

  async function handleFile(kind, file) {
    if (!file) return;
    setCard(kind, 'loading', 'Читаю файл…', file.name);
    try {
      const rows = await readRows(file);
      const map = detectMap(Object.keys(rows[0] || {}));
      if (kind === 'tech') coerceClientIdsToText(rows, map);
      const missing = REQUIRED[kind].filter((field) => !map[field]);
      state[`${kind}Rows`] = rows;
      state[`${kind}Map`] = map;
      renderMapping(kind, map);
      if (missing.length) {
        setCard(kind, 'error', 'Нужна проверка', `${file.name} · ${formatInt(rows.length)} строк`);
        showValidation(`В ${kind === 'ip' ? 'IP' : 'технической'} выгрузке не распознаны обязательные поля: ${missing.map((field) => LABELS[field]).join(', ')}.`, true);
      } else {
        const invalidDates = rows.slice(0, 100).filter((row) => !parseDate(row[map.date])).length;
        if (invalidDates > 10) {
          setCard(kind, 'error', 'Проблема с датой', `${file.name} · ${formatInt(rows.length)} строк`);
          showValidation(`Поле даты найдено, но значения не распознаются. Используйте дату вида 25.07.2026 или 2026-07-25.`, true);
        } else {
          setCard(kind, 'ready', 'Готово', `${file.name} · ${formatInt(rows.length)} строк`);
          clearValidationIfReady();
        }
      }
    } catch (error) {
      state[`${kind}Rows`] = null;
      state[`${kind}Map`] = null;
      setCard(kind, 'error', 'Ошибка файла', error.message);
      showValidation(error.message, true);
    }
    updateAnalyzeState();
  }

  function setCard(kind, status, statusText, metaText) {
    const card = $(`#${kind}-card`);
    card.classList.remove('ready', 'error');
    if (status === 'ready') card.classList.add('ready');
    if (status === 'error') card.classList.add('error');
    $(`#${kind}-status`).textContent = statusText;
    $(`#${kind}-meta`).textContent = metaText;
  }

  function renderMapping(kind, map) {
    const container = $(`#${kind}-mapping`);
    const fields = kind === 'ip'
      ? ['date','source','ip','visits','users','bounce','time','newShare','qualityConversion','primaryConversion']
      : ['date','source','clientId','visits','users','bounce','time','newShare','browser','os','device','resolution','qualityConversion','primaryConversion'];
    container.hidden = false;
    container.innerHTML = `<strong>Распознанные поля</strong><div class="mapping-grid">${fields.map((field) => {
      const value = map[field];
      return `<span class="${value ? '' : 'missing'}" title="${escapeHtml(value || 'Не найдено')}">${escapeHtml(LABELS[field])}: ${escapeHtml(value || '—')}</span>`;
    }).join('')}</div>`;
  }

  function updateAnalyzeState() {
    const validIp = state.ipRows && REQUIRED.ip.every((field) => state.ipMap?.[field]);
    const validTech = state.techRows && REQUIRED.tech.every((field) => state.techMap?.[field]);
    ui.analyze.disabled = !(validIp && validTech);
  }

  function showValidation(message, isError = false) {
    ui.validation.hidden = false;
    ui.validation.classList.toggle('error', isError);
    ui.validation.textContent = message;
  }

  function clearValidationIfReady() {
    if (state.ipRows && state.techRows && REQUIRED.ip.every((field) => state.ipMap?.[field]) && REQUIRED.tech.every((field) => state.techMap?.[field])) {
      const clientIdNote = state.techMap?.clientId
        ? ' ClientID найден в технической выгрузке и будет учитываться только из неё.'
        : ' ClientID в технической выгрузке не найден; анализ продолжится без ClientID-сигналов.';
      showValidation(`Оба файла распознаны, включая дату. Каждый день будет сравниваться с остальными днями того же источника.${clientIdNote}`, false);
    }
  }

  function parseNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value ?? '')
      .replace(/\u00a0/g, '')
      .replace(/\s+/g, '')
      .replace(/,/g, '.')
      .replace(/[^0-9.+-]/g, '');
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : 0;
  }

  function parseRate(value) {
    if (value === '' || value == null) return 0;
    const hasPercent = String(value).includes('%');
    const number = parseNumber(value);
    return hasPercent || Math.abs(number) > 1.5 ? number / 100 : number;
  }

  function parseDuration(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds();
    if (typeof value === 'number' && Number.isFinite(value)) return value > 0 && value < 1 ? value * 86400 : value;
    const text = String(value ?? '').trim();
    if (!text) return 0;
    if (/^\d+(?:[.,]\d+)?$/.test(text)) return parseNumber(text);
    const parts = text.split(':').map(parseNumber);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return dateKey(value);
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (window.XLSX?.SSF?.parse_date_code) {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
      }
      const excelDate = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      if (!Number.isNaN(excelDate.getTime())) return dateKey(excelDate, true);
    }
    const text = String(value ?? '').trim();
    if (!text) return '';
    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (match) return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : dateKey(parsed);
  }

  function dateKey(date, utc = false) {
    const year = utc ? date.getUTCFullYear() : date.getFullYear();
    const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
    const day = utc ? date.getUTCDate() : date.getDate();
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function sourceName(value) {
    const text = String(value ?? '').trim();
    return !text || ['не определено','undefined','none','(not set)'].includes(text.toLowerCase()) ? 'Не определено' : text;
  }

  function isTotalRow(value) {
    const text = normalize(value);
    return text.startsWith('итого') || text === 'total' || text.startsWith('всего');
  }

  function emptyBucket() {
    return { visits: 0, users: 0, bounceWeighted: 0, timeWeighted: 0, newWeighted: 0, qualityWeighted: 0, primaryWeighted: 0 };
  }

  function addMetrics(bucket, row, map) {
    const visits = Math.max(0, parseNumber(row[map.visits]));
    const users = map.users ? Math.max(0, parseNumber(row[map.users])) : visits;
    bucket.visits += visits;
    bucket.users += users;
    bucket.bounceWeighted += (map.bounce ? parseRate(row[map.bounce]) : 0) * visits;
    bucket.timeWeighted += (map.time ? parseDuration(row[map.time]) : 0) * visits;
    bucket.newWeighted += (map.newShare ? parseRate(row[map.newShare]) : 0) * (users || visits);
    bucket.qualityWeighted += (map.qualityConversion ? parseRate(row[map.qualityConversion]) : 0) * visits;
    bucket.primaryWeighted += (map.primaryConversion ? parseRate(row[map.primaryConversion]) : 0) * visits;
    return visits;
  }

  function finishBucket(bucket) {
    const visits = bucket.visits || 1;
    const users = bucket.users || bucket.visits || 1;
    return {
      visits: bucket.visits,
      users: bucket.users,
      bounce: bucket.bounceWeighted / visits,
      time: bucket.timeWeighted / visits,
      newShare: bucket.newWeighted / users,
      quality: bucket.qualityWeighted / visits,
      primary: bucket.primaryWeighted / visits
    };
  }

  function increase(map, key, value) {
    const safeKey = String(key || 'Не определено').trim() || 'Не определено';
    map.set(safeKey, (map.get(safeKey) || 0) + value);
  }

  function subnetOf(ipValue) {
    const ip = String(ipValue ?? '').trim();
    if (!ip) return 'Не определено';
    if (ip.includes(':')) {
      const groups = ip.split(':').filter(Boolean).slice(0, 4);
      return `${groups.join(':')}::/64`;
    }
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.0/24` : ip;
  }

  function emptySlice() {
    return {
      tech: emptyBucket(), ip: emptyBucket(), browsers: new Map(), os: new Map(), devices: new Map(), resolutions: new Map(), profiles: new Map(),
      ips: new Map(), subnets: new Map(), clientIds: new Map(), clientIdVisits: 0, ipv6Visits: 0
    };
  }

  function getSource(store, name) {
    if (!store.has(name)) store.set(name, { name, ...emptySlice(), days: new Map() });
    return store.get(name);
  }

  function getDay(source, date) {
    if (!source.days.has(date)) source.days.set(date, { date, ...emptySlice() });
    return source.days.get(date);
  }

  function validClientId(value) {
    const clientId = String(value ?? '').trim();
    if (!clientId || /^(не определено|undefined|none|not set|\(not set\)|0)$/i.test(clientId)) return '';
    return clientId;
  }

  function addClientId(target, row, map, visits) {
    if (!map.clientId || !visits) return;
    const clientId = validClientId(row[map.clientId]);
    if (!clientId) return;
    increase(target.clientIds, clientId, visits);
    target.clientIdVisits += visits;
  }

  function addTechRow(target, row, map) {
    const visits = addMetrics(target.tech, row, map);
    if (!visits) return;
    addClientId(target, row, map, visits);
    const browser = map.browser ? row[map.browser] : 'Не определено';
    const os = map.os ? row[map.os] : 'Не определено';
    const device = map.device ? row[map.device] : 'Не определено';
    const resolution = map.resolution ? row[map.resolution] : 'Не определено';
    increase(target.browsers, browser, visits);
    increase(target.os, os, visits);
    increase(target.devices, device, visits);
    increase(target.resolutions, resolution, visits);
    increase(target.profiles, `${browser || '—'} · ${os || '—'} · ${device || '—'} · ${resolution || '—'}`, visits);
  }

  function addIpRow(target, row, map) {
    const visits = addMetrics(target.ip, row, map);
    if (!visits) return;
    const ip = String(row[map.ip] || 'Не определено').trim() || 'Не определено';
    increase(target.ips, ip, visits);
    increase(target.subnets, subnetOf(ip), visits);
    if (ip.includes(':')) target.ipv6Visits += visits;
  }

  function buildAggregates() {
    const store = new Map();
    let skippedDates = 0;

    for (const row of state.techRows || []) {
      const rawSource = row[state.techMap.source];
      if (isTotalRow(rawSource)) continue;
      const date = parseDate(row[state.techMap.date]);
      if (!date) { skippedDates += 1; continue; }
      const source = getSource(store, sourceName(rawSource));
      addTechRow(source, row, state.techMap);
      addTechRow(getDay(source, date), row, state.techMap);
    }

    for (const row of state.ipRows || []) {
      const rawSource = row[state.ipMap.source];
      if (isTotalRow(rawSource)) continue;
      const date = parseDate(row[state.ipMap.date]);
      if (!date) { skippedDates += 1; continue; }
      const source = getSource(store, sourceName(rawSource));
      addIpRow(source, row, state.ipMap);
      addIpRow(getDay(source, date), row, state.ipMap);
    }

    if (skippedDates) showValidation(`Анализ запущен. Пропущено строк с нераспознанной датой: ${formatInt(skippedDates)}.`, false);
    return [...store.values()];
  }

  function topEntry(map, total) {
    let key = '—';
    let value = 0;
    for (const [candidate, count] of map.entries()) {
      if (count > value) { key = candidate; value = count; }
    }
    return { key, value, share: total ? value / total : 0 };
  }

  function topShare(map, total, limit = 10) {
    if (!total || !map.size) return 0;
    const values = [...map.values()].sort((a, b) => b - a).slice(0, limit);
    return values.reduce((sum, value) => sum + value, 0) / total;
  }

  function snapshot(slice) {
    if (slice?.precomputedSnapshot) return slice.precomputedSnapshot;
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
    const browserText = [...slice.browsers.keys()].join(' ').toLowerCase();
    return {
      visits, tech, ip, metrics, topBrowser, topResolution, topProfile, topIp, topSubnet,
      clientIdVisits, uniqueClientIds, topClientId, top10ClientShare, visitsPerClientId, repeatClientVisitShare, clientIdCoverage,
      ipv6Share: ip.visits ? slice.ipv6Visits / ip.visits : 0,
      unknownBrowserShare: tech.visits ? unknownBrowserVisits / tech.visits : 0,
      automation: /headless|phantom|selenium|webdriver/.test(browserText)
    };
  }

  function buildBase(sources) {
    let visits = 0;
    let users = 0;
    let bounceWeighted = 0;
    let timeWeighted = 0;
    let newWeighted = 0;
    let qualityWeighted = 0;
    let primaryWeighted = 0;
    for (const source of sources) {
      const data = snapshot(source);
      const metrics = data.metrics || {};
      const sourceVisits = Number(data.visits) || 0;
      const sourceUsers = Number(metrics.users) || sourceVisits;
      visits += sourceVisits;
      users += sourceUsers;
      bounceWeighted += (Number(metrics.bounce) || 0) * sourceVisits;
      timeWeighted += (Number(metrics.time) || 0) * sourceVisits;
      newWeighted += (Number(metrics.newShare) || 0) * sourceUsers;
      qualityWeighted += (Number(metrics.quality) || 0) * sourceVisits;
      primaryWeighted += (Number(metrics.primary) || 0) * sourceVisits;
    }
    return {
      visits,
      users,
      bounce: visits ? bounceWeighted / visits : 0,
      time: visits ? timeWeighted / visits : 0,
      newShare: users ? newWeighted / users : 0,
      quality: visits ? qualityWeighted / visits : 0,
      primary: visits ? primaryWeighted / visits : 0
    };
  }

  function median(values) {
    const safe = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!safe.length) return 0;
    const middle = Math.floor(safe.length / 2);
    return safe.length % 2 ? safe[middle] : (safe[middle - 1] + safe[middle]) / 2;
  }

  function robustZ(value, sample, floor = 0.0001) {
    if (sample.length < 4) return 0;
    const center = median(sample);
    const deviations = sample.map((item) => Math.abs(item - center));
    const mad = median(deviations);
    const scale = Math.max(1.4826 * mad, Math.abs(center) * 0.08, floor);
    return Math.abs(value - center) / scale;
  }

  function scorePeriodSource(source, base) {
    const data = snapshot(source);
    const reasons = [];
    let score = 0;
    const m = data.metrics;

    if (m.bounce >= .78 || m.bounce - base.bounce >= .28) { score += 24; reasons.push('сильно повышенный отказ за период'); }
    else if (m.bounce >= .62 || m.bounce - base.bounce >= .18) { score += 16; reasons.push('повышенный отказ за период'); }
    if (m.newShare >= .995) { score += 9; reasons.push('практически весь трафик новый'); }
    if (base.quality > 0 && m.quality < base.quality * .15 && data.visits >= 1500) { score += 7; reasons.push('почти нет качественных конверсий'); }
    if (base.primary > 0 && m.primary > base.primary * 4 && data.visits >= 500) { score += 9; reasons.push('аномально высокая первичная конверсия'); }
    if (data.automation) { score += 30; reasons.push('обнаружен headless/automation браузер'); }
    if (data.unknownBrowserShare >= .4) { score += 15; reasons.push('высокая доля неизвестных браузеров'); }
    else if (data.unknownBrowserShare >= .15) score += 7;
    if (data.concentrationScope !== 'daily' && data.topProfile.share >= .7 && data.tech.visits >= 500) { score += 19; reasons.push('один технический профиль доминирует'); }
    else if (data.concentrationScope !== 'daily' && data.topProfile.share >= .45 && data.tech.visits >= 500) { score += 11; reasons.push('концентрация технического профиля'); }
    if (data.concentrationScope !== 'daily' && data.topIp.share >= .2 && data.ip.visits >= 200) { score += 24; reasons.push('высокая концентрация одного IP'); }
    else if (data.concentrationScope !== 'daily' && data.topIp.share >= .08 && data.ip.visits >= 200) { score += 13; reasons.push('концентрация одного IP'); }
    if (data.concentrationScope !== 'daily' && data.topSubnet.share >= .35 && data.ip.visits >= 500) { score += 22; reasons.push('высокая концентрация подсети'); }
    else if (data.concentrationScope !== 'daily' && data.topSubnet.share >= .18 && data.ip.visits >= 500) { score += 14; reasons.push('концентрация подсети'); }

    let clientIdScore = 0;
    const enoughClientIds = data.concentrationScope !== 'daily' && data.clientIdVisits >= 300 && data.clientIdCoverage >= .5 && data.uniqueClientIds >= 20;
    if (enoughClientIds) {
      if (data.topClientId.share >= .3 && data.topClientId.value >= 100) { clientIdScore += 18; reasons.push(`один ClientID дал ${formatPct(data.topClientId.share)} визитов за период`); }
      else if (data.topClientId.share >= .15 && data.topClientId.value >= 50) { clientIdScore += 10; reasons.push('повышенная концентрация одного ClientID'); }
      if (data.top10ClientShare >= .8) { clientIdScore += 14; reasons.push(`топ-10 ClientID дали ${formatPct(data.top10ClientShare)} визитов`); }
      else if (data.top10ClientShare >= .6) { clientIdScore += 8; reasons.push('повышенная концентрация топ-10 ClientID'); }
      if (data.visitsPerClientId >= 12) { clientIdScore += 14; reasons.push(`в среднем ${data.visitsPerClientId.toFixed(1)} визита на ClientID`); }
      else if (data.visitsPerClientId >= 6) { clientIdScore += 8; reasons.push('много повторных визитов на один ClientID'); }
    }
    score += Math.min(28, clientIdScore);

    if (data.visits < 100) score = Math.min(score, 24);
    else if (data.visits < 500) score = Math.min(score, 44);
    return { ...data, score: Math.min(100, Math.round(score)), reasons };
  }

  function scoreDailyDays(source) {
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
      let score = 0;
      const enoughDays = others.length >= 4;
      const minimumVisits = Math.max(50, baseline.visits * .12);
      const enoughVolume = day.visits >= minimumVisits;
      const ratio = (value, reference) => reference > 0 ? value / reference : 0;

      if (enoughDays && enoughVolume) {
        const visitRatio = ratio(day.visits, baseline.visits);
        const visitZ = robustZ(day.visits, sample((item) => item.visits), 10);
        if (visitRatio >= 2.5 && visitZ >= 3) { score += 22; reasons.push(`всплеск объёма: ×${visitRatio.toFixed(1)} к обычному дню`); }
        else if (visitRatio >= 1.8 && visitZ >= 2.5) { score += 13; reasons.push(`повышенный объём: ×${visitRatio.toFixed(1)}`); }

        const bounceSample = sample((item) => item.metrics.bounce);
        const bounceDiff = day.metrics.bounce - baseline.bounce;
        const bounceZ = robustZ(day.metrics.bounce, bounceSample, .02);
        const enoughBounceVolume = day.visits >= Math.max(100, baseline.visits * .15);
        if (bounceDiff >= .2 && bounceZ >= 2.5) { score += 22; reasons.push(`отказы выше медианы на ${formatPct(bounceDiff)}`); }
        else if (bounceDiff >= .12 && bounceZ >= 2.5) { score += 15; reasons.push(`скачок отказов на ${formatPct(bounceDiff)}`); }

        const bounceDrop = baseline.bounce - day.metrics.bounce;
        if (enoughBounceVolume && baseline.bounce >= .08 && bounceDrop >= .2 && bounceZ >= 3.5) {
          score += 22;
          reasons.push(`подозрительно низкие отказы: ${formatPct(day.metrics.bounce)} против медианы ${formatPct(baseline.bounce)}`);
        } else if (enoughBounceVolume && baseline.bounce >= .08 && bounceDrop >= .12 && bounceZ >= 3) {
          score += 14;
          reasons.push(`отказы аномально ниже медианы на ${formatPct(bounceDrop)}`);
        }

        const timeSample = sample((item) => item.metrics.time).filter((value) => value > 0);
        const timeRatio = ratio(day.metrics.time, baseline.time);
        const timeZ = robustZ(day.metrics.time, timeSample, 8);
        const enoughTimeHistory = timeSample.length >= 6;
        const enoughTimeVolume = day.visits >= Math.max(100, baseline.visits * .15);
        if (enoughTimeHistory && enoughTimeVolume && day.metrics.time > 0 && baseline.time >= 30 && timeRatio <= .45 && timeZ >= 3.5) {
          score += 24;
          reasons.push(`среднее время ${formatDuration(day.metrics.time)} против медианы ${formatDuration(baseline.time)} (${Math.round(timeRatio * 100)}% обычного)`);
        } else if (enoughTimeHistory && enoughTimeVolume && day.metrics.time > 0 && baseline.time >= 30 && timeRatio <= .6 && timeZ >= 3) {
          score += 14;
          reasons.push(`сильное падение среднего времени: ${Math.round(timeRatio * 100)}% медианы площадки`);
        } else if (enoughTimeHistory && enoughTimeVolume && day.metrics.time >= 600 && baseline.time >= 30 && timeRatio >= 3 && timeZ >= 3.5) {
          score += 24;
          reasons.push(`подозрительно высокое среднее время: ${formatDuration(day.metrics.time)} против медианы ${formatDuration(baseline.time)}`);
        } else if (enoughTimeHistory && enoughTimeVolume && day.metrics.time >= 300 && baseline.time >= 30 && timeRatio >= 2 && timeZ >= 3) {
          score += 14;
          reasons.push(`среднее время аномально выше медианы: ×${timeRatio.toFixed(1)}`);
        }

        const newDiff = day.metrics.newShare - baseline.newShare;
        if (newDiff >= .08 && robustZ(day.metrics.newShare, sample((item) => item.metrics.newShare), .015) >= 2.5) { score += 8; reasons.push('резкий рост доли новых посетителей'); }
        if (baseline.quality > 0 && day.metrics.quality <= baseline.quality * .25 && day.visits >= 300) { score += 7; reasons.push('качественные конверсии резко ниже обычного'); }
        if (baseline.primary > 0 && day.metrics.primary >= baseline.primary * 4 && day.visits >= 200) { score += 7; reasons.push('первичная конверсия резко выше обычного'); }

        const ipDiff = day.topIp.share - baseline.topIp;
        if (day.topIp.share >= .2 && ipDiff >= .1) { score += 20; reasons.push(`один IP дал ${formatPct(day.topIp.share)} дневного трафика`); }
        else if (day.topIp.share >= .08 && robustZ(day.topIp.share, sample((item) => item.topIp.share), .02) >= 3) { score += 11; reasons.push('однодневный рост концентрации IP'); }

        const subnetDiff = day.topSubnet.share - baseline.topSubnet;
        if (day.topSubnet.share >= .35 && subnetDiff >= .15) { score += 20; reasons.push(`одна подсеть дала ${formatPct(day.topSubnet.share)} трафика`); }
        else if (day.topSubnet.share >= .18 && robustZ(day.topSubnet.share, sample((item) => item.topSubnet.share), .025) >= 3) { score += 12; reasons.push('однодневный рост концентрации подсети'); }

        const profileDiff = day.topProfile.share - baseline.topProfile;
        if (day.topProfile.share >= .7 && profileDiff >= .15) { score += 19; reasons.push(`техпрофиль занял ${formatPct(day.topProfile.share)} трафика`); }
        else if (day.topProfile.share >= .45 && robustZ(day.topProfile.share, sample((item) => item.topProfile.share), .025) >= 3) { score += 11; reasons.push('однодневная концентрация техпрофиля'); }

        let clientIdScore = 0;
        const enoughClientHistory = clientPeers.length >= 6;
        const enoughClientVolume = day.clientIdVisits >= Math.max(200, baseline.clientIdVisits * .15) && day.clientIdCoverage >= .5 && day.uniqueClientIds >= 10;
        if (enoughClientHistory && enoughClientVolume) {
          const topClientDiff = day.topClientId.share - baseline.topClientId;
          const topClientZ = robustZ(day.topClientId.share, clientSample((item) => item.topClientId.share), .02);
          if (day.topClientId.share >= .25 && topClientDiff >= .12 && topClientZ >= 3.5 && day.topClientId.value >= 50) { clientIdScore += 18; reasons.push(`один ClientID дал ${formatPct(day.topClientId.share)} визитов в этот день`); }
          else if (day.topClientId.share >= .12 && topClientDiff >= .06 && topClientZ >= 3) { clientIdScore += 10; reasons.push('однодневный рост концентрации одного ClientID'); }
          const top10Diff = day.top10ClientShare - baseline.top10ClientShare;
          const top10Z = robustZ(day.top10ClientShare, clientSample((item) => item.top10ClientShare), .03);
          if (day.top10ClientShare >= .75 && top10Diff >= .2 && top10Z >= 3.5) { clientIdScore += 14; reasons.push(`топ-10 ClientID дали ${formatPct(day.top10ClientShare)} дневных визитов`); }
          else if (day.top10ClientShare >= .55 && top10Diff >= .12 && top10Z >= 3) { clientIdScore += 8; reasons.push('аномальная концентрация топ-10 ClientID'); }
          const visitsPerClientRatio = ratio(day.visitsPerClientId, baseline.visitsPerClientId);
          const visitsPerClientZ = robustZ(day.visitsPerClientId, clientSample((item) => item.visitsPerClientId), .5);
          if (day.visitsPerClientId >= 8 && visitsPerClientRatio >= 2.5 && visitsPerClientZ >= 3.5) { clientIdScore += 16; reasons.push(`аномально много повторов: ${day.visitsPerClientId.toFixed(1)} визита на ClientID`); }
          else if (day.visitsPerClientId >= 5 && visitsPerClientRatio >= 1.8 && visitsPerClientZ >= 3) { clientIdScore += 9; reasons.push('рост повторных визитов на ClientID'); }
        }
        score += Math.min(28, clientIdScore);

        if (day.automation) { score += 28; reasons.push('в этот день появился automation/headless браузер'); }
        const unknownDiff = day.unknownBrowserShare - baseline.unknownBrowser;
        if (day.unknownBrowserShare >= .35 && unknownDiff >= .15) { score += 14; reasons.push('резкий рост неизвестных браузеров'); }
      }

      let confidence = 'Высокая';
      const coverage = Math.max(day.tech.visits, day.ip.visits) ? Math.min(day.tech.visits, day.ip.visits) / Math.max(day.tech.visits, day.ip.visits) : 0;
      if (!enoughDays || day.visits < 100 || !day.tech.visits || !day.ip.visits) confidence = 'Низкая';
      else if (others.length < 8 || day.visits < 500 || coverage < .65) confidence = 'Средняя';

      if (!enoughDays || day.visits < 50) score = Math.min(score, 24);
      else if (day.visits < 100) score = Math.min(score, 44);
      score = Math.min(100, Math.round(score));
      const risk = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';

      return {
        ...day,
        baseline,
        score,
        risk,
        confidence,
        reasons: [...new Set(reasons)],
        flaggedVisits: risk === 'low' ? 0 : day.visits,
        month: day.date.slice(0, 7)
      };
    });
  }

  function combineSource(source, base) {
    const period = scorePeriodSource(source, base);
    const days = scoreDailyDays(source);
    const anomalousDays = days.filter((day) => day.risk !== 'low').sort((a, b) => b.score - a.score || b.visits - a.visits);
    const maxDaily = anomalousDays[0]?.score || 0;
    let score = Math.max(period.score, maxDaily);
    if (anomalousDays.length >= 2) score = Math.min(100, score + Math.min(10, anomalousDays.length * 2));
    const risk = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
    const reasons = [...period.reasons];
    if (anomalousDays.length) reasons.unshift(`${anomalousDays.length} ${plural(anomalousDays.length, 'аномальный день', 'аномальных дня', 'аномальных дней')}; максимум ${anomalousDays[0].score}/100`);
    let confidence = 'Высокая';
    if (period.visits < 500 || days.length < 5 || !period.tech.visits || !period.ip.visits) confidence = 'Низкая';
    else if (period.visits < 3000 || days.length < 9) confidence = 'Средняя';
    const action = risk === 'high'
      ? 'Сначала проверить отмеченные даты и кластеры внутри них. Запросить детализацию у площадки, не отключая весь источник автоматически.'
      : risk === 'medium'
        ? 'Сопоставить аномальные даты с размещениями, SSP, приложениями и изменениями кампании. Источник целиком пока не отключать.'
        : 'Оставить источник в мониторинге; новые дни будут сравниваться с его собственной устойчивой базой.';
    return { name: source.name, ...period, score, risk, confidence, reasons: [...new Set(reasons)], action, days, anomalousDays };
  }

  function buildMonthly(dailyResults) {
    const months = new Map();
    for (const day of dailyResults) {
      if (!months.has(day.month)) months.set(day.month, { month: day.month, visits: 0, flaggedVisits: 0, highDays: 0, mediumDays: 0, sources: new Set() });
      const month = months.get(day.month);
      month.visits += day.visits;
      month.flaggedVisits += day.flaggedVisits;
      if (day.risk === 'high') month.highDays += 1;
      if (day.risk === 'medium') month.mediumDays += 1;
      if (day.risk !== 'low') month.sources.add(day.source);
    }
    return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  function maxShareEntry(rows, field) {
    return rows.reduce((best, row) => {
      const candidate = row[field] || { key: '—', value: 0, share: 0 };
      return (Number(candidate.share) || 0) > (Number(best.share) || 0) ? candidate : best;
    }, { key: '—', value: 0, share: 0 });
  }

  function aggregateApiSnapshots(rows) {
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
      automation: rows.some((row) => Boolean(row.automation)),
      concentrationScope: 'daily',
      dataSource: 'yandex-metrica-logs-api'
    };
  }

  function buildApiSources(rows) {
    const grouped = new Map();
    for (const rawRow of rows || []) {
      const name = String(rawRow.source || 'Не определено').trim() || 'Не определено';
      const date = String(rawRow.date || '');
      const visits = Number(rawRow.visits) || 0;
      if (!date || visits <= 0) continue;
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push({ ...rawRow, source: name, date, visits, concentrationScope: 'daily' });
    }
    return [...grouped.entries()].map(([name, dailyRows]) => {
      const days = new Map();
      for (const day of dailyRows) {
        days.set(day.date, { date: day.date, precomputedSnapshot: day });
      }
      return {
        name,
        days,
        precomputedSnapshot: aggregateApiSnapshots(dailyRows)
      };
    });
  }

  function analyzeSources(allSources, context = {}) {
    const sourceVolumes = allSources.map((source) => ({ source, visits: snapshot(source).visits }));
    const includedSources = sourceVolumes.filter((item) => item.visits >= MIN_SOURCE_VISITS);
    const excludedSources = sourceVolumes.filter((item) => item.visits < MIN_SOURCE_VISITS);
    const sources = includedSources.map((item) => item.source);
    if (!sources.length) throw new Error(`После очистки данных не осталось площадок с ${MIN_SOURCE_VISITS} и более визитами за период.`);

    state.dataMode = context.mode || 'manual';
    state.analysisContext = context.label || '';
    if (excludedSources.length) {
      const excludedVisits = excludedSources.reduce((sum, item) => sum + item.visits, 0);
      const excludedText = `исключено ${excludedSources.length} ${plural(excludedSources.length, 'площадка', 'площадки', 'площадок')} и ${formatInt(excludedVisits)} визитов с объёмом менее ${MIN_SOURCE_VISITS}`;
      state.analysisContext = [state.analysisContext, excludedText].filter(Boolean).join(' · ');
      if (state.dataMode !== 'api') showValidation(excludedText, false);
    }

    const base = buildBase(sources);
    state.results = sources.map((source) => combineSource(source, base)).sort((a, b) => b.score - a.score || b.visits - a.visits);
    state.dailyResults = state.results.flatMap((source) => source.days).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
    state.monthlyResults = buildMonthly(state.dailyResults);
    renderResults(base);
    ui.results.hidden = false;
    ui.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function analyze() {
    try {
      analyzeSources(buildAggregates(), { mode: 'manual', label: 'Ручные выгрузки' });
    } catch (error) {
      showValidation(error.message, true);
    }
  }

  function formatInt(value) {
    return Math.round(value || 0).toLocaleString('ru-RU');
  }

  function formatPct(value, digits = 1) {
    return `${((value || 0) * 100).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Math.round(value || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
  }

  function formatDate(value) {
    const [year, month, day] = String(value).split('-');
    return year && month && day ? `${day}.${month}.${year}` : value;
  }

  function formatMonth(value) {
    const [year, month] = String(value).split('-');
    const date = new Date(Number(year), Number(month) - 1, 1);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  }

  function riskLabel(risk) {
    return risk === 'high' ? 'Высокий' : risk === 'medium' ? 'Требует проверки' : 'Низкий';
  }

  function maskIp(ip) {
    const value = String(ip || '—');
    if (value.includes(':')) return `${value.split(':').slice(0, 2).join(':')}:****:****`;
    const parts = value.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.***.***` : value;
  }

  function renderResults(base) {
    const totalVisits = state.results.reduce((sum, row) => sum + row.visits, 0);
    const anomalousDays = state.dailyResults.filter((day) => day.risk !== 'low');
    const highDays = anomalousDays.filter((day) => day.risk === 'high');
    const flaggedVisits = anomalousDays.reduce((sum, day) => sum + day.flaggedVisits, 0);
    const highSources = state.results.filter((row) => row.risk === 'high');
    const ipTotal = state.results.reduce((sum, row) => sum + row.ip.visits, 0);
    const techTotal = state.results.reduce((sum, row) => sum + row.tech.visits, 0);
    const coverage = Math.max(ipTotal, techTotal) ? Math.min(ipTotal, techTotal) / Math.max(ipTotal, techTotal) : 0;

    ui.kpis.innerHTML = [
      ['Всего визитов', formatInt(totalVisits), `${state.results.length} источников`],
      ['Визиты в аномальные дни', formatInt(flaggedVisits), formatPct(totalVisits ? flaggedVisits / totalVisits : 0) + ' трафика'],
      ['Аномальные дни', formatInt(anomalousDays.length), `${highDays.length} высокого риска`],
      ['Источники высокого риска', formatInt(highSources.length), 'по периоду и дням'],
      ['Средний отказ', formatPct(base.bounce), 'по всей базе'],
      state.dataMode === 'api'
        ? ['Источник данных', 'Logs API', 'без ограничения CSV']
        : ['Покрытие файлов', formatPct(coverage), 'совпадение объёмов']
    ].map(([label, value, note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');

    const conclusion = anomalousDays.length
      ? `Найдено ${anomalousDays.length} ${plural(anomalousDays.length, 'аномальное сочетание источника и дня', 'аномальных сочетания источника и дня', 'аномальных сочетаний источника и дня')}. В оценочный объём вошло ${formatInt(flaggedVisits)} визитов, совершённых в эти дни. Это объём под проверкой, а не точное число фродовых визитов.`
      : 'Однодневных отклонений с достаточной выборкой не найдено. Каждый день сравнивался с остальными днями того же источника.';
    ui.conclusion.innerHTML = `<strong>Общий вывод</strong>${escapeHtml(conclusion)}`;
    const contextText = state.analysisContext ? ` ${state.analysisContext}.` : '';
    ui.summary.textContent = `Проанализировано ${formatInt(totalVisits)} визитов по ${state.results.length} источникам и ${state.dailyResults.length} дневным срезам.${contextText}`;
    if (ui.dailySummary) ui.dailySummary.textContent = `День считается аномальным только относительно остальных дней того же источника. Минимальная база — 5 дней.`;

    renderMonthly();
    renderDaily();
    renderSources();
    applyFilters();
  }

  function renderMonthly() {
    if (!ui.monthlyTable) return;
    ui.monthlyTable.innerHTML = state.monthlyResults.map((row) => `
      <tr>
        <td>${escapeHtml(formatMonth(row.month))}</td>
        <td>${formatInt(row.visits)}</td>
        <td>${formatInt(row.flaggedVisits)}</td>
        <td>${formatPct(row.visits ? row.flaggedVisits / row.visits : 0)}</td>
        <td>${row.highDays}</td>
        <td>${row.mediumDays}</td>
        <td>${row.sources.size}</td>
      </tr>`).join('');
  }

  function renderDaily() {
    if (!ui.dailyTable) return;
    const rows = [...state.dailyResults].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
    ui.dailyTable.innerHTML = rows.map((day) => `
      <tr data-risk="${day.risk}" data-name="${escapeHtml(day.source.toLowerCase())}" data-scope="daily">
        <td>${escapeHtml(formatDate(day.date))}</td>
        <td>${escapeHtml(day.source)}</td>
        <td>${formatInt(day.visits)}</td>
        <td>${formatInt(day.baseline.visits)}</td>
        <td>${formatPct(day.metrics.bounce)} <small>база ${formatPct(day.baseline.bounce)}</small></td>
        <td>${formatDuration(day.metrics.time)} <small>база ${formatDuration(day.baseline.time)}</small></td>
        <td><span class="risk-pill ${day.risk}">${riskLabel(day.risk)}</span></td>
        <td><strong>${day.score}</strong>/100</td>
        <td>${escapeHtml(day.reasons.slice(0, 3).join(' · ') || 'нет выраженных отклонений')}</td>
      </tr>`).join('');
  }

  function renderSources() {
    ui.table.innerHTML = state.results.map((row) => `
      <tr data-risk="${row.risk}" data-name="${escapeHtml(row.name.toLowerCase())}" data-scope="source">
        <td><a href="#source-${slug(row.name)}">${escapeHtml(row.name)}</a></td>
        <td>${formatInt(row.visits)}</td>
        <td>${row.anomalousDays.length}</td>
        <td>${formatInt(row.anomalousDays.reduce((sum, day) => sum + day.flaggedVisits, 0))}</td>
        <td>${formatPct(row.metrics.bounce)}</td>
        <td>${formatDuration(row.metrics.time)}</td>
        <td><span class="risk-pill ${row.risk}">${riskLabel(row.risk)}</span></td>
        <td><strong>${row.score}</strong>/100</td>
      </tr>`).join('');
    ui.list.innerHTML = state.results.map((row, index) => renderSourceCard(row, index)).join('');
  }

  function renderSourceCard(row, index) {
    const reasons = row.reasons.length ? row.reasons : ['критичных сочетаний признаков не найдено'];
    const dailyRows = row.anomalousDays.length
      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td>${day.clientIdVisits ? `${formatInt(day.uniqueClientIds)} / ${formatPct(day.topClientId.share)}` : '—'}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="7">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
    const dailyConcentrations = row.concentrationScope === 'daily';
    const ipTitle = dailyConcentrations ? 'IP и подсети — максимум за день' : 'IP и подсети за период';
    const techTitle = dailyConcentrations ? 'Технический профиль — максимум за день' : 'Технический профиль';
    const clientTitle = dailyConcentrations ? 'ClientID — дневные максимумы' : 'ClientID за период';
    const uniqueClientLabel = dailyConcentrations ? 'Макс. уникальных за день' : 'Уникальных ClientID';
    const visitsPerClientLabel = dailyConcentrations ? 'Макс. визитов на ClientID' : 'Визитов на ClientID';
    return `<details class="source-card ${row.risk}" id="source-${slug(row.name)}" data-risk="${row.risk}" data-name="${escapeHtml(row.name.toLowerCase())}" data-scope="source-card" ${index < 3 || row.risk !== 'low' ? 'open' : ''}>
      <summary>
        <div><span class="section-kicker">UTM Source</span><h3>${escapeHtml(row.name)}</h3><p>${escapeHtml(reasons.slice(0, 4).join(' · '))}</p></div>
        <div class="source-score"><span>${riskLabel(row.risk)} риск</span><strong>${row.score}<small>/100</small></strong></div>
      </summary>
      <div class="source-body">
        <div class="metric-strip">
          <div><strong>${formatInt(row.visits)}</strong><span>визиты</span></div>
          <div><strong>${row.days.length}</strong><span>дней в базе</span></div>
          <div><strong>${row.anomalousDays.length}</strong><span>аномальных дней</span></div>
          <div><strong>${formatInt(row.anomalousDays.reduce((sum, day) => sum + day.flaggedVisits, 0))}</strong><span>визиты под проверкой</span></div>
          <div><strong>${formatPct(row.metrics.bounce)}</strong><span>отказы</span></div>
          <div><strong>${escapeHtml(row.confidence)}</strong><span>уверенность</span></div>
        </div>
        <section class="daily-detail"><h4>Конкретные аномальные даты</h4><div class="table-wrap mini-table-wrap"><table class="mini-table"><thead><tr><th>Дата</th><th>Визиты</th><th>Отказы</th><th>Время</th><th>ClientID: уник. / топ-1</th><th>Score</th><th>Причины</th></tr></thead><tbody>${dailyRows}</tbody></table></div></section>
        <div class="detail-grid">
          <section class="detail"><h4>Почему такой score</h4><ul class="flag-list">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></section>
          <section class="detail"><h4>${ipTitle}</h4><p><b>Топ IP:</b> ${escapeHtml(maskIp(row.topIp.key))} · ${formatPct(row.topIp.share)}</p><p><b>Топ подсеть:</b> ${escapeHtml(row.topSubnet.key)} · ${formatPct(row.topSubnet.share)}</p></section>
          <section class="detail"><h4>${techTitle}</h4><p><b>Топ браузер:</b> ${escapeHtml(row.topBrowser.key)} · ${formatPct(row.topBrowser.share)}</p><p><b>Топ связка:</b> ${escapeHtml(shorten(row.topProfile.key, 100))} · ${formatPct(row.topProfile.share)}</p></section>
          <section class="detail"><h4>${clientTitle}</h4>${row.clientIdVisits ? `<p><b>Покрытие:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>${uniqueClientLabel}:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>${visitsPerClientLabel}:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Макс. топ-1 / топ-10:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>` : '<p>ClientID не найден в выбранных данных.</p>'}</section>
          <section class="detail"><h4>Покрытие</h4><p><b>Техническая выгрузка:</b> ${formatInt(row.tech.visits)} визитов</p><p><b>IP-выгрузка:</b> ${formatInt(row.ip.visits)} визитов</p><p><b>Дней:</b> ${row.days.length}</p></section>
          <section class="detail detail--action"><h4>Рекомендация</h4><p>${escapeHtml(row.action)}</p></section>
        </div>
      </div>
    </details>`;
  }

  function plural(number, one, few, many) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return many;
    if (n1 > 1 && n1 < 5) return few;
    return n1 === 1 ? one : many;
  }

  function shorten(value, max) {
    const text = String(value || '—');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function slug(value) {
    return normalize(value).replace(/\s+/g, '-').replace(/[^a-zа-я0-9-]/g, '') || 'unknown';
  }

  function applyFilters() {
    const query = state.query.toLowerCase();
    $$('[data-name][data-risk]').forEach((element) => {
      const riskMatch = state.riskFilter === 'all' || element.dataset.risk === state.riskFilter;
      const searchMatch = !query || element.dataset.name.includes(query);
      element.hidden = !(riskMatch && searchMatch);
    });
  }

  function exportCsv() {
    if (!state.dailyResults.length) return;
    const headers = ['Дата','Месяц','Источник','Визиты','Обычный дневной объём','Отказы','Обычные отказы','Время, сек','Обычное время, сек','Топ IP, доля','Топ подсеть, доля','Топ техпрофиль, доля','ClientID, покрытие','Уникальные ClientID','Визитов на ClientID','Топ-1 ClientID, доля','Обычная доля топ-1 ClientID','Топ-10 ClientID, доля','Обычная доля топ-10 ClientID','Risk score','Уровень','Уверенность','Визиты под проверкой','Причины'];
    const rows = state.dailyResults.map((day) => [
      day.date, day.month, day.source, day.visits, day.baseline.visits, day.metrics.bounce, day.baseline.bounce, day.metrics.time, day.baseline.time,
      day.topIp.share, day.topSubnet.share, day.topProfile.share, day.clientIdCoverage, day.uniqueClientIds, day.visitsPerClientId, day.topClientId.share, day.baseline.topClientId, day.top10ClientShare, day.baseline.top10ClientShare,
      day.score, riskLabel(day.risk), day.confidence, day.flaggedVisits, day.reasons.join('; ')
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `traffic-fraud-daily-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function csvCell(value) {
    const text = typeof value === 'number' ? String(value).replace('.', ',') : String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function reset() {
    state.ipRows = state.techRows = state.ipMap = state.techMap = null;
    state.results = [];
    state.dailyResults = [];
    state.monthlyResults = [];
    state.analysisContext = '';
    state.dataMode = 'manual';
    ui.ipFile.value = '';
    ui.techFile.value = '';
    setCard('ip', 'idle', 'Файл не выбран', 'Поддерживаются CSV, XLSX и XLS.');
    setCard('tech', 'idle', 'Файл не выбран', 'Поддерживаются CSV, XLSX и XLS.');
    $('#ip-mapping').hidden = true;
    $('#tech-mapping').hidden = true;
    ui.validation.hidden = true;
    ui.results.hidden = true;
    ui.search.value = '';
    state.query = '';
    state.riskFilter = 'all';
    $$('.filter-button').forEach((button) => button.classList.toggle('active', button.dataset.risk === 'all'));
    updateAnalyzeState();
  }

  function loadDemo() {
    const dates = Array.from({ length: 12 }, (_, index) => `2026-06-${String(index + 1).padStart(2, '0')}`);
    const sources = ['yandex', 'rutube', 'unknown_dsp'];
    state.ipRows = [];
    state.techRows = [];
    for (const source of sources) {
      dates.forEach((date, index) => {
        const anomaly = source === 'unknown_dsp' && index === 7;
        const medium = source === 'rutube' && index === 9;
        const baseVisits = source === 'yandex' ? 1100 : source === 'rutube' ? 760 : 520;
        const visits = anomaly ? 4100 : medium ? 1550 : Math.round(baseVisits * (0.9 + (index % 4) * 0.05));
        const bounce = anomaly ? 0.94 : medium ? 0.73 : source === 'yandex' ? 0.36 : source === 'rutube' ? 0.57 : 0.49;
        const time = anomaly ? 7 : medium ? 29 : source === 'yandex' ? 132 : source === 'rutube' ? 70 : 88;
        const concentrated = anomaly ? Math.round(visits * .72) : Math.round(visits * .12);
        state.ipRows.push({ 'Дата визита': date, 'UTM Source': source, 'IP-адрес': anomaly ? '185.90.10.11' : `95.24.${index}.10`, 'Визиты': concentrated, 'Посетители': concentrated, 'Отказы': bounce, 'Время на сайте': time, 'Доля новых посетителей': anomaly ? 1 : .84 });
        state.ipRows.push({ 'Дата визита': date, 'UTM Source': source, 'IP-адрес': anomaly ? '185.90.10.12' : `95.25.${index}.44`, 'Визиты': visits - concentrated, 'Посетители': visits - concentrated, 'Отказы': bounce, 'Время на сайте': time, 'Доля новых посетителей': anomaly ? 1 : .84 });
        const profileVisits = anomaly ? Math.round(visits * .86) : Math.round(visits * .42);
        state.techRows.push({ 'Дата визита': date, 'UTM Source': source, 'Версия браузера': anomaly ? 'HeadlessChrome 138' : 'Chrome 138', 'Операционная система (детально)': anomaly ? 'Linux' : 'Android', 'Модель устройства': anomaly ? 'Не определено' : 'Mobile', 'Разрешение': anomaly ? '1920x1080' : '360x800', 'Визиты': profileVisits, 'Посетители': profileVisits, 'Отказы': bounce, 'Время на сайте': time, 'Доля новых посетителей': anomaly ? 1 : .84 });
        state.techRows.push({ 'Дата визита': date, 'UTM Source': source, 'Версия браузера': 'Safari', 'Операционная система (детально)': 'iOS', 'Модель устройства': 'iPhone', 'Разрешение': '390x844', 'Визиты': visits - profileVisits, 'Посетители': visits - profileVisits, 'Отказы': bounce, 'Время на сайте': time, 'Доля новых посетителей': anomaly ? 1 : .84 });
      });
    }
    state.ipMap = detectMap(Object.keys(state.ipRows[0]));
    state.techMap = detectMap(Object.keys(state.techRows[0]));
    renderMapping('ip', state.ipMap);
    renderMapping('tech', state.techMap);
    setCard('ip', 'ready', 'Демо загружено', `${formatInt(state.ipRows.length)} строк · 12 дней`);
    setCard('tech', 'ready', 'Демо загружено', `${formatInt(state.techRows.length)} строк · 12 дней`);
    showValidation('Демо содержит один выраженный однодневный всплеск и одно среднее отклонение.', false);
    updateAnalyzeState();
    analyze();
  }

  window.FraudLab = Object.freeze({
    analyzeApiRows(rows, options = {}) {
      const sources = buildApiSources(rows);
      if (!sources.length) throw new Error('API не вернуло данных для выбранного периода.');
      analyzeSources(sources, { ...options, mode: 'api' });
      return { sources: state.results.length, days: state.dailyResults.length };
    }
  });

  ui.ipFile?.addEventListener('change', (event) => handleFile('ip', event.target.files?.[0]));
  ui.techFile?.addEventListener('change', (event) => handleFile('tech', event.target.files?.[0]));
  ui.analyze?.addEventListener('click', analyze);
  ui.reset?.addEventListener('click', reset);
  ui.demo?.addEventListener('click', loadDemo);
  ui.export?.addEventListener('click', exportCsv);
  ui.search?.addEventListener('input', (event) => { state.query = event.target.value.trim(); applyFilters(); });
  $$('.filter-button').forEach((button) => button.addEventListener('click', () => {
    state.riskFilter = button.dataset.risk;
    $$('.filter-button').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
    applyFilters();
  }));

  updateAnalyzeState();
})();
