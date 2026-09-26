import { Pressable, Text, View } from 'react-native';
import type { Loan, User } from './api';
import { formatSignedMoney } from './amountFormat';
import { fonts, radii, space, useTheme } from './theme';
import { Card, DueDatePill, EmptyState, Money } from './ui';

type Props = {
  user: User;
  loans: Loan[];
  onOpenLoan: (id: string) => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

export function LoansScreen({ user, loans, onOpenLoan }: Props) {
  const { colors } = useTheme();

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Loans</Text>

      {loans.length === 0 ? (
        <Card>
          <EmptyState
            title="No loans in sight"
            body="Tap + to start with a friend, search someone, or invite a contact. They’ll approve before it goes live."
          />
        </Card>
      ) : (
        loans.map((loan) => {
          const peer = loan.your_role === 'borrower' ? loan.lender : loan.borrower;
          const title = loan.institution_label || peer.display_name;
          const initial = title.slice(0, 1).toUpperCase();
          const signed = formatSignedMoney(
            loan.expected_total,
            loan.currency_code,
            loan.your_role === 'lender' ? 1 : -1,
            user.locale || 'en',
          );
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
                      {initial}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
                      {loan.title || title}
                    </Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {loan.reference_code}
                      {loan.currency_code ? ` · ${loan.currency_code}` : ''}
                      {loan.title ? ` · ${title}` : ''}
                    </Text>
                  </View>
                  <DueDatePill dueAt={loan.due_at} status={loan.status} locale={user.locale} />
                </View>
                <Money value={signed} size="md" tone={loan.your_role === 'lender' ? 'positive' : 'negative'} />
                {!loan.principal ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>Waiting for terms</Text>
                ) : null}
              </Card>
            </Pressable>
          );
        })
      )}
    </View>
  );
}
