# Lony mobile (Expo)

React Native app for **iOS and Android**. Design tokens and chrome are shared in spirit with the Vite user website (`apps/web`).

## Scripts

```bash
npm start          # Expo dev server
npm run android
npm run ios
npm run web        # Expo web (engineering only — not the product site)
npm run typecheck
```

## User website

The customer-facing web app lives in **`apps/web`** (Vite, port **8082**). Do not treat `npm run web` here as the product website.

```bash
cd ../web
npm install
npm run dev
```

## API base URL

Set `EXPO_PUBLIC_API_URL` (see `src/theme.tsx` `apiBaseUrl`). Example:

```bash
# PowerShell
$env:EXPO_PUBLIC_API_URL="http://localhost:8080/api/v1"
npm start
```

Admin SaaS ops live in `apps/admin` (Vite). Voice notes are native-only.
