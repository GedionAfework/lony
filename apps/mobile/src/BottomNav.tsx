import { Pressable, Text, View } from 'react-native';
import { IconChat, IconHome, IconLoans } from './icons';
import { fonts, radii, useTheme } from './theme';

export type TabId = 'home' | 'loans' | 'chats';

type Props = {
  active: TabId;
  unread?: number;
  onChange: (tab: TabId) => void;
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'loans', label: 'Loans' },
  { id: 'chats', label: 'Chat' },
];

export function BottomNav({ active, unread = 0, onChange }: Props) {
  const { colors, resolved } = useTheme();
  const glassBg = resolved === 'dark' ? 'rgba(18, 26, 43, 0.88)' : 'rgba(255, 255, 255, 0.92)';
  const glassBorder = resolved === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.06)';

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 16,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-around',
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: radii.full,
          backgroundColor: glassBg,
          borderWidth: 1,
          borderColor: glassBorder,
          shadowColor: '#0F172A',
          shadowOpacity: resolved === 'dark' ? 0.4 : 0.1,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 10 },
          elevation: 12,
          minWidth: 260,
          maxWidth: 340,
          width: '100%',
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
                flex: 1,
                maxWidth: 88,
                height: 52,
                borderRadius: radii.full,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                backgroundColor: isActive ? colors.primarySoft : 'transparent',
                position: 'relative',
              }}
            >
              {tab.id === 'home' ? <IconHome size={20} color={tint} /> : null}
              {tab.id === 'loans' ? <IconLoans size={20} color={tint} /> : null}
              {tab.id === 'chats' ? <IconChat size={20} color={tint} /> : null}
              <Text
                style={{
                  color: tint,
                  fontSize: 10,
                  fontFamily: isActive ? fonts.uiSemi : fonts.ui,
                }}
              >
                {tab.label}
              </Text>
              {tab.id === 'chats' && unread > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 18,
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
      </View>
    </View>
  );
}
