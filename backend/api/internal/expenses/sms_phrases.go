package expenses

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strings"
	"unicode"
)

// Non-English bank/wallet wording, the same table as mobile/src/smsPhrases.ts (a test
// fails if they differ). English rules are the regexes in sms_classify.go.

//go:embed sms_phrases.json
var smsPhrasesJSON []byte

type smsPhraseSet struct {
	Name    string   `json:"name"`
	In      []string `json:"in"`
	Out     []string `json:"out"`
	Failed  []string `json:"failed"`
	Request []string `json:"request"`
	Promo   []string `json:"promo"`
	OTP     []string `json:"otp"`
	Telecom []string `json:"telecom"`
}

type smsPhraseRegexes struct {
	in, out, failed, request, promo, otp, telecom *regexp.Regexp
}

var smsPhrases = loadSMSPhrases()

func loadSMSPhrases() smsPhraseRegexes {
	var sets map[string]smsPhraseSet
	if err := json.Unmarshal(smsPhrasesJSON, &sets); err != nil {
		panic("sms_phrases.json: " + err.Error())
	}
	pick := func(get func(smsPhraseSet) []string) *regexp.Regexp {
		var parts []string
		for _, set := range sets {
			for _, p := range get(set) {
				src := regexp.MustCompile(`\s+`).ReplaceAllString(regexp.QuoteMeta(strings.TrimSpace(p)), `\s+`)
				if needsWordEdges(p) {
					// RE2 has no lookarounds: the edge characters are consumed, which is fine for matching.
					src = `(?:^|[^\pL\pN])` + src + `(?:$|[^\pL\pN])`
				}
				parts = append(parts, src)
			}
		}
		return regexp.MustCompile(`(?i)` + strings.Join(parts, "|"))
	}
	return smsPhraseRegexes{
		in:      pick(func(s smsPhraseSet) []string { return s.In }),
		out:     pick(func(s smsPhraseSet) []string { return s.Out }),
		failed:  pick(func(s smsPhraseSet) []string { return s.Failed }),
		request: pick(func(s smsPhraseSet) []string { return s.Request }),
		promo:   pick(func(s smsPhraseSet) []string { return s.Promo }),
		otp:     pick(func(s smsPhraseSet) []string { return s.OTP }),
		telecom: pick(func(s smsPhraseSet) []string { return s.Telecom }),
	}
}

// Latin and Cyrillic phrases must stand as whole words; other scripts match anywhere.
func needsWordEdges(p string) bool {
	for _, r := range p {
		if unicode.IsLetter(r) && !unicode.In(r, unicode.Latin, unicode.Cyrillic) {
			return false
		}
	}
	return true
}

// normalizeSMSDigits turns Arabic-Indic, Persian, Devanagari and Bengali digits (and
// Arabic decimal/thousands marks) into the 0-9 . , the parser reads.
func normalizeSMSDigits(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case r == 0x066B:
			return '.'
		case r == 0x066C:
			return ','
		case r >= 0x0660 && r <= 0x0669:
			return '0' + (r - 0x0660)
		case r >= 0x06F0 && r <= 0x06F9:
			return '0' + (r - 0x06F0)
		case r >= 0x0966 && r <= 0x096F:
			return '0' + (r - 0x0966)
		case r >= 0x09E6 && r <= 0x09EF:
			return '0' + (r - 0x09E6)
		}
		return r
	}, s)
}
