#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app-v2.js"
INDEX = ROOT / "index.html"
README = ROOT / "README.md"
RUNTIME = ROOT / "scripts" / "validate_api_runtime.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing expected block: {label}")
    return text.replace(old, new, 1)


app = APP.read_text(encoding="utf-8")

app = replace_once(
    app,
    """  function aggregateApiSnapshots(rows) {
""",
    """  function aggregateVisitRisk(rows) {
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    let classifiedVisits = 0;
    let highRiskVisits = 0;
    let reviewVisits = 0;
    let lowRiskVisits = 0;
    const reasonMap = new Map();
    const confidenceRank = { 'Низкая': 1, 'Средняя': 2, 'Высокая': 3 };
    let confidence = 'Высокая';
    let hasData = false;

    for (const row of rows || []) {
      const visitRisk = row?.visitRisk;
      if (!visitRisk) continue;
      hasData = true;
      classifiedVisits += number(visitRisk.classifiedVisits);
      highRiskVisits += number(visitRisk.highRiskVisits);
      reviewVisits += number(visitRisk.reviewVisits);
      lowRiskVisits += number(visitRisk.lowRiskVisits);
      if ((confidenceRank[visitRisk.confidence] || 0) < (confidenceRank[confidence] || 0)) confidence = visitRisk.confidence || confidence;
      for (const reason of visitRisk.reasons || []) {
        const code = String(reason.code || reason.label || 'other');
        const current = reasonMap.get(code) || { code, label: String(reason.label || code), visits: 0 };
        current.visits += number(reason.visits);
        reasonMap.set(code, current);
      }
    }
    if (!hasData) return null;

    const suspiciousVisits = highRiskVisits + reviewVisits;
    const reasons = [...reasonMap.values()]
      .sort((a, b) => b.visits - a.visits)
      .map((reason) => ({ ...reason, shareOfSuspicious: suspiciousVisits ? reason.visits / suspiciousVisits : 0 }));
    const topReasons = reasons.slice(0, 2).map((reason) => reason.label);
    const comment = suspiciousVisits
      ? `${formatInt(suspiciousVisits)} визитов требуют внимания: ${formatInt(highRiskVisits)} высокого риска и ${formatInt(reviewVisits)} требуют проверки. Основные причины — ${topReasons.join(' и ') || 'совпадение нескольких независимых признаков'}.`
      : 'Выраженных сочетаний признаков на уровне отдельных визитов не найдено.';

    return {
      classifiedVisits,
      highRiskVisits,
      reviewVisits,
      lowRiskVisits,
      suspiciousVisits,
      suspiciousShare: classifiedVisits ? suspiciousVisits / classifiedVisits : 0,
      confidence,
      comment,
      reasons
    };
  }

  function aggregateApiSnapshots(rows) {
""",
    "visit risk aggregator",
)

app = replace_once(
    app,
    """      cookieEnabledShare: weighted((row) => row.cookieEnabledShare),
      automation: rows.some((row) => Boolean(row.automation)),
""",
    """      cookieEnabledShare: weighted((row) => row.cookieEnabledShare),
      visitRisk: aggregateVisitRisk(rows),
      automation: rows.some((row) => Boolean(row.automation)),
""",
    "aggregate visit risk output",
)

app = replace_once(
    app,
    """        reasons: [...new Set(reasons)],
        flaggedVisits: risk === 'low' ? 0 : day.visits,
        month: day.date.slice(0, 7)
""",
    """        reasons: [...new Set(reasons)],
        flaggedVisits: risk === 'low'
          ? 0
          : day.visitRisk
            ? Math.min(day.visits, Number(day.visitRisk.suspiciousVisits) || 0)
            : day.visits,
        month: day.date.slice(0, 7)
""",
    "refined flagged visits",
)

