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
    """    const fields = kind === 'ip'\n      ? ['date','source','ip','clientId','visits','users','bounce','time','newShare','qualityConversion','primaryConversion']\n      : ['date','source','clientId','visits','users','bounce','time','newShare','browser','os','device','resolution','qualityConversion','primaryConversion'];""",
    """    const fields = kind === 'ip'\n      ? ['date','source','ip','visits','users','bounce','time','newShare','qualityConversion','primaryConversion']\n      : ['date','source','clientId','visits','users','bounce','time','newShare','browser','os','device','resolution','qualityConversion','primaryConversion'];""",
    "mapping fields",
)

app = replace_once(
    app,
    """      coerceClientIdsToText(rows, map);""",
    """      if (kind === 'tech') coerceClientIdsToText(rows, map);""",
    "technical-only ClientID coercion",
)

app = replace_once(
    app,
    """      showValidation('Оба файла распознаны, включая дату. Каждый день будет сравниваться с остальными днями того же источника.', false);""",
    """      const clientIdNote = state.techMap?.clientId\n        ? ' ClientID найден в технической выгрузке и будет учитываться только из неё.'\n        : ' ClientID в технической выгрузке не найден; анализ продолжится без ClientID-сигналов.';\n      showValidation(`Оба файла распознаны, включая дату. Каждый день будет сравниваться с остальными днями того же источника.${clientIdNote}`, false);""",
    "ready validation",
)

app = replace_once(
    app,
    """  function addTechRow(target, row, map, includeClientId = false) {\n    const visits = addMetrics(target.tech, row, map);\n    if (!visits) return;\n    if (includeClientId) addClientId(target, row, map, visits);""",
    """  function addTechRow(target, row, map) {\n    const visits = addMetrics(target.tech, row, map);\n    if (!visits) return;\n    addClientId(target, row, map, visits);""",
    "technical aggregation",
)

app = replace_once(
    app,
    """  function addIpRow(target, row, map, includeClientId = false) {\n    const visits = addMetrics(target.ip, row, map);\n    if (!visits) return;\n    if (includeClientId) addClientId(target, row, map, visits);""",
    """  function addIpRow(target, row, map) {\n    const visits = addMetrics(target.ip, row, map);\n    if (!visits) return;""",
    "IP aggregation",
)

app = replace_once(
    app,
    """    let skippedDates = 0;\n    const clientIdSource = state.ipMap?.clientId ? 'ip' : state.techMap?.clientId ? 'tech' : null;\n""",
    """    let skippedDates = 0;\n""",
    "ClientID source selection",
)

app = replace_once(
    app,
    """      addTechRow(source, row, state.techMap, clientIdSource === 'tech');\n      addTechRow(getDay(source, date), row, state.techMap, clientIdSource === 'tech');""",
    """      addTechRow(source, row, state.techMap);\n      addTechRow(getDay(source, date), row, state.techMap);""",
    "technical calls",
)

app = replace_once(
    app,
    """      addIpRow(source, row, state.ipMap, clientIdSource === 'ip');\n      addIpRow(getDay(source, date), row, state.ipMap, clientIdSource === 'ip');""",
    """      addIpRow(source, row, state.ipMap);\n      addIpRow(getDay(source, date), row, state.ipMap);""",
    "IP calls",
)

app = replace_once(
    app,
    """    const clientIdCoverage = visits ? Math.min(1, clientIdVisits / visits) : 0;""",
    """    const clientIdCoverage = tech.visits ? Math.min(1, clientIdVisits / tech.visits) : 0;""",
    "ClientID coverage denominator",
)

APP.write_text(app, encoding="utf-8")

index = INDEX.read_text(encoding="utf-8")
index = replace_once(
    index,
    """          <h3>Дата + источник + IP + ClientID</h3>\n          <p>Дата визита, UTM Source, IP-адрес, ClientID, визиты, отказы, время и при наличии конверсии. ClientID также можно добавить в техническую выгрузку; идентификатор читается как текст.</p>""",
    """          <h3>Дата + источник + IP</h3>\n          <p>Дата визита, UTM Source, IP-адрес, визиты, отказы, время и при наличии конверсии. ClientID в этой выгрузке не требуется.</p>""",
    "IP upload copy",
)
index = replace_once(
    index,
    """          <h3>Дата + источник + техника</h3>\n          <p>Дата визита, браузер, ОС, устройство, разрешение, визиты, отказы и время.</p>""",
    """          <h3>Дата + источник + техника + ClientID</h3>\n          <p>Дата визита, ClientID, браузер, ОС, устройство, разрешение, визиты, отказы и время. ClientID читается как текст и учитывается только из этого файла.</p>""",
    "technical upload copy",
)
INDEX.write_text(index, encoding="utf-8")

readme = README.read_text(encoding="utf-8")
readme = replace_once(
    readme,
    """- Доля новых посетителей;\n- конверсии;\n- ClientID / Client ID / ym:s:clientID.\n\nClientID можно передать в IP- или технической выгрузке. Если поле есть в обеих, для расчёта используется IP-выгрузка, чтобы не удваивать визиты. При чтении файла значение принудительно сохраняется строкой. При этом в исходном Excel длинные ClientID всё равно желательно хранить как текст: если Excel уже округлил число, браузер не сможет восстановить потерянные цифры.""",
    """- Доля новых посетителей;\n- конверсии.\n\nClientID в IP-выгрузке не требуется и не участвует в расчёте, даже если такая колонка случайно присутствует.""",
    "IP README fields",
)
readme = replace_once(
    readme,
    """- конверсии;\n- ClientID / Client ID / ym:s:clientID.\n\n## Требования к периоду""",
    """- конверсии;\n- ClientID / Client ID / ym:s:clientID.\n\nClientID берётся только из технической выгрузки. Покрытие ClientID рассчитывается как доля технических визитов с корректным идентификатором. Значение сохраняется строкой; если Excel уже округлил длинное число до загрузки, потерянные цифры восстановить невозможно.\n\n## Требования к периоду""",
    "technical README note",
)
README.write_text(readme, encoding="utf-8")
