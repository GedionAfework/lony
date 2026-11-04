/**
 * Bank / wallet SMS wording per language, for languages other than English (English
 * rules live in smsParse.ts / smsClassify.ts as tuned regexes).
 *
 *   in       money arrived in YOUR account   ("you have received", "credited")
 *   out      money left YOUR account         ("you have sent / paid", "debited")
 *   failed   nothing moved                   ("failed", "declined", "insufficient balance")
 *   request  nothing moved yet               (payment requests, reminders, "due")
 *   promo    advertising                     ("win", "offer", "discount")
 *   otp      security codes
 *   telecom  airtime / data notices from the phone company
 *
 * Matching is case-insensitive. Latin/Cyrillic phrases must stand as whole words; other
 * scripts match anywhere. To add a language, add a block — nothing else changes.
 *
 * The server embeds the same JSON (backend/api/internal/expenses/sms_phrases.json); a Go
 * test fails if the two differ. Keep the block between the markers valid JSON.
 */
export type SmsPhraseSet = {
  name: string;
  in: string[];
  out: string[];
  failed: string[];
  request: string[];
  promo: string[];
  otp: string[];
  telecom: string[];
};

export const SMS_PHRASES: Record<string, SmsPhraseSet> =
/* PHRASES-JSON-START */
{
  "am": {
    "name": "Amharic",
    "in": ["ተቀብለዋል", "ገቢ ተደርጓል", "ገቢ ሆኗል", "ገቢ ተደርጎልዎታል", "ተልኮልዎታል"],
    "out": ["ከፍለዋል", "ልከዋል", "አስተላልፈዋል", "ወጪ ተደርጓል", "ገዝተዋል", "ተቀንሷል", "ወጪ ሆኗል"],
    "failed": ["አልተሳካም", "አልተሳካ", "ውድቅ ተደርጓል", "በቂ ቀሪ ሂሳብ የለዎትም", "ተሰርዟል"],
    "request": ["ጠይቀዋል", "የክፍያ ጥያቄ", "ማስታወሻ", "ያስታውሱ"],
    "promo": ["ያሸንፉ", "ሽልማት", "ቅናሽ", "ዕድል", "በነጻ", "ቦነስ", "ይሸለሙ"],
    "otp": ["የማረጋገጫ ኮድ", "ሚስጥራዊ ቁጥር", "ለማንም አያጋሩ"],
    "telecom": ["የአየር ሰዓት", "ጥቅል", "ኢንተርኔት", "ሜጋባይት", "ደቂቃ"]
  },
  "om": {
    "name": "Afaan Oromo",
    "in": ["argattaniittu", "argatteetta", "argattaniitu", "galmaa'eera", "galii ta'eera", "isiniif ergameera", "isinii ergameera", "seeneera"],
    "out": ["ergitaniittu", "ergiteetta", "ergitaniitu", "kaffaltaniittu", "kaffalteetta", "dabarsitaniittu", "baasii ta'eera", "hir'ateera", "bittaniittu"],
    "failed": ["hin milkoofne", "hin milkaa'ne", "kufeera", "haqameera", "gahaa miti"],
    "request": ["gaafateera", "gaaffii kaffaltii", "yaadachiisa"],
    "promo": ["mo'adhaa", "badhaasa", "hir'ina gatii", "carraa", "bilisaan", "boonasii"],
    "otp": ["koodii mirkaneessaa", "lakkoofsa iccitii", "nama biraaf hin qoodinaa"],
    "telecom": ["yeroo bilbilaa", "paakeejii", "interneetii"]
  },
  "ti": {
    "name": "Tigrinya",
    "in": ["ተቐቢልኩም", "ተቐቢልካ", "ተቐቢልኪ", "ተላኢኹልኩም", "ኣትዩ"],
    "out": ["ሰዲድኩም", "ሰዲድካ", "ከፊልኩም", "ከፊልካ", "ኣሕሊፍኩም", "ተጎዲሉ"],
    "failed": ["ኣይተዓወተን", "ኣይሰለጠን", "ፈሺሉ", "ተሰሪዙ"],
    "request": ["ሓቲቱ", "ናይ ክፍሊት ሕቶ", "መዘኻኸሪ"],
    "promo": ["ተዓወቱ", "ሽልማት", "ቅናሽ", "ዕድል", "ብናጻ", "ቦነስ"],
    "otp": ["ናይ መረጋገጺ ኮድ", "ምስጢራዊ ቁጽሪ"],
    "telecom": ["ናይ ኣየር ሰዓት", "ጥቕሊ", "ኢንተርነት"]
  },
  "so": {
    "name": "Somali",
    "in": ["waxaad heshay", "waad heshay", "ka heshay", "ayaad ka heshay", "laguu soo diray", "lagu shubay", "waxaa lagu soo shubay"],
    "out": ["waxaad u dirtay", "waad u dirtay", "ayaad u dirtay", "u dirtay", "waxaad bixisay", "waad bixisay", "ayaad bixisay", "waxaad iibsatay", "waxaad ka qaadatay", "laga jaray"],
    "failed": ["ma guulaysan", "ma guuleysan", "fashilmay", "haraagaagu kuguma filna", "waa la diiday"],
    "request": ["kaa codsaday", "codsi lacag", "xasuusin"],
    "promo": ["ku guuleyso", "abaalmarin", "qiimo dhimis", "fursad", "bilaash", "dalab"],
    "otp": ["koodka xaqiijinta", "lambarka sirta", "cidna lala wadaagin"],
    "telecom": ["xirmada internetka", "daqiiqo hadal"]
  },
  "ar": {
    "name": "Arabic",
    "in": ["تم إيداع", "تم ايداع", "استلمت", "تم استلام", "أضيف إلى حسابك", "اضيف الى حسابك", "تمت إضافة", "حوالة واردة", "وصلتك حوالة"],
    "out": ["تم خصم", "تم سحب", "قمت بتحويل", "تم تحويل", "تم الدفع", "دفعت", "عملية شراء", "حوالة صادرة", "شراء بمبلغ"],
    "failed": ["فشلت", "فشل", "مرفوضة", "تم رفض", "غير ناجحة", "رصيد غير كاف", "الرصيد غير كافي", "تم إلغاء"],
    "request": ["يطلب منك", "طلب دفع", "تذكير", "مستحق", "بانتظار"],
    "promo": ["اربح", "فز", "عرض خاص", "جائزة", "مجانا", "مجاناً", "تخفيض", "استمتع"],
    "otp": ["رمز التحقق", "كلمة المرور لمرة واحدة", "رمز التفعيل", "لا تشارك"],
    "telecom": ["رصيد المكالمات", "باقة", "انترنت", "إنترنت", "ميجا", "جيجا", "شحن رصيد"]
  },
  "fr": {
    "name": "French",
    "in": ["vous avez reçu", "vous avez recu", "a été crédité", "a ete credite", "crédité sur votre", "versement reçu", "virement reçu", "dépôt de"],
    "out": ["vous avez envoyé", "vous avez envoye", "vous avez payé", "vous avez paye", "vous avez transféré", "a été débité", "a ete debite", "débité de votre", "retrait de", "paiement de", "achat de"],
    "failed": ["échoué", "echoue", "échec", "refusé", "refusée", "annulé", "annulée", "solde insuffisant", "n'a pas abouti"],
    "request": ["demande de paiement", "vous demande", "rappel", "en attente", "sera débité", "échéance"],
    "promo": ["gagnez", "gagner", "offre", "promo", "bonus", "remise", "réduction", "gratuit", "profitez"],
    "otp": ["code de vérification", "code de confirmation", "code secret", "mot de passe à usage unique", "ne partagez"],
    "telecom": ["crédit d'appel", "forfait internet", "forfait appel", "mo de données", "go de données"]
  },
  "es": {
    "name": "Spanish",
    "in": ["has recibido", "recibiste", "se acreditó", "se ha acreditado", "abono de", "depósito recibido", "te enviaron", "te transfirieron"],
    "out": ["has enviado", "enviaste", "has pagado", "pagaste", "se debitó", "se ha debitado", "cargo de", "compra por", "compra de", "retiro de", "transferiste"],
    "failed": ["rechazada", "rechazado", "fallida", "fallido", "no se pudo", "fondos insuficientes", "saldo insuficiente", "cancelada"],
    "request": ["te solicita", "solicitud de pago", "recordatorio", "pendiente", "vence"],
    "promo": ["gana", "ganar", "oferta", "promoción", "descuento", "gratis", "aprovecha", "bono"],
    "otp": ["código de verificación", "código de seguridad", "clave dinámica", "no compartas"],
    "telecom": ["recarga de saldo", "paquete de datos", "megas", "minutos"]
  },
  "pt": {
    "name": "Portuguese",
    "in": ["você recebeu", "voce recebeu", "pix recebido", "transferência recebida", "foi creditado", "crédito de", "depósito de"],
    "out": ["você enviou", "voce enviou", "você pagou", "voce pagou", "pix enviado", "foi debitado", "débito de", "compra aprovada", "saque de", "transferência enviada"],
    "failed": ["recusada", "recusado", "falhou", "não autorizada", "nao autorizada", "saldo insuficiente", "cancelada"],
    "request": ["cobrança", "solicitou", "lembrete", "vence", "pendente"],
    "promo": ["ganhe", "oferta", "promoção", "desconto", "grátis", "aproveite"],
    "otp": ["código de verificação", "código de segurança", "não compartilhe"],
    "telecom": ["recarga de celular", "pacote de dados", "pacote de internet"]
  },
  "sw": {
    "name": "Swahili",
    "in": ["umepokea", "imepokelewa", "umetumiwa", "imewekwa kwenye akaunti"],
    "out": ["umetuma", "umelipa", "umenunua", "umetoa", "imetumwa kwa", "umelipia"],
    "failed": ["imeshindikana", "haikufanikiwa", "imekataliwa", "salio halitoshi"],
    "request": ["ameomba", "ombi la malipo", "kumbusho"],
    "promo": ["shinda", "zawadi", "punguzo", "bure", "ofa", "bonasi"],
    "otp": ["nambari ya siri", "nambari ya uthibitisho", "usishiriki"],
    "telecom": ["muda wa maongezi", "kifurushi", "bando", "intaneti"]
  },
  "hi": {
    "name": "Hindi",
    "in": ["प्राप्त हुए", "जमा किए गए", "जमा हुए", "प्राप्त किया", "क्रेडिट किए गए"],
    "out": ["डेबिट किए गए", "भेजे गए", "भुगतान किया", "निकाले गए", "कटौती"],
    "failed": ["विफल", "असफल", "अस्वीकृत", "अपर्याप्त शेष"],
    "request": ["अनुरोध", "अनुस्मारक", "देय"],
    "promo": ["जीतें", "ऑफर", "छूट", "मुफ्त", "कैशबैक"],
    "otp": ["ओटीपी", "सत्यापन कोड", "साझा न करें"],
    "telecom": ["टॉकटाइम", "डेटा पैक", "रिचार्ज"]
  },
  "bn": {
    "name": "Bengali",
    "in": ["জমা হয়েছে", "পেয়েছেন", "গ্রহণ করেছেন", "ক্যাশ ইন"],
    "out": ["পাঠিয়েছেন", "প্রেরণ করেছেন", "পরিশোধ করেছেন", "কেটে নেওয়া হয়েছে", "ক্যাশ আউট", "ডেবিট"],
    "failed": ["ব্যর্থ", "বাতিল", "অপর্যাপ্ত ব্যালেন্স"],
    "request": ["অনুরোধ", "স্মরণ করিয়ে"],
    "promo": ["জিতুন", "অফার", "ছাড়", "ফ্রি", "ক্যাশব্যাক"],
    "otp": ["ওটিপি", "যাচাইকরণ কোড", "শেয়ার করবেন না"],
    "telecom": ["টকটাইম", "ইন্টারনেট প্যাক", "রিচার্জ"]
  },
  "ur": {
    "name": "Urdu",
    "in": ["موصول ہوئے", "وصول ہوئے", "جمع ہو گئے", "آپ کو موصول"],
    "out": ["بھیجے گئے", "آپ نے بھیجے", "ادا کیے", "کٹوتی", "نکالے گئے"],
    "failed": ["ناکام", "مسترد", "ناکافی بیلنس"],
    "request": ["درخواست", "یاد دہانی"],
    "promo": ["جیتیں", "آفر", "رعایت", "مفت", "انعام"],
    "otp": ["او ٹی پی", "تصدیقی کوڈ", "کسی کو نہ بتائیں"],
    "telecom": ["بیلنس لوڈ", "انٹرنیٹ پیکج", "منٹس"]
  },
  "id": {
    "name": "Indonesian / Malay",
    "in": ["anda menerima", "telah diterima", "dana masuk", "transfer masuk", "diterima dari", "telah dikreditkan"],
    "out": ["anda mengirim", "anda telah membayar", "transfer keluar", "telah didebit", "penarikan tunai", "pembelian sebesar"],
    "failed": ["gagal", "ditolak", "dibatalkan", "saldo tidak cukup", "saldo tidak mencukupi"],
    "request": ["permintaan pembayaran", "tagihan", "pengingat", "jatuh tempo"],
    "promo": ["menangkan", "promo", "diskon", "gratis", "hadiah"],
    "otp": ["kode verifikasi", "kode otp", "jangan berikan", "rahasiakan"],
    "telecom": ["pulsa", "paket data", "kuota"]
  },
  "tr": {
    "name": "Turkish",
    "in": ["hesabınıza geçti", "hesabınıza yatırıldı", "gelen havale", "gelen eft", "para aldınız"],
    "out": ["hesabınızdan çekildi", "borçlandırıldı", "ödeme yapıldı", "giden havale", "giden eft", "harcama yapıldı"],
    "failed": ["başarısız", "reddedildi", "iptal edildi", "İptal edildi", "yetersiz bakiye"],
    "request": ["ödeme talebi", "hatırlatma", "son ödeme"],
    "promo": ["kazan", "kampanya", "indirim", "ücretsiz", "hediye", "fırsat"],
    "otp": ["doğrulama kodu", "tek kullanımlık şifre", "kimseyle paylaşmayın"],
    "telecom": ["kontör", "internet paketi", "dakika"]
  },
  "ru": {
    "name": "Russian",
    "in": ["зачисление", "зачислено", "поступление", "поступило", "получен перевод", "вам перевели"],
    "out": ["списание", "списано", "покупка", "оплата", "перевод отправлен", "снятие", "вы перевели"],
    "failed": ["отклонено", "отклонена", "не выполнен", "недостаточно средств", "отменен", "отменена"],
    "request": ["запрос на оплату", "напоминание", "к оплате", "задолженность"],
    "promo": ["выиграйте", "акция", "скидка", "бесплатно", "бонус", "кешбэк"],
    "otp": ["код подтверждения", "никому не сообщайте", "одноразовый пароль"],
    "telecom": ["пакет интернета", "минут", "гб"]
  },
  "zh": {
    "name": "Chinese",
    "in": ["收入", "转入", "存入", "到账", "入账"],
    "out": ["支出", "转出", "消费", "付款", "扣款", "取现"],
    "failed": ["失败", "被拒", "余额不足", "已取消"],
    "request": ["付款请求", "提醒", "待支付", "到期"],
    "promo": ["优惠", "折扣", "免费", "中奖", "抽奖"],
    "otp": ["验证码", "动态密码", "请勿泄露"],
    "telecom": ["话费", "流量"]
  },
  "de": {
    "name": "German",
    "in": ["gutschrift", "geldeingang", "gutgeschrieben", "sie haben erhalten", "eingegangen"],
    "out": ["lastschrift", "abbuchung", "belastet", "zahlung an", "überweisung an", "abgehoben", "kartenzahlung"],
    "failed": ["fehlgeschlagen", "abgelehnt", "storniert", "nicht ausgeführt", "keine deckung"],
    "request": ["zahlungsaufforderung", "erinnerung", "fällig"],
    "promo": ["gewinnen", "angebot", "rabatt", "gratis", "kostenlos", "aktion"],
    "otp": ["bestätigungscode", "sicherheitscode", "nicht weitergeben"],
    "telecom": ["guthaben aufgeladen", "datenvolumen", "minuten"]
  },
  "it": {
    "name": "Italian",
    "in": ["hai ricevuto", "accredito", "accreditato", "bonifico ricevuto"],
    "out": ["hai inviato", "hai pagato", "addebito", "addebitato", "pagamento di", "prelievo", "acquisto di"],
    "failed": ["rifiutata", "rifiutato", "non riuscita", "fallita", "annullata", "saldo insufficiente"],
    "request": ["richiesta di pagamento", "ti ha richiesto", "promemoria", "in scadenza"],
    "promo": ["vinci", "offerta", "sconto", "gratis", "approfitta"],
    "otp": ["codice di verifica", "codice otp", "non condividere"],
    "telecom": ["ricarica", "giga", "minuti"]
  }
}
/* PHRASES-JSON-END */;

