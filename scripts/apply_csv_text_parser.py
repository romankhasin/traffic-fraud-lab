#!/usr/bin/env python3
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "assets" / "app-v2.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


text = APP.read_text(encoding="utf-8")
text = replace_once(
    text,
    """  async function readRows(file) {
    if (!window.XLSX) throw new Error('Не загрузилась библиотека чтения Excel. Проверьте интернет и обновите страницу.');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true });
    if (!workbook.SheetNames.length) throw new Error('В файле не найдено листов.');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
    if (!rows.length) throw new Error('Файл пустой или таблица не распознана.');
    return rows;
  }
""",
    r"""  function countCsvDelimiter(record, delimiter) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < record.length; index += 1) {
      const char = record[index];
      if (char === '"') {
        if (quoted && record[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && char === delimiter) count += 1;
    }
    return count;
  }

  function detectCsvDelimiter(text) {
    const header = text.split(/\r?\n/, 1)[0] || '';
    return [';', ',', '\t']
      .map((delimiter) => ({ delimiter, count: countCsvDelimiter(header, delimiter) }))
      .sort((a, b) => b.count - a.count)[0]?.delimiter || ';';
  }

  function parseCsvRows(text) {
    let source = String(text || '').replace(/^\uFEFF/, '');
    const separator = source.match(/^sep=(.)\r?\n/i);
    const delimiter = separator ? separator[1] : detectCsvDelimiter(source);
    if (separator) source = source.slice(separator[0].length);

    const table = [];
    let row = [];
    let value = '';
    let quoted = false;

    const pushValue = () => {
      row.push(value);
      value = '';
    };
    const pushRow = () => {
      pushValue();
      if (row.some((cell) => String(cell).trim() !== '')) table.push(row);
      row = [];
    };

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (quoted) {
        if (char === '"' && source[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (char === '"') quoted = false;
        else value += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) pushValue();
      else if (char === '\n') pushRow();
      else if (char !== '\r') value += char;
    }
    if (value || row.length) pushRow();

    const headers = (table.shift() || []).map((header, index) => String(header).trim() || `Колонка ${index + 1}`);
    return table.map((cells) => Object.fromEntries(headers.map((header, index) => [header, String(cells[index] ?? '')])));
  }

  async function readRows(file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    let rows;
    if (extension === 'csv') {
      rows = parseCsvRows(await file.text());
    } else {
      if (!window.XLSX) throw new Error('Не загрузилась библиотека чтения Excel. Проверьте интернет и обновите страницу.');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      if (!workbook.SheetNames.length) throw new Error('В файле не найдено листов.');
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
    }
    if (!rows.length) throw new Error('Файл пустой или таблица не распознана.');
    return rows;
  }
""",
    "CSV reader",
)
APP.write_text(text, encoding="utf-8")
print("Text-safe CSV parser applied")
