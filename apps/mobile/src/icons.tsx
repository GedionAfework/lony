import FontAwesome from '@expo/vector-icons/FontAwesome';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import type { ViewStyle } from 'react-native';
import { useTheme } from './theme';

type IconProps = {
  size?: number;
  color?: string;
  style?: ViewStyle;
};

function useIconColor(color?: string) {
  const { colors } = useTheme();
  return color ?? colors.text;
}

export function IconHome({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="home" size={size} color={useIconColor(color)} style={style} />;
}

export function IconLoans({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="exchange" size={size} color={useIconColor(color)} style={style} />;
}

export function IconChat({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="comments" size={size} color={useIconColor(color)} style={style} />;
}

export function IconMenu({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="bars" size={size} color={useIconColor(color)} style={style} />;
}

export function IconSun({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="sun-o" size={size} color={useIconColor(color)} style={style} />;
}

export function IconMoon({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="moon-o" size={size} color={useIconColor(color)} style={style} />;
}

export function IconGoogle({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="google" size={size} color={useIconColor(color)} style={style} />;
}

export function IconTelegram({ size = 22, color, style }: IconProps) {
  return <FontAwesome5 name="telegram-plane" size={size} color={useIconColor(color)} style={style} />;
}

export function IconSearch({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="search" size={size} color={useIconColor(color)} style={style} />;
}

export function IconPlus({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  return <FontAwesome name="plus" size={size} color={color ?? colors.onPrimary} style={style} />;
}

export function IconBack({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="chevron-left" size={size} color={useIconColor(color)} style={style} />;
}

export function IconSend({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  // Filled up-circle — deliberately not Telegram's paper-plane.
  return <FontAwesome name="arrow-circle-up" size={size} color={color ?? colors.onPrimary} style={style} />;
}

export function IconAnalytics({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="bar-chart" size={size} color={useIconColor(color)} style={style} />;
}

export function IconMic({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="microphone" size={size} color={useIconColor(color)} style={style} />;
}

export function IconAttach({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="paperclip" size={size} color={useIconColor(color)} style={style} />;
}

export function IconEmoji({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="smile-o" size={size} color={useIconColor(color)} style={style} />;
}

export function IconContact({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="address-book" size={size} color={useIconColor(color)} style={style} />;
}

export function IconBank({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="university" size={size} color={useIconColor(color)} style={style} />;
}

export function IconEdit({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="pencil" size={size} color={useIconColor(color)} style={style} />;
}

export function IconTrash({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="trash-o" size={size} color={useIconColor(color)} style={style} />;
}

export function IconRepeat({ size = 22, color, style }: IconProps) {
  return <FontAwesome name="refresh" size={size} color={useIconColor(color)} style={style} />;
}
