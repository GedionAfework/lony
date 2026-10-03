from pathlib import Path
p = Path(r'C:\Users\Gedion\Documents\lony\apps\mobile\src\SettingsScreen.tsx')
text = p.read_text(encoding='utf-8')
marker = "settings.biometricsLock"
idx = text.find(marker)
if idx < 0:
    raise SystemExit('marker not found')
# find start of the View containing biometrics
start = text.rfind('<View', 0, idx)
# find loanApproval view after this block
end = text.find("settings.loanApproval", idx)
end = text.rfind('<View', 0, end)
text2 = text[:start] + text[end:]
p.write_text(text2, encoding='utf-8')
print('ok', start, end)
