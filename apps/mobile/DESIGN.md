---
name: Lony
colors:
  background: '#F7F9FB'
  surface: '#FFFFFF'
  surface-muted: '#EEF2F6'
  on-surface: '#0F172A'
  on-surface-variant: '#64748B'
  outline: '#E2E8F0'
  primary: '#1FA8A8'
  on-primary: '#FFFFFF'
  primary-soft: '#E6F7F6'
  secondary: '#D97706'
  tertiary: '#0284C7'
  error: '#DC2626'
  success: '#0F766E'
  dark-background: '#0B1220'
  dark-surface: '#121A2B'
  dark-on-surface: '#F1F5F9'
  dark-primary: '#2EC4C4'
typography:
  brand:
    fontFamily: Manrope
    fontSize: 22px
    fontWeight: '700'
  headline:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: '600'
  body:
    fontFamily: Manrope
    fontSize: 15px
    fontWeight: '400'
  mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
spacing: 4px
rounding:
  sm: 10px
  md: 14px
  lg: 20px
  full: 9999px
---

# Lony Design System

Soft slate canvas with white surfaces, teal primary, amber secondary, sky tertiary. Manrope for UI, JetBrains Mono for amounts. Shared language with the Vite user website (`apps/web`).

## Theme

- Default: light (`#F7F9FB` background). Toggle persists in SecureStore.
- Dark: deep navy surfaces, teal accents.
- Status bar follows resolved theme.
- Admin-published system themes merge with built-ins on the Themes screen.

## Navigation (mobile)

- **Bottom bar:** Home · Loans · Chat (floating glass pill).
- **Drawer:** Expenses/Home, Accounts, Loans, Insights, Plan, Settings.
- **FAB:** new income/expense on Home; new loan on Loans.
- One job per screen; avoid nested dashboards.

## Screens

1. **Auth** — Brand mark, short product line, calm form card, OAuth, disclaimer.
2. **Home** — Wealth / cashflow dashboard (Dashboard · Income · Expenses).
3. **Loans** — Peer loan list and detail / repayments.
4. **Chats** — Friend DMs (text, emoji, reply, react, file; voice native-only).
5. **Accounts / Plan / Insights / Banks** — via drawer.

## Components

Cards with hairline borders and soft elevation. Money in mono. Status pills. Segmented controls. Primary buttons with light teal glow.
