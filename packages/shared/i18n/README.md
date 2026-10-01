# Lony i18n master catalog

## Translate a language

1. Copy [`en.json`](./en.json).
2. Change `locale` (BCP-47, e.g. `am-ET`, `ar`), `name` (native label), and `dir` (`ltr` or `rtl`).
3. Translate every value under `messages` (keep the keys identical).
4. In **Admin → Localization → Languages**, paste/upload the JSON and enable it.
5. Users pick it under **Settings → Preferences**.

Missing keys fall back to English at runtime.

## Shape

```json
{
  "locale": "am-ET",
  "name": "አማርኛ",
  "dir": "ltr",
  "messages": {
    "nav.settings": "ቅንብሮች"
  }
}
```

## Calendars

Gregorian, Ethiopic, and Hijri are seeded. Admins can hide calendars; users choose an enabled calendar for **display**. API dates stay ISO Gregorian.
