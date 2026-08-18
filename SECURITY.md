# Security Policy

## Reporting a vulnerability

Report privately, not in a public issue. Two ways, either is fine:

- **GitHub**: [open a private advisory](https://github.com/freyotrisolana/mindjack-mcp/security/advisories/new)
  on this repository.
- **Email**: security reports to **freyo@mindjack.xyz**. Put `security` in the
  subject so it is not read as ordinary support.

You will get a first reply within **72 hours**, and an assessment with a fix or
a mitigation plan within **7 days**. If a report turns out to affect the hosted
API rather than this package, it is handled the same way and you will be told
which it was.

Please include what you need to make it reproducible: the version, the tool or
endpoint, the request, and what you expected instead. A proof of concept helps
and is never required.

## Supported versions

| Version | Supported           |
| ------- | ------------------- |
| 1.3.x   | Yes                 |
| 1.2.x   | Security fixes only |
| < 1.2   | No                  |

This package is a thin client over `https://api.mindjack.xyz`. A fix to the
hosted API reaches every caller without a release; a fix to this package needs
one, and security releases are published the same day they are ready.

## Scope

In scope: this package, the tool schemas it advertises, the credential handling
around `MINDJACK_API_KEY` (including the file it writes at
`~/.config/mindjack/key`), and the hosted MCP endpoint at
`https://api.mindjack.xyz/mcp`.

Out of scope: the accuracy of an answer. A verdict you disagree with is not a
vulnerability, and the measured hit rate behind every verdict is published at
[`/v1/scorecard`](https://api.mindjack.xyz/v1/scorecard). Denial-of-service by
volume against the hosted API is also out of scope: it is rate limited and
metered by design.

## What we will not do

We will not pursue anyone who reports in good faith through the channels above,
and we will not ask you to stay quiet indefinitely. Once a fix is out, disclose
what you like. Credit is offered by default and withheld only if you ask.
