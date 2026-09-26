import * as Contacts from 'expo-contacts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findNodeHandle,
  Linking,
  Pressable,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import type { Friendship, PeerTrust, SearchHit } from './api';
import { api } from './api';
import { formatAmountCommas, parseAmountNumber, stripAmount } from './amountFormat';
import { CURRENCIES } from './catalogs';
import { DateField } from './DateField';
import { IconBack, IconContact, IconSearch } from './icons';
import {
  INSTITUTION_TYPES,
  institutionsForType,
  resolveInstitutionLabel,
} from './institutions';
import { dialForCountry, toE164 } from './phone';
import { SearchSelect } from './SearchSelect';
import { fonts, radii, space, useTheme } from './theme';
import { Card, EmptyState, Field, PrimaryButton, SectionLabel } from './ui';

export type LoanKind = 'one_time' | 'long_term';
export type PartyMode = 'alone' | 'shared';

type Props = {
  token: string;
  friends: Friendship[];
  loanFriendId: string;
  lenderIds: string[];
  loanRole: 'borrower' | 'lender';
  loanKind: LoanKind;
  partyMode: PartyMode;
  principal: string;
  interest: string;
  currency: string;
  dueDate: string;
  interestPeriodMonths: string;
  installmentCount: string;
  institutionType: string;
  institutionId: string;
  institutionOther: string;
  startDate: string;
  note: string;
  loanTitle: string;
  busy: boolean;
  countryCode: string;
  lockedPeer?: { id: string; display_name: string } | null;
  onSelectFriend: (id: string) => void;
  onToggleLender: (id: string) => void;
  onRole: (role: 'borrower' | 'lender') => void;
  onLoanKind: (kind: LoanKind) => void;
  onPartyMode: (mode: PartyMode) => void;
  onPrincipal: (v: string) => void;
  onInterest: (v: string) => void;
  onCurrency: (v: string) => void;
  onDueDate: (v: string) => void;
  onInterestPeriodMonths: (v: string) => void;
  onInstallmentCount: (v: string) => void;
  onInstitutionType: (v: string) => void;
  onInstitutionId: (v: string) => void;
  onInstitutionOther: (v: string) => void;
  onStartDate: (v: string) => void;
  onNote: (v: string) => void;
  onLoanTitle: (v: string) => void;
  onBack: () => void;
  onCreate: () => void;
  onLookupPhone: (e164: string) => Promise<'selected' | 'invited' | 'pending' | 'error'>;
  onError: (message: string) => void;
  onFieldFocus?: (y: number) => void;
};

/** Reducing-balance EMI; mirrors apps/api ComputeEMI. */
export function computeMonthlyPayment(principal: number, annualRatePercent: number, months: number): number {
  if (!Number.isFinite(principal) || principal <= 0 || months < 1) return 0;
  if (!annualRatePercent || annualRatePercent <= 0) return round4(principal / months);
  const r = annualRatePercent / 100 / 12;
  const pow = Math.pow(1 + r, months);
  if (pow === 1) return round4(principal / months);
  return round4((principal * r * pow) / (pow - 1));
}

