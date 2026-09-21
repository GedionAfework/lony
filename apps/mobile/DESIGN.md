---
name: Lony
colors:
  # Light (default) — white canvas, teal primary
  background: '#FFFFFF'
  surface: '#FFFFFF'
  surface-muted: '#F4F6F8'
  on-surface: '#0F172A'
  on-surface-variant: '#64748B'
  outline: '#E8ECF0'
  primary: '#0D9488'
  on-primary: '#FFFFFF'
  primary-soft: '#E6F7F5'
  secondary: '#D97706'
  tertiary: '#0284C7'
  error: '#DC2626'
  success: '#0F766E'
  # Dark
  dark-background: '#0B1220'
  dark-surface: '#121A2B'
  dark-on-surface: '#F1F5F9'
  dark-primary: '#2DD4BF'
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
  sm: 8px
  md: 14px
  lg: 18px
  full: 9999px
---

# Lony Design System

Simple white-first ledger UI with optional dark mode. Teal primary, amber secondary, sky tertiary. Manrope for UI, JetBrains Mono for amounts.

## Theme

- Default: light (`#FFFFFF` background). Toggle persists in SecureStore.
- Dark: deep navy surfaces, teal accents.
- Status bar follows resolved theme.

## Navigation

Bottom bar: Home · Loans · **+** · Chats · Banks · Inbox. FAB creates a loan. Keep one job per screen; avoid nested dashboards.

## Screens

1. **Auth** — Brand, short disclaimer, form, theme toggle.
2. **Home** — Net position, quick actions, loan list, friends strip.
3. **Loan detail** — Status, terms, repayments, payment profile.
4. **Chats** — Friend DMs (text, emoji, reply, react, file, voice).
5. **Banks / Inbox** — Payment profiles and notifications.

## Components

Cards with hairline borders (no heavy shadows). Money in mono. Status pills. Segmented currency switch. Theme toggle moon/sun.
