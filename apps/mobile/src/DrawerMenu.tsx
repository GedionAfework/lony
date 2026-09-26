import { Modal, Pressable, Text, View } from 'react-native';
import { t } from './i18n';
import { fonts, radii, space, useTheme } from './theme';

export type DrawerItem = 'expenses' | 'accounts' | 'loans' | 'analytics' | 'plan' | 'settings';

type Props = {
  open: boolean;
  active?: DrawerItem | null;
  locale?: string | null;
  onClose: () => void;
  onSelect: (item: DrawerItem) => void;
};

const ITEM_KEYS: { id: DrawerItem; key: 'expenses' | 'accounts' | 'loans' | 'insights' | 'plan' | 'settings' }[] = [
  { id: 'expenses', key: 'expenses' },
  { id: 'accounts', key: 'accounts' },
  { id: 'loans', key: 'loans' },
  { id: 'analytics', key: 'insights' },
  { id: 'plan', key: 'plan' },
  { id: 'settings', key: 'settings' },
];

export function DrawerMenu({ open, active, locale, onClose, onSelect }: Props) {
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
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.uiSemi,
              fontSize: 12,
              letterSpacing: 1,
              marginBottom: 12,
            }}
          >
            {t(locale, 'menu')}
          </Text>
          {ITEM_KEYS.map((item) => {
            const selected = active === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  onSelect(item.id);
                  onClose();
                }}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  borderRadius: radii.md,
                  backgroundColor: selected ? colors.primarySoft : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: selected ? colors.primary : colors.text,
                    fontFamily: fonts.uiSemi,
                    fontSize: 17,
                  }}
                >
                  {t(locale, item.key)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={{ flex: 1, backgroundColor: colors.overlay }} onPress={onClose} />
      </View>
    </Modal>
  );
}
