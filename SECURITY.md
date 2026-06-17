# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅ Active |

Security fixes are backported to the current minor release only.

---

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues securely via GitHub's Private Vulnerability Reporting feature:
1. Go to the **Security** tab of the repository.
2. Click **Advisories** in the sidebar.
3. Click **Report a vulnerability**.

Include the following:

- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Affected versions
- Any suggested mitigations, if known

---

## Response Timeline

| Stage                          | Target          |
| ------------------------------ | --------------- |
| Initial acknowledgement        | 48 hours        |
| Severity assessment            | 5 business days |
| Fix and coordinated disclosure | 90 days         |

We follow responsible disclosure. We will coordinate a disclosure timeline with you and credit reporters in the release notes unless you request anonymity.

---

## Scope

The following are in scope:

- Authentication bypass in `@realtimemongo/server`
- Authorization bypass (subscribing to documents without permission)
- Remote code execution or server-side injection via WebSocket messages
- Denial-of-service vulnerabilities in the transport or change stream layer
- Protocol-level issues that allow data leakage across tenants

The following are out of scope:

- Vulnerabilities in MongoDB itself
- Vulnerabilities in the `ws` or `mongodb` npm packages (report upstream)
- Issues requiring physical access to the server
- Social engineering

---

## Security Design

See [docs/security.md](./docs/security.md) for the full security architecture documentation.
