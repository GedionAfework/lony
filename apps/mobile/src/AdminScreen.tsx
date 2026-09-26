import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, type AdminOverview } from './api';
import { t } from './i18n';
import { fonts, space, useTheme } from './theme';
import { Card, EmptyState, PrimaryButton, ScreenHeader } from './ui';

type Props = {
  token: string;
  locale?: string | null;
  onError?: (message: string) => void;
  onBack?: () => void;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  const { colors } = useTheme();
  return (
    <View style={{ minWidth: '42%', gap: 2, paddingVertical: 8 }}>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 20 }}>{value}</Text>
    </View>
  );
}

export function AdminScreen({ token, locale, onError, onBack }: Props) {
  const { colors } = useTheme();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [aiDisabled, setAiDisabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [ov, settings] = await Promise.all([
        api.adminOverview(token),
        api.adminGetSettings(token).catch(() => null),
      ]);
      setOverview(ov.overview);
      if (settings) setAiDisabled(Boolean(settings.settings?.ai_disabled));
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Admin unavailable');
    }
  }, [token, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggleAI() {
    setBusy(true);
    try {
      const res = await api.adminSetAI(token, !aiDisabled);
      setAiDisabled(Boolean(res.settings?.ai_disabled));
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not update AI setting');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.md }}>
      {onBack ? <ScreenHeader title={t(locale, 'admin')} onBack={onBack} /> : (
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
          {t(locale, 'admin')}
        </Text>
      )}
      {!overview ? (
        <Card>
          <EmptyState title="Loading…" body="Fetching platform KPIs." />
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
                {t(locale, 'adminOverview')}
              </Text>
              <Pressable onPress={() => void reload()} hitSlop={8}>
                <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
                  {t(locale, 'refresh')}
                </Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <Stat label="Total users" value={overview.total_users} />
              <Stat label="Active" value={overview.active_users} />
              <Stat label="Suspended" value={overview.suspended_users} />
              <Stat label="Signups 7d" value={overview.signups_7d} />
              <Stat label="DAU" value={overview.dau} />
              <Stat label="WAU" value={overview.wau} />
              <Stat label="Open loans" value={overview.open_loans} />
              <Stat label="Overdue" value={overview.overdue_loans} />
              <Stat label="Cashflow 7d" value={overview.cashflow_entries_7d} />
            </View>
          </Card>
          <Card>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>
              {t(locale, 'aiUsage')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <Stat label="Insights 7d" value={overview.ai_insights_7d} />
              <Stat label="Runs 7d" value={overview.ai_runs_7d} />
              <Stat label="AI users 7d" value={overview.ai_users_7d} />
              <Stat label="Tokens 7d" value={overview.ai_tokens_7d} />
              <Stat label="Requests today" value={overview.ai_requests_today} />
            </View>
            <PrimaryButton
              label={busy ? '…' : aiDisabled ? 'Enable AI' : 'Disable AI'}
              onPress={toggleAI}
              disabled={busy}
            />
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, marginTop: 6 }}>
              Global kill switch · currently {aiDisabled ? 'disabled' : 'enabled'}
            </Text>
          </Card>
        </>
      )}
    </View>
  );
}
