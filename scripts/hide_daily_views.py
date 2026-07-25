#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
APP = ROOT / "assets" / "app-v2.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_index() -> None:
    text = INDEX.read_text(encoding="utf-8")
    daily_section = '''      <section class="panel panel--compact results-subsection">
        <div class="daily-intro">
          <div>
            <span class="section-kicker">Источник × день</span>
            <h3>Все дневные срезы</h3>
            <p id="daily-summary">Каждый день сравнивается с остальными днями того же источника.</p>
          </div>
          <div class="daily-note">Для устойчивой базы используются медиана и MAD. Проверяемый день исключается из собственной базы сравнения.</div>
        </div>
        <div class="toolbar">
          <div class="filter-group" role="group" aria-label="Фильтр риска">
            <button class="filter-button active" type="button" data-risk="all">Все</button>
            <button class="filter-button" type="button" data-risk="high">Высокий</button>
            <button class="filter-button" type="button" data-risk="medium">Требует проверки</button>
            <button class="filter-button" type="button" data-risk="low">Низкий</button>
          </div>
          <input class="search-input" id="source-search" type="search" placeholder="Поиск по источнику">
        </div>
        <div class="table-wrap">
          <table class="daily-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Источник</th>
                <th>Визиты</th>
                <th>Обычный день</th>
                <th>Отказы</th>
                <th>Время</th>
                <th>Риск</th>
                <th>Score</th>
                <th>Причины</th>
              </tr>
            </thead>
            <tbody id="daily-table"></tbody>
          </table>
        </div>
      </section>

'''
    text = replace_once(text, daily_section, "", "Daily results section")
    INDEX.write_text(text, encoding="utf-8")


def patch_app() -> None:
    text = APP.read_text(encoding="utf-8")
    daily_rows = '''    const dailyRows = row.anomalousDays.length
      ? row.anomalousDays.map((day) => `<tr><td>${escapeHtml(formatDate(day.date))}</td><td>${formatInt(day.visits)}</td><td>${formatPct(day.metrics.bounce)}</td><td>${formatDuration(day.metrics.time)}</td><td><span class="risk-pill ${day.risk}">${day.score}/100</span></td><td>${escapeHtml(day.reasons.slice(0, 3).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="6">Аномальных дней с достаточной выборкой не найдено.</td></tr>';
'''
    text = replace_once(text, daily_rows, "", "Per-source daily rows")
    daily_detail = '''        <section class="daily-detail"><h4>Аномальные дни</h4><div class="table-wrap mini-table-wrap"><table class="mini-table"><thead><tr><th>Дата</th><th>Визиты</th><th>Отказы</th><th>Время</th><th>Score</th><th>Причины</th></tr></thead><tbody>${dailyRows}</tbody></table></div></section>
'''
    text = replace_once(text, daily_detail, "", "Per-source daily detail")
    APP.write_text(text, encoding="utf-8")


def main() -> None:
    patch_index()
    patch_app()
    print("Visible daily slices removed; daily calculations preserved")


if __name__ == "__main__":
    main()
