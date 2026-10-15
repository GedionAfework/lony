import { Text, View } from 'react-native';
import { fonts, space, useTheme } from './theme';
import { Card, EmptyState } from './ui';

type Props = {
  title: string;
  emptyTitle: string;
  emptyBody: string;
};

export function PlaceholderScreen({ title, emptyTitle, emptyBody }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>{title}</Text>
      <Card>
        <EmptyState title={emptyTitle} body={emptyBody} />
      </Card>
    </View>
  );
}
