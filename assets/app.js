(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const FIELD_DEFS = {
    source: ['utm source','utmsource','источник трафика','источник','площадка','source'],
    campaign: ['utm campaign','utmcampaign','кампания','campaign'],
    ip: ['ip адрес','ip-адрес','ip address','ipaddress','ip'],
    visits: ['визиты','визитов','visits','sessions','сеансы'],
    users: ['посетители','пользователи','users','visitors'],
    bounce: ['отказы','показатель отказов','bounce rate','bouncerate','bounce'],
    time: ['время на сайте','среднее время на сайте','длительность визита','avg visit duration','avgvisitduration','time on site','duration'],
    newShare: ['доля новых посетителей','новые посетители','new users share','new visitors','newshare'],
    browser: ['версия браузера','браузер','browser version','browser'],
    os: ['операционная система детально','операционная система (детально)','операционная система','os version','operating system','os'],
    device: ['модель устройства','тип устройства','устройство','device model','device type','device'],
    resolution: ['разрешение экрана','разрешение','screen resolution','resolution'],
    qualityConversion: ['конверсия (первично-качественные звонки uis)','первично-качественные звонки','качественные звонки','quality calls','qualified calls','quality conversion'],
    primaryConversion: ['конверсия (первичные звонки uis)','первичные звонки','primary calls','primary conversion']
  };

  const LABELS = {
    source: 'Источник', ip: 'IP', visits: 'Визиты', users: 'Посетители', bounce: 'Отказы', time: 'Время', newShare: 'Новые',
    browser: 'Браузер', os: 'ОС', device: 'Устройство', resolution: 'Разрешение', qualityConversion: 'Качественные', primaryConversion: 'Первичные'
  };

  const REQUIRED = {
    ip: ['source', 'ip', 'visits'],
    tech: ['source', 'visits']
  };

  const state = {
    ipRows: null,
    techRows: null,
    ipMap: null,
    techMap: null,
    results: [],
    riskFilter: 'all',
    query: ''
  };

  const ui = {
    ipFile: $('#ip-file'), techFile: $('#tech-file'), analyze: $('#analyze-button'), reset: $('#reset-button'), demo: $('#demo-button'),
    results: $('#results'), validation: $('#validation'), export: $('#export-button'), search: $('#source-search'),
    table: $('#source-table'), list: $('#source-list'), kpis: $('#kpi-grid'), conclusion: $('#conclusion'), summary: $('#summary-text')
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
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

  async function readRows(file) {
    if (!window.XLSX) throw new Error('Не загрузилась библиотека чтения Excel. Проверьте подключение к интернету и обновите страницу.');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    if (!workbook.SheetNames.length) throw new Error('В файле не найдено листов.');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
    if (!rows.length) throw new Error('Файл пустой или таблица не распознана.');
    return rows;
  }

  async function handleFile(kind, file) {
    if (!file) return;
    setCard(kind, 'loading', 'Читаю файл…', file.name);
    try {
      const rows = await readRows(file);
      const headers = Object.keys(rows[0] || {});
      const map = detectMap(headers);
      const missing = REQUIRED[kind].filter((field) => !map[field]);
      state[`${kind}Rows`] = rows;
      state[`${kind}Map`] = map;
      renderMapping(kind, map, missing);
      if (missing.length) {
        setCard(kind, 'error', 'Нужна проверка', `${file.name} · ${formatInt(rows.length)} строк`);
        showValidation(`В ${kind === 'ip' ? 'IP' : 'технической'} выгрузке не распознаны обязательные поля: ${missing.map((f) => LABELS[f]).join(', ')}.`, true);
      } else {
        setCard(kind, 'ready', 'Готово', `${file.name} · ${formatInt(rows.length)} строк`);
        clearValidationIfReady();
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

  function renderMapping(kind, map, missing) {
    const container = $(`#${kind}-mapping`);
    const fields = kind === 'ip'
      ? ['source','ip','visits','users','bounce','time','newShare','qualityConversion','primaryConversion']
      : ['source','visits','users','bounce','time','newShare','browser','os','device','resolution','qualityConversion','primaryConversion'];
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
    if (state.ipRows && state.techRows && REQUIRED.ip.every((f) => state.ipMap?.[f]) && REQUIRED.tech.every((f) => state.techMap?.[f])) {
      showValidation('Оба файла распознаны. Можно запускать анализ.', false);
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
    if (hasPercent || Math.abs(number) > 1.5) return number / 100;
    return number;
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

  function sourceName(value) {
    const text = String(value ?? '').trim();
    if (!text || ['не определено','undefined','none','(not set)'].includes(text.toLowerCase())) return 'Не определено';
    return text;
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
    if (parts.length === 4) return `${parts.slice(0, 3).join('.')}.0/24`;
    return ip;
  }

  function getSource(store, name) {
    if (!store.has(name)) {
      store.set(name, {
        name,
        tech: emptyBucket(), ip: emptyBucket(),
        browsers: new Map(), os: new Map(), devices: new Map(), resolutions: new Map(), profiles: new Map(),
        ips: new Map(), subnets: new Map(), ipv6Visits: 0
      });
    }
    return store.get(name);
  }

  function topEntry(map, total) {
    let key = '—';
    let value = 0;
    for (const [candidate, count] of map.entries()) {
      if (count > value) { key = candidate; value = count; }
    }
    return { key, value, share: total ? value / total : 0 };
  }

  function buildAggregates() {
    const store = new Map();

    for (const row of state.techRows || []) {
      const rawSource = row[state.techMap.source];
      if (isTotalRow(rawSource)) continue;
      const source = getSource(store, sourceName(rawSource));
      const visits = addMetrics(source.tech, row, state.techMap);
      if (!visits) continue;
      const browser = state.techMap.browser ? row[state.techMap.browser] : 'Не определено';
      const os = state.techMap.os ? row[state.techMap.os] : 'Не определено';
      const device = state.techMap.device ? row[state.techMap.device] : 'Не определено';
      const resolution = state.techMap.resolution ? row[state.techMap.resolution] : 'Не определено';
      increase(source.browsers, browser, visits);
      increase(source.os, os, visits);
      increase(source.devices, device, visits);
      increase(source.resolutions, resolution, visits);
      increase(source.profiles, `${browser || '—'} · ${os || '—'} · ${device || '—'} · ${resolution || '—'}`, visits);
    }

    for (const row of state.ipRows || []) {
      const rawSource = row[state.ipMap.source];
      if (isTotalRow(rawSource)) continue;
      const source = getSource(store, sourceName(rawSource));
      const visits = addMetrics(source.ip, row, state.ipMap);
      if (!visits) continue;
      const ip = String(row[state.ipMap.ip] || 'Не определено').trim() || 'Не определено';
      increase(source.ips, ip, visits);
      increase(source.subnets, subnetOf(ip), visits);
      if (ip.includes(':')) source.ipv6Visits += visits;
    }

    return [...store.values()];
  }

  function buildBase(sources) {
    const bucket = emptyBucket();
    for (const source of sources) {
      const selected = source.tech.visits ? source.tech : source.ip;
      bucket.visits += selected.visits;
      bucket.users += selected.users;
      bucket.bounceWeighted += selected.bounceWeighted;
      bucket.timeWeighted += selected.timeWeighted;
      bucket.newWeighted += selected.newWeighted;
      bucket.qualityWeighted += selected.qualityWeighted;
      bucket.primaryWeighted += selected.primaryWeighted;
    }
    return finishBucket(bucket);
  }

  function scoreSource(source, base) {
    const tech = finishBucket(source.tech);
    const ip = finishBucket(source.ip);
    const metrics = tech.visits ? tech : ip;
    const visits = Math.max(tech.visits, ip.visits);
    const topBrowser = topEntry(source.browsers, tech.visits);
    const topResolution = topEntry(source.resolutions, tech.visits);
    const topProfile = topEntry(source.profiles, tech.visits);
    const topIp = topEntry(source.ips, ip.visits);
    const topSubnet = topEntry(source.subnets, ip.visits);
    const ipv6Share = ip.visits ? source.ipv6Visits / ip.visits : 0;
    const reasons = [];
    let score = 0;

    if (metrics.bounce >= .78 || metrics.bounce - base.bounce >= .28) { score += 24; reasons.push('сильно повышенный отказ'); }
    else if (metrics.bounce >= .62 || metrics.bounce - base.bounce >= .18) { score += 16; reasons.push('повышенный отказ'); }
    else if (metrics.bounce >= .5 || metrics.bounce - base.bounce >= .1) { score += 8; reasons.push('отказ выше общей базы'); }
    if (metrics.bounce <= .01 && visits >= 200) { score += 16; reasons.push('аномально низкий отказ'); }

    if (metrics.time > 0 && metrics.time <= 20) { score += 22; reasons.push('очень короткое время'); }
    else if (metrics.time > 0 && metrics.time <= 45) { score += 14; reasons.push('короткое время'); }
    else if (metrics.time > 0 && metrics.time <= 75) { score += 6; }

    if (metrics.newShare >= .995) { score += 9; reasons.push('практически весь трафик новый'); }
    else if (metrics.newShare >= .98) score += 5;

    if (base.quality > 0 && metrics.quality < base.quality * .15 && visits >= 1500) { score += 7; reasons.push('почти нет качественных конверсий'); }
    if (base.primary > 0 && metrics.primary > base.primary * 4 && visits >= 500) { score += 9; reasons.push('аномально высокая первичная конверсия'); }

    const browserText = [...source.browsers.keys()].join(' ').toLowerCase();
    if (browserText.includes('headless') || browserText.includes('phantom') || browserText.includes('selenium')) { score += 30; reasons.push('обнаружен headless/automation браузер'); }
    const unknownBrowserVisits = [...source.browsers.entries()].filter(([key]) => /не определ|unknown|undefined|other|другие/i.test(key)).reduce((sum, [,value]) => sum + value, 0);
    const unknownBrowserShare = tech.visits ? unknownBrowserVisits / tech.visits : 0;
    if (unknownBrowserShare >= .4) { score += 15; reasons.push('высокая доля неизвестных браузеров'); }
    else if (unknownBrowserShare >= .15) score += 7;

    if (topProfile.share >= .7 && tech.visits >= 500) { score += 19; reasons.push('один технический профиль доминирует'); }
    else if (topProfile.share >= .45 && tech.visits >= 500) { score += 11; reasons.push('концентрация технического профиля'); }
    if (topBrowser.share >= .75 && tech.visits >= 500) { score += 8; reasons.push('однотипный браузер'); }
    if (topResolution.share >= .65 && tech.visits >= 500) { score += 8; reasons.push('однотипное разрешение'); }

    if (topIp.share >= .2 && ip.visits >= 200) { score += 24; reasons.push('высокая концентрация одного IP'); }
    else if (topIp.share >= .08 && ip.visits >= 200) { score += 13; reasons.push('концентрация одного IP'); }
    else if (topIp.share >= .03 && ip.visits >= 500) score += 6;

    if (topSubnet.share >= .35 && ip.visits >= 500) { score += 22; reasons.push('высокая концентрация подсети'); }
    else if (topSubnet.share >= .18 && ip.visits >= 500) { score += 14; reasons.push('концентрация подсети'); }
    else if (topSubnet.share >= .08 && ip.visits >= 500) score += 6;

    if (ipv6Share >= .7 && metrics.bounce > base.bounce + .12) { score += 5; reasons.push('IPv6-кластер с отклонением поведения'); }

    let confidence = 'Высокая';
    if (visits < 500 || !tech.visits || !ip.visits) confidence = 'Низкая';
    else if (visits < 3000 || Math.min(tech.visits, ip.visits) / Math.max(tech.visits, ip.visits) < .65) confidence = 'Средняя';

    if (visits < 100) score = Math.min(score, 24);
    else if (visits < 500) score = Math.min(score, 44);
    score = Math.min(100, Math.round(score));

    const risk = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';
    const action = risk === 'high'
      ? 'Запросить у площадки детализацию по SSP, сайтам, приложениям и user-agent. Проверить выделенные кластеры до отключения или претензии.'
      : risk === 'medium'
        ? 'Точечно проверить отмеченные IP, подсети и технические профили. Площадку целиком пока не отключать.'
        : 'Оставить источник в мониторинге и сравнивать динамику признаков в следующих периодах.';

    return {
      name: source.name, visits, tech, ip, metrics, score, risk, confidence,
      reasons: [...new Set(reasons)], action, topBrowser, topResolution, topProfile, topIp, topSubnet, ipv6Share
    };
  }

  function analyze() {
    try {
      const sources = buildAggregates();
      if (!sources.length) throw new Error('После очистки итоговых строк не осталось данных для анализа.');
      const base = buildBase(sources);
      state.results = sources.map((source) => scoreSource(source, base)).sort((a,b) => b.score - a.score || b.visits - a.visits);
      renderResults(base);
      ui.results.hidden = false;
      ui.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    return hours ? `${hours}:${String(minutes).padStart(2,'0')}:${String(rest).padStart(2,'0')}` : `${minutes}:${String(rest).padStart(2,'0')}`;
  }

  function riskLabel(risk) {
    return risk === 'high' ? 'Высокий' : risk === 'medium' ? 'Требует проверки' : 'Низкий';
  }

  function maskIp(ip) {
    const value = String(ip || '—');
    if (value.includes(':')) {
      const parts = value.split(':');
      return `${parts.slice(0,2).join(':')}:****:****`;
    }
    const parts = value.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.***.***` : value;
  }

  function renderResults(base) {
    const totalVisits = state.results.reduce((sum, row) => sum + row.visits, 0);
    const high = state.results.filter((row) => row.risk === 'high');
    const medium = state.results.filter((row) => row.risk === 'medium');
    const highVisits = high.reduce((sum, row) => sum + row.visits, 0);
    const ipTotal = state.results.reduce((sum,row) => sum + row.ip.visits, 0);
    const techTotal = state.results.reduce((sum,row) => sum + row.tech.visits, 0);
    const coverage = Math.max(ipTotal, techTotal) ? Math.min(ipTotal, techTotal) / Math.max(ipTotal, techTotal) : 0;

    ui.kpis.innerHTML = [
      ['Всего визитов', formatInt(totalVisits), `${state.results.length} источников`],
      ['Высокий риск', formatInt(high.length), formatPct(totalVisits ? highVisits / totalVisits : 0) + ' визитов'],
      ['Требуют проверки', formatInt(medium.length), 'средний приоритет'],
      ['Средний отказ', formatPct(base.bounce), 'по всей базе'],
      ['Среднее время', formatDuration(base.time), 'по всей базе'],
      ['Покрытие файлов', formatPct(coverage), 'совпадение объёмов']
    ].map(([label,value,note]) => `<article class="kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');

    const conclusion = high.length
      ? `Обнаружено ${high.length} ${plural(high.length,'источник','источника','источников')} с высокой комбинацией признаков. Это повод для детальной проверки выделенных кластеров, но не автоматическое доказательство фрода.`
      : medium.length
        ? `Критических комбинаций не найдено. ${medium.length} ${plural(medium.length,'источник требует','источника требуют','источников требуют')} точечной ручной проверки.`
        : 'Выраженных комбинаций аномальных признаков не найдено. Источники можно оставить в мониторинге.';
    ui.conclusion.innerHTML = `<strong>Общий вывод</strong>${escapeHtml(conclusion)}`;
    ui.summary.textContent = `Проанализировано ${formatInt(totalVisits)} визитов по ${state.results.length} источникам.`;

    ui.table.innerHTML = state.results.map((row) => `
      <tr data-risk="${row.risk}" data-name="${escapeHtml(row.name.toLowerCase())}">
        <td><a href="#source-${slug(row.name)}">${escapeHtml(row.name)}</a></td>
        <td>${formatInt(row.visits)}</td>
        <td>${formatPct(row.metrics.bounce)}</td>
        <td>${formatDuration(row.metrics.time)}</td>
        <td title="${escapeHtml(row.topSubnet.key)}">${escapeHtml(shorten(row.topSubnet.key,22))} · ${formatPct(row.topSubnet.share)}</td>
        <td title="${escapeHtml(row.topProfile.key)}">${escapeHtml(shorten(row.topProfile.key,28))} · ${formatPct(row.topProfile.share)}</td>
        <td><span class="risk-pill ${row.risk}">${riskLabel(row.risk)}</span></td>
        <td><strong>${row.score}</strong>/100</td>
      </tr>`).join('');

    ui.list.innerHTML = state.results.map((row,index) => renderSourceCard(row,index)).join('');
    applyFilters();
  }

  function renderSourceCard(row, index) {
    const reasons = row.reasons.length ? row.reasons : ['критичных сочетаний признаков не найдено'];
    return `<details class="source-card ${row.risk}" id="source-${slug(row.name)}" data-risk="${row.risk}" data-name="${escapeHtml(row.name.toLowerCase())}" ${index < 3 || row.risk !== 'low' ? 'open' : ''}>
      <summary>
        <div><span class="section-kicker">UTM Source</span><h3>${escapeHtml(row.name)}</h3><p>${escapeHtml(reasons.slice(0,4).join(' · '))}</p></div>
        <div class="source-score"><span>${riskLabel(row.risk)} риск</span><strong>${row.score}<small>/100</small></strong></div>
      </summary>
      <div class="source-body">
        <div class="metric-strip">
          <div><strong>${formatInt(row.visits)}</strong><span>визиты</span></div>
          <div><strong>${formatPct(row.metrics.bounce)}</strong><span>отказы</span></div>
          <div><strong>${formatDuration(row.metrics.time)}</strong><span>время</span></div>
          <div><strong>${formatPct(row.metrics.newShare)}</strong><span>новые</span></div>
          <div><strong>${formatPct(row.metrics.quality,3)}</strong><span>качественные</span></div>
          <div><strong>${escapeHtml(row.confidence)}</strong><span>уверенность</span></div>
        </div>
        <div class="detail-grid">
          <section class="detail"><h4>Почему такой score</h4><ul class="flag-list">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></section>
          <section class="detail"><h4>IP и подсети</h4><p><b>Топ IP:</b> ${escapeHtml(maskIp(row.topIp.key))} · ${formatPct(row.topIp.share)}</p><p><b>Топ подсеть:</b> ${escapeHtml(row.topSubnet.key)} · ${formatPct(row.topSubnet.share)}</p><p><b>IPv6:</b> ${formatPct(row.ipv6Share)}</p></section>
          <section class="detail"><h4>Технический профиль</h4><p><b>Топ браузер:</b> ${escapeHtml(row.topBrowser.key)} · ${formatPct(row.topBrowser.share)}</p><p><b>Топ разрешение:</b> ${escapeHtml(row.topResolution.key)} · ${formatPct(row.topResolution.share)}</p><p><b>Топ связка:</b> ${escapeHtml(shorten(row.topProfile.key,100))} · ${formatPct(row.topProfile.share)}</p></section>
          <section class="detail"><h4>Покрытие</h4><p><b>Техническая выгрузка:</b> ${formatInt(row.tech.visits)} визитов</p><p><b>IP-выгрузка:</b> ${formatInt(row.ip.visits)} визитов</p><p><b>Уверенность:</b> ${escapeHtml(row.confidence)}</p></section>
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
    if (n1 === 1) return one;
    return many;
  }

  function shorten(value, max) {
    const text = String(value || '—');
    return text.length > max ? `${text.slice(0,max - 1)}…` : text;
  }

  function slug(value) {
    return normalize(value).replace(/\s+/g,'-').replace(/[^a-zа-я0-9-]/g,'') || 'unknown';
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
    if (!state.results.length) return;
    const headers = ['Источник','Визиты','Отказы','Время, сек','Качественная конверсия','Первичная конверсия','Топ IP, доля','Топ подсеть, доля','Топ техпрофиль, доля','Risk score','Уровень','Уверенность','Причины','Рекомендация'];
    const rows = state.results.map((row) => [
      row.name,row.visits,row.metrics.bounce,row.metrics.time,row.metrics.quality,row.metrics.primary,row.topIp.share,row.topSubnet.share,row.topProfile.share,row.score,riskLabel(row.risk),row.confidence,row.reasons.join('; '),row.action
    ]);
    const csv = '\uFEFF' + [headers,...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `traffic-fraud-analysis-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function csvCell(value) {
    const text = typeof value === 'number' ? String(value).replace('.',',') : String(value ?? '');
    return `"${text.replace(/"/g,'""')}"`;
  }

  function reset() {
    state.ipRows = state.techRows = state.ipMap = state.techMap = null;
    state.results = [];
    ui.ipFile.value = '';
    ui.techFile.value = '';
    setCard('ip','idle','Файл не выбран','Поддерживаются CSV, XLSX и XLS.');
    setCard('tech','idle','Файл не выбран','Поддерживаются CSV, XLSX и XLS.');
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
    state.ipRows = [
      {'UTM Source':'yandex','IP-адрес':'95.24.12.10','Визиты':7600,'Посетители':6900,'Отказы':'35%','Время на сайте':'2:16','Доля новых посетителей':'81%','Конверсия (Первично-качественные звонки UIS)':'0,24%'},
      {'UTM Source':'yandex','IP-адрес':'95.25.18.44','Визиты':4300,'Посетители':3900,'Отказы':'37%','Время на сайте':'2:08','Доля новых посетителей':'82%','Конверсия (Первично-качественные звонки UIS)':'0,21%'},
      {'UTM Source':'rutube','IP-адрес':'2a00:1450:4001:81a::200e','Визиты':6400,'Посетители':6200,'Отказы':'61%','Время на сайте':'0:43','Доля новых посетителей':'98,5%','Конверсия (Первично-качественные звонки UIS)':'0,03%'},
      {'UTM Source':'rutube','IP-адрес':'2a00:1450:4001:81a::2010','Визиты':2600,'Посетители':2550,'Отказы':'64%','Время на сайте':'0:39','Доля новых посетителей':'99%','Конверсия (Первично-качественные звонки UIS)':'0,02%'},
      {'UTM Source':'unknown_dsp','IP-адрес':'185.90.10.11','Визиты':8900,'Посетители':8850,'Отказы':'92%','Время на сайте':'0:08','Доля новых посетителей':'100%','Конверсия (Первично-качественные звонки UIS)':'0%'},
      {'UTM Source':'unknown_dsp','IP-адрес':'185.90.10.12','Визиты':6100,'Посетители':6070,'Отказы':'94%','Время на сайте':'0:06','Доля новых посетителей':'100%','Конверсия (Первично-качественные звонки UIS)':'0%'},
      {'UTM Source':'small_test','IP-адрес':'77.88.1.1','Визиты':62,'Посетители':60,'Отказы':'82%','Время на сайте':'0:14','Доля новых посетителей':'100%'}
    ];
    state.techRows = [
      {'UTM Source':'yandex','Версия браузера':'Chrome 138','Операционная система (детально)':'Android 16','Модель устройства':'Разные модели','Разрешение':'393x852','Визиты':5200,'Посетители':4800,'Отказы':'35%','Время на сайте':'2:15','Доля новых посетителей':'81%','Конверсия (Первично-качественные звонки UIS)':'0,23%'},
      {'UTM Source':'yandex','Версия браузера':'Safari 26','Операционная система (детально)':'iOS 26','Модель устройства':'iPhone','Разрешение':'390x844','Визиты':6700,'Посетители':6000,'Отказы':'36%','Время на сайте':'2:12','Доля новых посетителей':'82%','Конверсия (Первично-качественные звонки UIS)':'0,22%'},
      {'UTM Source':'rutube','Версия браузера':'Chrome 138','Операционная система (детально)':'Android 16','Модель устройства':'Mobile','Разрешение':'360x800','Визиты':7600,'Посетители':7400,'Отказы':'62%','Время на сайте':'0:42','Доля новых посетителей':'99%','Конверсия (Первично-качественные звонки UIS)':'0,03%'},
      {'UTM Source':'rutube','Версия браузера':'Другие','Операционная система (детально)':'Android','Модель устройства':'Mobile','Разрешение':'360x800','Визиты':1400,'Посетители':1350,'Отказы':'68%','Время на сайте':'0:31','Доля новых посетителей':'99%','Конверсия (Первично-качественные звонки UIS)':'0%'},
      {'UTM Source':'unknown_dsp','Версия браузера':'HeadlessChrome 138','Операционная система (детально)':'Linux','Модель устройства':'Не определено','Разрешение':'1920x1080','Визиты':13800,'Посетители':13700,'Отказы':'93%','Время на сайте':'0:07','Доля новых посетителей':'100%','Конверсия (Первично-качественные звонки UIS)':'0%'},
      {'UTM Source':'unknown_dsp','Версия браузера':'Unknown','Операционная система (детально)':'Linux','Модель устройства':'Не определено','Разрешение':'1920x1080','Визиты':1200,'Посетители':1190,'Отказы':'96%','Время на сайте':'0:04','Доля новых посетителей':'100%','Конверсия (Первично-качественные звонки UIS)':'0%'},
      {'UTM Source':'small_test','Версия браузера':'Unknown','Операционная система (детально)':'Не определено','Модель устройства':'Не определено','Разрешение':'800x600','Визиты':62,'Посетители':60,'Отказы':'82%','Время на сайте':'0:14','Доля новых посетителей':'100%'}
    ];
    state.ipMap = detectMap(Object.keys(state.ipRows[0]));
    state.techMap = detectMap(Object.keys(state.techRows[0]));
    renderMapping('ip',state.ipMap,[]);
    renderMapping('tech',state.techMap,[]);
    setCard('ip','ready','Демо готово',`${formatInt(state.ipRows.length)} строк · тестовые данные`);
    setCard('tech','ready','Демо готово',`${formatInt(state.techRows.length)} строк · тестовые данные`);
    showValidation('Загружен демонстрационный набор. Можно изучить результат или заменить его своими файлами.',false);
    updateAnalyzeState();
    analyze();
  }

  ui.ipFile.addEventListener('change', (event) => handleFile('ip', event.target.files[0]));
  ui.techFile.addEventListener('change', (event) => handleFile('tech', event.target.files[0]));
  ui.analyze.addEventListener('click', analyze);
  ui.reset.addEventListener('click', reset);
  ui.demo.addEventListener('click', loadDemo);
  ui.export.addEventListener('click', exportCsv);
  ui.search.addEventListener('input', (event) => { state.query = event.target.value.trim(); applyFilters(); });
  $$('.filter-button').forEach((button) => button.addEventListener('click', () => {
    state.riskFilter = button.dataset.risk;
    $$('.filter-button').forEach((candidate) => candidate.classList.toggle('active', candidate === button));
    applyFilters();
  }));
})();
