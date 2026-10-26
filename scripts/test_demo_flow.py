#!/usr/bin/env python3
"""End-to-end verification of the Apex OS live demo endpoints and functionality."""

import json
import sys
import urllib.error
import urllib.request


def check_endpoint(
    name: str, url: str, method: str = "GET", data: dict | None = None
) -> dict | str:
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8") if data is not None else None,
        headers={"Content-Type": "application/json"} if data is not None else {},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            content_type = response.headers.get("Content-Type", "")
            raw = response.read()
            if "application/json" in content_type:
                res = json.loads(raw)
                print(f"  ✓ {name}: HTTP {response.status} JSON OK")
                return res
            else:
                text = raw.decode("utf-8")
                print(
                    f"  ✓ {name}: HTTP {response.status} Text/Raw OK ({len(text)} bytes)"
                )
                return text
    except urllib.error.URLError as e:
        print(f"  ✗ {name}: Failed ({e})")
        sys.exit(1)


def main():
    print("=== APEX OS DEMO VERIFICATION SUITE ===")

    # 1. Frontend Check
    print("\n1. Verifying Next.js Production Frontend (Port 3000)...")
    check_endpoint("Next.js Terminal Root", "http://127.0.0.1:3000/")

    # 2. Backend Health & State
    print("\n2. Verifying Backend State & Telemetry (Port 8000)...")
    engine = check_endpoint("Meta Model Engine", "http://127.0.0.1:8000/api/engine")
    assert "model" in engine, "Engine missing model"

    state = check_endpoint(
        "Terminal State Portfolio", "http://127.0.0.1:8000/api/state"
    )
    assert len(state.get("courses", [])) > 0, "No courses in portfolio"
    assert len(state.get("assignments", [])) > 0, "No assignments in portfolio"

    # 3. Quantitative Math Engines
    print("\n3. Verifying Quantitative Math & Risk Engines...")
    mc = check_endpoint(
        "1000-Path Monte Carlo VaR",
        "http://127.0.0.1:8000/api/v1/simulate/monte-carlo",
        method="POST",
        data={},
    )
    assert len(mc.get("courses", [])) > 0, "Monte Carlo produced 0 courses"
    assert mc["courses"][0].get("var_90") is not None, "Missing var_90"

    ef = check_endpoint(
        "Markowitz Efficient Frontier",
        "http://127.0.0.1:8000/api/v1/portfolio/efficient-frontier",
        method="POST",
        data={},
    )
    assert len(ef.get("frontier_curve", [])) > 0, (
        "Efficient frontier produced 0 curve points"
    )

    cb = check_endpoint(
        "Circuit Breaker Status",
        "http://127.0.0.1:8000/api/v1/portfolio/circuit-breaker",
        method="POST",
        data={},
    )
    assert "triggered" in cb, "Circuit breaker response invalid"

    mc_call = check_endpoint(
        "Academic Margin Call & WhatsApp",
        "http://127.0.0.1:8000/api/v1/portfolio/margin-call",
        method="POST",
        data={},
    )
    assert mc_call.get("webhook_payload", {}).get("messaging_product") == "whatsapp", (
        "WhatsApp webhook payload missing"
    )

    # 4. Integrations
    print("\n4. Verifying Calendar & Syllabus Integrations...")
    cal = check_endpoint(
        "RFC 5545 Calendar .ics", "http://127.0.0.1:8000/api/v1/portfolio/calendar.ics"
    )
    assert "BEGIN:VCALENDAR" in cal, "Missing VCALENDAR header in .ics"
    assert "BEGIN:VEVENT" in cal, "Missing VEVENT in .ics"

    presets = check_endpoint(
        "Syllabus Presets (MIT, Stanford, Harvard, Columbia)",
        "http://127.0.0.1:8000/api/v1/syllabus/presets",
    )
    assert len(presets) >= 4, "Missing syllabus presets"

    print("\n==============================================")
    print("ALL DEMO CHECKS PASSED: 100% OPERATIONAL & READY")
    print("==============================================")


if __name__ == "__main__":
    main()
