/** Web stub — voice notes are native-only for now. */

export const RecordingPresets = {
  HIGH_QUALITY: {},
};

type StubRecorder = {
  uri: string | null;
  prepareToRecordAsync: (preset?: unknown) => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
};

export function useAudioRecorder(_preset?: unknown): StubRecorder {
  return {
    uri: null,
    prepareToRecordAsync: async () => undefined,
    record: () => undefined,
    stop: async () => undefined,
  };
}

export function useAudioRecorderState(_recorder: StubRecorder, _interval?: number) {
  return { isRecording: false, durationMillis: 0 };
}

export const AudioModule = {
  requestRecordingPermissionsAsync: async () => ({ granted: false, status: 'denied' as const }),
};

export async function setAudioModeAsync(_opts?: unknown): Promise<void> {
  return undefined;
}

export function createAudioPlayer(_source: unknown) {
  return {
    play: () => undefined,
    pause: () => undefined,
    remove: () => undefined,
  };
}
