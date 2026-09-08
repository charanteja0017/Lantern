# NovaHunter report templates

This folder holds the **canonical** templates the agent aims to produce,
and the renderers consume. They are the single source of truth for the
shape of an exported report.

| File | Purpose |
|------|---------|
| [`finding.md`](./finding.md) | Per-finding template aligned with HackerOne / Bugcrowd / OpenBugBounty conventions. |
| [`executive-summary.md`](./executive-summary.md) | Executive summary that sits at the top of every report. |

## Hierarchy

A fully-rendered report consists of:

1. **Executive summary** (`executive-summary.md`) - one page, human-first.
2. **Table of contents** - auto-generated from findings, in severity order.
3. **Per-finding sections** - one `finding.md` per `FindingReport`, rendered
   via the backend renderer (Markdown/PDF/HTML/TXT/JSON/SARIF/CSV).
4. **Appendix** - evidence artifacts, request/response captures, scope notes.

## Validation

The `FindingReport` pydantic model in
`strix/api/services/report_schema.py` enforces the minimum shape. Every
template field maps to a model field; if the agent fills the template
correctly, the normalizer accepts the output on the first pass.

The `create_vulnerability_report` and `finish_scan` tool schemas point the
LLM at these templates so it has the exact narrative style to emulate.

## Style

Follow the style guide at the bottom of [`finding.md`](./finding.md#style-guide-for-the-agent):

- Lead with the attacker outcome.
- Cite CWE + OWASP Top 10 by code.
- Include a copy-paste PoC.
- Include a concrete remediation plan, not generic best-practices.
- At least one authoritative reference URL for every high or critical finding.
