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
            paddingTop: space.xl + 8,
            paddingHorizontal: space.md,
            paddingBottom: space.lg,
            gap: 6,
            borderRightWidth: 1,
            borderRightColor: colors.border,
            shadowColor: '#0F172A',
            shadowOpacity: 0.12,
            shadowRadius: 24,
            shadowOffset: { width: 4, height: 0 },
            elevation: 8,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontFamily: fonts.uiBold,
              fontSize: 22,
              marginBottom: 4,
              letterSpacing: -0.3,
            }}
          >
            Lony
          </Text>
          <Text
            style={{
              color: colors.muted,
              fontFamily: fonts.uiSemi,
              fontSize: 11,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              marginBottom: 16,
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
                  borderWidth: selected ? 1 : 0,
                  borderColor: selected ? colors.primary : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: selected ? colors.primary : colors.text,
                    fontFamily: fonts.uiSemi,
                    fontSize: 16,
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
