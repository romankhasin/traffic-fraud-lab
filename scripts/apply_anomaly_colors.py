from pathlib import Path

JS_PATH = Path("assets/api-mode.js")
CSS_PATH = Path("assets/api.css")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one {label} block, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    js = JS_PATH.read_text(encoding="utf-8")
    css = CSS_PATH.read_text(encoding="utf-8")

    js = js.replace(
        '<p><b>За выбранный период</b></p>',
        '<p class="metric-section-heading metric-section-heading--period"><b>За выбранный период</b></p>',
    )
    js = js.replace(
        '<p><b>Пиковые дневные значения</b></p>',
        '<p class="metric-section-heading metric-section-heading--peak"><b>Пиковые дневные значения</b></p>',
    )

    js = replace_once(
        js,
        "  const renderSignal = (item) => `<span class=\"warning-signal\"><b>${escapeHtml(item.label)}:</b> ${item.formatter(item.current)} vs ${item.formatter(item.baseline)} <em>${escapeHtml(item.deltaText)}</em></span>`;",
        "  const renderSignal = (item) => `<span class=\"warning-signal warning-signal--anomaly\"><b>${escapeHtml(item.label)}:</b> <strong class=\"anomaly-value\">${item.formatter(item.current)}</strong> vs ${item.formatter(item.baseline)} <em>${escapeHtml(item.deltaText)}</em></span>`;",
        "warning signal renderer",
    )

    old_behavior = '''  const segmentBehaviorHtml = (segment) => {
    if (!segment || !segment.visits) return '—';
    if (!segment.restVisits) return '<small>Нет сопоставимого остатка трафика</small>';
    return `
      <div class="tech-behavior">
        <span><b>Отказы:</b> ${formatPct(segment.bounce)} vs ${formatPct(segment.restBounce)} <em>${signedPp(segment.bounce, segment.restBounce)}</em></span>
        <span><b>Время:</b> ${formatSeconds(segment.time)} vs ${formatSeconds(segment.restTime)} <em>${signedNumber(segment.time, segment.restTime, formatSeconds)}</em></span>
        <span><b>Глубина:</b> ${formatDecimal(segment.depth)} vs ${formatDecimal(segment.restDepth)} <em>${signedNumber(segment.depth, segment.restDepth, formatDecimal)}</em></span>
        <span><b>Кач. конверсия:</b> ${formatPct(segment.quality)} vs ${formatPct(segment.restQuality)} <em>${signedPp(segment.quality, segment.restQuality)}</em></span>
      </div>`;
  };'''
    new_behavior = '''  const anomalyMetric = (value, formatter, active) => active
    ? `<strong class="anomaly-value">${formatter(value)}</strong>`
    : formatter(value);

  const segmentBehaviorHtml = (segment) => {
    if (!segment || !segment.visits) return '—';
    if (!segment.restVisits) return '<small>Нет сопоставимого остатка трафика</small>';
    const bounceAnomaly = segment.bounce >= .55 && segment.bounce - segment.restBounce >= .15;
    const timeAnomaly = (segment.time <= 15 && segment.restTime >= 45)
      || (segment.time >= Math.max(180, segment.restTime * 2.5));
    const depthAnomaly = segment.depth <= .6 * segment.restDepth
      || segment.depth >= Math.max(4, segment.restDepth * 2.5);
    const qualityAnomaly = segment.quality >= .02
      && segment.quality >= Math.max(segment.restQuality * 5, segment.restQuality + .02);
    return `
      <div class="tech-behavior">
        <span><b>Отказы:</b> ${anomalyMetric(segment.bounce, formatPct, bounceAnomaly)} vs ${formatPct(segment.restBounce)} <em class="${bounceAnomaly ? 'anomaly-delta' : ''}">${signedPp(segment.bounce, segment.restBounce)}</em></span>
        <span><b>Время:</b> ${anomalyMetric(segment.time, formatSeconds, timeAnomaly)} vs ${formatSeconds(segment.restTime)} <em class="${timeAnomaly ? 'anomaly-delta' : ''}">${signedNumber(segment.time, segment.restTime, formatSeconds)}</em></span>
        <span><b>Глубина:</b> ${anomalyMetric(segment.depth, formatDecimal, depthAnomaly)} vs ${formatDecimal(segment.restDepth)} <em class="${depthAnomaly ? 'anomaly-delta' : ''}">${signedNumber(segment.depth, segment.restDepth, formatDecimal)}</em></span>
        <span><b>Кач. конверсия:</b> ${anomalyMetric(segment.quality, formatPct, qualityAnomaly)} vs ${formatPct(segment.restQuality)} <em class="${qualityAnomaly ? 'anomaly-delta' : ''}">${signedPp(segment.quality, segment.restQuality)}</em></span>
      </div>`;
  };'''
    js = replace_once(js, old_behavior, new_behavior, "technical behavior renderer")

    old_period = '''  const segmentPeriodHtml = (key, segment, period) => {
    if (!segment) return '—';
    const denominatorNote = key === 'unknownMobileModel'
      ? `<small>из ${formatInt(period.mobileTabletVisits)} mobile/tablet-визитов</small>`
      : `<small>из ${formatInt(segment.denominatorVisits || period.visits)} визитов</small>`;
    return `${formatInt(segment.visits)} · ${formatPct(segment.share)}<br>${denominatorNote}`;
  };'''
    new_period = '''  const segmentPeriodHtml = (key, segment, period) => {
    if (!segment) return '—';
    const denominatorNote = key === 'unknownMobileModel'
      ? `<small>из ${formatInt(period.mobileTabletVisits)} mobile/tablet-визитов</small>`
      : `<small>из ${formatInt(segment.denominatorVisits || period.visits)} визитов</small>`;
    const suspiciousShare = key !== 'cookieOn' && Number(segment.share) >= .15;
    const shareHtml = suspiciousShare
      ? `<strong class="anomaly-value">${formatPct(segment.share)}</strong>`
      : formatPct(segment.share);
    return `${formatInt(segment.visits)} · ${shareHtml}<br>${denominatorNote}`;
  };'''
    js = replace_once(js, old_period, new_period, "technical segment period renderer")

    old_daily = '''  const segmentDailyHtml = (segment) => {
    if (!segment) return '—';
    const peak = segment.dailyMaxDate
      ? `${formatPct(segment.dailyMaxShare)} — ${formatDate(segment.dailyMaxDate)}<br><small>${formatInt(segment.dailyMaxVisits)} из ${formatInt(segment.dailyMaxSourceVisits)}</small>`
      : 'не было';
    return `<b>Обычно:</b> ${formatPct(segment.dailyTypicalShare)}<br><b>Пик:</b> ${peak}`;
  };'''
    new_daily = '''  const segmentDailyHtml = (segment) => {
    if (!segment) return '—';
    const typical = Number(segment.dailyTypicalShare) || 0;
    const maximum = Number(segment.dailyMaxShare) || 0;
    const peakAnomaly = maximum >= .20 && maximum >= Math.max(typical * 1.8, typical + .08);
    const peakShare = peakAnomaly
      ? `<strong class="anomaly-value">${formatPct(maximum)}</strong>`
      : formatPct(maximum);
    const peak = segment.dailyMaxDate
      ? `${peakShare} — ${formatDate(segment.dailyMaxDate)}<br><small>${formatInt(segment.dailyMaxVisits)} из ${formatInt(segment.dailyMaxSourceVisits)}</small>`
      : 'не было';
    return `<b>Обычно:</b> ${formatPct(typical)}<br><b>Пик:</b> ${peak}`;
  };'''
    js = replace_once(js, old_daily, new_daily, "technical daily renderer")

    css_marker = "/* Bronze section headings and burgundy anomalies */"
    if css_marker not in css:
        css += '''

/* Bronze section headings and burgundy anomalies */
.metric-section-heading {
  margin: 14px 0 8px;
  color: #68452d;
  font-size: 11px;
  letter-spacing: 0.015em;
}

.metric-section-heading b {
  color: inherit;
}

.metric-section-heading--peak {
  padding-top: 10px;
  border-top: 1px solid rgba(104, 69, 45, 0.18);
}

.anomaly-value,
.warning-signal--anomaly .anomaly-value,
.tech-behavior .anomaly-delta {
  color: #7a1f2b;
  font-weight: 800;
}

.warning-signal--anomaly {
  padding-left: 7px;
  border-left: 2px solid rgba(122, 31, 43, 0.34);
}

.warning-signal--anomaly em {
  color: #7a1f2b;
}
'''

    JS_PATH.write_text(js, encoding="utf-8")
    CSS_PATH.write_text(css, encoding="utf-8")


if __name__ == "__main__":
    main()
