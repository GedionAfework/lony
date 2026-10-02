import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Loan, User } from './api';
import { formatSignedMoney } from './amountFormat';
import { t } from './i18n';
import { fonts, radii, space, useTheme } from './theme';
import { Card, DueDatePill, EmptyState, Money, Segmented } from './ui';

type Props = {
  user: User;
  loans: Loan[];
  onOpenLoan: (id: string) => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
  onOpenPeer?: (peerId: string, peerName: string, loanIds: string[]) => void;
  /** When viewing one person's loans, hide aggregation tabs. */
  peerDetail?: boolean;
};

type PeerBucket = {
  peerId: string;
  name: string;
  loans: Loan[];
  /** Net remaining in preferred display: positive = owed to you */
  net: number;
  currency: string;
};

function peerOf(loan: Loan) {
  return loan.your_role === 'borrower' ? loan.lender : loan.borrower;
}

function remaining(loan: Loan): number {
  const n = Number(loan.expected_total || loan.principal || 0);
  return Number.isFinite(n) ? n : 0;
}

export function LoansScreen({ user, loans, onOpenLoan, onOpenPeer, peerDetail }: Props) {
  const { colors } = useTheme();
  const locale = user.locale || 'en';
  const [mode, setMode] = useState<'all' | 'individual'>('all');
  const effectiveMode = peerDetail ? 'all' : mode;

  const individuals = useMemo(() => {
    const map = new Map<string, PeerBucket>();
    for (const loan of loans) {
      const peer = peerOf(loan);
      const id = peer?.id || loan.id;
      const name = loan.institution_label || peer?.display_name || 'Someone';
      const cur = (loan.currency_code || user.default_currency_code || 'USD').toUpperCase();
      const key = `${id}:${cur}`;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { peerId: id, name, loans: [], net: 0, currency: cur };
        map.set(key, bucket);
      }
      bucket.loans.push(loan);
      const amt = remaining(loan);
      bucket.net += loan.your_role === 'lender' ? amt : -amt;
    }
    return [...map.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [loans, user.default_currency_code]);

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
        {t(locale, 'loans.title') || 'Loans'}
      </Text>
      {!peerDetail ? (
        <Segmented
          options={[
            { id: 'all', label: t(locale, 'loans.tabAll') || 'All' },
            { id: 'individual', label: t(locale, 'loans.tabIndividual') || 'Individual' },
          ]}
          value={mode}
          onChange={(id) => setMode(id as 'all' | 'individual')}
        />
      ) : null}

      {loans.length === 0 ? (
        <Card>
          <EmptyState
            title={t(locale, 'loans.emptyTitle') || 'No loans in sight'}
            body={
              t(locale, 'loans.emptyBody') ||
              'Tap + to start with a friend, search someone, or invite a contact. They’ll approve before it goes live.'
            }
          />
        </Card>
      ) : effectiveMode === 'all' ? (
        loans.map((loan) => {
          const peer = peerOf(loan);
          const title = loan.institution_label || peer?.display_name || 'Loan';
          const initial = title.slice(0, 1).toUpperCase();
          const signed = formatSignedMoney(
            loan.expected_total,
            loan.currency_code,
            loan.your_role === 'lender' ? 1 : -1,
            locale,
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
                    <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 15 }}>{initial}</Text>
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
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                    {t(locale, 'loans.waitingTerms') || 'Waiting for terms'}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          );
        })
      ) : (
        individuals.map((bucket) => {
          const initial = bucket.name.slice(0, 1).toUpperCase();
          const signed = formatSignedMoney(
            String(Math.abs(bucket.net).toFixed(2)),
            bucket.currency,
            bucket.net >= 0 ? 1 : -1,
            locale,
          );
          return (
            <Pressable
              key={`${bucket.peerId}:${bucket.currency}`}
              onPress={() => {
                if (onOpenPeer) {
                  onOpenPeer(
                    bucket.peerId,
                    bucket.name,
                    bucket.loans.map((l) => l.id),
                  );
                } else if (bucket.loans[0]) {
                  onOpenLoan(bucket.loans[0].id);
                }
              }}
            >
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
                    <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 15 }}>{initial}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{bucket.name}</Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                      {bucket.loans.length}{' '}
                      {bucket.loans.length === 1
                        ? t(locale, 'loans.oneLoan') || 'loan'
                        : t(locale, 'loans.manyLoans') || 'loans'}
                      {` · ${bucket.currency}`}
                    </Text>
                  </View>
                </View>
                <Money value={signed} size="md" tone={bucket.net >= 0 ? 'positive' : 'negative'} />
                <View style={{ gap: 8, marginTop: 8 }}>
                  {bucket.loans.map((loan) => {
                    const line = formatSignedMoney(
                      loan.expected_total,
                      loan.currency_code,
                      loan.your_role === 'lender' ? 1 : -1,
                      locale,
                    );
                    return (
                      <Pressable
                        key={loan.id}
                        onPress={() => onOpenLoan(loan.id)}
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          paddingVertical: 8,
                          borderTopWidth: 1,
                          borderTopColor: colors.border,
                        }}
                      >
                        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, flex: 1 }} numberOfLines={1}>
                          {loan.title || loan.reference_code}
                        </Text>
                        <Text
                          style={{
                            color: loan.your_role === 'lender' ? colors.success : colors.warning,
                            fontFamily: fonts.uiSemi,
                            fontSize: 13,
                          }}
                        >
                          {line}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            </Pressable>
          );
        })
      )}
    </View>
  );
}