app = replace_once(
    app,
    """      ['Визиты в аномальные дни', formatInt(flaggedVisits), formatPct(totalVisits ? flaggedVisits / totalVisits : 0) + ' трафика'],
""",
    """      [state.dataMode === 'api' ? 'Подозрительные визиты' : 'Визиты в аномальные дни', formatInt(flaggedVisits), formatPct(totalVisits ? flaggedVisits / totalVisits : 0) + (state.dataMode === 'api' ? ' получили сочетание признаков' : ' трафика')],
""",
    "visit risk KPI",
)

app = replace_once(
    app,
    """    const conclusion = anomalousDays.length
      ? `Найдено ${anomalousDays.length} ${plural(anomalousDays.length, 'аномальное сочетание источника и дня', 'аномальных сочетания источника и дня', 'аномальных сочетаний источника и дня')}. В оценочный объём вошло ${formatInt(flaggedVisits)} визитов, совершённых в эти дни. Это объём под проверкой, а не точное число фродовых визитов.`
      : 'Однодневных отклонений с достаточной выборкой не найдено. Каждый день сравнивался с остальными днями того же источника.';
""",
    """    const conclusion = anomalousDays.length
      ? state.dataMode === 'api'
        ? `Найдено ${anomalousDays.length} ${plural(anomalousDays.length, 'аномальное сочетание источника и дня', 'аномальных сочетания источника и дня', 'аномальных сочетаний источника и дня')}. Внутри них ${formatInt(flaggedVisits)} визитов получили сочетание независимых признаков и отнесены к высокому риску либо требуют проверки. Это оценка риска, а не доказанный фрод.`
        : `Найдено ${anomalousDays.length} ${plural(anomalousDays.length, 'аномальное сочетание источника и дня', 'аномальных сочетания источника и дня', 'аномальных сочетаний источника и дня')}. В оценочный объём вошло ${formatInt(flaggedVisits)} визитов, совершённых в эти дни. Это объём под проверкой, а не точное число фродовых визитов.`
      : 'Однодневных отклонений с достаточной выборкой не найдено. Каждый день сравнивался с остальными днями того же источника.';
""",
    "API conclusion",
)

app = replace_once(
    app,
    """      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td>${day.clientIdVisits ? `${formatInt(day.uniqueClientIds)} / ${formatPct(day.topClientId.share)}` : '—'}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="7">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
""",
    """      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${day.visitRisk ? formatInt(day.visitRisk.suspiciousVisits) : formatInt(day.flaggedVisits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td>${day.clientIdVisits ? `${formatInt(day.uniqueClientIds)} / ${formatPct(day.topClientId.share)}` : '—'}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="8">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
""",
    "daily visit risk column",
)

app = replace_once(
    app,
    """    const dailyConcentrations = row.concentrationScope === 'daily';
""",
    """    const visitRisk = aggregateVisitRisk(row.anomalousDays);
    const visitRiskReasons = visitRisk?.reasons?.length
      ? `<ul class="flag-list">${visitRisk.reasons.slice(0, 5).map((reason) => `<li>${escapeHtml(reason.label)} — ${formatInt(reason.visits)} визитов</li>`).join('')}</ul>`
      : '';
    const dailyConcentrations = row.concentrationScope === 'daily';
""",
    "source visit risk data",
)

app = replace_once(
    app,
    """           <div><strong>${formatInt(row.anomalousDays.reduce((sum, day) => sum + day.flaggedVisits, 0))}</strong><span>визиты под проверкой</span></div>
""",
    """           <div><strong>${formatInt(row.anomalousDays.reduce((sum, day) => sum + day.flaggedVisits, 0))}</strong><span>${state.dataMode === 'api' ? 'подозрительные визиты' : 'визиты под проверкой'}</span></div>
""",
    "source metric label",
)

app = replace_once(
    app,
    """<thead><tr><th>Дата</th><th>Визиты</th><th>Отказы</th><th>Время</th><th>ClientID: уник. / топ-1</th><th>Score</th><th>Причины</th></tr></thead>""",
    """<thead><tr><th>Дата</th><th>Визиты</th><th>Подозр.</th><th>Отказы</th><th>Время</th><th>ClientID: уник. / топ-1</th><th>Score</th><th>Причины</th></tr></thead>""",
    "daily table header",
)

