#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app-v2.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    text = APP.read_text(encoding="utf-8")

    reasons_line = "    const reasons = row.reasons.length ? row.reasons : ['критичных сочетаний признаков не найдено'];\n"
    reasons_with_daily = reasons_line + """    const dailyRows = row.anomalousDays.length
      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td><span class=\"risk-pill ${day.risk}\">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan=\"6\">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
"""
    if "const dailyRows = row.anomalousDays.length" not in text:
        text = replace_once(text, reasons_line, reasons_with_daily, "Daily rows builder")

    detail_anchor = "        <div class=\"detail-grid\">\n"
    daily_detail = """        <section class=\"daily-detail\"><h4>Конкретные аномальные даты</h4><div class=\"table-wrap mini-table-wrap\"><table class=\"mini-table\"><thead><tr><th>Дата</th><th>Визиты</th><th>Отказы</th><th>Время</th><th>Score</th><th>Причины</th></tr></thead><tbody>${dailyRows}</tbody></table></div></section>
        <div class=\"detail-grid\">
"""
    if 'class="daily-detail"' not in text:
        text = replace_once(text, detail_anchor, daily_detail, "Per-source anomaly dates table")

    APP.write_text(text, encoding="utf-8")
    print("Per-source anomaly date tables restored")


if __name__ == "__main__":
    main()
