import { Pressable, Text, View } from 'react-native';
import { fonts, radii, useTheme } from './theme';

export type TabId = 'dashboard' | 'loans' | 'chats' | 'banks' | 'activity';

type Props = {
  active: TabId;
  unread?: number;
  onChange: (tab: TabId) => void;
  onCreate: () => void;
};

const TABS: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Home' },
  { id: 'loans', label: 'Loans' },
  { id: 'chats', label: 'Chats' },
  { id: 'banks', label: 'Banks' },
  { id: 'activity', label: 'Inbox' },
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
        paddingTop: 8,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 4 }}>
        {left.map((tab) => (
          <TabButton key={tab.id} tab={tab} active={active === tab.id} onPress={() => onChange(tab.id)} colors={colors} />
        ))}
        <View style={{ width: 70, alignItems: 'center', marginTop: -20 }}>
          <Pressable
            style={{
              width: 54,
              height: 54,
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
            <Text style={{ color: colors.onPrimary, fontSize: 26, fontFamily: fonts.uiBold, marginTop: -2 }}>+</Text>
          </Pressable>
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.uiMedium,
              fontSize: 10,
              marginTop: 2,
            }}
          >
            New
          </Text>
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
  tab: { id: TabId; label: string };
  active: boolean;
  badge?: number;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 48, position: 'relative' }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: active }}
    >
      <View
        style={{
          width: 28,
          height: 3,
          borderRadius: 2,
          backgroundColor: active ? colors.primary : 'transparent',
        }}
      />
      <Text
        style={{
          color: active ? colors.primary : colors.muted,
          fontFamily: active ? fonts.uiSemi : fonts.uiMedium,
          fontSize: 12,
        }}
      >
        {tab.label}
      </Text>
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: '18%',
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
