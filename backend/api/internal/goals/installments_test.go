package goals

import "testing"

func TestDetectInstallmentPlan(t *testing.T) {
	cases := []struct {
		name   string
		html   string
		amount string
		months int
		cur    string
	}{
		{"per month for", `<p>Pay <b>$68</b>/mo for 24 months</p>`, "68", 24, "USD"},
		{"per month over", `<span>$41.62 per month over 12 months</span>`, "41.62", 12, "USD"},
		{"payments of", `<div>6 monthly payments of €199.00</div>`, "199", 6, "EUR"},
		{"installments of", `<div>Split into 4 installments of $25</div>`, "25", 4, "USD"},
		{"times months", `<li>$120 x 10 months</li>`, "120", 10, "USD"},
		{"count times monthly", `<li>18 × $55/mo</li>`, "55", 18, "USD"},
		{"monthly plus program length", `<h1>Data bootcamp</h1><p>Only $499/month.</p><p>A 6-month program with mentors.</p>`, "499", 6, "USD"},
		{"birr", `<p>Br 3,500 per month for 12 months</p>`, "3500", 12, "ETB"},
		{"json-ld billing duration", `<script type="application/ld+json">{"@type":"Product","name":"Phone","offers":{"@type":"Offer","price":"33.33","priceCurrency":"USD","priceSpecification":{"@type":"UnitPriceSpecification","price":"33.33","priceCurrency":"USD","billingDuration":"P24M","unitCode":"MON"}}}</script>`, "33.33", 24, "USD"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p, ok := detectInstallmentPlan(c.html)
			if !ok {
				t.Fatalf("no plan found")
			}
			if p.Amount.String() != c.amount || p.Months != c.months || p.Currency != c.cur {
				t.Fatalf("got %s × %d %s, want %s × %d %s", p.Amount, p.Months, p.Currency, c.amount, c.months, c.cur)
			}
		})
	}
}

func TestDetectInstallmentPlan_NoPlan(t *testing.T) {
	for _, html := range []string{
		`<b>$1,299</b> <small>$54 per month</small>`, // monthly price, but no length
		`<p>Ships in 2 x 3 days for $5</p>`,
		`<p>Price $899. Free returns within 30 days.</p>`,
	} {
		if p, ok := detectInstallmentPlan(html); ok {
			t.Fatalf("%q: unexpected plan %s × %d", html, p.Amount, p.Months)
		}
	}
}

func TestApplyInstallmentPlan(t *testing.T) {
	plan, _ := planOf("68", "24", "$")

	// The page's price was only the first payment: the goal becomes the whole plan.
	out := PreviewURLResult{Price: "68.00", Currency: "USD"}
	applyInstallmentPlan(&out, plan)
	if out.Price != "1632.00" || !out.PlanTotal || out.PaymentMonths != 24 || out.MonthlyPayment != "68.00" {
		t.Fatalf("first payment not expanded: %+v", out)
	}

	// No price at all.
	out = PreviewURLResult{}
	applyInstallmentPlan(&out, plan)
	if out.Price != "1632.00" || out.Currency != "USD" {
		t.Fatalf("missing price not filled: %+v", out)
	}

	// A real full price next to "or $68/mo for 24 months" stays.
	out = PreviewURLResult{Price: "1599.00", Currency: "USD"}
	applyInstallmentPlan(&out, plan)
	if out.Price != "1599.00" || out.PlanTotal {
		t.Fatalf("full price replaced: %+v", out)
	}

	// A plan in another currency than the page price is not mixed in.
	out = PreviewURLResult{Price: "68.00", Currency: "EUR"}
	applyInstallmentPlan(&out, plan)
	if out.Price != "68.00" {
		t.Fatalf("currencies mixed: %+v", out)
	}
}

func TestPreviewPipeline_MonthlyOnlyPage(t *testing.T) {
	// A page whose structured price is the monthly payment.
	html := `<html><head><meta property="og:title" content="Pro course"><meta property="product:price:amount" content="99"><meta property="product:price:currency" content="USD"></head>
<body><h1>Pro course</h1><p>$99/month for 12 months</p></body></html>`
	out := PreviewURLResult{Price: "99", Currency: "USD"}
	if plan, ok := detectInstallmentPlan(html); ok {
		applyInstallmentPlan(&out, plan)
	}
	if out.Price != "1188.00" {
		t.Fatalf("price=%q want 1188.00", out.Price)
	}
}
