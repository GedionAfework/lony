import * as Contacts from 'expo-contacts';
import { Linking, Pressable, Text, View } from 'react-native';
import type { Friendship } from './api';
import { CURRENCIES } from './catalogs';
import { DateField } from './DateField';
import { dialForCountry, toE164 } from './phone';
import { SearchSelect } from './SearchSelect';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Field, PrimaryButton, SecondaryButton, SectionLabel } from './ui';

type Props = {
  friends: Friendship[];
  loanFriendId: string;
  loanRole: 'borrower' | 'lender';
  principal: string;
  interest: string;
  currency: string;
  dueDate: string;
  note: string;
  busy: boolean;
  countryCode: string;
  /** When set (e.g. from chat), counterparty is fixed — no person picker. */
  lockedPeer?: { id: string; display_name: string } | null;
  onSelectFriend: (id: string) => void;
  onRole: (role: 'borrower' | 'lender') => void;
  onPrincipal: (v: string) => void;
  onInterest: (v: string) => void;
  onCurrency: (v: string) => void;
  onDueDate: (v: string) => void;
  onNote: (v: string) => void;
  onBack: () => void;
  onCreate: () => void;
  onLookupPhone: (e164: string) => Promise<'selected' | 'invited' | 'pending' | 'error'>;
  onError: (message: string) => void;
};

export function NewLoanScreen({
  friends,
  loanFriendId,
  loanRole,
  principal,
  interest,
  currency,
  dueDate,
  note,
  busy,
  countryCode,
  lockedPeer,
  onSelectFriend,
  onRole,
  onPrincipal,
  onInterest,
  onCurrency,
  onDueDate,
  onNote,
  onBack,
  onCreate,
  onLookupPhone,
  onError,
}: Props) {
  const { colors } = useTheme();
  const selected = friends.find((f) => f.peer.id === loanFriendId);
  const peerLabel = lockedPeer?.display_name || selected?.peer.display_name;

  async function pickContact() {
    const perm = await Contacts.requestPermissionsAsync();
    if (!perm.granted) {
      onError('Contacts permission is required to add someone by phone');
      return;
    }
    const picked = await Contacts.presentContactPickerAsync();
    if (!picked) return;
    const numbers = picked.phoneNumbers ?? [];
    const raw = numbers[0]?.number;
    if (!raw) {
      onError('That contact has no phone number');
      return;
    }
    const digits = raw.replace(/\D/g, '');
    const dial = dialForCountry(countryCode || 'ET');
    let e164 = raw.trim().startsWith('+') ? `+${digits}` : toE164(countryCode || 'ET', digits);
    if (!e164.startsWith('+') && dial && digits.startsWith(dial)) {
      e164 = `+${digits}`;
    }
    const result = await onLookupPhone(e164);
    if (result === 'invited') {
      const body = encodeURIComponent(
        `Join me on Lony to track our loan together: https://lony.app — add your phone ${e164} after signup.`,
      );
      const url = `sms:${e164}?body=${body}`;
      try {
        await Linking.openURL(url);
      } catch {
        onError('Could not open Messages. Invite them with: ' + e164);
      }
    }
  }

  return (
    <View style={{ gap: space.md }}>
      <Pressable onPress={onBack}>
        <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 15 }}>Back</Text>
      </Pressable>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>New loan</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>
        {lockedPeer
          ? `Propose terms with ${lockedPeer.display_name}. They’ll accept before it goes live.`
          : 'Pick someone, or add from contacts. They’ll approve before the loan goes live.'}
      </Text>

      {!lockedPeer ? (
        <Card>
          <SectionLabel>With</SectionLabel>
          {friends.length === 0 ? (
            <EmptyState
              title="No one connected yet"
              body="Pull someone from your contacts. If they’re on Lony, you can propose a loan. If not, we’ll open a message to invite them."
            />
          ) : (
            friends.map((friend) => {
              const active = loanFriendId === friend.peer.id;
              return (
                <Pressable
                  key={friend.id}
                  onPress={() => onSelectFriend(friend.peer.id)}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: radii.md,
                    backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{friend.peer.display_name}</Text>
                  {friend.peer.username ? (
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>@{friend.peer.username}</Text>
                  ) : null}
                </Pressable>
              );
            })
          )}
          <SecondaryButton label={busy ? 'Working…' : 'Add from contacts'} onPress={pickContact} disabled={busy} />
          {selected ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
              Selected · {selected.peer.display_name}
            </Text>
          ) : null}
        </Card>
      ) : peerLabel ? (
        <Card>
          <SectionLabel>With</SectionLabel>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{peerLabel}</Text>
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Your role</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <RoleChip label="I borrow" active={loanRole === 'borrower'} onPress={() => onRole('borrower')} />
          <RoleChip label="I lend" active={loanRole === 'lender'} onPress={() => onRole('lender')} />
        </View>
        <SectionLabel>Terms</SectionLabel>
        <Field label="Principal" value={principal} onChange={onPrincipal} keyboardType="decimal-pad" />
        <Field label="Flat interest %" value={interest} onChange={onInterest} keyboardType="decimal-pad" />
        <SearchSelect label="Currency" value={currency} onChange={onCurrency} options={CURRENCIES} placeholder="Select currency" />
        <DateField label="Due date" value={dueDate} onChange={onDueDate} />
        <Field label="Note" value={note} onChange={onNote} />
        <PrimaryButton
          label={busy ? 'Working…' : 'Send for acceptance'}
          onPress={onCreate}
          disabled={busy || !loanFriendId || !currency || !principal}
        />
      </Card>
    </View>
  );
}

function RoleChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: radii.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? colors.primary : colors.surfaceMuted,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text style={{ color: active ? colors.onPrimary : colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}
