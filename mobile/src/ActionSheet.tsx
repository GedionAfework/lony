import { Modal, Pressable, Text, View } from 'react-native';
import { fonts, radii, useTheme } from './theme';

export type SheetAction = {
  label: string;
  /** "danger" paints the label red, for anything that removes data. */
  tone?: 'danger' | 'default';
  onPress: () => void;
};

export type SheetRequest = {
  title: string;
  message?: string;
  actions: SheetAction[];
};

/**
 * Lony's own bottom sheet for choices and confirmations, used instead of the
 * phone's system pop-up so it matches the app in light and dark mode.
 */
export function ActionSheet({ request, onClose, cancelLabel = 'Cancel' }: { request: SheetRequest | null; onClose: () => void; cancelLabel?: string }) {
  const { colors } = useTheme();
  return (
    <Modal visible={Boolean(request)} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => undefined}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 26,
            gap: 10,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 6 }} />
          {request ? (
            <>
              <View style={{ alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 4 }}>
                <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 17, textAlign: 'center' }}>{request.title}</Text>
                {request.message ? (
                  <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13.5, textAlign: 'center', lineHeight: 19 }}>{request.message}</Text>
                ) : null}
              </View>
              <View style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: colors.surfaceMuted }}>
                {request.actions.map((a, i) => (
                  <Pressable
                    key={a.label}
                    onPress={() => {
                      onClose();
                      a.onPress();
                    }}
                    style={({ pressed }) => ({
                      paddingVertical: 15,
                      alignItems: 'center',
                      backgroundColor: pressed ? colors.border : 'transparent',
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                    })}
                  >
                    <Text style={{ color: a.tone === 'danger' ? colors.error : colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{a.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => ({
                  paddingVertical: 15,
                  alignItems: 'center',
                  borderRadius: radii.lg,
                  backgroundColor: pressed ? colors.border : colors.surfaceMuted,
                })}
              >
                <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 16 }}>{cancelLabel}</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
