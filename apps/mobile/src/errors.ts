/** Human-friendly API / network error messages for Lony clients. */

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  password: 'Password',
  current_password: 'Current password',
  new_password: 'New password',
  display_name: 'Name',
  first_name: 'First name',
  last_name: 'Last name',
  middle_name: 'Middle name',
  username: 'Username',
  phone_e164: 'Phone',
  phone: 'Phone',
  country_code: 'Country',
  currency_code: 'Currency',
  default_currency_code: 'Currency',
  accepted_disclaimer: 'Disclaimer',
  code: 'Verification code',
  title: 'Title',
  amount: 'Amount',
  target_amount: 'Target amount',
  timezone: 'Timezone',
  locale: 'Language',
  calendar_id: 'Calendar',
  url: 'Link',
  text: 'Text',
  message: 'Message',
};

const CODE_MESSAGES: Record<string, string> = {
  EMAIL_TAKEN: 'An account with this email already exists.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  UNAUTHORIZED: 'Please sign in again.',
  FORBIDDEN: 'You do not have permission to do that.',
  NOT_FOUND: 'We could not find that.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  AI_UNAVAILABLE: 'AI is temporarily unavailable.',
  AI_CAP: 'Daily AI limit reached. Try again tomorrow.',
  VALIDATION: 'Please check the highlighted fields and try again.',
  CONFLICT: 'That value is already in use.',
  EMAIL_NOT_VERIFIED: 'Verify your email before signing in.',
  MALFORMED_JSON: 'Something went wrong with the request. Please try again.',
  INTERNAL: 'Something went wrong. Please try again.',
};

function labelFor(field: string): string {
  return FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksNetwork(message: string): boolean {
  return /network request failed|failed to fetch|timeout|ECONNREFUSED|unreachable|NetworkError|Internet/i.test(
    message,
  );
}

type ApiErrorShape = {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
};

/**
 * Turn any thrown value / API payload into one short sentence for the UI.
 */
export function formatError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err == null) return fallback;

  if (typeof err === 'string') {
    const t = err.trim();
    if (!t) return fallback;
    if (looksNetwork(t)) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    return t;
  }

  if (err instanceof Error) {
    const msg = err.message?.trim() || '';
    if (looksNetwork(msg)) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    // Field dump from api.ts: "email: …; password: …"
    if (/^[a-z_]+:\s/i.test(msg) && msg.includes(':')) {
      const parts = msg.split(';').map((p) => p.trim()).filter(Boolean);
      const friendly = parts.map((p) => {
        const idx = p.indexOf(':');
        if (idx < 0) return p;
        const key = p.slice(0, idx).trim();
        const val = p.slice(idx + 1).trim();
        return `${labelFor(key)}: ${val}`;
      });
      return friendly.join('. ');
    }
    return msg || fallback;
  }

  const shaped = err as ApiErrorShape;
  const code = shaped?.error?.code;
  const fields = shaped?.error?.fields;
  if (fields && typeof fields === 'object') {
    const entries = Object.entries(fields);
    if (entries.length) {
      return entries.map(([k, v]) => `${labelFor(k)}: ${v}`).join('. ');
    }
  }
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (shaped?.error?.message) return shaped.error.message;
  return fallback;
}

export function passwordIssues(password: string): string[] {
  const issues: string[] = [];
  if (password.length < 8) issues.push('at least 8 characters');
  if (!/[A-Za-z]/.test(password)) issues.push('a letter');
  if (!/[0-9]/.test(password)) issues.push('a number');
  return issues;
}

export function passwordHint(password: string): string | null {
  const issues = passwordIssues(password);
  if (!issues.length) return null;
  return `Password needs ${issues.join(', ')}.`;
}
