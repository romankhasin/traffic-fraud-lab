from pathlib import Path

path = Path('assets/app-v2.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise RuntimeError(f'Pattern not found: {old[:100]}')
    text = text.replace(old, new, 1)

# Period score: preserve every awarded component.
period_start = text.index('  function scorePeriodSource(source, base) {')
period_end = text.index('\n  function scoreDailyDays(source) {', period_start)
period = text[period_start:period_end]
period = period.replace('    const reasons = [];\n    const families = new Set();', '    const reasons = [];\n    const breakdown = [];\n    const families = new Set();', 1)
period = period.replace('      if (reason) reasons.push(reason);', '      if (reason) { reasons.push(reason); breakdown.push({ points, family, reason, scope: \'period\' }); }', 1)
period = period.replace("      reasons.push(...clientReasons);", "      reasons.push(...clientReasons);\n      breakdown.push({ points: Math.min(28, clientIdScore), family: 'identity', reason: clientReasons.join(' · '), scope: 'period' });", 1)
period = period.replace('      reasons,\n      families:', '      reasons,\n      breakdown,\n      families:', 1)
text = text[:period_start] + period + text[period_end:]

# Daily score: preserve every awarded component.
daily_start = text.index('  function scoreDailyDays(source) {')
daily_end = text.index('\n  function combineSource(source, base) {', daily_start)
daily = text[daily_start:daily_end]
daily = daily.replace('      const reasons = [];\n      const families = new Set();', '      const reasons = [];\n      const breakdown = [];\n      const families = new Set();', 1)
daily = daily.replace('        if (reason) reasons.push(reason);', '        if (reason) { reasons.push(reason); breakdown.push({ points, family, reason, scope: \'day\', date: day.date }); }', 1)
daily = daily.replace("          reasons.push(...clientReasons);", "          reasons.push(...clientReasons);\n          breakdown.push({ points: Math.min(28, clientIdScore), family: 'identity', reason: clientReasons.join(' · '), scope: 'day', date: day.date });", 1)
daily = daily.replace('        reasons: [...new Set(reasons)],\n        families:', '        reasons: [...new Set(reasons)],\n        breakdown,\n        families:', 1)
text = text[:daily_start] + daily + text[daily_end:]

# Source score: explain which component determined the final result and all caps/bonuses.
combine_start = text.index('  function combineSource(source, base) {')
combine_end = text.index('\n  function buildMonthly(dailyResults) {', combine_start)
combine = text[combine_start:combine_end]
combine = combine.replace(
    "    let score = Math.max(period.score, maxDaily);\n    if (anomalousDays.length >= 2) score = Math.min(100, score + Math.min(10, anomalousDays.length * 2));",
    "    const dominant = period.score >= maxDaily ? period : anomalousDays[0];\n    let score = Math.max(period.score, maxDaily);\n    const anomalyBonus = anomalousDays.length >= 2 ? Math.min(10, anomalousDays.length * 2) : 0;\n    if (anomalyBonus) score = Math.min(100, score + anomalyBonus);"
)
combine = combine.replace(
    "    const risk = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';",
    "    const risk = score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low';\n    const scoreBreakdown = [...(dominant?.breakdown || [])];\n    if (anomalyBonus) scoreBreakdown.push({ points: anomalyBonus, family: 'stability', reason: `${anomalousDays.length} аномальных дня/дней за период`, scope: 'period' });\n    const rawBreakdownTotal = scoreBreakdown.reduce((sum, item) => sum + (Number(item.points) || 0), 0);\n    if (rawBreakdownTotal !== score) scoreBreakdown.push({ points: score - rawBreakdownTotal, family: 'limit', reason: 'корректировка итогового score правилами объёма и числа независимых семейств сигналов', scope: 'system' });",
    1
)
combine = combine.replace('      reasons: [...new Set(reasons)],\n      families:', '      reasons: [...new Set(reasons)],\n      scoreBreakdown,\n      scoreBasis: dominant === period ? \'период\' : `день ${dominant?.date || \'—\'}`,\n      families:', 1)
text = text[:combine_start] + combine + text[combine_end:]

# Expanded analyst language and score rendering.
anchor = '  function renderSourceCard(row, index) {'
insert = r'''  const FAMILY_LABELS = {
    volume: 'Объём трафика',
    behavior: 'Поведение',
    quality: 'Качество и конверсии',
    network: 'IP и подсети',
    identity: 'ClientID',
    technical: 'Технический профиль',
    stability: 'Повторяемость аномалий',
    limit: 'Системная корректировка'
  };

  function analystExplanation(reason, context = {}) {
    const value = String(reason || '').trim();
    const lower = value.toLowerCase();
    const conclusion = 'Сам по себе признак не доказывает фрод; вывод делается только вместе с независимыми техническими и поведенческими сигналами.';
    if (lower.includes('отказ')) return `${value}. Это означает, что доля визитов без содержательного взаимодействия заметно вышла за собственную норму источника. Возможные причины: изменение качества инвентаря, некорректная посадочная страница, автоматические переходы или случайный трафик. Следствие: вероятность нецелевого либо автоматизированного потока повышается. ${conclusion}`;
    if (lower.includes('время')) return `${value}. Длительность визита существенно отличается от типичного дня площадки. Резкое падение часто связано с быстрым закрытием страницы или автоматическим открытием, а чрезмерный рост — с зависшими вкладками, фоновыми webview либо искусственным удержанием сессии. Следствие: поведенческий профиль дня нельзя считать обычным. ${conclusion}`;
    if (lower.includes('clientid')) return `${value}. Небольшое число идентификаторов формирует непропорционально большой объём визитов или повторов. Это может возникать из-за реальных возвратов, служебного трафика, общей инфраструктуры или автоматизации. Следствие: требуется проверить устойчивость ClientID, cookies и совпадение с IP/техническими кластерами. ${conclusion}`;
    if (lower.includes('ip') || lower.includes('подсет')) return `${value}. Значительная часть дневного трафика сосредоточена в одном сетевом адресе или диапазоне. Для массовой рекламной аудитории такая концентрация нетипична, но возможна у корпоративных сетей, операторских NAT и прокси. Следствие: сигнал становится сильным только при совпадении с плохим поведением, повторными ClientID или однородным техническим профилем. ${conclusion}`;
    if (lower.includes('техпроф') || lower.includes('браузер') || lower.includes('автоматизац')) return `${value}. Большая группа визитов имеет одинаковую либо технически необычную конфигурацию браузера, ОС, устройства и разрешения. Это может быть особенностью приложения или рекламного формата, но также характерно для эмуляторов и автоматизированных сред. Следствие: необходимо локализовать кластер по дням, referrer и поведению. ${conclusion}`;
    if (lower.includes('конверс')) return `${value}. Конверсионное поведение заметно отличается от обычного уровня источника. Почти полное отсутствие качественных действий указывает на слабую ценность трафика; неестественно высокая конверсия может означать ошибку передачи цели или автоматические действия. Следствие: проверить цели, коллтрекинг и состав трафика в отмеченные даты. ${conclusion}`;
    if (lower.includes('нов')) return `${value}. Почти каждый визит определяется как новый пользователь, поэтому источник практически не формирует возвращающуюся аудиторию. Возможные причины: реальный приток новой аудитории, нестабильные идентификаторы, приватные сессии или очистка хранилища. Следствие: метрики ClientID и повторов нужно интерпретировать осторожно. ${conclusion}`;
    if (lower.includes('объём') || lower.includes('всплеск')) return `${value}. Объём трафика резко вырос относительно обычного дня этой же площадки. Сам рост может быть результатом увеличения бюджета или нового размещения, но он повышает значимость остальных отклонений: если вместе с объёмом ухудшаются поведение и техническая структура, риск становится существенно выше. ${conclusion}`;
    return `${value}. Алгоритм зафиксировал отклонение от собственной нормы источника. Причину необходимо уточнить по дате, кампании, referrer и связанным техническим срезам. ${conclusion}`;
  }

  function renderScoreBreakdown(row) {
    const items = (row.scoreBreakdown || []).filter((item) => Number(item.points));
    if (!items.length) return '<p>Баллы не начислены: выраженных отклонений с достаточной выборкой не найдено.</p>';
    const body = items.map((item) => {
      const points = Number(item.points) || 0;
      return `<tr><td><b>${escapeHtml(FAMILY_LABELS[item.family] || item.family || 'Сигнал')}</b><br><small>${escapeHtml(item.reason || '—')}</small></td><td class="score-points ${points < 0 ? 'negative' : ''}">${points >= 0 ? '+' : '−'}${Math.abs(points)}</td><td>${escapeHtml(analystExplanation(item.reason, row))}</td></tr>`;
    }).join('');
    return `<p><b>Основа итоговой оценки:</b> ${escapeHtml(row.scoreBasis || '—')}. Баллы ниже отражают фактические правила движка; отрицательная корректировка означает ограничение score из-за объёма выборки или недостаточного числа независимых семейств сигналов.</p><div class="table-wrap"><table class="mini-table score-breakdown-table"><thead><tr><th>Сигнал</th><th>Баллы</th><th>Причина → следствие → вывод</th></tr></thead><tbody>${body}</tbody><tfoot><tr><th>Итоговый score</th><th>${formatInt(row.score)}</th><th>${escapeHtml(row.action)}</th></tr></tfoot></table></div>`;
  }

'''
if anchor not in text:
    raise RuntimeError('renderSourceCard anchor not found')
text = text.replace(anchor, insert + anchor, 1)
text = text.replace('<section class="detail"><h4>Почему такой score</h4><ul class="flag-list">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join(\'\')}</ul></section>', '<section class="detail detail--wide"><h4>Как сформирован score</h4>${renderScoreBreakdown(row)}</section>', 1)

# Make visit-level summary more analytical.
text = text.replace(
    "      ? `${formatInt(suspiciousVisits)} визитов требуют внимания: ${formatInt(highRiskVisits)} высокого риска и ${formatInt(reviewVisits)} требуют проверки. Основные причины — ${topReasons.join(' и ') || 'совпадение нескольких независимых признаков'}.`",
    "      ? `${formatInt(suspiciousVisits)} визитов получили сочетание признаков: ${formatInt(highRiskVisits)} отнесены к высокому риску, ещё ${formatInt(reviewVisits)} требуют проверки. Наибольший вклад дали ${topReasons.join(' и ') || 'несколько независимых технических и поведенческих факторов'}. Это означает, что отклонения сосредоточены не во всём трафике источника, а в конкретной части визитов. Практический вывод — сначала локализовать даты, домены и технические кластеры, затем подтверждать причину в Метрике и данных площадки.`",
    1
)

path.write_text(text, encoding='utf-8')
print('Applied expanded analyst explanations and score breakdown')
