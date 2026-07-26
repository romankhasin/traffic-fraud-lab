from pathlib import Path

js_path = Path("assets/api-mode.js")
css_path = Path("assets/api.css")

js = js_path.read_text(encoding="utf-8")
replacements = {
    '<p><b>За выбранный период</b></p>': '<p class="metric-section-heading">За выбранный период</p>',
    '<p><b>Пиковые дневные значения</b></p>': '<p class="metric-section-heading">Пиковые дневные значения</p>',
}
for old, new in replacements.items():
    if old not in js:
        raise RuntimeError(f"Expected heading not found: {old}")
    js = js.replace(old, new)
js_path.write_text(js, encoding="utf-8")

css = css_path.read_text(encoding="utf-8")
marker = "/* Metric section heading emphasis */"
if marker not in css:
    css += """

/* Metric section heading emphasis */
.metric-section-heading {
  margin: 12px 0 8px;
  color: var(--bronze);
  font-weight: 800;
  line-height: 1.35;
}
"""
css_path.write_text(css, encoding="utf-8")
