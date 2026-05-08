Run a security review of the entire codebase (or the files changed in this session if specified).

Use the security-reviewer agent to check for:
- Hardcoded secrets or API keys
- Missing authentication on protected routes
- Broken object-level authorisation (users accessing other users' data)
- SQL injection or XSS vulnerabilities
- Sensitive data in API responses or logs
- Dependencies with known CVEs (`npm audit`)

Output findings grouped by severity: Critical / High / Medium / Low.
Fix all Critical and High findings immediately.
Add `// TODO(security):` comments for Medium and Low findings.

End with: X critical fixed, Y high fixed, Z medium flagged, W low flagged.
