# Lony mobile (Expo)

Same React Native app for iOS, Android, and **web** (user-facing web app).

## Scripts

```bash
npm start          # Expo dev server
npm run android
npm run ios
npm run web        # Expo web (react-native-web)
npm run typecheck
```

## API base URL

Set `EXPO_PUBLIC_API_URL` (see `src/theme.tsx` `apiBaseUrl`). Example:

```bash
# PowerShell
$env:EXPO_PUBLIC_API_URL="http://localhost:8080/api/v1"
npm run web
```

Admin SaaS ops live in `apps/admin` (Vite), not this app. Voice notes are native-only; other flows work on web with localStorage for session/themes.
