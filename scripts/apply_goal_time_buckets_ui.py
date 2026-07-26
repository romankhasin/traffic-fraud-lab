from pathlib import Path

path = Path('assets/api-mode.js')
text = path.read_text(encoding='utf-8')
old = '''        ${behaviorItem('ClientID с 5+ отказными визитами', period.repeatBounceClients5, period.repeatBounceClientShare, 'Повторяющийся отказной сценарий одного браузера.')}
        ${behaviorItem('Любая цель достигнута ≤15 секунд', period.fastAnyGoal15Visits, period.fastAnyGoal15Share, 'Проверить автоматические клики и служебные цели.')}
        ${behaviorItem('Любая цель достигнута за 15–30 секунд', period.fastAnyGoal30Visits, period.fastAnyGoal30Share, 'Погранично быстрые достижения целей.')}'''
new = '''        ${behaviorItem('Любая цель достигнута за 0–3 секунды', period.fastAnyGoal3Visits, period.fastAnyGoal3Share, 'Крайне быстрое достижение: проверить автоклики, служебные цели и события, срабатывающие при загрузке.')}
        ${behaviorItem('Любая цель достигнута за 4–15 секунд', period.fastAnyGoal15Visits, period.fastAnyGoal15Share, 'Быстрое достижение: проверить реалистичность пользовательского сценария и тип цели.')}
        ${behaviorItem('Любая цель достигнута за 16–30 секунд', period.fastAnyGoal30Visits, period.fastAnyGoal30Share, 'Погранично быстрый сценарий: сопоставить с типом цели и посадочной страницей.')}'''
if old not in text:
    raise RuntimeError('Behavior card block not found')
text = text.replace(old, new)
path.write_text(text, encoding='utf-8')
print('Goal timing cards migrated')
