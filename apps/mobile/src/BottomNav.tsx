import { Pressable, Text, View } from 'react-native';
import { fonts, radii, useTheme } from './theme';

export type TabId = 'home' | 'loans' | 'chats';

type Props = {
  active: TabId;
  unread?: number;
  onChange: (tab: TabId) => void;
  onCreate?: () => void;
};

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'loans', icon: '⇄', label: 'Loans' },
  { id: 'chats', icon: '💬', label: 'Chat' },
];

export function BottomNav({ active, unread = 0, onChange, onCreate }: Props) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.nav,
        paddingBottom: 10,
        paddingTop: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>
        {TABS.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={active === tab.id}
            badge={tab.id === 'chats' && unread > 0 ? unread : undefined}
            onPress={() => onChange(tab.id)}
            colors={colors}
          />
        ))}
        {onCreate ? (
          <Pressable
            style={{
              width: 48,
              height: 48,
              borderRadius: radii.full,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              marginHorizontal: 6,
            }}
            onPress={onCreate}
            accessibilityRole="button"
            accessibilityLabel="New loan"
          >
            <Text style={{ color: colors.onPrimary, fontSize: 24, fontFamily: fonts.uiBold, marginTop: -2 }}>+</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TabButton({
  tab,
  active,
  badge,
  onPress,
  colors,
}: {
  tab: { id: TabId; icon: string; label: string };
  active: boolean;
  badge?: number;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 48, position: 'relative' }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
    >
      <Text style={{ fontSize: 22, opacity: active ? 1 : 0.55 }}>{tab.icon}</Text>
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: '22%',
            backgroundColor: colors.secondary,
            borderRadius: radii.full,
            minWidth: 16,
            height: 16,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 3,
          }}
        >
          <Text style={{ color: '#111', fontSize: 9, fontFamily: fonts.uiBold }}>{badge > 9 ? '9+' : String(badge)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