type Category = Exclude<keyof SmsPhraseSet, 'name'>;

// Letters/digits that count as "part of a word" for Latin and Cyrillic phrases.
const WORD = 'A-Za-z0-9\\u00C0-\\u024F\\u0400-\\u04FF';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const needsEdges = (phrase: string) => /^[\sA-Za-z0-9À-ɏЀ-ӿ'’.-]+$/.test(phrase);

function phraseRegex(category: Category): RegExp {
  const parts: string[] = [];
  for (const set of Object.values(SMS_PHRASES)) {
    for (const p of set[category]) {
      const src = escape(p.trim()).replace(/\s+/g, '\\s+');
      parts.push(needsEdges(p) ? `(?:^|[^${WORD}])${src}(?![${WORD}])` : src);
    }
  }
  return new RegExp(parts.join('|'), 'i');
}

const REGEX: Record<Category, RegExp> = {
  in: phraseRegex('in'),
  out: phraseRegex('out'),
  failed: phraseRegex('failed'),
  request: phraseRegex('request'),
  promo: phraseRegex('promo'),
  otp: phraseRegex('otp'),
  telecom: phraseRegex('telecom'),
};

export function hasPhrase(category: Category, text: string): boolean {
  return REGEX[category].test(text);
}

/** Direction stated in any supported non-English language; the earliest phrase wins. */
export function localDirection(text: string): 'income' | 'expense' | null {
  const inAt = text.search(REGEX.in);
  const outAt = text.search(REGEX.out);
  if (inAt < 0 && outAt < 0) return null;
  if (inAt < 0) return 'expense';
  if (outAt < 0) return 'income';
  return inAt <= outAt ? 'income' : 'expense';
}
