# -*- coding: utf-8 -*-
import json
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "api" / "internal" / "localization" / "am-ET.json"
data = json.loads(p.read_text(encoding="utf-8"))
m = data["messages"]
# Use unicode escapes to avoid editor encoding issues.
extra = {
    "settings.security": "\u12f0\u1205\u1295\u1290\u1275",
    "settings.securitySubtitle": "\u1218\u1246\u1208\u134a\u12eb\u1363 \u1263\u12ee\u121c\u1275\u122a\u12ad\u1235\u1363 \u1270\u1300\u121b\u122a \u121b\u1228\u130b\u1308\u132b",
    "settings.extraFactor": "\u1270\u1300\u121b\u122a \u121b\u1228\u130b\u1308\u132b",
    "settings.extraFactorHint": "\u1201\u1208\u1270\u129b \u12f0\u1228\u1303 \u1218\u12ad\u1348\u127b \u2014 6 \u12a0\u1203\u12db PIN\u1363 3\u00d73 \u1295\u12f5\u134d \u12c8\u12ed\u121d \u12e8\u12ed\u1208\u134d \u1243\u120d\u1362",
    "settings.extraFactorToggle": "\u1201\u1208\u1270\u129b \u1218\u12ad\u1348\u127b \u12eb\u1235\u1348\u120d\u130d",
    "settings.extraFactorOn": "\u1260\u122d\u1277\u120d \u00b7 {method}",
    "settings.extraFactorOff": "\u1320\u134d\u1277\u120d \u2014 PIN\u1363 \u1295\u12f5\u134d \u12c8\u12ed\u121d \u12e8\u12ed\u1208\u134d \u1243\u120d \u12eb\u12cb\u1245\u1229",
    "settings.extraFactorSaved": "\u1270\u1300\u121b\u122a \u121b\u1228\u130b\u1308\u132b \u1270\u1240\u121d\u1327\u120d\u1362",
    "settings.chooseMethod": "\u12d8\u12f4 \u12ed\u121d\u1228\u1321",
    "settings.activeMethod": "\u1270\u1218\u122d\u1327\u120d",
    "settings.methodPin": "6 \u12a0\u1203\u12db PIN",
    "settings.methodPattern": "\u1295\u12f5\u134d",
    "settings.methodPassword": "\u12e8\u12ed\u1208\u134d \u1243\u120d",
    "settings.turnOffLock": "\u1218\u1246\u1208\u134a\u12eb \u12a0\u1325\u134b",
    "nav.home": "\u1218\u1290\u123b",
    "nav.loans": "\u1265\u12f5\u122e\u127d",
    "nav.chats": "\u12cd\u12ed\u12ed\u1276\u127d",
    "nav.plan": "\u12e8\u1308\u1295\u12d8\u1265 \u12d5\u1245\u12f5",
    "expenses.title": "\u12c8\u1322\u12ce\u127d",
    "expenses.tabDashboard": "\u12f3\u123d\u1266\u122d\u12f5",
    "expenses.tabIncome": "\u1308\u1262",
    "expenses.tabExpenses": "\u12c8\u1322\u12ce\u127d",
    "expenses.emptyDay": "\u1260\u12da\u1205 \u1240\u1295 \u121d\u1295\u121d \u12e8\u1208\u121d",
    "expenses.emptyDayBody": "\u1208\u1270\u1218\u1228\u1320\u12cd \u1240\u1295 \u1308\u1262\u1293 \u12c8\u1322\u12ce\u127d \u12a5\u12da\u1205 \u12ed\u1273\u12eb\u1209\u1362",
    "expenses.noIncome": "\u1308\u1262 \u12e8\u1208\u121d",
    "expenses.noExpenses": "\u12c8\u1322 \u12e8\u1208\u121d",
    "expenses.loadError": "\u1308\u1295\u12d8\u1265 \u134d\u1230\u1275 \u1218\u132b\u1295 \u12a0\u120d\u1270\u127b\u1208\u121d",
    "expenses.quietMonth": "\u1338\u1325 \u12eb\u1208 \u12c8\u122d",
    "expenses.quietMonthBody": "\u1308\u1262 \u12c8\u12ed\u121d \u12c8\u1322 \u1208\u1218\u1328\u1218\u122d + \u12ed\u132b\u1291\u1362",
    "wealth.totalBalance": "\u1320\u1245\u120b\u120b \u121a\u12db\u1295",
    "wealth.cash": "\u1325\u122c \u1308\u1295\u12d8\u1265",
    "wealth.owedToYou": "\u12e8\u121a\u12a8\u1348\u120d\u12ce\u1275",
    "wealth.youOwe": "\u12a5\u122d\u1235\u12ce \u12e8\u121a\u12a8\u134d\u1209\u1275",
    "wealth.details": "\u12dd\u122d\u12dd\u122d",
    "wealth.institutions": "\u1270\u1249\u121b\u1275",
    "wealth.accounts": "\u1218\u1208\u12eb\u12ce\u127d",
    "wealth.vsLastMonth": "\u12a8\u1263\u1208\u1348\u12cd \u12c8\u122d",
    "plan.title": "\u12e8\u1308\u1295\u12d8\u1265 \u12d5\u1245\u12f5",
    "plan": "\u12e8\u1308\u1295\u12d8\u1265 \u12d5\u1245\u12f5",
}
m.update(extra)
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("ok", len(extra))