app = replace_once(
    app,
    """          <section class="detail"><h4>${clientTitle}</h4>${row.clientIdVisits ? `<p><b>Покрытие:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>${uniqueClientLabel}:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>${visitsPerClientLabel}:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Макс. топ-1 / топ-10:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>` : '<p>ClientID не найден в выбранных данных.</p>'}</section>
          <section class="detail"><h4>Покрытие</h4>""",
    """          <section class="detail"><h4>${clientTitle}</h4>${row.clientIdVisits ? `<p><b>Покрытие:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>${uniqueClientLabel}:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>${visitsPerClientLabel}:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Макс. топ-1 / топ-10:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>` : '<p>ClientID не найден в выбранных данных.</p>'}</section>
          ${state.dataMode === 'api' ? `<section class="detail detail--visit-risk"><h4>Оценка конкретных визитов</h4>${visitRisk ? `<p><b>Высокий риск:</b> ${formatInt(visitRisk.highRiskVisits)}</p><p><b>Требуют проверки:</b> ${formatInt(visitRisk.reviewVisits)}</p><p><b>Всего подозрительных:</b> ${formatInt(visitRisk.suspiciousVisits)} · ${formatPct(visitRisk.suspiciousShare)}</p><p><b>Надёжность:</b> ${escapeHtml(visitRisk.confidence)}</p><p>${escapeHtml(visitRisk.comment)}</p>${visitRiskReasons}` : '<p>Для выбранных аномальных дней классификация визитов ещё не рассчитана.</p>'}</section>` : ''}
          <section class="detail"><h4>Покрытие</h4>""",
    "visit risk source block",
)

app = replace_once(
    app,
    """    const headers = ['Дата','Месяц','Источник','Визиты','Обычный дневной объём','Отказы','Обычные отказы','Время, сек','Обычное время, сек','Топ IP, доля','Топ подсеть, доля','Топ техпрофиль, доля','ClientID, покрытие','Уникальные ClientID','Визитов на ClientID','Топ-1 ClientID, доля','Обычная доля топ-1 ClientID','Топ-10 ClientID, доля','Обычная доля топ-10 ClientID','Risk score','Уровень','Уверенность','Визиты под проверкой','Причины'];
""",
    """    const headers = ['Дата','Месяц','Источник','Визиты','Обычный дневной объём','Отказы','Обычные отказы','Время, сек','Обычное время, сек','Топ IP, доля','Топ подсеть, доля','Топ техпрофиль, доля','ClientID, покрытие','Уникальные ClientID','Визитов на ClientID','Топ-1 ClientID, доля','Обычная доля топ-1 ClientID','Топ-10 ClientID, доля','Обычная доля топ-10 ClientID','VisitID высокий риск','VisitID требуют проверки','VisitID подозрительные','Причины VisitID','Risk score','Уровень','Уверенность','Визиты под проверкой','Причины'];
""",
    "CSV visit risk headers",
)

app = replace_once(
    app,
    """      day.topIp.share, day.topSubnet.share, day.topProfile.share, day.clientIdCoverage, day.uniqueClientIds, day.visitsPerClientId, day.topClientId.share, day.baseline.topClientId, day.top10ClientShare, day.baseline.top10ClientShare,
      day.score, riskLabel(day.risk), day.confidence, day.flaggedVisits, day.reasons.join('; ')
""",
    """      day.topIp.share, day.topSubnet.share, day.topProfile.share, day.clientIdCoverage, day.uniqueClientIds, day.visitsPerClientId, day.topClientId.share, day.baseline.topClientId, day.top10ClientShare, day.baseline.top10ClientShare,
      day.visitRisk?.highRiskVisits || 0, day.visitRisk?.reviewVisits || 0, day.visitRisk?.suspiciousVisits || 0, (day.visitRisk?.reasons || []).map((reason) => `${reason.label}: ${reason.visits}`).join('; '),
      day.score, riskLabel(day.risk), day.confidence, day.flaggedVisits, day.reasons.join('; ')
""",
    "CSV visit risk rows",
)

