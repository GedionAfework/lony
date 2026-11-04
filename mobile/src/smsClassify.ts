import { normalizeAmount, normalizeDigits } from './smsMoney';
import { explicitDirection, extractSmsStatedBalance, parseTransferSms, type ParsedSmsTransfer } from './smsParse';
import { hasPhrase } from './smsPhrases';

/**
 * Decides whether an SMS is real money that moved in one of your accounts.
 *
 *  - transaction: save it automatically.
 *  - review:      looks like money, but we are not sure (unknown sender, unclear wording,
 *                 a reversal or cashback). The user decides once.
 *  - ignore:      never money that moved: codes, failed/declined transfers, payment
 *                 requests and reminders, promotions, airtime/data notices.
 *
 * The server applies the same "ignore" rules (backend/api/internal/expenses/sms_classify.go).
 */
export type SmsVerdict = 'transaction' | 'review' | 'ignore';

export type SmsClassification = {
  verdict: SmsVerdict;
  /** Short reason shown to the user for review/ignore. */
  reason: string;
  parsed: ParsedSmsTransfer;
  /** Canonical bank/wallet name for a recognised sender ("127" → Telebirr). */
  senderInstitution: string | null;
};

const OTP_RE =
  /\b(?:otp|one[-\s]?time (?:password|code|pin)|verification code|pin code|security code|passcode|code de (?:v[ée]rification|confirmation)|c[óo]digo de (?:verificaci[óo]n|seguran[çc]a|acceso)|nambari ya siri)\b|do not share (?:this|your) (?:code|pin|otp)/i;

// Nothing moved (yet). Reversals are handled separately: money did come back.
const FAILED_RE =
  /\b(?:failed|unsuccessful|not successful|declined|denied|rejected|could not be (?:processed|completed)|was not (?:completed|processed|successful)|insufficient (?:funds|balance)|cancell?ed|timed out|expired)\b|imeshindikana|haikufanikiwa|አልተሳካም/i;

const REQUEST_RE =
  /\b(?:requested|is requesting|has requested|payment request|request(?:ing)? (?:to pay|money|payment|for)|pending (?:approval|confirmation|authori[sz]ation)|awaiting (?:approval|confirmation|payment)|will be (?:debited|charged|deducted|credited)|is due|due (?:on|date|today|tomorrow)|reminder|scheduled (?:for|on)|to approve|approve (?:this|the) (?:payment|request))\b/i;

const PROMO_RE =
  /\b(?:win|winner|won|congratulations|offer|discount|promo(?:tion)?|cash ?back offer|chance to|get up to|enjoy|free|bonus|reward points|loyalty|limited time|apply now|download|subscribe|unsubscribe|opt[- ]?out|stop to|reply)\b|\d+\s?% off|\*\d{2,4}(?:\*\d+)*#|https?:\/\/|www\./i;

const TELECOM_RE =
  /\b(?:airtime|data (?:bundle|package|balance)|bundle|internet package|voice package|sms package|night package|minutes? (?:package|balance)|mb|gb|recharge card|top[- ]?up card|your (?:airtime|data) balance)\b|\d+(?:\.\d+)?\s?(?:mb|gb)\b/i;

