import { EncodingType, readAsStringAsync } from 'expo-file-system/legacy';
import { useRef, useState } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from './audioChat';
import { api } from './api';
import { IconMic } from './icons';
import { t } from './i18n';
import { fonts, useTheme } from './theme';

export type VoiceDraft = {
  kind?: 'income' | 'expense';
  title?: string;
  amount?: string;
  currency_code?: string;
  note?: string;
  occurred_at?: string;
  category_id?: string;
  account_id?: string;
  account_hint?: string;
  category_hint?: string;
  transcript?: string;
};

type Props = {
  token: string;
  locale?: string | null;
  disabled?: boolean;
  onDraft: (draft: VoiceDraft) => void;
  onError: (message: string) => void;
};

export function VoiceAddButton({ token, locale, disabled, onDraft, onError }: Props) {
  const { colors } = useTheme();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder, 200);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);
  const recording = recorderState.isRecording;

  async function toggle() {
    if (disabled || busy) return;
    if (Platform.OS === 'web') {
      onError(t(locale, 'voice.nativeOnly'));
      return;
    }
    try {
      if (recording || audioRecorder.isRecording) {
        await audioRecorder.stop();
        let uri = audioRecorder.uri;
        for (let i = 0; !uri && i < 8; i++) {
          await new Promise((r) => setTimeout(r, 40));
          uri = audioRecorder.uri;
        }
        if (!uri) {
          onError(t(locale, 'voice.noAudio'));
          return;
        }
        setBusy(true);
        const b64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
        if (!b64) {
          setBusy(false);
          onError(t(locale, 'voice.noAudio'));
          return;
        }
        const res = await api.parseCashflowVoice(token, { mime: 'audio/mp4', audio_base64: b64 });
        const ex = res.extract || {};
        onDraft({
          kind: ex.kind === 'income' ? 'income' : ex.kind === 'expense' ? 'expense' : undefined,
          title: ex.title,
          amount: ex.amount,
          currency_code: ex.currency_code,
          note: ex.note,
          occurred_at: ex.occurred_at,
          category_id: ex.category_id,
          account_id: ex.account_id,
          account_hint: ex.account_hint,
          category_hint: ex.category_hint,
          transcript: ex.transcript,
        });
        setBusy(false);
        return;
      }
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError(t(locale, 'voice.needMic'));
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      audioRecorder.record();
      startedAt.current = Date.now();
    } catch (e) {
      setBusy(false);
      onError(e instanceof Error ? e.message : t(locale, 'voice.failed'));
    }
  }

  const label = busy
    ? t(locale, 'voice.listening')
    : recording
      ? t(locale, 'voice.stop')
      : t(locale, 'voice.sayIt');

  return (
    <Pressable
      onPress={() => void toggle()}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        minHeight: 42,
        paddingHorizontal: 12,
        borderRadius: 21,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: recording ? colors.errorSoft : colors.primarySoft,
      }}
    >
      <IconMic size={16} color={recording ? colors.error : colors.primary} />
      <Text style={{ color: recording ? colors.error : colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}
