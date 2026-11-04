package expenses

import "regexp"

// Server copy of the "never money that moved" rules in mobile/src/smsClassify.ts. The
// phone decides what to auto-save; the server refuses anything these rules reject
// unless the user confirmed it by hand, so a bad parse on the phone cannot create
// entries from codes, failed transfers, requests, promotions or airtime notices.

var (
	smsOTPRe = regexp.MustCompile(`(?i)\b(?:otp|one[-\s]?time (?:password|code|pin)|verification code|pin code|security code|passcode)\b|do not share (?:this|your) (?:code|pin|otp)`)

	smsFailedRe = regexp.MustCompile(`(?i)\b(?:failed|unsuccessful|not successful|declined|denied|rejected|could not be (?:processed|completed)|was not (?:completed|processed|successful)|insufficient (?:funds|balance)|cancell?ed|timed out|expired)\b|imeshindikana|haikufanikiwa|አልተሳካም`)

	smsRequestRe = regexp.MustCompile(`(?i)\b(?:requested|is requesting|has requested|payment request|request(?:ing)? (?:to pay|money|payment|for)|pending (?:approval|confirmation|authori[sz]ation)|awaiting (?:approval|confirmation|payment)|will be (?:debited|charged|deducted|credited)|is due|due (?:on|date|today|tomorrow)|reminder|scheduled (?:for|on)|to approve)\b`)

	smsPromoRe = regexp.MustCompile(`(?i)\b(?:win|winner|won|congratulations|offer|discount|promo(?:tion)?|chance to|get up to|enjoy|free|bonus|limited time|apply now|download|subscribe|unsubscribe)\b|\d+\s?% off|\*\d{2,4}(?:\*\d+)*#`)

	smsTelecomRe = regexp.MustCompile(`(?i)\b(?:airtime|data (?:bundle|package|balance)|bundle|internet package|voice package|sms package|recharge card|top[- ]?up card)\b|\d+(?:\.\d+)?\s?(?:mb|gb)\b`)

	// Real confirmations carry a transaction number/reference or the new balance; adverts don't.
	smsReceiptRe = regexp.MustCompile(`(?i)\b(?:transaction (?:number|no|id|ref)|txn|trx|ref(?:erence)?\s*(?:no|number|#|:)|confirmed|balance|avail(?:able)?\.?\s*bal|solde|saldo|bakiye|haftee|salio|haraag)|ቀሪ\s*ሂሳብ|ተረፍ|баланс|остаток|余额|رصيد|शेष|ব্যালেন্স|بیلنس`)

	smsReversalRe = regexp.MustCompile(`(?i)\brevers(?:ed|al)\b|\brefund(?:ed)?\b`)

	smsExplicitIncomeRe = regexp.MustCompile(`(?i)\byou have (?:received|been credited)\b|\b(?:account|a/c|acct|card|wallet)\b[^.]{0,40}\b(?:has been|was|is)\s+credited\b|\b(?:direct deposit|money received|payment received)\b|\b(?:credited|deposited)\s+(?:to|into|in)\s+your\s+(?:account|a/c|acct|card|wallet)\b|\bvous avez re[çc]u\b|\bumepokea\b|ተቀብለዋል`)

	smsExplicitExpenseRe = regexp.MustCompile(`(?i)\byou have (?:transfered|transferred|sent|paid|been debited|bought|purchased|recharged|topped up|withdrawn)\b|\b(?:account|a/c|acct|card|wallet)\b[^.]{0,40}\b(?:has been|was|is)\s+(?:debited|charged)\b|\b(?:sent|paid)\s+to\b|\bdebited\s+from\s+your\b|\bvous avez (?:envoy[ée]|pay[ée])\b|\bumetuma\b|\bumelipa\b|ከፍለዋል|ልከዋል|አስተላልፈዋል`)

	smsWalletOrBankRe = regexp.MustCompile(`(?i)ቴሌብር|\btele\s*birr\b|\bm-?pesa\b|\bbank\b|\bcbe\b|\bwallet\b|\baccount\b|\ba/c\b|\bcard\b`)
)

// SMSNotATransfer reports why a message is never money that moved, or "" when it may be.
func SMSNotATransfer(text string) string {
	text = normalizeSMSDigits(text)
	p := smsPhrases
	explicit := smsExplicitIncomeRe.MatchString(text) || smsExplicitExpenseRe.MatchString(text) ||
		p.in.MatchString(text) || p.out.MatchString(text)
	switch {
	case smsOTPRe.MatchString(text) || p.otp.MatchString(text):
		return "security code"
	case (smsFailedRe.MatchString(text) || p.failed.MatchString(text)) && !smsReversalRe.MatchString(text):
		return "failed or declined"
	case (smsRequestRe.MatchString(text) || p.request.MatchString(text)) && !explicit:
		return "request or reminder, no money moved"
	case (smsTelecomRe.MatchString(text) || p.telecom.MatchString(text)) && !(explicit && smsWalletOrBankRe.MatchString(text)):
		return "airtime or data notice"
	case (smsPromoRe.MatchString(text) || p.promo.MatchString(text)) && !(explicit && smsReceiptRe.MatchString(text)):
		return "promotion"
	}
	return ""
}
