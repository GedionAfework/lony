import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Loan, User } from './api';
import { formatSignedMoney } from './amountFormat';
import { t } from './i18n';
import { fonts, radii, space, useTheme } from './theme';
import { Card, DueDatePill, EmptyState, HeroCard, Segmented, SectionLabel } from './ui';

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
  const n = Number(loan.outstanding_amount || loan.expected_total || loan.principal || 0);
  return Number.isFinite(n) ? n : 0;
}

export function LoansScreen({ user, loans, onOpenLoan, onOpenPeer, peerDetail, formatMoney }: Props) {
  const { colors } = useTheme();
  const locale = user.locale || 'en';
  const [mode, setMode] = useState<'all' | 'individual'>('all');
  const effectiveMode = peerDetail ? 'all' : mode;

  const individuals = useMemo(() => {
    const map = new Map<string, PeerBucket>();
    for (const loan of loans) {
      const peer = peerOf(loan);
      const id = peer?.id || loan.id;
      const name = loan.institution_label || peer?.display_name || t(locale, 'loans.someone');
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
  }, [loans, user.default_currency_code, locale]);

  // Totals in the user's main currency, for the summary card.
  const mainCurrency = (user.default_currency_code || loans[0]?.currency_code || 'USD').toUpperCase();
  const inMain = loans.filter((l) => (l.currency_code || mainCurrency).toUpperCase() === mainCurrency);
  const owedToYou = inMain.filter((l) => l.your_role === 'lender').reduce((sum, l) => sum + remaining(l), 0);
  const youOwe = inMain.filter((l) => l.your_role !== 'lender').reduce((sum, l) => sum + remaining(l), 0);
  const money = (n: number) => formatMoney(n.toFixed(2), mainCurrency, locale);

  const row = (
    key: string,
    title: string,
    subtitle: string,
    amount: string,
    positive: boolean,
    onPress: () => void,
    right?: ReactNode,
  ) => (
    <Pressable key={key} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: radii.full,
          backgroundColor: positive ? colors.successSoft : colors.surfaceMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: positive ? colors.success : colors.text, fontFamily: fonts.uiBold, fontSize: 15 }}>
          {title.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ color: positive ? colors.success : colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>{amount}</Text>
        {right}
      </View>
    </Pressable>
  );

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 24 }}>
        {t(locale, 'loans.title') || 'Loans'}
      </Text>
      {!peerDetail && loans.length > 0 ? (
        <HeroCard
          label={t(locale, 'loans.title') || 'Loans'}
          value={money(owedToYou - youOwe)}
          sub={`${loans.length} ${loans.length === 1 ? 'loan' : 'loans'}`}
          tiles={[
            { label: t(locale, 'wealth.owedToYou'), value: money(owedToYou) },
            { label: t(locale, 'wealth.youOwe'), value: money(youOwe) },
          ]}
        />
      ) : null}
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
          <EmptyState title={t(locale, 'loans.emptyTitle') || 'No loans yet'} body={t(locale, 'loans.emptyBody') || 'Tap + to add a loan.'} />
        </Card>
      ) : effectiveMode === 'all' ? (
        <Card>
          <SectionLabel>{t(locale, 'loans.tabAll') || 'All'}</SectionLabel>
          {loans.map((loan) => {
            const peer = peerOf(loan);
            const who = loan.institution_label || peer?.display_name || t(locale, 'loans.loanFallback');
            const lender = loan.your_role === 'lender';
            return row(
              loan.id,
              loan.title || who,
              [loan.title ? who : null, lender ? t(locale, 'expenses.theyOwe') : t(locale, 'wealth.youOwe'), !loan.principal ? t(locale, 'loans.waitingTerms') || 'Waiting for terms' : null]
                .filter(Boolean)
                .join(' · '),
              formatSignedMoney(loan.expected_total, loan.currency_code, lender ? 1 : -1, locale),
              lender,
              () => onOpenLoan(loan.id),
              <DueDatePill dueAt={loan.due_at} status={loan.status} locale={user.locale} />,
            );
          })}
        </Card>
      ) : (
        <Card>
          <SectionLabel>{t(locale, 'loans.tabIndividual') || 'Individual'}</SectionLabel>
          {individuals.map((bucket) =>
            row(
              `${bucket.peerId}:${bucket.currency}`,
              bucket.name,
              `${bucket.loans.length} ${bucket.loans.length === 1 ? t(locale, 'loans.oneLoan') || 'loan' : t(locale, 'loans.manyLoans') || 'loans'} · ${bucket.currency}`,
              formatSignedMoney(String(Math.abs(bucket.net).toFixed(2)), bucket.currency, bucket.net >= 0 ? 1 : -1, locale),
              bucket.net >= 0,
              () => {
                if (onOpenPeer) onOpenPeer(bucket.peerId, bucket.name, bucket.loans.map((l) => l.id));
                else if (bucket.loans[0]) onOpenLoan(bucket.loans[0].id);
              },
            ),
          )}
        </Card>
      )}
    </View>
  );
}
