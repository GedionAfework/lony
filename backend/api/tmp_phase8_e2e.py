"""Phase 8 live checks: disclaimer, idempotency, IDOR."""
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
            return res.status, json.loads(raw) if raw else {}, dict(res.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode() or "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return e.code, payload, dict(e.headers)


def register(email, name):
    status, body, _ = req(
        "POST",
        "/auth/register",
        {
            "email": email,
            "password": "password12",
            "display_name": name,
            "accepted_disclaimer": True,
        },
        headers={"Idempotency-Key": f"reg-{email}"},
    )
    assert status == 201, body
    code = body["verification_code"]
    status, _, _ = req("POST", "/auth/verify", {"email": email, "code": code})
    assert status == 200, body
    status, tok, _ = req("POST", "/auth/login", {"email": email, "password": "password12"})
    assert status == 200, tok
    return tok["access_token"], tok["user"]["id"]


def main():
    # Disclaimer required
    status, body, _ = req(
        "POST",
        "/auth/register",
        {"email": f"no-disc-{uuid.uuid4().hex[:8]}@example.com", "password": "password12", "display_name": "NoDisc"},
    )
    assert status == 422, body
    assert body["error"]["fields"]["accepted_disclaimer"]

    suffix = uuid.uuid4().hex[:8]
    a_tok, a_id = register(f"a-{suffix}@example.com", "Alice")
    b_tok, b_id = register(f"b-{suffix}@example.com", "Bob")
    c_tok, _ = register(f"c-{suffix}@example.com", "Carol")

    status, fr, _ = req("POST", "/friend-requests", {"user_id": b_id}, token=a_tok)
    assert status == 201, fr
    status, _, _ = req("POST", f"/friend-requests/{fr['friendship']['id']}/accept", token=b_tok)
    assert status == 200

    # Idempotent loan create
    due = "2026-10-16T12:00:00Z"
    key = f"loan-{suffix}"
    loan_body = {
        "counterparty_id": b_id,
        "role": "borrower",
        "principal": "1000",
        "currency_code": "ETB",
        "interest_rate_percent": "5",
        "due_at": due,
    }
    status, loan1, hdr1 = req("POST", "/loans", loan_body, token=a_tok, headers={"Idempotency-Key": key})
    assert status == 201, loan1
    status, loan2, hdr2 = req("POST", "/loans", loan_body, token=a_tok, headers={"Idempotency-Key": key})
    assert status == 201, loan2
    assert loan1["loan"]["id"] == loan2["loan"]["id"]
    assert hdr2.get("Idempotent-Replay") == "true" or hdr2.get("Idempotent-Replay".lower()) == "true" or any(
        k.lower() == "idempotent-replay" and v == "true" for k, v in hdr2.items()
    )

    # Mismatch body with same key
    bad = dict(loan_body)
    bad["principal"] = "2000"
    status, mismatch, _ = req("POST", "/loans", bad, token=a_tok, headers={"Idempotency-Key": key})
    assert status == 409, mismatch

    loan_id = loan1["loan"]["id"]

    # IDOR
    status, _, _ = req("GET", f"/loans/{loan_id}", token=c_tok)
    assert status == 404

    # Accept without disclaimer
    status, body, _ = req("POST", f"/loans/{loan_id}/accept", {}, token=b_tok)
    assert status == 422, body

    status, accepted, _ = req(
        "POST",
        f"/loans/{loan_id}/accept",
        {"accepted_disclaimer": True},
        token=b_tok,
        headers={"Idempotency-Key": f"accept-{suffix}"},
    )
    assert status == 200, accepted
    assert accepted["loan"]["status"] == "active"

    print("phase8 live ok")


if __name__ == "__main__":
    main()
