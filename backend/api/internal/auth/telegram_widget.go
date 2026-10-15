package auth

import (
	"fmt"
	"html"
	"net/http"
	"net/url"
	"strings"
)

// TelegramWidget serves a Login Widget page that deep-links back into the mobile app.
// Requires TELEGRAM_BOT_USERNAME (+ TELEGRAM_BOT_TOKEN for API verification).
func (h *Handler) TelegramWidget(w http.ResponseWriter, r *http.Request) {
	bot := strings.TrimSpace(h.svc.cfg.TelegramBotUsername)
	if bot == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = fmt.Fprintf(w, `{"error":{"code":"TELEGRAM_UNCONFIGURED","message":"Set TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN to enable Telegram sign-in"}}`)
		return
	}
	redirect := strings.TrimSpace(r.URL.Query().Get("redirect"))
	if redirect == "" {
		redirect = "lony://oauth/telegram"
	}
	if !strings.HasPrefix(redirect, "lony://") {
		http.Error(w, "redirect must use lony:// scheme", http.StatusBadRequest)
		return
	}
	botEsc := html.EscapeString(bot)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Lony — Sign in with Telegram</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#1e293b;padding:28px;border-radius:16px;max-width:360px;text-align:center}
  h1{font-size:1.25rem;margin:0 0 8px}
  p{opacity:.8;font-size:.9rem;margin:0 0 20px}
</style>
<script>
function onTelegramAuth(user) {
  var base = %q;
  var q = Object.keys(user).map(function(k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(user[k] == null ? '' : String(user[k]));
  }).join('&');
  window.location.href = base + (base.indexOf('?') >= 0 ? '&' : '?') + q;
}
</script>
</head>
<body>
  <div class="card">
    <h1>Lony</h1>
    <p>Sign in with Telegram to continue. Lony is a shared ledger — not a bank or escrow.</p>
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="%s"
      data-size="large"
      data-onauth="onTelegramAuth(user)"
      data-request-access="write"></script>
  </div>
</body>
</html>`, redirect, botEsc)
}

// TelegramCallback accepts an optional server-side redirect path for domains that cannot use data-onauth.
func (h *Handler) TelegramCallback(w http.ResponseWriter, r *http.Request) {
	redirect := strings.TrimSpace(r.URL.Query().Get("app_redirect"))
	if redirect == "" {
		redirect = "lony://oauth/telegram"
	}
	if !strings.HasPrefix(redirect, "lony://") {
		http.Error(w, "invalid redirect", http.StatusBadRequest)
		return
	}
	q := url.Values{}
	for k, vals := range r.URL.Query() {
		if k == "app_redirect" || len(vals) == 0 {
			continue
		}
		q.Set(k, vals[0])
	}
	target := redirect
	if enc := q.Encode(); enc != "" {
		if strings.Contains(redirect, "?") {
			target = redirect + "&" + enc
		} else {
			target = redirect + "?" + enc
		}
	}
	http.Redirect(w, r, target, http.StatusFound)
}
