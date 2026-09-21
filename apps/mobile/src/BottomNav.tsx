import { Pressable, Text, View } from 'react-native';
import { fonts, radii, useTheme } from './theme';

export type TabId = 'dashboard' | 'loans' | 'chats' | 'banks' | 'activity';

type Props = {
  active: TabId;
  unread?: number;
  onChange: (tab: TabId) => void;
  onCreate: () => void;
};

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Home', icon: '⌂' },
  { id: 'loans', label: 'Loans', icon: '≡' },
  { id: 'chats', label: 'Chats', icon: '◎' },
  { id: 'banks', label: 'Banks', icon: '▤' },
  { id: 'activity', label: 'Inbox', icon: '◉' },
];

export function BottomNav({ active, unread = 0, onChange, onCreate }: Props) {
  const { colors } = useTheme();
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.nav,
        paddingBottom: 10,
        paddingTop: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 }}>
        {left.map((tab) => (
          <TabButton key={tab.id} tab={tab} active={active === tab.id} onPress={() => onChange(tab.id)} colors={colors} />
        ))}
        <View style={{ width: 70, alignItems: 'center', marginTop: -22 }}>
          <Pressable
            style={{
              width: 56,
              height: 56,
              borderRadius: radii.full,
              backgroundColor: colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 4,
              borderColor: colors.fabBorder,
            }}
            onPress={onCreate}
            accessibilityRole="button"
            accessibilityLabel="New loan"
          >
            <Text style={{ color: colors.onPrimary, fontSize: 28, fontFamily: fonts.uiBold, marginTop: -2 }}>+</Text>
          </Pressable>
        </View>
        {right.map((tab) => (
          <TabButton
            key={tab.id}
            tab={tab}
            active={active === tab.id}
            badge={tab.id === 'activity' && unread > 0 ? unread : undefined}
            onPress={() => onChange(tab.id)}
            colors={colors}
          />
        ))}
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
  tab: { id: TabId; label: string; icon: string };
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
    >
      <Text style={{ color: active ? colors.primary : colors.muted, fontSize: 16 }}>{tab.icon}</Text>
      <Text
        style={{
          color: active ? colors.primary : colors.muted,
          fontFamily: active ? fonts.uiSemi : fonts.uiMedium,
          fontSize: 11,
        }}
      >
        {tab.label}
      </Text>
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: '26%',
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
