# Executive summary template

The executive summary sits at the top of every exported report. It is the
first (and for most readers, the only) page decision-makers read. Keep it
crisp: results, risk, and what to do next. One page max.

## Required sections

### Engagement overview

- **Target**: fully-qualified URL / scope.
- **Time window**: start - end in UTC.
- **Scan profile**: one of `quick`, `standard`, `deep`.
- **Mode**: `blackbox` or `whitebox (repo=<owner/name>@<sha>)`.
- **Agents**: number of agents and human minutes saved vs. manual.

### Risk at a glance

A single severity-count table. Numbers only, sorted critical -> informational.

| Severity | Count |
|-----------|-------|
| Critical | N |
| High | N |
| Medium | N |
| Low | N |
| Informational | N |

If any critical or high findings exist, the one-sentence narrative directly
under the table MUST name them, for example:

> Two critical findings require urgent remediation: **CVE-ready RCE in
> `/api/v1/import`** and **stored XSS with cookie exfiltration on `/profile`**.

### Top findings (highest severity first)

Bullet list of up to five items. Each item is one sentence starting with
the impact.

- **Critical - RCE on `/api/v1/import`**: the `archive` parameter is
  passed to `tar -xvf` unsanitized; attackers can drop a PHP webshell under
  `/var/www/html/`.
- **High - Reflected XSS on `/search`**: ...

### Recommended next steps

Three to five ordered actions the blue team should take *this week*. Prefer
specific over generic.

1. Patch the `archive` handler (see Finding #1) and redeploy.
2. Enable CSP with a per-request nonce sitewide.
3. Rotate all session cookies issued during the scan window.
4. Add a retest scan targeting only Finding #1 and #2 once patches land.

### Caveats

- Testing was **authenticated as** *role=member*. Unauthenticated surface
  is not covered unless explicitly noted.
- The scan was conducted from IP `<vpn-egress-ip>` via the configured VPN
  profile.
- Agents ran with `allow_dangerous_commands=false` and within the
  configured rate-limit (`max_rps_per_host`).

---

The agent should copy this template verbatim and fill it. Do not add
paragraphs of justification or meta-commentary.
