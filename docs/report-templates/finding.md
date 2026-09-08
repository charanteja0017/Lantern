# Canonical Finding Report Template (HackerOne / Bugcrowd / OpenBugBounty aligned)

This template is the shape every NovaHunter report aims to match. It is
inspired by the structure used by top-tier disclosures on HackerOne,
Bugcrowd, and OpenBugBounty. Every field below maps 1:1 to a field on
`FindingReport` in `strix/api/services/report_schema.py` - if the LLM fills
this template correctly, validation passes on the first try.

Mandatory = must be present. Recommended = fill when available.

---

## Finding metadata

| Field | Required | Notes |
|-------|----------|-------|
| `title` | Mandatory | Short, outcome-first. "Stored XSS via display_name in /profile" not "Bug". 8-120 chars. |
| `severity` | Mandatory | One of `critical`, `high`, `medium`, `low`, `informational`. Must agree with `cvss_score`. |
| `cvss_vector` | Mandatory | Canonical CVSS v3.1 or v4.0 string, e.g. `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:L/A:N`. |
| `cvss_score` | Mandatory | Numeric 0-10, computed from the vector. |
| `cwe` | Recommended | List of `CWE-NNN` entries. At minimum the most specific CWE. |
| `owasp_top10` | Recommended | List like `"A03:2021 - Injection"`. Helps triage. |
| `affected_asset` | Mandatory | Fully-qualified URL, host, or repo path. Most specific location wins. |
| `references` | Mandatory for high/critical | At least one authoritative link (OWASP page, CWE page, vendor advisory, research write-up). |
| `discovered_by_agent` | Recommended | Which agent found it (`root`, `web-agent`, `source-aware-1`). |
| `evidence_artifacts` | Recommended | List of artifact IDs or paths the renderer can inline (screenshots, HARs, pcaps). |

---

## Narrative sections

### 1. Summary (`summary`)

One to three sentences a triager can read and immediately understand the
issue. **Lead with what the attacker can do, not with how the bug works.**

> The `display_name` parameter on `POST /api/v1/profile` stores the attacker's
> payload as-is and renders it unescaped on every viewer's profile page,
> allowing a single attacker to execute JavaScript in the context of every
> authenticated user who views them.

### 2. Steps to reproduce (`steps_to_reproduce`)

A numbered list of the **minimum** commands / clicks required to reproduce
the finding on a clean environment. Each line must be actionable and assume
nothing about operator state.

1. Create or log in as a low-privilege user (role=`member`).
2. Submit `POST /api/v1/profile` with body `{"display_name":"<img src=x onerror=alert(1)>"}`.
3. Log in as a second user (role=`member` is fine).
4. Navigate to the attacker's profile page at `GET /users/<attacker-id>`.
5. Observe `alert(1)` fires in the viewer's browser.

If a step requires custom tooling, reference the `proof_of_concept` field
rather than inlining the whole script.

### 3. Proof of concept (`proof_of_concept`)

A fully-standalone PoC the triager can copy-paste. Prefer a curl script or
a single short HTTP request body over prose. Include the attacker user's
credentials if they were seeded for the scan.

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="https://target.example.com"
ATTACKER_COOKIE="session=<attacker-session>"

curl -sS -X POST "$BASE/api/v1/profile" \
  -H "Cookie: $ATTACKER_COOKIE" \
  -H "Content-Type: application/json" \
  --data '{"display_name":"<img src=x onerror=alert(1)>"}'

echo "Now visit $BASE/users/<attacker-id> as a different user."
```

### 4. Impact (`impact`)

Be concrete. Say what data is at risk, what privilege escalation is
possible, which users are affected, and whether the issue is
pre-authentication or post-authentication. Avoid generic language.

> Any authenticated user can execute arbitrary JavaScript in another user's
> browser context by persuading them to load the attacker's profile. Because
> the session cookie is not `HttpOnly`, the payload can exfiltrate the
> cookie and take over the account, including administrator accounts.

### 5. Remediation (`remediation`)

Tell the engineer exactly what to change. Cite the library / framework
mitigation where possible. Ordered by preference.

1. HTML-encode `display_name` on render (e.g. Jinja `{{ user.display_name }}`, React text nodes, etc.).
2. Add a strict Content-Security-Policy header with `default-src 'self'; script-src 'self' 'nonce-<per-request>'`.
3. Re-issue session cookies with the `HttpOnly` and `SameSite=Lax` attributes.
4. Add a unit test that renders `<script>` literally into HTML and asserts the escape.

### 6. References (`references`)

Authoritative links only. At least one for high/critical.

- https://owasp.org/Top10/A03_2021-Injection/
- https://cwe.mitre.org/data/definitions/79.html
- Vendor / library advisory URL, if any.

---

## Style guide for the agent

- **Lead with the attacker outcome**, not the code path. Triagers read the
  first 200 characters and move on if it reads like "the function is
  insecure".
- **Never** copy attacker-supplied strings into the report without
  delimiters - wrap payloads in backticks or fenced code blocks.
- **Do not** include the full HTTP response body. Include only the minimum
  bytes proving the vulnerability.
- **Do not** speculate ("this may allow RCE"). If you cannot reach that
  state, keep the severity honest.
- **Deduplicate**. Before creating a new report, check the existing list
  via the tracer; if the same weakness was already reported against the
  same affected asset, add a note to the existing finding instead.
