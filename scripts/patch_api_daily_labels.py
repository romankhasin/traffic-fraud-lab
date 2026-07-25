#!/usr/bin/env python3
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "assets" / "app-v2.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Missing expected block: {label}")
    return text.replace(old, new, 1)


app = APP.read_text(encoding="utf-8")
app = replace_once(
    app,
    """    const uniqueClientIds = rows.reduce((sum, row) => sum + number(row.uniqueClientIds), 0);""",
    """    const uniqueClientIds = Math.max(0, ...rows.map((row) => number(row.uniqueClientIds)));""",
    "API daily maximum unique ClientIDs",
)
app = replace_once(
    app,
    """    const dailyRows = row.anomalousDays.length
      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td>${day.clientIdVisits ? `${formatInt(day.uniqueClientIds)} / ${formatPct(day.topClientId.share)}` : '—'}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="7">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
""",
    """    const dailyRows = row.anomalousDays.length
      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td>${day.clientIdVisits ? `${formatInt(day.uniqueClientIds)} / ${formatPct(day.topClientId.share)}` : '—'}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="7">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
    const dailyConcentrations = row.concentrationScope === 'daily';
    const ipTitle = dailyConcentrations ? 'IP и подсети — максимум за день' : 'IP и подсети за период';
    const techTitle = dailyConcentrations ? 'Технический профиль — максимум за день' : 'Технический профиль';
    const clientTitle = dailyConcentrations ? 'ClientID — дневные максимумы' : 'ClientID за период';
    const uniqueClientLabel = dailyConcentrations ? 'Макс. уникальных за день' : 'Уникальных ClientID';
    const visitsPerClientLabel = dailyConcentrations ? 'Макс. визитов на ClientID' : 'Визитов на ClientID';
""",
    "API source card labels",
)
app = replace_once(
    app,
    """          <section class="detail"><h4>IP и подсети за период</h4><p><b>Топ IP:</b> ${escapeHtml(maskIp(row.topIp.key))} · ${formatPct(row.topIp.share)}</p><p><b>Топ подсеть:</b> ${escapeHtml(row.topSubnet.key)} · ${formatPct(row.topSubnet.share)}</p></section>
          <section class="detail"><h4>Технический профиль</h4><p><b>Топ браузер:</b> ${escapeHtml(row.topBrowser.key)} · ${formatPct(row.topBrowser.share)}</p><p><b>Топ связка:</b> ${escapeHtml(shorten(row.topProfile.key, 100))} · ${formatPct(row.topProfile.share)}</p></section>
          <section class="detail"><h4>ClientID за период</h4>${row.clientIdVisits ? `<p><b>Покрытие:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>Уникальных ClientID:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>Визитов на ClientID:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Топ-1 / топ-10:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>` : '<p>ClientID не найден в загруженных выгрузках.</p>'}</section>
""",
    """          <section class="detail"><h4>${ipTitle}</h4><p><b>Топ IP:</b> ${escapeHtml(maskIp(row.topIp.key))} · ${formatPct(row.topIp.share)}</p><p><b>Топ подсеть:</b> ${escapeHtml(row.topSubnet.key)} · ${formatPct(row.topSubnet.share)}</p></section>
          <section class="detail"><h4>${techTitle}</h4><p><b>Топ браузер:</b> ${escapeHtml(row.topBrowser.key)} · ${formatPct(row.topBrowser.share)}</p><p><b>Топ связка:</b> ${escapeHtml(shorten(row.topProfile.key, 100))} · ${formatPct(row.topProfile.share)}</p></section>
          <section class="detail"><h4>${clientTitle}</h4>${row.clientIdVisits ? `<p><b>Покрытие:</b> ${formatPct(row.clientIdCoverage)}</p><p><b>${uniqueClientLabel}:</b> ${formatInt(row.uniqueClientIds)}</p><p><b>${visitsPerClientLabel}:</b> ${row.visitsPerClientId.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p><p><b>Макс. топ-1 / топ-10:</b> ${formatPct(row.topClientId.share)} / ${formatPct(row.top10ClientShare)}</p>` : '<p>ClientID не найден в выбранных данных.</p>'}</section>
""",
    "conditional detail headings",
)
APP.write_text(app, encoding="utf-8")
