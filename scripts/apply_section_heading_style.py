from pathlib import Path

js_path = Path("assets/api-mode.js")
css_path = Path("assets/api.css")

js = js_path.read_text(encoding="utf-8")
required = (
    'metric-section-heading--period',
    'metric-section-heading--peak',
)
for marker in required:
    if marker not in js:
        raise RuntimeError(f"Expected heading class not found: {marker}")

css = css_path.read_text(encoding="utf-8")
marker = "/* Metric section heading emphasis */"
if marker not in css:
    css += """

/* Metric section heading emphasis */
.metric-section-heading {
  margin: 14px 0 8px;
  color: var(--bronze);
  font-weight: 800;
  line-height: 1.35;
}

.metric-section-heading b {
  color: inherit;
  font-weight: 800;
}
"""
css_path.write_text(css, encoding="utf-8")
