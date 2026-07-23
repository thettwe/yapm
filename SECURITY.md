# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](../../security/advisories/new), or email
**thettweaung@gmail.com** with `[yapm security]` in the subject.

Include what you found, how to reproduce it, and what an attacker could do with it. A proof of
concept helps but isn't required.

You'll get an acknowledgement within 72 hours and an assessment within a week. If the report is
valid, we'll agree on a disclosure timeline with you — the default is a fix released before
public disclosure, with credit to you unless you'd rather stay anonymous.

## Supported versions

yapm is pre-alpha. Until a 1.0 release, only the latest version receives security fixes.

## Scope

In scope: the yapm application, its container images, and its default self-hosted configuration.

Out of scope: vulnerabilities in third-party dependencies (report those upstream, though we
appreciate a heads-up), and issues that require an already-compromised host or database.

## For self-hosters

Security fixes ship in patch releases. Watch releases, or pin the `stable` image tag and pull
regularly — upgrades are `docker compose pull && docker compose up -d`, with migrations applied
automatically on boot.
