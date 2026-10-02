import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { t } from './i18n';
import { fonts, radii, space, useTheme } from './theme';
import { PrimaryButton } from './ui';

const GRADES: { grade: string; titleKey: string; bodyKey: string; title: string; body: string }[] = [
  {
    grade: 'A',
    titleKey: 'trust.gradeATitle',
    bodyKey: 'trust.gradeABody',
    title: 'Excellent',
    body: 'Strong repayment history, healthy balances, and steady cashflow on Lony. Peers can lend with high confidence.',
  },
  {
    grade: 'B',
    titleKey: 'trust.gradeBTitle',
    bodyKey: 'trust.gradeBBody',
    title: 'Good',
    body: 'Reliable overall. A few gaps or thinner history, but activity looks solid for peer lending.',
  },
  {
    grade: 'C',
    titleKey: 'trust.gradeCTitle',
    bodyKey: 'trust.gradeCBody',
    title: 'Fair',
    body: 'Mixed signals — some repayment or liquidity pressure. Keep confirming income and paying on time to improve.',
  },
  {
    grade: 'D',
    titleKey: 'trust.gradeDTitle',
    bodyKey: 'trust.gradeDBody',
    title: 'Weak',
    body: 'Higher risk from missed patterns, thin history, or tight cash. Focus on clearing dues and building a buffer.',
  },
  {
    grade: 'E',
    titleKey: 'trust.gradeETitle',
    bodyKey: 'trust.gradeEBody',
    title: 'At risk',
    body: 'Low trust based on current Lony activity. Rebuild with consistent repayments and clearer cashflow tracking.',
  },
];

type Props = {
  visible: boolean;
  grade?: string | null;
  onClose: () => void;
  locale?: string | null;
};

/** Explains what each Lony Trust grade means. */
export function TrustGradeModal({ visible, grade, onClose, locale }: Props) {
  const { colors } = useTheme();
  const highlight = (grade || '').toUpperCase();
  const loc = locale || 'en';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            padding: space.lg,
            maxHeight: '78%',
            gap: space.md,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 20 }}>
            {highlight
              ? (t(loc, 'trust.youAreGrade') || 'You are grade {grade} in Lony Trust').replace(
                  '{grade}',
                  highlight,
                )
              : t(loc, 'trust.gradesTitle') || 'Lony Trust grades'}
          </Text>
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
            {t(loc, 'trust.gradesIntro') ||
              'Grades summarize how you use Lony — repayments, debt load, consistency, liquidity, savings, and goals.'}
          </Text>
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 10 }}>
            {GRADES.map((g) => {
              const active = g.grade === highlight;
              return (
                <View
                  key={g.grade}
                  style={{
                    flexDirection: 'row',
                    gap: 12,
                    padding: 12,
                    borderRadius: radii.md,
                    backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color: active ? colors.primary : colors.text,
                      fontFamily: fonts.uiBold,
                      fontSize: 28,
                      width: 36,
                    }}
                  >
                    {g.grade}
                  </Text>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
                      {t(loc, g.titleKey) || g.title}
                    </Text>
                    <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>
                      {t(loc, g.bodyKey) || g.body}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <PrimaryButton label={t(loc, 'common.done') || 'Got it'} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