APP.write_text(app, encoding="utf-8")

index = INDEX.read_text(encoding="utf-8")
index = replace_once(
    index,
    """          <span>Без хранения идентификаторов</span>
""",
    """          <span>Сумма подозрительных VisitID</span>
          <span>Без хранения идентификаторов</span>
""",
    "hero VisitID chip",
)
index = replace_once(index, "Версия 0.6 · Metrica Logs API · дневной мониторинг", "Версия 0.7 · VisitID risk summary · дневной мониторинг", "footer version")
INDEX.write_text(index, encoding="utf-8")

readme = README.read_text(encoding="utf-8")
readme = replace_once(readme, "## Что умеет версия 0.6", "## Что умеет версия 0.7", "README version")
readme = replace_once(
    readme,
    """- оценивает количество визитов, совершённых в аномальные дни, и суммирует их по месяцам;
""",
    """- внутри аномального дня классифицирует отдельные визиты и выводит только суммы по уровням риска;
- показывает агрегированные причины подозрительности без публикации VisitID, ClientID и IP;
- суммирует подозрительные визиты по площадкам и месяцам;
""",
    "README visit risk bullets",
)
readme = replace_once(
    readme,
    """Показатель `Визиты в аномальные дни` — это объём трафика, попавшего под проверку. Он не равен точному количеству доказанных фродовых визитов. Для точного подсчёта уникальных визитов потребуется выгрузка на уровне `VisitID`.
""",
    """В API-режиме каждый VisitID получает внутренний rule-based класс: низкий риск, требует проверки или высокий риск. В дашборд выводятся только суммы и агрегированные причины. Один визит учитывается один раз в итоговом количестве, даже если у него несколько причин. Результат остаётся оценкой риска и не является доказательством фрода.
""",
    "README limitation",
)
README.write_text(readme, encoding="utf-8")

runtime = RUNTIME.read_text(encoding="utf-8")
runtime = replace_once(
    runtime,
    """      cookieEnabledShare: 1,
      automation: false,
""",
    """      cookieEnabledShare: 1,
      visitRisk: {
        classifiedVisits: visits,
        highRiskVisits: anomaly ? 600 : 0,
        reviewVisits: anomaly ? 900 : 0,
        lowRiskVisits: anomaly ? visits - 1500 : visits,
        suspiciousVisits: anomaly ? 1500 : 0,
        suspiciousShare: anomaly ? 1500 / visits : 0,
        confidence: 'Высокая',
        comment: anomaly ? '1 500 визитов требуют внимания.' : 'Выраженных сочетаний признаков не найдено.',
        reasons: anomaly ? [{ code: 'repeated_clientid', label: 'повторные визиты одного ClientID', visits: 1500, shareOfSuspicious: 1 }] : [],
      },
      automation: false,
""",
    "runtime visit risk fixture",
)
runtime = replace_once(
    runtime,
    """if (!getElement('#source-list').innerHTML.includes('ClientID — дневные максимумы')) {
  throw new Error('Daily concentration labels were not rendered');
}
""",
    """if (!getElement('#source-list').innerHTML.includes('ClientID — дневные максимумы')) {
  throw new Error('Daily concentration labels were not rendered');
}
if (!getElement('#source-list').innerHTML.includes('Оценка конкретных визитов')) {
  throw new Error('Visit-level risk summary was not rendered');
}
if (!getElement('#source-list').innerHTML.includes('повторные визиты одного ClientID')) {
  throw new Error('Visit-level reason was not rendered');
}
if (!getElement('#kpi-grid').innerHTML.includes('Подозрительные визиты')) {
  throw new Error('Refined suspicious visits KPI was not rendered');
}
""",
    "runtime visit risk assertions",
)
RUNTIME.write_text(runtime, encoding="utf-8")

print("Visit-risk UI applied")
