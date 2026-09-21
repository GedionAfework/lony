"""Chat smoke: open DM, send, reply, react, voice."""
import base64
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
        {"email": email, "password": "password12", "display_name": name, "accepted_disclaimer": True},
    )
    assert status == 201, body
    status, _ = req("POST", "/auth/verify", {"email": email, "code": body["verification_code"]})
    assert status == 200
    status, tok = req("POST", "/auth/login", {"email": email, "password": "password12"})
    assert status == 200, tok
    return tok["access_token"], tok["user"]["id"]


def main():
    s = uuid.uuid4().hex[:8]
    a_tok, a_id = register(f"chat-a-{s}@example.com", "ChatA")
    b_tok, b_id = register(f"chat-b-{s}@example.com", "ChatB")
    status, fr = req("POST", "/friend-requests", {"user_id": b_id}, token=a_tok)
    assert status == 201, fr
    status, _ = req("POST", f"/friend-requests/{fr['friendship']['id']}/accept", token=b_tok)
    assert status == 200

    status, conv = req("POST", "/conversations", {"peer_id": b_id}, token=a_tok)
    assert status == 200, conv
    cid = conv["conversation"]["id"]

    status, m1 = req("POST", f"/conversations/{cid}/messages", {"body": "hey"}, token=a_tok)
    assert status == 201, m1
    mid = m1["message"]["id"]

    status, m2 = req(
        "POST",
        f"/conversations/{cid}/messages",
        {"body": "yo", "reply_to_message_id": mid},
        token=b_tok,
    )
    assert status == 201, m2
    assert m2["message"]["reply_to"]["id"] == mid

    status, reacted = req("POST", f"/messages/{m2['message']['id']}/reactions", {"emoji": "🔥"}, token=a_tok)
    assert status == 200, reacted
    assert reacted["message"]["reactions"][0]["emoji"] == "🔥"

    status, voice = req(
        "POST",
        f"/conversations/{cid}/messages",
        {
            "attachment_kind": "voice",
            "attachment_name": "note.m4a",
            "attachment_mime": "audio/m4a",
            "attachment_base64": base64.b64encode(b"fake-audio-bytes").decode(),
            "voice_duration_ms": 1500,
        },
        token=a_tok,
    )
    assert status == 201, voice
    assert voice["message"]["attachment_kind"] == "voice"
    assert voice["message"]["attachment_url"]

    status, listed = req("GET", f"/conversations/{cid}/messages", token=b_tok)
    assert status == 200, listed
    assert len(listed["messages"]) >= 3

    status, convs = req("GET", "/conversations", token=a_tok)
    assert status == 200 and len(convs["conversations"]) >= 1

    print("chat ok")


if __name__ == "__main__":
    main()
