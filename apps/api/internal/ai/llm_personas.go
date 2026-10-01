package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"equilend/api/internal/ai/llm"
	"equilend/api/internal/httpx"

	"github.com/google/uuid"
)

// FeatureSnapshot is the sanitized metric pack sent to the LLM (no bank identifiers).
type FeatureSnapshot struct {
	Currency string         `json:"currency"`
	Overview map[string]any `json:"overview,omitempty"`
	Categories []map[string]any `json:"categories,omitempty"`
	Series   []map[string]any `json:"cashflow_series,omitempty"`
	Debts    map[string]any `json:"debts,omitempty"`
	Goals    []map[string]any `json:"goals,omitempty"`
	Score    map[string]any `json:"score,omitempty"`
}

func (s *Service) BuildFeatureSnapshot(ctx context.Context, userID uuid.UUID, currency string) (FeatureSnapshot, error) {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	snap := FeatureSnapshot{Currency: currency}
	if s.data == nil {
		return snap, nil
	}
	if ov, err := s.data.Overview(ctx, userID, currency, 1); err == nil {
		snap.Overview = map[string]any{
			"income": ov.Income, "expense": ov.Expense, "net": ov.Net,
			"prev_income": ov.PrevIncome, "prev_expense": ov.PrevExpense,
			"open_payables": ov.OpenPayables, "open_receivables": ov.OpenReceivables,
			"savings_rate_percent": ov.SavingsRatePercent,
			"period_from": ov.PeriodFrom, "period_to": ov.PeriodTo,
		}
	}
	if cats, err := s.data.Categories(ctx, userID, currency, 1); err == nil {
		for i, c := range cats {
			if i >= 8 {
				break
			}
			snap.Categories = append(snap.Categories, map[string]any{
				"category": c.Category, "amount": c.Amount, "share_percent": c.SharePercent,
			})
		}
	}
	if series, err := s.data.CashflowSeries(ctx, userID, currency, 6); err == nil {
		for _, p := range series {
			snap.Series = append(snap.Series, map[string]any{
				"month": p.Month, "income": p.Income, "expense": p.Expense, "net": p.Net,
			})
		}
	}
	if debts, err := s.data.Debts(ctx, userID, currency); err == nil {
		snap.Debts = map[string]any{
			"payables": debts.Payables,
			"receivables": debts.Receivables,
			"net": debts.Net,
			"debt_service_ratio": debts.DebtServiceRatio,
			"by_currency_count": len(debts.ByCurrency),
		}
	}
	if goals, err := s.data.Goals(ctx, userID); err == nil {
		for i, g := range goals {
			if i >= 10 {
				break
			}
			snap.Goals = append(snap.Goals, map[string]any{
				"title": g.Title, "goal_type": g.GoalType,
				"progress_percent": g.ProgressPercent,
				"current_amount": g.CurrentAmount, "target_amount": g.TargetAmount,
				"currency_code": g.CurrencyCode, "status": g.Status,
			})
		}
	}
	if s.score != nil {
		if sc, err := s.score.Get(ctx, userID, currency, false); err == nil {
			snap.Score = map[string]any{
				"grade": sc.Grade, "band": sc.Band, "points": sc.Points,
				"tips": sc.Tips,
			}
		}
	}
	return snap, nil
}

