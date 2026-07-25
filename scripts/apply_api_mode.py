#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app-v2.js"
INDEX = ROOT / "index.html"
README = ROOT / "README.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing expected block: {label}")
    return text.replace(old, new, 1)


app = APP.read_text(encoding="utf-8")

app = replace_once(
    app,
    """    monthlyResults: [],
    riskFilter: 'all',
    query: ''
""",
    """    monthlyResults: [],
    analysisContext: '',
    dataMode: 'manual',
    riskFilter: 'all',
    query: ''
""",
    "state API context",
)

app = replace_once(
    app,
    """  function snapshot(slice) {
    const tech = finishBucket(slice.tech);
""",
    """  function snapshot(slice) {
    if (slice?.precomputedSnapshot) return slice.precomputedSnapshot;
    const tech = finishBucket(slice.tech);
""",
    "precomputed snapshot",
)

app = replace_once(
    app,
    """  function buildBase(sources) {
    const bucket = emptyBucket();
    for (const source of sources) {
      const selected = source.tech.visits ? source.tech : source.ip;
      Object.keys(bucket).forEach((key) => { bucket[key] += selected[key] || 0; });
    }
    return finishBucket(bucket);
  }
""",
    """  function buildBase(sources) {
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
""",
    "generic base calculation",
)

for old, new, label in [
    (
        "if (data.topProfile.share >= .7 && data.tech.visits >= 500)",
        "if (data.concentrationScope !== 'daily' && data.topProfile.share >= .7 && data.tech.visits >= 500)",
        "period profile strong",
    ),
    (
        "else if (data.topProfile.share >= .45 && data.tech.visits >= 500)",
        "else if (data.concentrationScope !== 'daily' && data.topProfile.share >= .45 && data.tech.visits >= 500)",
        "period profile medium",
    ),
    (
        "if (data.topIp.share >= .2 && data.ip.visits >= 200)",
        "if (data.concentrationScope !== 'daily' && data.topIp.share >= .2 && data.ip.visits >= 200)",
        "period IP strong",
    ),
    (
        "else if (data.topIp.share >= .08 && data.ip.visits >= 200)",
        "else if (data.concentrationScope !== 'daily' && data.topIp.share >= .08 && data.ip.visits >= 200)",
        "period IP medium",
    ),
    (
        "if (data.topSubnet.share >= .35 && data.ip.visits >= 500)",
        "if (data.concentrationScope !== 'daily' && data.topSubnet.share >= .35 && data.ip.visits >= 500)",
        "period subnet strong",
    ),
    (
        "else if (data.topSubnet.share >= .18 && data.ip.visits >= 500)",
        "else if (data.concentrationScope !== 'daily' && data.topSubnet.share >= .18 && data.ip.visits >= 500)",
        "period subnet medium",
    ),
    (
        "const enoughClientIds = data.clientIdVisits >= 300 && data.clientIdCoverage >= .5 && data.uniqueClientIds >= 20;",
        "const enoughClientIds = data.concentrationScope !== 'daily' && data.clientIdVisits >= 300 && data.clientIdCoverage >= .5 && data.uniqueClientIds >= 20;",
        "period ClientID scope",
    ),
]:
    app = replace_once(app, old, new, label)

old_analyze = """  function analyze() {
    try {
      const sourceVolumes = buildAggregates().map((source) => ({ source, visits: snapshot(source).visits }));
      const includedSources = sourceVolumes.filter((item) => item.visits >= MIN_SOURCE_VISITS);
      const excludedSources = sourceVolumes.filter((item) => item.visits < MIN_SOURCE_VISITS);
      const sources = includedSources.map((item) => item.source);
      if (!sources.length) throw new Error(`После очистки данных не осталось площадок с ${MIN_SOURCE_VISITS} и более визитами за период.`);
      if (excludedSources.length) {
        const excludedVisits = excludedSources.reduce((sum, item) => sum + item.visits, 0);
        showValidation(`Исключено ${excludedSources.length} ${plural(excludedSources.length, 'площадка', 'площадки', 'площадок')} с объёмом менее ${MIN_SOURCE_VISITS} визитов за период (${formatInt(excludedVisits)} визитов).`, false);
      }
      const base = buildBase(sources);
      state.results = sources.map((source) => combineSource(source, base)).sort((a, b) => b.score - a.score || b.visits - a.visits);
      state.dailyResults = state.results.flatMap((source) => source.days).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
      state.monthlyResults = buildMonthly(state.dailyResults);
      renderResults(base);
      ui.results.hidden = false;
      ui.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showValidation(error.message, true);
    }
  }
"""

