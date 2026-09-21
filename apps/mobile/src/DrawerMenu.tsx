import { Modal, Pressable, Text, View } from 'react-native';
import { fonts, radii, space, useTheme } from './theme';

export type DrawerItem = 'expenses' | 'loans' | 'analytics' | 'plan' | 'settings';

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (item: DrawerItem) => void;
};

const ITEMS: { id: DrawerItem; label: string; hint: string }[] = [
  { id: 'expenses', label: 'Expenses', hint: 'Track spending' },
  { id: 'loans', label: 'Loans', hint: 'Shared ledgers' },
  { id: 'analytics', label: 'Analytics', hint: 'Reports & trends' },
  { id: 'plan', label: 'Plan', hint: 'Budgets & goals' },
  { id: 'settings', label: 'Settings', hint: 'Profile & prefs' },
];

export function DrawerMenu({ open, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View
          style={{
            width: '78%',
            maxWidth: 320,
            backgroundColor: colors.surface,
            paddingTop: space.xl,
            paddingHorizontal: space.md,
            paddingBottom: space.lg,
            gap: 4,
            borderRightWidth: 1,
            borderRightColor: colors.border,
          }}
        >
          <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12, letterSpacing: 1, marginBottom: 12 }}>
            MENU
          </Text>
          {ITEMS.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => {
                onSelect(item.id);
                onClose();
              }}
              style={{
                paddingVertical: 14,
                paddingHorizontal: 12,
                borderRadius: radii.md,
                gap: 2,
              }}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 17 }}>{item.label}</Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{item.hint}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
      </View>
    </Modal>
  );
}