func (s *Service) snapshotJSON(ctx context.Context, userID uuid.UUID, currency string) (string, error) {
	snap, err := s.BuildFeatureSnapshot(ctx, userID, currency)
	if err != nil {
		return "", err
	}
	b, err := json.Marshal(snap)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (s *Service) allowLLM(ctx context.Context, userID uuid.UUID) error {
	if s.llm == nil || !s.llm.Available() {
		return fmt.Errorf("unavailable")
	}
	_, ok, err := s.store.IncrementUsage(ctx, userID, s.now().UTC(), s.dailyCap)
	if err != nil {
		return err
	}
	if !ok {
		return httpx.E(http.StatusTooManyRequests, "AI_CAP", "daily AI request limit reached")
	}
	return nil
}

const coachSystemPrompt = `You are Lony Coach, a careful personal finance assistant inside the Lony ledger app.
Rules:
- Use ONLY the provided JSON metrics. Do not invent balances or account numbers.
- Never recommend taking new loans or borrowing more to fix cashflow.
- Prioritize: emergency buffer, overdue/high-interest debt, budgets, Plan goals.
- Refuse illegal debt collection advice, guaranteed returns, or bureau credit-score claims.
- Be concise (under 180 words). End without repeating the legal disclaimer (the app adds it).
- Suggest concrete next steps the user can do in Lony when helpful.`

func (s *Service) coachLLM(ctx context.Context, userID uuid.UUID, currency, message string) (CoachReply, error) {
	if err := s.allowLLM(ctx, userID); err != nil {
		return CoachReply{}, err
	}
	snap, err := s.snapshotJSON(ctx, userID, currency)
	if err != nil {
		return CoachReply{}, err
	}
	conv, err := s.store.EnsureConversation(ctx, userID, PersonaCoach, "Coach")
	if err != nil {
		return CoachReply{}, err
	}
	history, _ := s.store.ListMessages(ctx, conv.ID, 12)
	msgs := []llm.Message{{Role: "system", Content: coachSystemPrompt + "\n\nUser metrics JSON:\n" + snap}}
	for _, h := range history {
		if h.Role == "user" || h.Role == "assistant" {
			msgs = append(msgs, llm.Message{Role: h.Role, Content: h.Content})
		}
	}
	msgs = append(msgs, llm.Message{Role: "user", Content: message})

	res, err := s.llm.Chat(ctx, msgs, 500)
	if err != nil {
		status := "error"
		sum := err.Error()
		model := s.llm.Model()
		_, _ = s.store.InsertRun(ctx, Run{
			UserID: userID, Persona: PersonaCoach, Kind: "chat", Model: &model,
			InputSummary: strPtr(message), OutputSummary: &sum, Status: status,
		})
		return CoachReply{}, err
	}

	content := sanitizeCoachReply(res.Content)
	_, _ = s.store.InsertMessage(ctx, Message{ConversationID: conv.ID, Role: "user", Content: message})
	_, _ = s.store.InsertMessage(ctx, Message{ConversationID: conv.ID, Role: "assistant", Content: content})
	model := res.Model
	_, _ = s.store.InsertRun(ctx, Run{
		UserID: userID, Persona: PersonaCoach, Kind: "chat", Model: &model,
		InputSummary: strPtr(truncate(message, 200)), OutputSummary: strPtr(truncate(content, 400)),
		PromptTokens: res.PromptTokens, CompletionTokens: res.CompletionTokens, Status: "ok",
	})

	actions := []Action{
		{Label: "Log expense", DeepLink: "lony://expenses/new"},
		{Label: "Open goals", DeepLink: "lony://plan"},
		{Label: "View insights", DeepLink: "lony://insights"},
	}
	return CoachReply{Reply: content, Disclaimer: Disclaimer, Actions: actions}, nil
}

func (s *Service) GetCoachThread(ctx context.Context, userID uuid.UUID) (ConversationDTO, error) {
	if err := s.ensureAIEnabled(ctx, userID); err != nil {
		return ConversationDTO{}, err
	}
	conv, err := s.store.EnsureConversation(ctx, userID, PersonaCoach, "Coach")
	if err != nil {
		return ConversationDTO{}, err
	}
	msgs, err := s.store.ListMessages(ctx, conv.ID, 100)
	if err != nil {
		return ConversationDTO{}, err
	}
	out := ConversationDTO{
		ID: conv.ID, Persona: conv.Persona, Title: conv.Title,
		CreatedAt: conv.CreatedAt, UpdatedAt: conv.UpdatedAt,
		Messages: make([]MessageDTO, 0, len(msgs)),
	}
	for _, m := range msgs {
		out.Messages = append(out.Messages, MessageDTO{
			ID: m.ID, Role: m.Role, Content: m.Content, Citations: m.Citations, CreatedAt: m.CreatedAt,
		})
	}
	return out, nil
}

// CoachStream writes SSE events: token, done|error. Falls back to a single token when LLM is unavailable.
func (s *Service) CoachStream(ctx context.Context, w http.ResponseWriter, userID uuid.UUID, currency, message string) error {
	if err := s.ensureAIEnabled(ctx, userID); err != nil {
		return err
	}
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if len(currency) != 3 {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"currency": "must be a 3-letter currency code",
		})
	}
	rawMsg := strings.TrimSpace(message)
	if rawMsg == "" {
		return httpx.Field(http.StatusUnprocessableEntity, "VALIDATION", "invalid fields", map[string]string{
			"message": "required",
		})
	}
	if s.data == nil {
		return httpx.E(http.StatusServiceUnavailable, "UNAVAILABLE", "insights unavailable")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	actions := []Action{
		{Label: "Log expense", DeepLink: "lony://expenses/new"},
		{Label: "Open goals", DeepLink: "lony://plan"},
		{Label: "View insights", DeepLink: "lony://insights"},
	}

	if s.llm == nil || !s.llm.Available() {
		reply, err := s.Coach(ctx, userID, currency, rawMsg)
		if err != nil {
			_ = writeSSE(w, "error", map[string]any{"error": map[string]string{"code": "COACH", "message": err.Error()}})
			return nil
		}
		_ = writeSSE(w, "token", map[string]any{"text": reply.Reply})
		_ = writeSSE(w, "done", map[string]any{"coach": reply})
		return nil
	}

	if err := s.allowLLM(ctx, userID); err != nil {
		var api *httpx.APIError
		if errors.As(err, &api) && api.Code == "AI_CAP" {
			_ = writeSSE(w, "error", map[string]any{"error": map[string]string{"code": api.Code, "message": api.Message}})
			return nil
		}
		reply, cErr := s.Coach(ctx, userID, currency, rawMsg)
		if cErr != nil {
			_ = writeSSE(w, "error", map[string]any{"error": map[string]string{"code": "COACH", "message": cErr.Error()}})
			return nil
		}
		_ = writeSSE(w, "token", map[string]any{"text": reply.Reply})
		_ = writeSSE(w, "done", map[string]any{"coach": reply})
		return nil
	}

	snap, err := s.snapshotJSON(ctx, userID, currency)
	if err != nil {
		_ = writeSSE(w, "error", map[string]any{"error": map[string]string{"code": "SNAPSHOT", "message": err.Error()}})
		return nil
	}
	conv, err := s.store.EnsureConversation(ctx, userID, PersonaCoach, "Coach")
	if err != nil {
		_ = writeSSE(w, "error", map[string]any{"error": map[string]string{"code": "STORE", "message": err.Error()}})
		return nil
	}
	history, _ := s.store.ListMessages(ctx, conv.ID, 12)
	msgs := []llm.Message{{Role: "system", Content: coachSystemPrompt + "\n\nUser metrics JSON:\n" + snap}}
	for _, h := range history {
		if h.Role == "user" || h.Role == "assistant" {
			msgs = append(msgs, llm.Message{Role: h.Role, Content: h.Content})
		}
	}
	msgs = append(msgs, llm.Message{Role: "user", Content: rawMsg})

	res, err := s.llm.ChatStream(ctx, msgs, 500, func(delta string) error {
		return writeSSE(w, "token", map[string]any{"text": delta})
	})
	if err != nil {
		_ = writeSSE(w, "error", map[string]any{"error": map[string]string{"code": "LLM", "message": err.Error()}})
		return nil
	}
	content := sanitizeCoachReply(res.Content)
	if content != res.Content {
		_ = writeSSE(w, "replace", map[string]any{"text": content})
	}
	_, _ = s.store.InsertMessage(ctx, Message{ConversationID: conv.ID, Role: "user", Content: rawMsg})
	_, _ = s.store.InsertMessage(ctx, Message{ConversationID: conv.ID, Role: "assistant", Content: content})
	model := res.Model
	_, _ = s.store.InsertRun(ctx, Run{
		UserID: userID, Persona: PersonaCoach, Kind: "chat_stream", Model: &model,
		InputSummary: strPtr(truncate(rawMsg, 200)), OutputSummary: strPtr(truncate(content, 400)),
		PromptTokens: res.PromptTokens, CompletionTokens: res.CompletionTokens, Status: "ok",
	})
	_ = writeSSE(w, "done", map[string]any{
		"coach": CoachReply{Reply: content, Disclaimer: Disclaimer, Actions: actions},
	})
	return nil
}

