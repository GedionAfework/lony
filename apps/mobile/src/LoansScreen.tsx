import { Pressable, Text, View } from 'react-native';
import type { Loan, User } from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Money, PrimaryButton, StatusPill } from './ui';

type Props = {
  user: User;
  loans: Loan[];
  loanFilter: string;
  onFilter: (filter: string) => void;
  onOpenLoan: (id: string) => void;
  onNewLoan: () => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

export function LoansScreen({
  user,
  loans,
  loanFilter,
  onFilter,
  onOpenLoan,
  onNewLoan,
  formatMoney,
}: Props) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Loans</Text>
        {loanFilter ? (
          <Pressable onPress={() => onFilter('')}>
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      <PrimaryButton label="New loan" onPress={onNewLoan} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[
          { id: '', label: 'All' },
          { id: 'pending_action', label: 'Requests' },
          { id: 'receivables', label: 'Owed to me' },
          { id: 'payables', label: 'I owe' },
        ].map((f) => {
          const active = loanFilter === f.id;
          return (
            <Pressable
              key={f.id || 'all'}
              onPress={() => onFilter(f.id)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: radii.full,
                backgroundColor: active ? colors.primary : colors.surfaceMuted,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text
                style={{
                  color: active ? colors.onPrimary : colors.text,
                  fontFamily: fonts.uiSemi,
                  fontSize: 12,
                }}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loans.length === 0 ? (
        <Card>
          <EmptyState
            title="No loans in sight"
            body="Start with a friend — or invite someone from your contacts. They’ll need to approve before it goes live."
          />
        </Card>
      ) : (
        loans.map((loan) => {
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
    </View>
  );
}