// What real transaction confirmations carry and adverts don't: a transaction number or
// reference, or the new balance (in the supported languages).
const RECEIPT_RE =
  /\b(?:transaction (?:number|no|id|ref)|txn|trx|ref(?:erence)?\s*(?:no|number|#|:)|confirmed|balance|avail(?:able)?\.?\s*bal|solde|saldo|bakiye|haftee|salio|haraag)|ቀሪ\s*ሂሳብ|ተረፍ|баланс|остаток|余额|رصيد|शेष|ব্যালেন্স|بیلنس/i;

const REVERSAL_RE = /\brevers(?:ed|al)\b|\brefund(?:ed)?\b|\bcharge ?back\b/i;
const CASHBACK_RE = /\bcash ?back\b|\bbonus\b|\breward\b/i;

/**
 * Sender IDs (as shown in the inbox) of banks and wallets, uppercase letters/digits only.
 * A message from one of these is trusted; anything else needs one-time approval.
 */
const KNOWN_SENDERS: [RegExp, string][] = [
  [/^127$/, 'Telebirr'],
  [/TELEBIRR/, 'Telebirr'],
  [/CBEBIRR/, 'CBE Birr'],
  [/^CBE|COMMERCIALBANK/, 'CBE'],
  [/AWASH/, 'Awash'],
  [/DASHEN/, 'Dashen'],
  [/ABYSSINIA|^BOA$|BANKOFABYSSINIA/, 'Abyssinia'],
  [/HIBRET|UNITEDBANK/, 'Hibret'],
  [/WEGAGEN/, 'Wegagen'],
  [/ZEMEN/, 'Zemen'],
  [/COOPBANK|COOPERATIVE|^COOP/, 'Coop'],
  [/^NIB|NIBBANK|NIBINTERNATIONAL/, 'Nib'],
  [/ENAT/, 'Enat'],
  [/BERHAN/, 'Berhan'],
  [/OROMIA|^OIB$/, 'Oromia'],
  [/AMHARABANK|^AMHARA/, 'Amhara'],
  [/TSEDEY/, 'Tsedey'],
  [/SIINQEE/, 'Siinqee'],
  [/ZAMZAM/, 'ZamZam'],
  [/HIJRA/, 'Hijra'],
  [/GADAA/, 'Gadaa'],
  [/BUNNA/, 'Bunna'],
  [/LIONBANK|^LIB$/, 'Lion'],
  [/AMOLE/, 'Amole'],
  [/HELLOCASH/, 'HelloCash'],
  [/MPESA/, 'M-Pesa'],
  [/AIRTELMONEY|AIRTEL/, 'Airtel Money'],
  [/MTNMOMO|MOMO/, 'MTN MoMo'],
  [/ORANGEMONEY/, 'Orange Money'],
  [/ECOCASH/, 'EcoCash'],
  [/TIGOPESA|MIXX/, 'Tigo Pesa'],
  [/OPAY/, 'OPay'],
  [/PALMPAY/, 'PalmPay'],
  [/GCASH/, 'GCash'],
  [/PAYTM/, 'Paytm'],
  [/BKASH/, 'bKash'],
  [/CHASE/, 'Chase'],
  [/WELLSFARGO/, 'Wells Fargo'],
  [/BANKOFAMERICA|^BOFA/, 'Bank of America'],
  [/CAPITALONE/, 'Capital One'],
  [/CITI/, 'Citi'],
  // Somalia
  [/EVCPLUS|HORMUUD/, 'EVC Plus'],
  [/ZAAD|TELESOM/, 'Zaad'],
  [/EDAHAB|SOMTEL/, 'eDahab'],
  // West Africa
  [/^WAVE/, 'Wave'],
  [/MOOVMONEY|FLOOZ/, 'Moov Money'],
  // Egypt, Gulf
  [/^CIB$|^NBE$|BANQUEMISR|BANKMISR/, 'Egyptian bank'],
  [/ALRAJHI|^SNB$|STCPAY|RIYADBANK/, 'Saudi bank'],
  [/EMIRATESNBD|^ADCB$|^FAB$|MASHREQ/, 'UAE bank'],
  // South Asia
  [/HDFCBK|HDFC|ICICIB|ICICI|SBIINB|SBIUPI|AXISBK|KOTAKB/, 'Indian bank'],
  [/BKASH/, 'bKash'],
  [/NAGAD/, 'Nagad'],
  [/JAZZCASH/, 'JazzCash'],
  [/EASYPAISA/, 'Easypaisa'],
  // Indonesia / Malaysia
  [/^BCA$|MANDIRI|^BNI$|^BRI$|BANKBRI/, 'Indonesian bank'],
  [/^DANA$|^OVO$|GOPAY/, 'Indonesian wallet'],
  [/MAYBANK|CIMB/, 'Malaysian bank'],
  // Turkey, Russia
  [/GARANTI|ISBANK|AKBANK|ZIRAAT|YAPIKREDI/, 'Turkish bank'],
  [/^900$|SBERBANK|TINKOFF|^VTB/, 'Russian bank'],
  // China
  [/^95588$|^95533$|^95599$|^95566$|^95555$/, 'Chinese bank'],
  [/ALIPAY|WECHATPAY/, 'Chinese wallet'],
  // Latin America, Europe
  [/NUBANK|^ITAU|BRADESCO|CAIXA|SANTANDER|^BBVA/, 'Bank'],
  [/SPARKASSE|DEUTSCHEBANK|COMMERZBANK|^N26$/, 'German bank'],
  [/INTESA|UNICREDIT|POSTEPAY/, 'Italian bank'],
];

/** Senders that are mobile-money wallets rather than bank accounts. */
const WALLET_SENDERS = new Set([
  'Telebirr', 'CBE Birr', 'Amole', 'HelloCash', 'M-Pesa', 'Airtel Money', 'MTN MoMo', 'Orange Money', 'EcoCash',
  'Tigo Pesa', 'OPay', 'PalmPay', 'GCash', 'Paytm', 'bKash', 'Nagad', 'JazzCash', 'Easypaisa', 'EVC Plus', 'Zaad',
  'eDahab', 'Wave', 'Moov Money', 'Indonesian wallet', 'Chinese wallet',
]);

/** Region-level names ("Indian bank") say the kind of sender, not which bank. */
const GENERIC_SENDER_NAME = /^(?:bank|.* bank|.* wallet)$/i;

export function normalizeSender(address?: string | null): string {
  return (address || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** A phone number is a person, never a bank sender. */
export function isPersonalNumber(address?: string | null): boolean {
  const digits = (address || '').replace(/\D/g, '');
  return digits.length >= 9 && /^[+\d\s()-]+$/.test((address || '').trim());
}

export function knownSenderInstitution(address?: string | null): string | null {
  const s = normalizeSender(address);
  if (!s) return null;
  for (const [re, name] of KNOWN_SENDERS) if (re.test(s)) return name;
  return null;
}

export function classifySms(
  body: string,
  sender?: string | null,
  trustedSenders?: ReadonlySet<string>,
): SmsClassification {
  const raw = normalizeDigits(body || '').trim();
  const parsed = parseTransferSms(raw);
  const known = knownSenderInstitution(sender);
  const userTrusted = Boolean(trustedSenders?.has(normalizeSender(sender)));
  const senderInstitution = known ?? (userTrusted ? sender || null : null);
  if (known && !GENERIC_SENDER_NAME.test(known)) {
    // The sender says whose account this is. "Sent to … telebirr" in a CBE message is still
    // CBE money, so the text never overrides a recognised sender.
    parsed.institutionHint = known;
    if (WALLET_SENDERS.has(known)) parsed.accountType = 'mobile_money';
    else if (parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet' || parsed.accountType === 'other') {
      parsed.accountType = 'bank';
    }
  } else if (senderInstitution && !parsed.institutionHint) {
    parsed.institutionHint = senderInstitution;
  }
  const out = (verdict: SmsVerdict, reason: string): SmsClassification => ({ verdict, reason, parsed, senderInstitution });

  if (raw.length < 20) return out('ignore', 'too short');
  // Banks never text from a personal phone number; "bank alerts" from one are scams or chat.
  if (sender && isPersonalNumber(sender) && !userTrusted) return out('ignore', 'sent from a personal number');
  if (OTP_RE.test(raw) || hasPhrase('otp', raw)) return out('ignore', 'security code');
  if ((FAILED_RE.test(raw) || hasPhrase('failed', raw)) && !REVERSAL_RE.test(raw)) return out('ignore', 'failed or declined');
  const explicit = explicitDirection(raw);
  // "has been debited … will be credited to the receiver" is still a real debit.
  if ((REQUEST_RE.test(raw) || hasPhrase('request', raw)) && !explicit) return out('ignore', 'request or reminder, no money moved');

  const walletOrBank =
    Boolean(senderInstitution) ||
    parsed.accountType === 'mobile_money' || parsed.accountType === 'wallet' || parsed.accountType === 'bank' || parsed.accountType === 'card';
  // "You have paid ETB 50 for airtime" from telebirr is real money; an airtime notice is not.
  if ((TELECOM_RE.test(raw) || hasPhrase('telecom', raw)) && !(explicit && walletOrBank && parsed.institutionHint)) {
    return out('ignore', 'airtime or data notice');
  }
  // "You have received a chance to win…" is an advert: promotional wording only passes with a receipt detail.
  // Banks put receipt links in real alerts, so a link from a known bank is not an advert by itself.
  const promoText = known ? raw.replace(/https?:\/\/\S+|www\.\S+/gi, ' ') : raw;
  if ((PROMO_RE.test(promoText) || hasPhrase('promo', promoText)) && !(explicit && RECEIPT_RE.test(raw))) {
    return out('ignore', 'promotion');
  }

  const trusted =
    Boolean(senderInstitution) ||
    // Bank named in the text and not sent from someone's phone number.
    (Boolean(parsed.institutionHint) && parsed.institutionHint !== 'Bank' && !isPersonalNumber(sender) && Boolean(sender));

  if (!parsed.amount || !parsed.kind) {
    // Safety net: a bank or wallet wrote about an amount in words we do not know (another
    // language or new wording). Ask the user instead of silently dropping it.
    const amount = parsed.amount || looseAmount(raw, parsed.statedBalance || extractSmsStatedBalance(raw));
    if (trusted && amount) {
      parsed.amount = amount;
      return out('review', parsed.kind ? 'amount found, please confirm' : "we couldn't read if money came in or went out");
    }
    if (trusted && (parsed.statedBalance || extractSmsStatedBalance(raw))) return out('ignore', 'balance notice');
    return out('ignore', 'no amount or direction');
  }
  if (!trusted) return out('review', 'unknown sender');
  if (REVERSAL_RE.test(raw)) return out('review', 'reversal or refund');
  if (CASHBACK_RE.test(raw)) return out('review', 'cashback or bonus');
  if (!explicit) return out('review', 'unclear if money came in or went out');
  if (explicit !== parsed.kind) parsed.kind = explicit;
  return out('transaction', 'transaction');
}

/**
 * The first money-looking figure that is not the stated balance: it has cents or
 * thousands separators, so phone numbers, years, codes and dates do not count.
 */
function looseAmount(raw: string, statedBalance: string | null): string | null {
  const re = /\d{1,3}(?:[,.\u00a0 ]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2}/g;
  for (const m of raw.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const before = raw[start - 1] || '';
    const after = raw.slice(end, end + 2);
    if (/[\d.,/:]/.test(before) || /^[.,/:]?\d/.test(after)) continue; // part of a date, time or longer number
    const amount = normalizeAmount(m[0]);
    if (amount && amount !== statedBalance) return amount;
  }
  return null;
}
