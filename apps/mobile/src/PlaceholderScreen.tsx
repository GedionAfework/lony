import { Text, View } from 'react-native';
import { fonts, space, useTheme } from './theme';
import { Card, ScreenHeader } from './ui';

type Props = {
  title: string;
  body: string;
  onBack?: () => void;
};

export function PlaceholderScreen({ title, body, onBack }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <ScreenHeader title={title} onBack={onBack} />
      <Card>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{title}</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, lineHeight: 20 }}>{body}</Text>
      </Card>
    </View>
  );
}
