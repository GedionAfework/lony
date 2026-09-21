/** ISO country → E.164 dial code (without +). */
export const COUNTRY_DIAL: Record<string, string> = {
  AF: '93', AL: '355', DZ: '213', AR: '54', AM: '374', AU: '61', AT: '43', AZ: '994',
  BH: '973', BD: '880', BY: '375', BE: '32', BJ: '229', BO: '591', BA: '387', BW: '267',
  BR: '55', BG: '359', BF: '226', BI: '257', KH: '855', CM: '237', CA: '1', TD: '235',
  CL: '56', CN: '86', CO: '57', CG: '242', CD: '243', CR: '506', CI: '225', HR: '385',
  CU: '53', CY: '357', CZ: '420', DK: '45', DJ: '253', DO: '1', EC: '593', EG: '20',
  SV: '503', ER: '291', EE: '372', SZ: '268', ET: '251', FI: '358', FR: '33', GA: '241',
  GM: '220', GE: '995', DE: '49', GH: '233', GR: '30', GT: '502', GN: '224', HK: '852',
  HU: '36', IS: '354', IN: '91', ID: '62', IR: '98', IQ: '964', IE: '353', IL: '972',
  IT: '39', JM: '1', JP: '81', JO: '962', KZ: '7', KE: '254', KW: '965', KG: '996',
  LA: '856', LV: '371', LB: '961', LR: '231', LY: '218', LT: '370', LU: '352', MG: '261',
  MW: '265', MY: '60', ML: '223', MT: '356', MR: '222', MU: '230', MX: '52', MD: '373',
  MN: '976', MA: '212', MZ: '258', MM: '95', NA: '264', NP: '977', NL: '31', NZ: '64',
  NI: '505', NE: '227', NG: '234', MK: '389', NO: '47', OM: '968', PK: '92', PS: '970',
  PA: '507', PY: '595', PE: '51', PH: '63', PL: '48', PT: '351', QA: '974', RO: '40',
  RU: '7', RW: '250', SA: '966', SN: '221', RS: '381', SL: '232', SG: '65', SK: '421',
  SI: '386', SO: '252', ZA: '27', KR: '82', SS: '211', ES: '34', LK: '94', SD: '249',
  SE: '46', CH: '41', SY: '963', TW: '886', TJ: '992', TZ: '255', TH: '66', TG: '228',
  TN: '216', TR: '90', TM: '993', UG: '256', UA: '380', AE: '971', GB: '44', US: '1',
  UY: '598', UZ: '998', VE: '58', VN: '84', YE: '967', ZM: '260', ZW: '263',
};

export type DialOption = { id: string; label: string; dial: string; keywords?: string };

export function dialOptionsForCountries(
  countries: { id: string; label: string }[],
): DialOption[] {
  return countries
    .filter((c) => COUNTRY_DIAL[c.id])
    .map((c) => {
      const dial = COUNTRY_DIAL[c.id];
      return {
        id: c.id,
        dial,
        label: `${c.label} (+${dial})`,
        keywords: `${c.id} ${c.label} ${dial} +${dial}`.toLowerCase(),
      };
    });
}

export function dialForCountry(country: string): string {
  return COUNTRY_DIAL[country] ?? '';
}

export function countryForDial(dial: string, prefer?: string): string {
  const clean = dial.replace(/\D/g, '');
  if (prefer && COUNTRY_DIAL[prefer] === clean) return prefer;
  const matches = Object.entries(COUNTRY_DIAL).filter(([, d]) => d === clean);
  if (matches.length === 0) return prefer ?? '';
  if (prefer && matches.some(([c]) => c === prefer)) return prefer;
  // Prefer US over other +1 when ambiguous
  if (clean === '1') return 'US';
  return matches[0][0];
}

/** Parse stored E.164 into country + national digits. */
export function splitE164(e164: string, fallbackCountry = 'US'): { country: string; national: string; dial: string } {
  const digits = e164.replace(/\D/g, '');
  if (!digits) {
    const dial = COUNTRY_DIAL[fallbackCountry] ?? '1';
    return { country: fallbackCountry, national: '', dial };
  }
  // Longest dial match
  let bestCountry = fallbackCountry;
  let bestDial = '';
  for (const [code, dial] of Object.entries(COUNTRY_DIAL)) {
    if (digits.startsWith(dial) && dial.length > bestDial.length) {
      bestDial = dial;
      bestCountry = code;
    }
  }
  if (!bestDial) {
    const dial = COUNTRY_DIAL[fallbackCountry] ?? '1';
    return { country: fallbackCountry, national: digits, dial };
  }
  return { country: bestCountry, national: digits.slice(bestDial.length), dial: bestDial };
}

export function toE164(country: string, national: string): string {
  const dial = COUNTRY_DIAL[country] ?? '';
  const n = national.replace(/\D/g, '').replace(/^0+/, '');
  if (!dial || !n) return n ? `+${n}` : '';
  return `+${dial}${n}`;
}