new_analyze = """  function maxShareEntry(rows, field) {
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
    const uniqueClientIds = rows.reduce((sum, row) => sum + number(row.uniqueClientIds), 0);
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
"""

app = replace_once(app, old_analyze, new_analyze, "analysis API functions")

app = replace_once(
    app,
    """      ['Покрытие файлов', formatPct(coverage), 'совпадение объёмов']
""",
    """      state.dataMode === 'api'
        ? ['Источник данных', 'Logs API', 'без ограничения CSV']
        : ['Покрытие файлов', formatPct(coverage), 'совпадение объёмов']
""",
    "API KPI",
)

app = replace_once(
    app,
    """    ui.summary.textContent = `Проанализировано ${formatInt(totalVisits)} визитов по ${state.results.length} источникам и ${state.dailyResults.length} дневным срезам.`;
""",
    """    const contextText = state.analysisContext ? ` ${state.analysisContext}.` : '';
    ui.summary.textContent = `Проанализировано ${formatInt(totalVisits)} визитов по ${state.results.length} источникам и ${state.dailyResults.length} дневным срезам.${contextText}`;
""",
    "API summary context",
)

app = replace_once(
    app,
    """    state.monthlyResults = [];
    ui.ipFile.value = '';
""",
    """    state.monthlyResults = [];
    state.analysisContext = '';
    state.dataMode = 'manual';
    ui.ipFile.value = '';
""",
    "reset API state",
)

app = replace_once(
    app,
    """  ui.ipFile?.addEventListener('change', (event) => handleFile('ip', event.target.files?.[0]));
""",
    """  window.FraudLab = Object.freeze({
    analyzeApiRows(rows, options = {}) {
      const sources = buildApiSources(rows);
      if (!sources.length) throw new Error('API не вернуло данных для выбранного периода.');
      analyzeSources(sources, { ...options, mode: 'api' });
      return { sources: state.results.length, days: state.dailyResults.length };
    }
  });

  ui.ipFile?.addEventListener('change', (event) => handleFile('ip', event.target.files?.[0]));
""",
    "FraudLab API exposure",
)

APP.write_text(app, encoding="utf-8")

index = INDEX.read_text(encoding="utf-8")
index = replace_once(
    index,
    """  <link rel="stylesheet" href="assets/daily.css">
""",
    """  <link rel="stylesheet" href="assets/daily.css">
  <link rel="stylesheet" href="assets/api.css">
""",
    "API stylesheet",
)
index = replace_once(
    index,
    """  <meta name="description" content="Локальная проверка дневных выгрузок Яндекс Метрики на признаки фрода и низкокачественного трафика">
""",
    """  <meta name="description" content="Фрод-анализ трафика по полным данным Yandex Metrica Logs API с выбором счётчика и периода">
""",
    "meta description",
)
index = replace_once(
    index,
    """        <p class="hero__lead">Загрузите две дневные выгрузки Яндекс Метрики. Инструмент сравнит каждый день источника с его остальными днями, найдёт локальные всплески и сформирует оценку объёма трафика под проверкой.</p>
""",
    """        <p class="hero__lead">Выберите счётчик и период. Инструмент загрузит полные дневные агрегаты из Yandex Metrica Logs API, сравнит каждый день источника с его историей и сформирует оценку объёма трафика под проверкой.</p>
""",
    "hero lead",
)
index = replace_once(
    index,
    """          <span>Локальная обработка</span>
""",
    """          <span>Logs API без лимита строк</span>
          <span>Без хранения идентификаторов</span>
""",
    "hero API chips",
)
index = replace_once(
    index,
    """          <strong>Данные остаются на устройстве</strong>
          <p>Файлы читаются браузером. Исходные строки, IP-адреса и ClientID не отправляются на сервер.</p>
""",
    """          <strong>Исходные идентификаторы не публикуются</strong>
          <p>IP, ClientID и VisitID обрабатываются внутри защищённого GitHub Action. В дашборд поступают только дневные агрегаты и доли.</p>
""",
    "privacy card",
)

