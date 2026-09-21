import { Pressable, Text, View } from 'react-native';
import type { Dashboard, Friendship, Loan, User } from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Banner, BrandMark, Card, Money, PrimaryButton, SecondaryButton, Segmented, StatusPill, ThemeToggle } from './ui';

type Props = {
  user: User;
  dashboard: Dashboard | null;
  dashCurrency: string;
  loans: Loan[];
  friends: Friendship[];
  loanFilter: string;
  onCurrency: (code: string) => void;
  onFilter: (filter: string) => void;
  onOpenLoan: (id: string) => void;
  onNewLoan: () => void;
  onBanks: () => void;
  onLogout: () => void;
  onProfile: () => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

export function DashboardHome({
  user,
  dashboard,
  dashCurrency,
  loans,
  friends,
  loanFilter,
  onCurrency,
  onFilter,
  onOpenLoan,
  onNewLoan,
  onBanks,
  onLogout,
  onProfile,
  formatMoney,
}: Props) {
  const { colors } = useTheme();
  const currencies = dashboard?.by_currency?.map((c) => c.currency_code) ?? [dashCurrency];
  const slice = dashboard?.by_currency?.find((c) => c.currency_code === dashCurrency);
  const netNum = slice ? Number(slice.net) : 0;
  const pendingConfirm = dashboard?.pending_confirmations ?? 0;
  const dueSoon = slice?.due_soon_count ?? 0;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <BrandMark />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ThemeToggle />
          <Pressable onPress={onProfile} accessibilityRole="button" accessibilityLabel="Open profile">
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radii.full,
                backgroundColor: colors.primarySoft,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 16 }}>
                {user.display_name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }}>
        Hi {user.display_name.split(' ')[0]} — shared records only. Money moves outside Lony.
      </Text>

      <Segmented options={currencies.map((c) => ({ id: c, label: c }))} value={dashCurrency} onChange={onCurrency} />

      <Card>
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.uiSemi,
            fontSize: 12,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}
        >
          Net position
        </Text>
        <Money
          value={slice ? formatMoney(slice.net, slice.currency_code, user.locale) : '—'}
          size="xl"
          tone={netNum > 0 ? 'positive' : netNum < 0 ? 'negative' : 'default'}
        />
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
          {netNum > 0 ? 'You are owed overall' : netNum < 0 ? 'You owe overall' : 'Balanced'} · {dashCurrency} only
        </Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: colors.surfaceMuted,
              borderRadius: radii.md,
              padding: 12,
              gap: 6,
            }}
            onPress={() => onFilter('receivables')}
          >
            <Text style={{ color: colors.muted, fontFamily: fonts.uiMedium, fontSize: 12 }}>Others owe me</Text>
            <Money value={slice?.receivables ?? '0'} currency={dashCurrency} size="md" tone="positive" />
          </Pressable>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: colors.surfaceMuted,
              borderRadius: radii.md,
              padding: 12,
              gap: 6,
            }}
            onPress={() => onFilter('payables')}
          >
            <Text style={{ color: colors.muted, fontFamily: fonts.uiMedium, fontSize: 12 }}>I owe others</Text>
            <Money value={slice?.payables ?? '0'} currency={dashCurrency} size="md" tone="negative" />
          </Pressable>
        </View>
      </Card>

      {pendingConfirm > 0 ? (
        <Banner
          tone="secondary"
          title="Confirm a repayment"
          body={`${pendingConfirm} claim${pendingConfirm === 1 ? '' : 's'} waiting for you.`}
          actionLabel="Review"
          onAction={() => onFilter('pending_confirmations')}
        />
      ) : null}
      {dueSoon > 0 ? (
        <Banner
          tone="tertiary"
          title="Due soon"
          body={`${dueSoon} loan${dueSoon === 1 ? '' : 's'} · ${formatMoney(slice?.due_soon, dashCurrency, user.locale)}`}
          actionLabel="Open"
          onAction={() => onFilter('due_soon')}
        />
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <QuickAction label="Requests" icon="↓" onPress={() => onFilter('pending_action')} />
        <QuickAction label="New loan" icon="+" primary onPress={onNewLoan} />
        <QuickAction label="Banks" icon="▤" onPress={onBanks} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 18 }}>Loans</Text>
        {loanFilter ? (
          <Pressable onPress={() => onFilter('')}>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Clear filter</Text>
          </Pressable>
        ) : null}
      </View>

      {loans.length === 0 ? (
        <Card>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }}>
            No loans yet. Add a friend, then create a shared ledger entry.
          </Text>
          <PrimaryButton label="Create loan" onPress={onNewLoan} />
        </Card>
      ) : (
        loans.slice(0, 8).map((loan) => {
          const peer = loan.your_role === 'borrower' ? loan.lender : loan.borrower;
          const signed =
            loan.your_role === 'lender'
              ? loan.expected_total
                ? `+${formatMoney(loan.expected_total, loan.currency_code, user.locale)}`
                : '—'
              : loan.expected_total
                ? `−${formatMoney(loan.expected_total, loan.currency_code, user.locale)}`
                : '—';
          return (
            <Pressable key={loan.id} onPress={() => onOpenLoan(loan.id)}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radii.full,
                      backgroundColor: colors.surfaceMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 15 }}>
                      {peer.display_name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{peer.display_name}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {loan.reference_code} · {loan.your_role}
                    </Text>
                  </View>
                  <StatusPill status={loan.status} />
                </View>
                <Money value={signed} size="md" tone={loan.your_role === 'lender' ? 'positive' : 'negative'} />
                {loan.principal ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                    Flat {loan.interest_rate_percent}% · due{' '}
                    {loan.due_at
                      ? new Date(loan.due_at).toLocaleDateString(user.locale || 'en', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                  </Text>
                ) : (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>Waiting for terms</Text>
                )}
              </Card>
            </Pressable>
          );
        })
      )}

      {friends.length > 0 && slice?.friends?.length ? (
        <>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 18 }}>By friend</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {slice.friends.map((fb) => (
              <View
                key={fb.peer.id}
                style={{
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radii.lg,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  gap: 4,
                  minWidth: 120,
                }}
              >
                <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                  {fb.peer.display_name.split(' ')[0]}
                </Text>
                <Money
                  value={formatMoney(fb.net, dashCurrency, user.locale)}
                  size="sm"
                  tone={Number(fb.net) >= 0 ? 'positive' : 'negative'}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}

      <SecondaryButton label="Sign out" onPress={onLogout} />
    </View>
  );
}

function QuickAction({
  label,
  icon,
  onPress,
  primary,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={{
        flex: 1,
        minHeight: 84,
        borderRadius: radii.lg,
        backgroundColor: primary ? colors.primary : colors.surfaceMuted,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
      onPress={onPress}
    >
      <Text style={{ color: primary ? colors.onPrimary : colors.primary, fontSize: 22, fontFamily: fonts.uiBold }}>
        {icon}
      </Text>
      <Text
        style={{
          color: primary ? colors.onPrimary : colors.text,
          fontFamily: fonts.uiSemi,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
