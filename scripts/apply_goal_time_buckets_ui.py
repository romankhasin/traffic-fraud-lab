from pathlib import Path

api_path = Path('assets/api-mode.js')
text = api_path.read_text(encoding='utf-8')
old = '''        ${behaviorItem('ClientID с 5+ отказными визитами', period.repeatBounceClients5, period.repeatBounceClientShare, 'Повторяющийся отказной сценарий одного браузера.')}
        ${behaviorItem('Любая цель достигнута ≤15 секунд', period.fastAnyGoal15Visits, period.fastAnyGoal15Share, 'Проверить автоматические клики и служебные цели.')}
        ${behaviorItem('Любая цель достигнута за 15–30 секунд', period.fastAnyGoal30Visits, period.fastAnyGoal30Share, 'Погранично быстрые достижения целей.')}'''
new = '''        ${behaviorItem('Любая цель достигнута за 0–3 секунды', period.fastAnyGoal3Visits, period.fastAnyGoal3Share, 'Крайне быстрое достижение: проверить автоклики, служебные цели и события, срабатывающие при загрузке.')}
        ${behaviorItem('Любая цель достигнута за 4–15 секунд', period.fastAnyGoal15Visits, period.fastAnyGoal15Share, 'Быстрое достижение: проверить реалистичность пользовательского сценария и тип цели.')}
        ${behaviorItem('Любая цель достигнута за 16–30 секунд', period.fastAnyGoal30Visits, period.fastAnyGoal30Share, 'Погранично быстрый сценарий: сопоставить с типом цели и посадочной страницей.')}'''
if old in text:
    text = text.replace(old, new)
elif new not in text:
    raise RuntimeError('Behavior card block not found')
api_path.write_text(text, encoding='utf-8')

validation_path = Path('scripts/validate_mi_extensions.js')
validation = validation_path.read_text(encoding='utf-8')
validation = validation.replace(
'''  repeatBounceClients5: 42,
  repeatBounceClientShare: 0.006,
  fastAnyGoal15Visits: 120,''',
'''  repeatBounceClients5: 42,
  repeatBounceClientShare: 0.006,
  fastAnyGoal3Visits: 40,
  fastAnyGoal3Share: 0.004,
  fastAnyGoal15Visits: 120,'''
)
validation = validation.replace(
'''if (!behaviorHtml.includes('Поведенческие паттерны') || !behaviorHtml.includes('5+ отказными') || !behaviorHtml.includes('≤15 секунд')) {''',
'''if (!behaviorHtml.includes('Поведенческие паттерны')
    || !behaviorHtml.includes('0–3 секунды')
    || !behaviorHtml.includes('4–15 секунд')
    || !behaviorHtml.includes('16–30 секунд')) {'''
)
for marker in ('fastAnyGoal3Visits: 40', "behaviorHtml.includes('0–3 секунды')", "behaviorHtml.includes('4–15 секунд')", "behaviorHtml.includes('16–30 секунд')"):
    if marker not in validation:
        raise RuntimeError(f'Validation marker missing: {marker}')
validation_path.write_text(validation, encoding='utf-8')
print('Goal timing cards and runtime validation migrated')
