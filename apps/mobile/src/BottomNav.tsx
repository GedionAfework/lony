import { Pressable, Text, View } from 'react-native';
import { IconChat, IconHome, IconLoans, IconPlus } from './icons';
import { fonts, radii, useTheme } from './theme';

export type TabId = 'home' | 'loans' | 'chats';

type Props = {
  active: TabId;
  unread?: number;
  onChange: (tab: TabId) => void;
  onCreate?: () => void;
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'loans', label: 'Loans' },
  { id: 'chats', label: 'Chat' },
];

export function BottomNav({ active, unread = 0, onChange, onCreate }: Props) {
  const { colors, resolved } = useTheme();
  const glassBg = resolved === 'dark' ? 'rgba(18, 26, 43, 0.72)' : 'rgba(255, 255, 255, 0.72)';
  const glassBorder = resolved === 'dark' ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.08)';

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 12,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: radii.full,
          backgroundColor: glassBg,
          borderWidth: 1,
          borderColor: glassBorder,
          shadowColor: '#0F172A',
          shadowOpacity: resolved === 'dark' ? 0.35 : 0.12,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
          gap: 4,
        }}
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          const tint = isActive ? colors.primary : colors.muted;
          return (
            <Pressable
              key={tab.id}
              onPress={() => onChange(tab.id)}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              style={{
                width: 52,
                height: 44,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isActive ? colors.primarySoft : 'transparent',
                position: 'relative',
              }}
            >
              {tab.id === 'home' ? <IconHome size={20} color={tint} /> : null}
              {tab.id === 'loans' ? <IconLoans size={20} color={tint} /> : null}
              {tab.id === 'chats' ? <IconChat size={20} color={tint} /> : null}
              {tab.id === 'chats' && unread > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 10,
                    backgroundColor: colors.secondary,
                    borderRadius: radii.full,
                    minWidth: 14,
                    height: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 3,
                  }}
                >
                  <Text style={{ color: '#111', fontSize: 8, fontFamily: fonts.uiBold }}>
                    {unread > 9 ? '9+' : String(unread)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
        {onCreate ? (
          <Pressable
            onPress={onCreate}
            accessibilityRole="button"
            accessibilityLabel="New loan"
            style={{
              width: 44,
              height: 44,
              borderRadius: radii.full,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 4,
            }}
          >
            <IconPlus size={18} color={colors.onPrimary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