api_section = """    <section class="panel api-panel" id="api-section">
      <div class="section-head">
        <div>
          <span class="section-kicker">Основной режим</span>
          <h2>Загрузить напрямую из Метрики</h2>
          <p>Счётчики обновляются автоматически. Выберите один или несколько счётчиков и период до последнего полностью завершённого дня.</p>
        </div>
      </div>

      <div class="api-grid">
        <fieldset class="api-fieldset">
          <legend>Счётчики</legend>
          <div class="counter-list" id="api-counter-list">
            <span class="api-generated">Загружаю список доступных счётчиков…</span>
          </div>
        </fieldset>
        <div class="api-field">
          <span>Период анализа</span>
          <div class="api-dates">
            <label class="api-field"><span>С</span><input id="api-date-from" type="date"></label>
            <label class="api-field"><span>По</span><input id="api-date-to" type="date"></label>
          </div>
        </div>
      </div>

      <div class="api-actions">
        <button class="button button--primary" id="api-analyze-button" type="button" disabled>Загрузить и проанализировать</button>
        <span class="api-generated" id="api-generated"></span>
      </div>
      <div class="api-status" id="api-status">Подключаюсь к каталогу подготовленных данных…</div>
    </section>

    <div class="manual-divider">Ручная загрузка остаётся резервным режимом</div>

"""
index = replace_once(
    index,
    """    <section class="panel" id="upload-section">
""",
    api_section + """    <section class="panel" id="upload-section">
""",
    "API section",
)
index = replace_once(
    index,
    """          <span class="section-kicker">Шаг 1</span>
          <h2>Загрузите дневные выгрузки</h2>
          <p>В обоих файлах обязательна отдельная колонка с датой визита. Поддерживаются значения вида 25.07.2026 и 2026-07-25.</p>
""",
    """          <span class="section-kicker">Резервный режим</span>
          <h2>Загрузить файлы вручную</h2>
          <p>Используйте этот вариант для сторонних счётчиков или проверки локальных файлов. В обоих файлах обязательна отдельная дата визита.</p>
""",
    "manual upload heading",
)
index = replace_once(
    index,
    """      <span>MVP 0.5 · дневной мониторинг · локальная обработка</span>
""",
    """      <span>Версия 0.6 · Metrica Logs API · дневной мониторинг</span>
""",
    "footer version",
)
index = replace_once(
    index,
    """  <script src="assets/app-v2.js"></script>
""",
    """  <script src="assets/app-v2.js"></script>
  <script src="assets/api-mode.js"></script>
""",
    "API script",
)
INDEX.write_text(index, encoding="utf-8")

readme = README.read_text(encoding="utf-8")
readme = replace_once(
    readme,
    """Инструмент для локального анализа дневных выгрузок Яндекс Метрики на возможные признаки фрода и низкокачественного трафика.

## Что умеет версия 0.5

- принимает две выгрузки CSV/XLSX: `Дата + источник + IP` и `Дата + источник + технические параметры`;
""",
    """Инструмент для анализа трафика Яндекс Метрики на возможные признаки фрода и низкокачественного трафика.

## Что умеет версия 0.6

- загружает безопасные дневные агрегаты напрямую из Yandex Metrica Logs API;
- позволяет выбрать счётчик и произвольный период из подготовленной истории;
- работает со счётчиками `53197618` и `100470605`;
- не зависит от ограничения CSV в 100 000 строк;
- сохраняет ручную загрузку двух CSV/XLSX как резервный режим;
- принимает две выгрузки CSV/XLSX: `Дата + источник + IP` и `Дата + источник + технические параметры`;
""",
    "README version and API bullets",
)
readme = replace_once(
    readme,
    """## Приватность

Файлы обрабатываются JavaScript-кодом непосредственно в браузере. Исходные IP-адреса, ClientID и строки выгрузок не отправляются в репозиторий или на внешний сервер. Для чтения CSV/XLSX используется клиентская библиотека SheetJS с CDN.

## Обязательные поля
""",
    """## API-режим

Отдельный GitHub Action использует секрет `YANDEX_METRIKA_TOKEN` и Logs API. Он получает визиты на уровне `VisitID`, считает дневные показатели по UTM Source, IP/подсетям, ClientID и техническим профилям, после чего удаляет подготовленные логи Метрики.

Данные хранятся помесячно в виде дневных агрегатов `счётчик × источник × дата`. Последние три завершённых дня обновляются повторно, чтобы учитывать поздно завершившиеся визиты. Интерфейс загружает только месяцы, пересекающиеся с выбранным периодом.

## Приватность

В публичные JSON не записываются исходные IP, ClientID и VisitID. Они используются только внутри GitHub Action для расчёта концентраций и сразу отбрасываются. Ручные CSV/XLSX по-прежнему обрабатываются JavaScript-кодом непосредственно в браузере и не отправляются на сервер.

## Обязательные поля ручного режима
""",
    "README API architecture",
)
README.write_text(readme, encoding="utf-8")