/** Full schedule totals matching apps/api BuildInstallmentSchedule. */
export function estimateLongTermSchedule(principal: number, annualRatePercent: number, months: number) {
  const emi = computeMonthlyPayment(principal, annualRatePercent, months);
  if (months < 1 || principal <= 0) {
    return { emi: 0, totalInterest: 0, totalPayable: 0 };
  }
  let balance = principal;
  const r = annualRatePercent > 0 ? annualRatePercent / 100 / 12 : 0;
  let totalInterest = 0;
  let totalPayable = 0;
  let payment = emi;
  for (let i = 1; i <= months; i++) {
    const interestPart = round4(balance * r);
    let principalPart = round4(payment - interestPart);
    if (i === months || principalPart > balance) {
      principalPart = balance;
      payment = round4(principalPart + interestPart);
    }
    if (principalPart < 0) principalPart = 0;
    totalInterest = round4(totalInterest + interestPart);
    totalPayable = round4(totalPayable + payment);
    balance = round4(balance - principalPart);
    if (balance < 0) balance = 0;
  }
  return { emi, totalInterest, totalPayable };
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

export function NewLoanScreen({
  token,
  friends,
  loanFriendId,
  lenderIds,
  loanRole,
  loanKind,
  partyMode,
  principal,
  interest,
  currency,
  dueDate,
  interestPeriodMonths,
  installmentCount,
  institutionType,
  institutionId,
  institutionOther,
  startDate,
  note,
  loanTitle,
  busy,
  countryCode,
  lockedPeer,
  onSelectFriend,
  onToggleLender,
  onRole,
  onLoanKind,
  onPartyMode,
  onPrincipal,
  onInterest,
  onCurrency,
  onDueDate,
  onInterestPeriodMonths,
  onInstallmentCount,
  onInstitutionType,
  onInstitutionId,
  onInstitutionOther,
  onStartDate,
  onNote,
  onLoanTitle,
  onBack,
  onCreate,
  onLookupPhone,
  onError,
  onFieldFocus,
}: Props) {
  const { colors } = useTheme();
  const rootRef = useRef<View>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [inviteHint, setInviteHint] = useState<string | null>(null);
  const [peerTrust, setPeerTrust] = useState<PeerTrust | null>(null);

  const selected = friends.find((f) => f.peer.id === loanFriendId);
  const peerLabel =
    lockedPeer?.display_name || selected?.peer.display_name || hits.find((h) => h.id === loanFriendId)?.display_name;
  const counterpartyId = lockedPeer?.id || loanFriendId;

  useEffect(() => {
    if (!counterpartyId || loanRole !== 'lender' || loanKind !== 'one_time') {
      setPeerTrust(null);
      return;
    }
    let cancelled = false;
    api
      .getPeerTrust(token, counterpartyId)
      .then((res) => {
        if (!cancelled) setPeerTrust(res.trust);
      })
      .catch(() => {
        if (!cancelled) setPeerTrust(null);
      });
    return () => {
      cancelled = true;
    };
  }, [counterpartyId, loanRole, loanKind, token]);

  const interestNum = parseAmountNumber(interest);
  const showInterestPeriod = loanKind === 'one_time' && interestNum > 0;
  const months = Math.max(0, Math.floor(Number(stripAmount(installmentCount)) || 0));
  const principalNum = parseAmountNumber(principal);
  const schedule =
    loanKind === 'long_term' && months >= 2 && principalNum > 0
      ? estimateLongTermSchedule(principalNum, interestNum, months)
      : { emi: 0, totalInterest: 0, totalPayable: 0 };
  const monthly = schedule.emi;
  const totalPayable = schedule.totalPayable;
  const totalInterest = schedule.totalInterest;

  const institutionOptions = useMemo(() => institutionsForType(institutionType || 'bank'), [institutionType]);
  const resolvedInstitution = resolveInstitutionLabel(institutionType, institutionId, institutionOther);
  const needsOther =
    !institutionId ||
    institutionId === 'other' ||
    institutionType === 'other' ||
    institutionType === 'person';
  const aloneOk = Boolean(resolvedInstitution.trim());
  const sharedLenders = lockedPeer ? [lockedPeer.id] : lenderIds;
  const sharedOk = sharedLenders.length >= 1;

  const friendMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => {
      const name = f.peer.display_name.toLowerCase();
      const user = (f.peer.username || '').toLowerCase();
      return name.includes(q) || user.includes(q);
    });
  }, [friends, query]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      api
        .searchUsers(token, q)
        .then((res) => {
          if (!cancelled) setHits(res.users ?? []);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, token]);

  function reportFocus(e: { target?: unknown } | unknown) {
    if (!onFieldFocus || !rootRef.current) return;
    const target = e && typeof e === 'object' && 'target' in e ? (e as { target?: unknown }).target : null;
    const handle = findNodeHandle(target as never);
    const rootHandle = findNodeHandle(rootRef.current);
    if (!handle || !rootHandle) return;
    UIManager.measureLayout(
      handle,
      rootHandle,
      () => {},
      (_x, y) => onFieldFocus(y),
    );
  }

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
    const dial = dialForCountry(countryCode || 'US');
    let e164 = raw.trim().startsWith('+') ? `+${digits}` : toE164(countryCode || 'US', digits);
    if (!e164.startsWith('+') && dial && digits.startsWith(dial)) {
      e164 = `+${digits}`;
    }
    const result = await onLookupPhone(e164);
    if (result === 'invited') {
      setInviteHint(`Invite sent to ${e164}. When they join with this number, your request will appear.`);
      const body = encodeURIComponent(
        `Join me on Lony to track our loan together: https://lony.app — add your phone ${e164} after signup.`,
      );
      try {
        await Linking.openURL(`sms:${e164}?body=${body}`);
      } catch {
        onError('Could not open Messages. Invite them with: ' + e164);
      }
    }
  }

  async function searchSubmit() {
    const q = query.trim();
    if (!q) return;
    if (q.startsWith('+') || /^\d{8,}$/.test(q.replace(/\D/g, ''))) {
      const digits = q.replace(/\D/g, '');
      const e164 = q.trim().startsWith('+') ? `+${digits}` : toE164(countryCode || 'US', digits);
      const result = await onLookupPhone(e164);
      if (result === 'invited') {
        setInviteHint(`Invite saved for ${e164}. It will sync when they create an account with this phone.`);
      }
    }
  }

  const remoteOnly = hits.filter((h) => !friends.some((f) => f.peer.id === h.id));
  const canSubmit =
    Boolean(currency && principalNum > 0) &&
    (loanKind === 'long_term'
      ? months >= 2 &&
        aloneOk &&
        institutionType.trim().length > 0 &&
        (partyMode === 'alone' ? true : sharedOk)
      : Boolean(loanFriendId) &&
        Boolean(dueDate) &&
        (!showInterestPeriod || Number(interestPeriodMonths) >= 1));

  const peerPicker = (
    <PeerPicker
      multi={loanKind === 'long_term' && partyMode === 'shared'}
      query={query}
      onQuery={setQuery}
      onSubmit={searchSubmit}
      onPickContact={pickContact}
      inviteHint={inviteHint}
      lenderIds={lenderIds}
      loanFriendId={loanFriendId}
      peerLabel={peerLabel}
      friends={friends}
      friendMatches={friendMatches}
      remoteOnly={remoteOnly}
      searching={searching}
      onSelectFriend={onSelectFriend}
      onToggleLender={onToggleLender}
    />
  );

  return (
    <View ref={rootRef} style={{ gap: space.md, paddingBottom: 160 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <IconBack size={18} color={colors.text} />
        </Pressable>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22, flex: 1 }}>New loan</Text>
      </View>

      <Card>
        <SectionLabel>Loan type</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <RoleChip label="One-time" active={loanKind === 'one_time'} onPress={() => onLoanKind('one_time')} />
          <RoleChip label="Long term" active={loanKind === 'long_term'} onPress={() => onLoanKind('long_term')} />
        </View>
      </Card>

      {loanKind === 'one_time' && !lockedPeer ? (
        <Card>
          <SectionLabel>With</SectionLabel>
          {peerPicker}
        </Card>
      ) : null}

      {lockedPeer && peerLabel ? (
        <Card>
          <SectionLabel>With</SectionLabel>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{peerLabel}</Text>
        </Card>
      ) : null}

      {peerTrust && loanRole === 'lender' ? (
        <Card>
          <SectionLabel>Their Lony Trust</SectionLabel>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 40 }}>{peerTrust.grade}</Text>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{peerTrust.band}</Text>
          </View>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
            {peerTrust.available
              ? `Repayment ${Math.round(peerTrust.repayment_score)}${
                  peerTrust.thin_history ? ' · limited history' : ''
                } · based on Lony activity only`
              : 'Not enough Lony activity to grade yet'}
          </Text>
        </Card>
      ) : null}

      {loanKind === 'long_term' ? (
        <Card>
          <SectionLabel>Lender type</SectionLabel>
          <SearchSelect
            label="Financial institution type"
            value={institutionType}
            onChange={(id) => {
              onInstitutionType(id);
              onInstitutionId('');
              onInstitutionOther('');
            }}
            options={INSTITUTION_TYPES}
            placeholder="Bank, SACCO, person…"
            showId={false}
          />
          {institutionType ? (
            <SearchSelect
              label="Institution"
              value={institutionId}
              onChange={onInstitutionId}
              options={institutionOptions}
              placeholder="Search institution"
              showId={false}
            />
          ) : null}
          {institutionType && needsOther ? (
            <Field
              label={institutionType === 'person' ? 'Person name' : 'Institution name'}
              value={institutionOther}
              onChange={onInstitutionOther}
              placeholder="Type the name"
              onFocus={reportFocus}
            />
          ) : null}

          <SectionLabel>Parties</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <RoleChip
              label="Alone"
              active={partyMode === 'alone'}
              onPress={() => onPartyMode('alone')}
            />
            <RoleChip
              label="With someone"
              active={partyMode === 'shared'}
              onPress={() => onPartyMode('shared')}
            />
          </View>
          {partyMode === 'shared' && !lockedPeer ? peerPicker : null}

          <Field
            label="Term (months)"
            value={installmentCount}
            onChange={(v) => onInstallmentCount(stripAmount(v).replace(/\./g, ''))}
            keyboardType="number-pad"
            placeholder="e.g. 60"
          />
          <DateField label="Start date" value={startDate} onChange={onStartDate} />
          {months >= 2 && principalNum > 0 ? (
            <View
              style={{
                marginTop: 4,
                padding: 12,
                borderRadius: radii.md,
                backgroundColor: colors.surfaceMuted,
                borderWidth: 1,
                borderColor: colors.border,
                gap: 4,
              }}
            >
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>Reducing-balance schedule</Text>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                {formatAmountCommas(monthly.toFixed(2))} {currency || ''}/mo
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                Interest {formatAmountCommas(totalInterest.toFixed(2))} · Total{' '}
                {formatAmountCommas(totalPayable.toFixed(2))}
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        {!(loanKind === 'long_term' && partyMode === 'alone') ? (
          <>
            <SectionLabel>Your role</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <RoleChip label="I borrow" active={loanRole === 'borrower'} onPress={() => onRole('borrower')} />
              <RoleChip label="I lend" active={loanRole === 'lender'} onPress={() => onRole('lender')} />
            </View>
          </>
        ) : null}
        <SectionLabel>Terms</SectionLabel>
        <Field
          label="Principal"
          value={principal}
          onChange={(v) => onPrincipal(formatAmountCommas(v))}
          keyboardType="decimal-pad"
          onFocus={reportFocus}
        />
        <Field
          label={loanKind === 'long_term' ? 'Annual interest %' : 'Flat interest %'}
          value={interest}
          onChange={(v) => onInterest(formatAmountCommas(v))}
          keyboardType="decimal-pad"
          onFocus={reportFocus}
        />
        {showInterestPeriod ? (
          <Field
            label="Interest period (months)"
            value={interestPeriodMonths}
            onChange={onInterestPeriodMonths}
            keyboardType="number-pad"
            placeholder="How long this rate applies"
            onFocus={reportFocus}
          />
        ) : null}
        <SearchSelect
          label="Currency"
          value={currency}
          onChange={onCurrency}
          options={CURRENCIES}
          placeholder="Select currency"
        />
        {loanKind === 'one_time' ? <DateField label="Due date" value={dueDate} onChange={onDueDate} /> : null}
        <Field label="Title" value={loanTitle} onChange={onLoanTitle} onFocus={reportFocus} />
        <Field label="Note" value={note} onChange={onNote} onFocus={reportFocus} />
        <PrimaryButton
          label={
            busy
              ? 'Working…'
              : loanKind === 'long_term' && partyMode === 'alone'
                ? 'Save debt schedule'
                : 'Send for acceptance'
          }
          onPress={onCreate}
          disabled={busy || !canSubmit}
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

type PeerPickerProps = {
  multi: boolean;
  query: string;
  onQuery: (v: string) => void;
  onSubmit: () => void;
  onPickContact: () => void;
  inviteHint: string | null;
  lenderIds: string[];
  loanFriendId: string;
  peerLabel?: string;
  friends: Friendship[];
  friendMatches: Friendship[];
  remoteOnly: SearchHit[];
  searching: boolean;
  onSelectFriend: (id: string) => void;
  onToggleLender: (id: string) => void;
};

function PeerPicker({
  multi,
  query,
  onQuery,
  onSubmit,
  onPickContact,
  inviteHint,
  lenderIds,
  loanFriendId,
  peerLabel,
  friends,
  friendMatches,
  remoteOnly,
  searching,
  onSelectFriend,
  onToggleLender,
}: PeerPickerProps) {
  const { colors } = useTheme();
  const [knownNames, setKnownNames] = useState<Record<string, string>>({});

  function remember(id: string, name: string) {
    setKnownNames((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }));
  }

  function selectOne(id: string, name: string) {
    remember(id, name);
    onSelectFriend(id);
  }

  function toggleOne(id: string, name: string) {
    remember(id, name);
    onToggleLender(id);
  }

  const selectedIds = multi ? lenderIds : loanFriendId ? [loanFriendId] : [];

  return (
    <>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: 48,
          borderRadius: 24,
          paddingLeft: 14,
          paddingRight: 6,
          backgroundColor: colors.surfaceMuted,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <IconSearch size={18} color={colors.muted} />
        <TextInput
          style={{ flex: 1, color: colors.text, fontFamily: fonts.ui, fontSize: 15, paddingVertical: 10 }}
          value={query}
          onChangeText={onQuery}
          placeholder={multi ? 'Search lenders to add' : 'Search friends, @username, or phone'}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          blurOnSubmit={false}
        />
        <Pressable
          onPress={onPickContact}
          accessibilityRole="button"
          accessibilityLabel="Pick from contacts"
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.primarySoft,
          }}
        >
          <IconContact size={18} color={colors.primary} />
        </Pressable>
      </View>

      {inviteHint ? (
        <Text style={{ color: colors.tertiary, fontFamily: fonts.ui, fontSize: 13 }}>{inviteHint}</Text>
      ) : null}

      {selectedIds.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, marginBottom: 4 }}>
          {selectedIds.map((id) => {
            const friend = friends.find((f) => f.peer.id === id);
            const hit = remoteOnly.find((h) => h.id === id);
            const name =
              friend?.peer.display_name ||
              hit?.display_name ||
              (id === loanFriendId ? peerLabel : undefined) ||
              knownNames[id] ||
              'Selected';
            const initial = name.slice(0, 1).toUpperCase();
            return (
              <Pressable
                key={id}
                onPress={() => (multi ? toggleOne(id, name) : onSelectFriend(''))}
                accessibilityLabel={`${name} selected`}
                style={{ width: 76, alignItems: 'center', gap: 6 }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.primarySoft,
                    borderWidth: 2,
                    borderColor: colors.primary,
                  }}
                >
                  <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 20 }}>{initial}</Text>
                </View>
                <Text
                  numberOfLines={2}
                  style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 12, textAlign: 'center', lineHeight: 15 }}
                >
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {friendMatches.length === 0 && remoteOnly.length === 0 && !searching ? (
        <EmptyState title="Find someone" body="Search by username or phone, or tap the contact icon." />
      ) : null}

      {friendMatches.map((friend) => {
        const active = multi ? lenderIds.includes(friend.peer.id) : loanFriendId === friend.peer.id;
        return (
          <Pressable
            key={friend.id}
            onPress={() =>
              multi
                ? toggleOne(friend.peer.id, friend.peer.display_name)
                : selectOne(friend.peer.id, friend.peer.display_name)
            }
            style={{
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: radii.md,
              backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
              marginBottom: 8,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface,
              }}
            >
              <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                {friend.peer.display_name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{friend.peer.display_name}</Text>
              {friend.peer.username ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>@{friend.peer.username}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {remoteOnly.map((hit) => {
        const active = multi ? lenderIds.includes(hit.id) : loanFriendId === hit.id;
        return (
          <Pressable
            key={hit.id}
            onPress={() => (multi ? toggleOne(hit.id, hit.display_name) : selectOne(hit.id, hit.display_name))}
            style={{
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: radii.md,
              backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
              marginBottom: 8,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surface,
              }}
            >
              <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                {hit.display_name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>{hit.display_name}</Text>
              {hit.username ? (
                <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>@{hit.username}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </>
  );
}