const analystSystemPrompt = `You are Lony Analyst. Rewrite each insight card body to be clearer and more actionable using the metrics JSON.
Return JSON array only: [{"theme":"...","title":"...","body":"..."}] matching input order.
Do not invent numbers. Never mention bank account numbers. Keep each body under 50 words.`

func (s *Service) enrichInsightsLLM(ctx context.Context, userID uuid.UUID, currency string, rows []Insight) []Insight {
	if s.llm == nil || !s.llm.Available() || len(rows) == 0 {
		return rows
	}
	if _, ok, err := s.store.IncrementUsage(ctx, userID, s.now().UTC(), s.dailyCap); err != nil || !ok {
		return rows
	}
	snap, err := s.snapshotJSON(ctx, userID, currency)
	if err != nil {
		return rows
	}
	type cardIn struct {
		Theme string `json:"theme"`
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	in := make([]cardIn, 0, len(rows))
	for _, r := range rows {
		in = append(in, cardIn{Theme: r.Theme, Title: r.Title, Body: r.Body})
	}
	payload, _ := json.Marshal(in)
	res, err := s.llm.Chat(ctx, []llm.Message{
		{Role: "system", Content: analystSystemPrompt + "\n\nMetrics:\n" + snap},
		{Role: "user", Content: string(payload)},
	}, 800)
	if err != nil {
		return rows
	}
	text := res.Content
	if i := strings.Index(text, "["); i >= 0 {
		if j := strings.LastIndex(text, "]"); j > i {
			text = text[i : j+1]
		}
	}
	var out []cardIn
	if err := json.Unmarshal([]byte(text), &out); err != nil || len(out) == 0 {
		return rows
	}
	for i := range rows {
		if i >= len(out) {
			break
		}
		if strings.TrimSpace(out[i].Title) != "" {
			title := strings.TrimSpace(out[i].Title)
			if len(title) > 160 {
				title = title[:160]
			}
			rows[i].Title = title
		}
		if strings.TrimSpace(out[i].Body) != "" {
			rows[i].Body = strings.TrimSpace(out[i].Body)
		}
		rows[i].Source = "llm"
	}
	model := res.Model
	_, _ = s.store.InsertRun(ctx, Run{
		UserID: userID, Persona: PersonaAnalyst, Kind: "enrich", Model: &model,
		OutputSummary: strPtr(fmt.Sprintf("enriched %d cards", len(out))),
		PromptTokens: res.PromptTokens, CompletionTokens: res.CompletionTokens, Status: "ok",
	})
	return rows
}

const visualizerSystemPrompt = `You are Lony Visualizer. Improve chart captions and write a short period summary from the report JSON.
Rules:
- Use ONLY numbers present in the report. Do not invent balances or account identifiers.
- Never recommend borrowing more.
- Return JSON only: {"summary":"...","captions":{"chart_id":"caption",...}}
- Each caption under 25 words. Summary under 60 words.`

func (s *Service) enrichReportLLM(ctx context.Context, userID uuid.UUID, rep Report) Report {
	if s.llm == nil || !s.llm.Available() {
		return rep
	}
	if _, ok, err := s.store.IncrementUsage(ctx, userID, s.now().UTC(), s.dailyCap); err != nil || !ok {
		return rep
	}
	type chartIn struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Caption string `json:"caption"`
	}
	in := struct {
		Currency string    `json:"currency"`
		Months   int       `json:"months"`
		Summary  string    `json:"summary"`
		Charts   []chartIn `json:"charts"`
		Tables   []ReportTable `json:"tables"`
	}{
		Currency: rep.CurrencyCode, Months: rep.PeriodMonths, Summary: rep.Summary, Tables: rep.Tables,
	}
	for _, c := range rep.Charts {
		in.Charts = append(in.Charts, chartIn{ID: c.ID, Title: c.Title, Caption: c.Caption})
	}
	payload, _ := json.Marshal(in)
	res, err := s.llm.Chat(ctx, []llm.Message{
		{Role: "system", Content: visualizerSystemPrompt},
		{Role: "user", Content: string(payload)},
	}, 500)
	if err != nil {
		return rep
	}
	text := res.Content
	if i := strings.Index(text, "{"); i >= 0 {
		if j := strings.LastIndex(text, "}"); j > i {
			text = text[i : j+1]
		}
	}
	var out struct {
		Summary  string            `json:"summary"`
		Captions map[string]string `json:"captions"`
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return rep
	}
	if strings.TrimSpace(out.Summary) != "" {
		rep.Summary = strings.TrimSpace(out.Summary)
	}
	for i := range rep.Charts {
		if cap, ok := out.Captions[rep.Charts[i].ID]; ok && strings.TrimSpace(cap) != "" {
			rep.Charts[i].Caption = strings.TrimSpace(cap)
		}
	}
	rep.Source = "llm_visualizer"
	model := res.Model
	_, _ = s.store.InsertRun(ctx, Run{
		UserID: userID, Persona: PersonaVisualizer, Kind: "report", Model: &model,
		OutputSummary: strPtr(truncate(rep.Summary, 200)),
		PromptTokens: res.PromptTokens, CompletionTokens: res.CompletionTokens, Status: "ok",
	})
	return rep
}

func strPtr(s string) *string { return &s }

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
