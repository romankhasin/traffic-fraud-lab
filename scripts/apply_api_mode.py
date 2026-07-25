#!/usr/bin/env python3
"""Finalize the already-applied Metrica API mode.

The script is intentionally idempotent because the pull-request workflow may run
again after committing its own changes.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app-v2.js"
README = ROOT / "README.md"


def replace_if_present(text: str, old: str, new: str) -> str:
    if old in text:
        return text.replace(old, new, 1)
    if new in text:
        return text
    raise RuntimeError(f"Neither old nor finalized block was found: {old[:80]!r}")


app = APP.read_text(encoding="utf-8")
if "function buildApiSources" not in app or "analyzeApiRows" not in app:
    raise RuntimeError("Metrica API mode is not present in app-v2.js")

app = replace_if_present(
    app,
    "const uniqueClientIds = rows.reduce((sum, row) => sum + number(row.uniqueClientIds), 0);",
    "const uniqueClientIds = Math.max(0, ...rows.map((row) => number(row.uniqueClientIds)));",
)

app = replace_if_present(
    app,
    """    const dailyRows = row.anomalousDays.length
      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td>${day.clientIdVisits ? `${formatInt(day.uniqueClientIds)} / ${formatPct(day.topClientId.share)}` : '—'}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="7">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
    return `<details class="source-card ${row.risk}" id="source-${slug(row.name)}" data-risk="${row.risk}" data-name="${escapeHtml(row.name.toLowerCase())}" data-scope="source-card" ${index < 3 || row.risk !== 'low' ? 'open' : ''}>
""",
    """    const dailyRows = row.anomalousDays.length
      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td>${day.clientIdVisits ? `${formatInt(day.uniqueClientIds)} / ${formatPct(day.topClientId.share)}` : '—'}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="7">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
    const apiMode = state.dataMode === 'api';
    const ipDetailTitle = apiMode ? 'Максимальная дневная концентрация IP' : 'IP и подсети за период';
    const profileDetailTitle = apiMode ? 'Максимальная дневная концентрация техники' : 'Технический профиль';
    const clientDetailTitle = apiMode ? 'ClientID: дневные максимумы' : 'ClientID за период';
    const clientDetail = row.clientIdVisits
      ? apiMode
        ? `<p><b>Покрытие за период:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>Максимум уникальных ClientID за день:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>Максимум визитов на ClientID за день:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Максимум топ-1 / топ-10 за день:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>`
        : `<p><b>Покрытие:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>Уникальных ClientID:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>Визитов на ClientID:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Топ-1 / топ-10:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>`
      : '<p>ClientID не найден в данных выбранного периода.</p>';
    const coverageDetail = apiMode
      ? `<p><b>Logs API — поведение и техника:</b> ${formatInt(row.tech.visits)} визитов</p><p><b>Logs API — IP и подсети:</b> ${formatInt(row.ip.visits)} визитов</p><p><b>Дней:</b> ${row.days.length}</p>`
      : `<p><b>Техническая выгрузка:</b> ${formatInt(row.tech.visits)} визитов</p><p><b>IP-выгрузка:</b> ${formatInt(row.ip.visits)} визитов</p><p><b>Дней:</b> ${row.days.length}</p>`;
    return `<details class="source-card ${row.risk}" id="source-${slug(row.name)}" data-risk="${row.risk}" data-name="${escapeHtml(row.name.toLowerCase())}" data-scope="source-card" ${index < 3 || row.risk !== 'low' ? 'open' : ''}>
""",
)

app = replace_if_present(
    app,
    """          <section class="detail"><h4>IP и подсети за период</h4><p><b>Топ IP:</b> ${escapeHtml(maskIp(row.topIp.key))} · ${formatPct(row.topIp.share)}</p><p><b>Топ подсеть:</b> ${escapeHtml(row.topSubnet.key)} · ${formatPct(row.topSubnet.share)}</p></section>
          <section class="detail"><h4>Технический профиль</h4><p><b>Топ браузер:</b> ${escapeHtml(row.topBrowser.key)} · ${formatPct(row.topBrowser.share)}</p><p><b>Топ связка:</b> ${escapeHtml(shorten(row.topProfile.key, 100))} · ${formatPct(row.topProfile.share)}</p></section>
          <section class="detail"><h4>ClientID за период</h4>${row.clientIdVisits ? `<p><b>Покрытие:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>Уникальных ClientID:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>Визитов на ClientID:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Топ-1 / топ-10:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>` : '<p>ClientID не найден в загруженных выгрузках.</p>'}</section>
          <section class="detail"><h4>Покрытие</h4><p><b>Техническая выгрузка:</b> ${formatInt(row.tech.visits)} визитов</p><p><b>IP-выгрузка:</b> ${formatInt(row.ip.visits)} визитов</p><p><b>Дней:</b> ${row.days.length}</p></section>
""",
    """          <section class="detail"><h4>${ipDetailTitle}</h4><p><b>${apiMode ? 'Максимум топ IP за день' : 'Топ IP'}:</b> ${escapeHtml(maskIp(row.topIp.key))} · ${formatPct(row.topIp.share)}</p><p><b>${apiMode ? 'Максимум топ подсети за день' : 'Топ подсеть'}:</b> ${escapeHtml(row.topSubnet.key)} · ${formatPct(row.topSubnet.share)}</p></section>
          <section class="detail"><h4>${profileDetailTitle}</h4><p><b>${apiMode ? 'Максимум топ браузера за день' : 'Топ браузер'}:</b> ${escapeHtml(row.topBrowser.key)} · ${formatPct(row.topBrowser.share)}</p><p><b>${apiMode ? 'Максимум топ связки за день' : 'Топ связка'}:</b> ${escapeHtml(shorten(row.topProfile.key, 100))} · ${formatPct(row.topProfile.share)}</p></section>
          <section class="detail"><h4>${clientDetailTitle}</h4>${clientDetail}</section>
          <section class="detail"><h4>Покрытие</h4>${coverageDetail}</section>
""",
)

APP.write_text(app, encoding="utf-8")

readme = README.read_text(encoding="utf-8")
readme = replace_if_present(
    readme,
    "Показатель `Визиты в аномальные дни` — это объём трафика, попавшего под проверку. Он не равен точному количеству доказанных фродовых визитов. Для точного подсчёта уникальных визитов потребуется выгрузка на уровне `VisitID`.",
    "Показатель `Визиты в аномальные дни` — это объём трафика, попавшего под проверку. Он не равен точному количеству доказанных фродовых визитов. В API-режиме VisitID используется для обработки каждого визита ровно один раз, но текущая методика всё равно маркирует аномальный день целиком, а не выносит вердикт по каждому VisitID.",
)
README.write_text(readme, encoding="utf-8")

print("Metrica API mode finalized")
