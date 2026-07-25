#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
APP = ROOT / "assets" / "app-v2.js"
README = ROOT / "README.md"
VALIDATE = ROOT / ".github" / "workflows" / "validate.yml"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_index() -> None:
    text = INDEX.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '  <link rel="stylesheet" href="assets/daily.css">\n',
        '  <link rel="stylesheet" href="assets/daily.css">\n  <link rel="stylesheet" href="assets/pdf.css">\n',
        "PDF stylesheet",
    )
    text = replace_once(
        text,
        '<button class="button button--ghost" id="export-button" type="button">Скачать дневной CSV</button>',
        '<button class="button button--ghost" id="export-button" type="button">Скачать CSV</button>',
        "CSV label",
    )
    export_panel = '''      <section class="panel panel--compact export-panel results-subsection" aria-label="Экспорт PDF">
        <div class="export-panel__copy">
          <span class="section-kicker">Экспорт</span>
          <h3>Краткий PDF-отчёт</h3>
          <p>Выберите все площадки или отметьте одну либо несколько. PDF формируется локально в браузере и включает итоговый score, надёжность оценки, визиты, отказы, среднее время, причины и аномальные даты.</p>
        </div>
        <div class="export-panel__controls">
          <div class="pdf-scope" role="radiogroup" aria-label="Состав PDF-отчёта">
            <label><input id="pdf-scope-all" type="radio" name="pdf-scope" value="all" checked> Все площадки</label>
            <label><input id="pdf-scope-selected" type="radio" name="pdf-scope" value="selected"> Выбрать площадки</label>
          </div>
          <div class="pdf-source-selector" id="pdf-source-selector" hidden></div>
          <div class="pdf-export-row">
            <button class="button button--primary" id="pdf-export-button" type="button" disabled>Скачать PDF</button>
            <span class="pdf-export-status" id="pdf-export-status">PDF будет компактным: до 6 аномальных дат на площадку.</span>
          </div>
        </div>
      </section>

'''
    text = replace_once(
        text,
        '      <section class="conclusion" id="conclusion"></section>\n\n',
        '      <section class="conclusion" id="conclusion"></section>\n\n' + export_panel,
        "PDF export panel",
    )
    text = replace_once(
        text,
        '  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>\n  <script src="assets/app-v2.js"></script>\n',
        '  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>\n  <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>\n  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>\n  <script src="assets/app-v2.js"></script>\n  <script src="assets/pdf-export.js"></script>\n',
        "PDF scripts",
    )
    text = text.replace('MVP 0.2 · дневной мониторинг · локальная обработка', 'MVP 0.3 · дневной мониторинг · локальная обработка')
    INDEX.write_text(text, encoding="utf-8")


def patch_app() -> None:
    text = APP.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "    if (m.time > 0 && m.time <= 20) { score += 22; reasons.push('очень короткое время за период'); }\n    else if (m.time > 0 && m.time <= 45) { score += 14; reasons.push('короткое время за период'); }\n",
        "",
        "Remove absolute period time scoring",
    )
    old = '''        const timeRatio = ratio(day.metrics.time, baseline.time);
        const timeZ = robustZ(day.metrics.time, sample((item) => item.metrics.time), 8);
        if (day.metrics.time > 0 && baseline.time >= 30 && timeRatio <= .4 && timeZ >= 2.5) { score += 21; reasons.push(`время упало до ${Math.round(timeRatio * 100)}% обычного`); }
        else if (day.metrics.time > 0 && baseline.time >= 30 && timeRatio <= .65 && timeZ >= 2.5) { score += 12; reasons.push(`заметное падение времени: ${Math.round(timeRatio * 100)}% базы`); }
'''
    new = '''        const timeSample = sample((item) => item.metrics.time).filter((value) => value > 0);
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
        }
'''
    text = replace_once(text, old, new, "Robust average-time anomaly")
    APP.write_text(text, encoding="utf-8")


def patch_readme() -> None:
    text = README.read_text(encoding="utf-8")
    text = text.replace('## Что умеет версия 0.2', '## Что умеет версия 0.3')
    text = text.replace(
        '- экспортирует дневные результаты в CSV.\n',
        '- экспортирует дневные результаты в CSV;\n- формирует компактный PDF по всем, одной или нескольким выбранным площадкам.\n',
    )
    text = text.replace(
        'Файлы обрабатываются JavaScript-кодом непосредственно в браузере. Исходные IP-адреса и строки выгрузок не отправляются в репозиторий или на внешний сервер. Для чтения CSV/XLSX используется клиентская библиотека SheetJS с CDN.',
        'Файлы обрабатываются JavaScript-кодом непосредственно в браузере. Исходные IP-адреса и строки выгрузок не отправляются в репозиторий или на внешний сервер. Для чтения CSV/XLSX используется SheetJS, а для локального формирования PDF — html2canvas и jsPDF с CDN.',
    )
    text = text.replace(
        '- резкое уменьшение времени на сайте;\n',
        '- сильное уменьшение среднего времени на сайте относительно медианы остальных дней той же площадки; сигнал учитывается только при достаточной истории, объёме и большом robust-отклонении;\n',
    )
    README.write_text(text, encoding="utf-8")


def patch_validate() -> None:
    text = VALIDATE.read_text(encoding="utf-8")
    text = replace_once(
        text,
        '      - name: Check JavaScript syntax\n        run: node --check assets/app-v2.js\n',
        '      - name: Check JavaScript syntax\n        run: |\n          node --check assets/app-v2.js\n          node --check assets/pdf-export.js\n',
        "JS validation",
    )
    text = replace_once(
        text,
        '          test -f assets/app-v2.js\n',
        '          test -f assets/app-v2.js\n          test -f assets/pdf-export.js\n          test -f assets/pdf.css\n',
        "PDF files validation",
    )
    text = replace_once(
        text,
        '          grep -q "assets/app-v2.js" index.html\n',
        '          grep -q "assets/app-v2.js" index.html\n          grep -q "assets/pdf-export.js" index.html\n          grep -q "assets/pdf.css" index.html\n          grep -q "pdf-export-button" index.html\n          grep -q "html2canvas" index.html\n          grep -q "jspdf" index.html\n          grep -q "enoughTimeHistory" assets/app-v2.js\n          grep -q "timeZ >= 3.5" assets/app-v2.js\n          ! grep -q "очень короткое время за период" assets/app-v2.js\n',
        "PDF and time logic validation",
    )
    VALIDATE.write_text(text, encoding="utf-8")


def main() -> None:
    patch_index()
    patch_app()
    patch_readme()
    patch_validate()
    print("Time anomaly and PDF export update applied")


if __name__ == "__main__":
    main()
