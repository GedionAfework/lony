package llm

import "testing"

func TestAudioFileName(t *testing.T) {
	cases := map[string]string{
		"audio/webm;codecs=opus": "audio.webm", // Chrome and Edge
		"audio/webm":             "audio.webm",
		"audio/ogg; codecs=opus": "audio.ogg", // Firefox
		"audio/mp4":              "audio.m4a", // Safari, Android and iOS app
		"audio/mp4;codecs=mp4a":  "audio.m4a",
		"audio/wav":              "audio.wav",
		"":                       "audio.m4a",
	}
	for mime, want := range cases {
		if got := audioFileName(mime); got != want {
			t.Errorf("audioFileName(%q) = %q, want %q", mime, got, want)
		}
	}
}
