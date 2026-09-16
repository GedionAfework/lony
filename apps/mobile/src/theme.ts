export const colors = {
  background: '#0b1326',
  surface: '#171f33',
  surfaceHigh: '#222a3d',
  surfaceLowest: '#060e20',
  primary: '#6bd8cb',
  onPrimary: '#003732',
  secondary: '#ffb95f',
  tertiary: '#93ccff',
  text: '#dae2fd',
  muted: '#bcc9c6',
  error: '#ffb4ab',
  outline: 'rgba(148, 163, 184, 0.16)',
};

export const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080/api/v1';
