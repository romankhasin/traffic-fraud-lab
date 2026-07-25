#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
APP = ROOT / "assets" / "app-v2.js"
README = ROOT / "README.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def patch_index() -> None:
    text = INDEX.read_text(encoding="utf-8")
    text = replace_once(text, '  <link rel="stylesheet" href="assets/pdf.css">\n', '', 'PDF stylesheet')
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
    text = replace_once(text, export_panel, '', 'PDF export panel')
    text = replace_once(text, '  <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>\n', '', 'html2canvas script')
    text = replace_once(text, '  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>\n', '', 'jsPDF script')
    text = replace_once(text, '  <script src="assets/pdf-export.js"></script>\n', '', 'PDF export script')
    INDEX.write_text(text, encoding="utf-8")


def patch_app() -> None:
    text = APP.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "    if (m.bounce <= .01 && data.visits >= 200) { score += 16; reasons.push('аномально низкий отказ за период'); }\n",
        "",
        "period low bounce",
    )

    old_bounce = '''        const bounceDiff = day.metrics.bounce - baseline.bounce;
        const bounceZ = robustZ(day.metrics.bounce, sample((item) => item.metrics.bounce), .02);
        if (bounceDiff >= .2 && bounceZ >= 2.5) { score += 22; reasons.push(`отказы выше обычного на ${formatPct(bounceDiff)}`); }
        else if (bounceDiff >= .12 && bounceZ >= 2.5) { score += 15; reasons.push(`скачок отказов на ${formatPct(bounceDiff)}`); }
        if (day.metrics.bounce <= .01 && baseline.bounce >= .08 && day.visits >= 150) { score += 14; reasons.push('аномально низкий отказ в этот день'); }
'''
    new_bounce = '''        const bounceSample = sample((item) => item.metrics.bounce);
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
'''
    text = replace_once(text, old_bounce, new_bounce, 'two-sided bounce logic')

    old_time = '''        const timeSample = sample((item) => item.metrics.time).filter((value) => value > 0);
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
    new_time = '''        const timeSample = sample((item) => item.metrics.time).filter((value) => value > 0);
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
'''
    text = replace_once(text, old_time, new_time, 'two-sided time logic')
    APP.write_text(text, encoding="utf-8")


def patch_readme() -> None:
    text = README.read_text(encoding="utf-8")
    text = replace_once(text, '- экспортирует дневные результаты в CSV;\n- формирует компактный PDF по всем, одной или нескольким выбранным площадкам.\n', '- экспортирует дневные результаты в CSV.\n', 'PDF capability')
    text = replace_once(text, 'Для чтения CSV/XLSX используется SheetJS, а для локального формирования PDF — html2canvas и jsPDF с CDN.', 'Для чтения CSV/XLSX используется клиентская библиотека SheetJS с CDN.', 'privacy libraries')
    text = replace_once(text, '- скачок или аномальное падение отказов;\n- сильное уменьшение среднего времени на сайте относительно медианы остальных дней той же площадки; сигнал учитывается только при достаточной истории, объёме и большом robust-отклонении;\n', '- резкое повышение или подозрительно низкий уровень отказов относительно медианы остальных дней площадки;\n- сильное уменьшение или неправдоподобно высокое среднее время на сайте относительно медианы остальных дней площадки;\n', 'two-sided behavior docs')
    README.write_text(text, encoding="utf-8")


def main() -> None:
    patch_index()
    patch_app()
    patch_readme()
    print('Two-sided behavior logic applied and PDF export removed')


if __name__ == '__main__':
    main()
