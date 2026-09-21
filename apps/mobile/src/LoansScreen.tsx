import { Pressable, Text, View } from 'react-native';
import type { Friendship, Loan, SearchHit, User } from './api';
import { fonts, radii, space, useTheme } from './theme';
import { Card, Field, Money, PrimaryButton, SecondaryButton, StatusPill } from './ui';

type Props = {
  user: User;
  loans: Loan[];
  friends: Friendship[];
  incoming: Friendship[];
  hits: SearchHit[];
  query: string;
  loanFilter: string;
  busy: boolean;
  onQuery: (v: string) => void;
  onSearch: () => void;
  onAdd: (hit: SearchHit) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onRemove: (id: string) => void;
  onBlock: (userId: string) => void;
  onFilter: (filter: string) => void;
  onOpenLoan: (id: string) => void;
  onNewLoan: () => void;
  formatMoney: (amount: string | null | undefined, currency: string | null | undefined, locale?: string) => string;
};

export function LoansScreen({
  user,
  loans,
  friends,
  incoming,
  hits,
  query,
  loanFilter,
  busy,
  onQuery,
  onSearch,
  onAdd,
  onAccept,
  onReject,
  onRemove,
  onBlock,
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
            <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 13 }}>Clear filter</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
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
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }}>
            No loans yet. Add a friend, then create a shared ledger entry.
          </Text>
          <PrimaryButton label="Create loan" onPress={onNewLoan} />
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

      <Card>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Friends</Text>
        <Field label="Search email or name" value={query} onChange={onQuery} />
        <PrimaryButton label={busy ? 'Working…' : 'Search'} onPress={onSearch} disabled={busy} />
        {hits.map((hit) => (
          <View key={hit.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{hit.display_name}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
                {hit.username ?? hit.id.slice(0, 8)}
              </Text>
            </View>
            <SecondaryButton label="Add" onPress={() => onAdd(hit)} disabled={busy} />
          </View>
        ))}
        {incoming.map((req) => (
          <View key={req.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{req.peer.display_name}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>Incoming request</Text>
            </View>
            <SecondaryButton label="Accept" onPress={() => onAccept(req.id)} disabled={busy} />
            <SecondaryButton label="Reject" onPress={() => onReject(req.id)} disabled={busy} />
          </View>
        ))}
        {friends.map((friend) => (
          <View key={friend.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{friend.peer.display_name}</Text>
            </View>
            <SecondaryButton label="Remove" onPress={() => onRemove(friend.id)} disabled={busy} />
            <SecondaryButton label="Block" onPress={() => onBlock(friend.peer.id)} disabled={busy} />
          </View>
        ))}
      </Card>
    </View>
  );
}
