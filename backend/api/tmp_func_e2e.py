"""Full functional path: register → friends → loan → accept → claim → confirm → notifications."""
import json
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:8080/api/v1"


def req(method, path, body=None, token=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    h = {"Accept": "application/json"}
    if body is not None:
        h["Content-Type"] = "application/json"
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r) as res:
            raw = res.read().decode() or "{}"
            return res.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload


def register(email, name):
    status, body = req(
        "POST",
        "/auth/register",
        {
            "email": email,
            "password": "password12",
            "display_name": name,
            "accepted_disclaimer": True,
        },
    )
    assert status == 201, body
    code = body["verification_code"]
    status, _ = req("POST", "/auth/verify", {"email": email, "code": code})
    assert status == 200
    status, tok = req("POST", "/auth/login", {"email": email, "password": "password12"})
    assert status == 200, tok
    return tok["access_token"], tok["refresh_token"], tok["user"]["id"]


def main():
    suffix = uuid.uuid4().hex[:8]
    a_tok, a_ref, a_id = register(f"func-a-{suffix}@example.com", "FuncA")
    b_tok, _, b_id = register(f"func-b-{suffix}@example.com", "FuncB")

    # refresh
    status, refreshed = req("POST", "/auth/refresh", {"refresh_token": a_ref})
    assert status == 200, refreshed
    a_tok = refreshed["access_token"]

    status, fr = req("POST", "/friend-requests", {"user_id": b_id}, token=a_tok)
    assert status == 201, fr
    status, _ = req("POST", f"/friend-requests/{fr['friendship']['id']}/accept", token=b_tok)
    assert status == 200

    # loan without terms then propose
    status, loan = req(
        "POST",
        "/loans",
        {"counterparty_id": b_id, "role": "borrower"},
        token=a_tok,
        headers={"Idempotency-Key": f"loan-{suffix}"},
    )
    assert status == 201, loan
    loan_id = loan["loan"]["id"]
    assert loan["loan"]["can_propose_terms"] is True

    status, proposed = req(
        "POST",
        f"/loans/{loan_id}/terms",
        {
            "principal": "1000",
            "currency_code": "ETB",
            "interest_rate_percent": "5",
            "due_at": "2026-10-16T12:00:00Z",
        },
        token=b_tok,
        headers={"Idempotency-Key": f"terms-{suffix}"},
    )
    assert status == 200, proposed

    status, accepted = req(
        "POST",
        f"/loans/{loan_id}/accept",
        {"accepted_disclaimer": True},
        token=a_tok,
        headers={"Idempotency-Key": f"accept-{suffix}"},
    )
    assert status == 200, accepted
    assert accepted["loan"]["status"] == "active"

    status, claimed = req(
        "POST",
        f"/loans/{loan_id}/repayments",
        {},
        token=a_tok,
        headers={"Idempotency-Key": f"claim-{suffix}"},
    )
    assert status == 201, claimed
    rep_id = claimed["repayment"]["id"]
    assert claimed["repayment"]["amount"] == "1050.0000"

    status, listed = req("GET", f"/loans/{loan_id}/repayments", token=b_tok)
    assert status == 200, listed
    assert listed["repayments"][0]["can_confirm"] is True

    status, confirmed = req(
        "POST",
        f"/repayments/{rep_id}/confirm",
        token=b_tok,
        headers={"Idempotency-Key": f"confirm-{suffix}"},
    )
    assert status == 200, confirmed
    assert confirmed["repayment"]["status"] == "confirmed"

    status, loan_done = req("GET", f"/loans/{loan_id}", token=a_tok)
    assert status == 200, loan_done
    assert loan_done["loan"]["status"] == "completed"

    status, notes = req("GET", "/notifications", token=a_tok)
    assert status == 200, notes
    assert len(notes["notifications"]) >= 1

    print("functional path ok")


if __name__ == "__main__":
    main()
