(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const ui = {
    results: $('#results'),
    sourceList: $('#source-list'),
    scopeAll: $('#pdf-scope-all'),
    scopeSelected: $('#pdf-scope-selected'),
    selector: $('#pdf-source-selector'),
    button: $('#pdf-export-button'),
    status: $('#pdf-export-status')
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function slug(value) {
    return String(value || 'report')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'report';
  }

  function sourceCards() {
    return $$('.source-card');
  }

  function selectedCards() {
    const cards = sourceCards();
    if (ui.scopeAll?.checked) return cards;
    const ids = new Set($$('#pdf-source-selector input[type="checkbox"]:checked').map((input) => input.value));
    return cards.filter((card) => ids.has(card.id));
  }

  function setStatus(message, kind = '') {
    if (!ui.status) return;
    ui.status.textContent = message;
    ui.status.dataset.kind = kind;
  }

  function updateButtonState() {
    if (!ui.button) return;
    const hasResults = ui.results && !ui.results.hidden && sourceCards().length > 0;
    const hasSelection = ui.scopeAll?.checked || $$('#pdf-source-selector input[type="checkbox"]:checked').length > 0;
    ui.button.disabled = !(hasResults && hasSelection);
  }

  function toggleSelector() {
    if (!ui.selector) return;
    ui.selector.hidden = !ui.scopeSelected?.checked;
    updateButtonState();
  }

  function populateSourceSelector() {
    if (!ui.selector) return;
    const cards = sourceCards();
    const previous = new Set($$('#pdf-source-selector input[type="checkbox"]:checked').map((input) => input.value));
    ui.selector.innerHTML = cards.map((card) => {
      const name = card.querySelector('summary h3')?.textContent?.trim() || card.id;
      const checked = previous.size ? previous.has(card.id) : true;
      return `<label class="pdf-source-option"><input type="checkbox" value="${escapeHtml(card.id)}" ${checked ? 'checked' : ''}><span>${escapeHtml(name)}</span></label>`;
    }).join('');
    $$('#pdf-source-selector input').forEach((input) => input.addEventListener('change', updateButtonState));
    updateButtonState();
  }

  function text(element, fallback = '—') {
    return element?.textContent?.trim() || fallback;
  }

  function metricItems(card) {
    return [...card.querySelectorAll('.metric-strip > div')].map((item) => ({
      value: text(item.querySelector('strong')),
      label: text(item.querySelector('span'))
    }));
  }

  function anomalyRows(card) {
    return [...card.querySelectorAll('.daily-detail tbody tr')].map((row) => {
      const cells = [...row.querySelectorAll('td')].map((cell) => text(cell));
      return cells.length >= 6 ? cells : null;
    }).filter(Boolean);
  }

  function reportSource(card) {
    const name = text(card.querySelector('summary h3'));
    const risk = text(card.querySelector('.source-score span'));
    const score = text(card.querySelector('.source-score strong'));
    const metrics = metricItems(card);
    const reasons = [...card.querySelectorAll('.flag-list li')].map((item) => text(item)).slice(0, 5);
    const recommendation = text(card.querySelector('.detail--action p'));
    const anomalies = anomalyRows(card);
    const visibleAnomalies = anomalies.slice(0, 6);
    const remaining = Math.max(0, anomalies.length - visibleAnomalies.length);

    return `<section class="pdf-report__source">
      <div class="pdf-report__source-head">
        <div><span>UTM Source</span><h2>${escapeHtml(name)}</h2></div>
        <div class="pdf-report__score"><span>${escapeHtml(risk)}</span><strong>${escapeHtml(score)}</strong></div>
      </div>
      <div class="pdf-report__metrics">${metrics.map((metric) => `<div><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>`).join('')}</div>
      <div class="pdf-report__columns">
        <div><h3>Ключевые причины</h3><ul>${(reasons.length ? reasons : ['Выраженных сочетаний признаков не найдено']).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></div>
        <div><h3>Рекомендация</h3><p>${escapeHtml(recommendation)}</p></div>
      </div>
      <h3>Аномальные даты</h3>
      <table><thead><tr><th>Дата</th><th>Визиты</th><th>Отказы</th><th>Время</th><th>Score</th><th>Причины</th></tr></thead>
      <tbody>${visibleAnomalies.length ? visibleAnomalies.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('') : '<tr><td colspan="6">Аномальных дат с достаточной выборкой не найдено.</td></tr>'}</tbody></table>
      ${remaining ? `<p class="pdf-report__more">Ещё ${remaining} аномальных дат доступны в интерактивном отчёте.</p>` : ''}
    </section>`;
  }

  function buildReport(cards) {
    const root = document.createElement('div');
    root.className = 'pdf-report-canvas';
    const summary = text($('#summary-text'));
    const conclusion = text($('#conclusion'));
    const scopeLabel = ui.scopeAll?.checked ? 'Все площадки' : cards.map((card) => text(card.querySelector('summary h3'))).join(', ');
    root.innerHTML = `<header class="pdf-report__header">
      <div><span>Level Group · Traffic Quality</span><h1>Traffic Fraud Lab</h1><p>Краткий отчёт по качеству трафика</p></div>
      <div class="pdf-report__meta"><strong>${escapeHtml(new Date().toLocaleDateString('ru-RU'))}</strong><span>${escapeHtml(scopeLabel)}</span></div>
    </header>
    <section class="pdf-report__summary"><strong>${escapeHtml(summary)}</strong><p>${escapeHtml(conclusion)}</p></section>
    ${cards.map(reportSource).join('')}
    <footer class="pdf-report__footer">Дневные отклонения используются для приоритизации проверки и не доказывают фрод каждого визита.</footer>`;
    document.body.appendChild(root);
    return root;
  }

  async function canvasToPdf(canvas, filename) {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 10;
    const imageWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;
    const slicePixelHeight = Math.max(1, Math.floor(canvas.width * printableHeight / imageWidth));

    let offsetY = 0;
    let page = 0;
    while (offsetY < canvas.height) {
      const sliceHeight = Math.min(slicePixelHeight, canvas.height - offsetY);
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;
      const context = pageCanvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
      if (page > 0) pdf.addPage();
      const imageHeight = sliceHeight * imageWidth / canvas.width;
      pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, imageWidth, imageHeight, undefined, 'FAST');
      offsetY += sliceHeight;
      page += 1;
    }
    pdf.save(filename);
  }

  async function exportPdf() {
    const cards = selectedCards();
    if (!cards.length) {
      setStatus('Выберите хотя бы одну площадку.', 'error');
      return;
    }
    if (!window.html2canvas || !window.jspdf?.jsPDF) {
      setStatus('Не загрузились библиотеки PDF. Проверьте интернет и обновите страницу.', 'error');
      return;
    }

    ui.button.disabled = true;
    setStatus('Формирую PDF…', 'loading');
    let report;
    try {
      report = buildReport(cards);
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = await window.html2canvas(report, {
        backgroundColor: '#ffffff',
        scale: 1.45,
        logging: false,
        useCORS: true,
        windowWidth: 1120
      });
      const scopeName = ui.scopeAll?.checked ? 'all' : cards.map((card) => text(card.querySelector('summary h3'))).join('-');
      const filename = `traffic-fraud-report-${slug(scopeName)}-${new Date().toISOString().slice(0, 10)}.pdf`;
      await canvasToPdf(canvas, filename);
      setStatus(`PDF готов: ${cards.length} площадок.`, 'success');
    } catch (error) {
      console.error(error);
      setStatus(`Не удалось сформировать PDF: ${error.message}`, 'error');
    } finally {
      report?.remove();
      updateButtonState();
    }
  }

  ui.scopeAll?.addEventListener('change', toggleSelector);
  ui.scopeSelected?.addEventListener('change', toggleSelector);
  ui.button?.addEventListener('click', exportPdf);

  if (ui.sourceList) {
    new MutationObserver(populateSourceSelector).observe(ui.sourceList, { childList: true });
  }
  if (ui.results) {
    new MutationObserver(updateButtonState).observe(ui.results, { attributes: true, attributeFilter: ['hidden'] });
  }

  populateSourceSelector();
  toggleSelector();
})();
