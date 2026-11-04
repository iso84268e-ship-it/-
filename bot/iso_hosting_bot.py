"""
ISO HOSTING — Standalone Python Bot Runner
------------------------------------------
تنبيه أمني هام:
لا يحتوي هذا الملف على أي توكن بوت أو معرّف مالك (ID) مكتوب داخله نهائياً.
يتم جلب التوكن ومعرّف المالك المشفرين مباشرة من تطبيق الويب عبر الجسر الآمن الموقع رقمياً.
"""

import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request

WEBAPP_URL = os.environ.get("ISO_WEBAPP_URL", "http://localhost:3000").rstrip("/")


def load_bridge_secret() -> str:
    if os.environ.get("ISO_BRIDGE_SECRET"):
        return os.environ["ISO_BRIDGE_SECRET"].strip()
    key_file = os.path.join(os.getcwd(), "data", ".bridge.key")
    if os.path.exists(key_file):
        with open(key_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def bridge_request(endpoint: str, payload: dict | None = None):
    secret = load_bridge_secret()
    body = json.dumps(payload) if payload is not None else ""
    ts = str(int(time.time() * 1000))
    sig = hmac.new(
        secret.encode("utf-8"),
        f"{ts}.{body}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    req = urllib.request.Request(
        f"{WEBAPP_URL}{endpoint}",
        data=body.encode("utf-8") if payload is not None else None,
        method="POST" if payload is not None else "GET",
        headers={
            "Content-Type": "application/json",
            "X-ISO-Timestamp": ts,
            "X-ISO-Signature": sig,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def telegram_api(token: str, method: str, payload: dict | None = None):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/{method}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=35) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        if not data.get("ok"):
            raise RuntimeError(data.get("description", "Telegram error"))
        return data.get("result")


def run_bot():
    offset = 0
    print("[ISO HOSTING PYTHON BOT] Waiting for encrypted Token & Owner ID from Web App...")
    while True:
        try:
            cfg = bridge_request("/api/bot-bridge/config")
            token = cfg.get("botToken", "")
            owner_id = cfg.get("ownerId", "")
            extra_admins = cfg.get("extraAdminIds", [])

            if not token or not owner_id:
                time.sleep(5)
                continue

            updates = telegram_api(
                token,
                "getUpdates",
                {"offset": offset, "timeout": 25, "allowed_updates": ["message"]},
            )
            for upd in updates:
                offset = upd["update_id"] + 1
                msg = upd.get("message")
                if not msg:
                    continue
                sender_id = str(msg.get("from", {}).get("id", ""))
                if sender_id != owner_id and sender_id not in extra_admins:
                    uname = msg.get("from", {}).get("username", "unknown")
                    bridge_request(
                        "/api/bot-bridge/unauthorized",
                        {"telegramUserId": sender_id, "username": f"@{uname}"},
                    )
                    telegram_api(
                        token,
                        "sendMessage",
                        {
                            "chat_id": msg["chat"]["id"],
                            "text": "هذا البوت مخصص لخادم استضافة خاص مدفوع. يرجى تفعيل الاشتراك أولاً.",
                        },
                    )
                    continue

                bots = bridge_request("/api/bot-bridge/bots")
                running = sum(1 for b in bots if b.get("status") == "running")
                telegram_api(
                    token,
                    "sendMessage",
                    {
                        "chat_id": msg["chat"]["id"],
                        "text": f"{cfg.get('welcomeMessage')}\n\nالبوتات النشطة: {running} من {len(bots)}",
                    },
                )
        except Exception as exc:
            print(f"[ISO HOSTING PYTHON BOT] Notice: {exc}")
            time.sleep(4)


if __name__ == "__main__":
    run_bot()
