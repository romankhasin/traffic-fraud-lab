#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app-v2.js"
INDEX = ROOT / "index.html"
README = ROOT / "README.md"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def patch_app() -> None:
    text = APP.read_text(encoding="utf-8")

    text = replace_once(
        text,
        "  };\n\n  const LABELS = {",
        "  };\n\n  const MIN_SOURCE_VISITS = 20;\n\n  const LABELS = {",
        "minimum source visits constant",
    )

    text = replace_once(
        text,
        "    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });",
        "    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true });",
        "raw text workbook parsing",
    )

    marker = """  async function readRows(file) {
"""
    helper = """  function coerceClientIdsToText(rows, map) {
    if (!map.clientId) return;
    for (const row of rows) {
      const value = row[map.clientId];
      row[map.clientId] = value == null ? '' : String(value).trim();
    }
  }

  async function readRows(file) {
"""
    text = replace_once(text, marker, helper, "ClientID text coercion helper")

    text = replace_once(
        text,
        "      const map = detectMap(Object.keys(rows[0] || {}));\n      const missing = REQUIRED[kind].filter((field) => !map[field]);",
        "      const map = detectMap(Object.keys(rows[0] || {}));\n      coerceClientIdsToText(rows, map);\n      const missing = REQUIRED[kind].filter((field) => !map[field]);",
        "ClientID text coercion call",
    )

    old_analyze = """      const sources = buildAggregates();
      if (!sources.length) throw new Error('После очистки итоговых строк и дат не осталось данных для анализа.');
      const base = buildBase(sources);
      state.results = sources.map((source) => combineSource(source, base)).sort((a, b) => b.score - a.score || b.visits - a.visits);
"""
    new_analyze = """      const sourceVolumes = buildAggregates().map((source) => ({ source, visits: snapshot(source).visits }));
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
"""
    text = replace_once(text, old_analyze, new_analyze, "small-source filtering")

    APP.write_text(text, encoding="utf-8")


def patch_index() -> None:
    text = INDEX.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "Дата визита, UTM Source, IP-адрес, ClientID, визиты, отказы, время и при наличии конверсии. ClientID также можно добавить в техническую выгрузку.",
        "Дата визита, UTM Source, IP-адрес, ClientID, визиты, отказы, время и при наличии конверсии. ClientID также можно добавить в техническую выгрузку; идентификатор читается как текст.",
        "upload ClientID text note",
    )
    text = replace_once(
        text,
        "Для сравнения желательно не менее 5 дней по источнику.",
        "Для сравнения желательно не менее 5 дней по источнику. Площадки с менее чем 20 визитами за период исключаются.",
        "minimum source visits UI note",
    )
    text = replace_once(text, "MVP 0.4", "MVP 0.5", "footer version")
    INDEX.write_text(text, encoding="utf-8")


def patch_readme() -> None:
    text = README.read_text(encoding="utf-8")
    text = replace_once(text, "## Что умеет версия 0.4", "## Что умеет версия 0.5", "README version")
    text = replace_once(
        text,
        "- автоматически распознаёт русские и английские названия столбцов;",
        "- автоматически распознаёт русские и английские названия столбцов;\n- читает ClientID как текст, не преобразуя длинный идентификатор в JavaScript Number;",
        "README ClientID text bullet",
    )
    text = replace_once(
        text,
        "- дата должна быть представлена отдельной группировкой, а не только общим периодом отчёта.",
        "- дата должна быть представлена отдельной группировкой, а не только общим периодом отчёта;\n- площадки с суммарным объёмом менее 20 визитов за загруженный период исключаются до расчёта общей базы, дневных аномалий и рейтинга.",
        "README small source rule",
    )
    text = replace_once(
        text,
        "ClientID можно передать в IP- или технической выгрузке. Если поле есть в обеих, для расчёта используется IP-выгрузка, чтобы не удваивать визиты. Длинные ClientID желательно хранить в Excel как текст.",
        "ClientID можно передать в IP- или технической выгрузке. Если поле есть в обеих, для расчёта используется IP-выгрузка, чтобы не удваивать визиты. При чтении файла значение принудительно сохраняется строкой. При этом в исходном Excel длинные ClientID всё равно желательно хранить как текст: если Excel уже округлил число, браузер не сможет восстановить потерянные цифры.",
        "README ClientID precision note",
    )
    README.write_text(text, encoding="utf-8")


def main() -> None:
    patch_app()
    patch_index()
    patch_readme()
    print("ClientID text parsing and minimum source filter applied")


if __name__ == "__main__":
    main()
