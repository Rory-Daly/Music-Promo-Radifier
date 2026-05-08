# Project Specification — [APP_NAME]

> Fill this in before writing any code. Claude reads this at session start.
> Generate a draft using Gemini 2.5 Pro with the prompt in CLAUDE.md.

## Overview

**Problem being solved:**
[What pain does this solve? For whom?]

**Core value proposition:**
[One sentence: what does this app do better than the alternative?]

**Target users:**
[Who uses this? What are their goals?]

---

## Feature List (v1 only)

List only what will be built in v1. Be explicit about what is OUT of scope.

### In scope

- [ ] Feature 1
- [ ] Feature 2

### Out of scope (v2+)

- Feature X
- Feature Y

---

## User Roles & Permissions

| Role   | Can do | Cannot do |
| ------ | ------ | --------- |
| [role] | ...    | ...       |

---

## Data Models

### [ModelName]

| Field      | Type      | Notes       |
| ---------- | --------- | ----------- |
| id         | uuid      | primary key |
| created_at | timestamp | auto        |

---

## Pages & User Flows

### [Page name] — `/route`

**Who sees it:** [role]
**Purpose:** [one line]
**Key interactions:**

- User does X → Y happens
- User does A → B happens

---

## Data Flows (if applicable)

> Skip this section for apps with no external data ingestion or ETL work.

### Sources

| Source          | Format | Frequency | Owner  |
| --------------- | ------ | --------- | ------ |
| [e.g. Xero API] | JSON   | Daily     | [team] |

### Transformation layers

| Layer       | Location                                | Description                   |
| ----------- | --------------------------------------- | ----------------------------- |
| Raw         | [e.g. BigQuery `raw` dataset]           | Immutable copy of source data |
| Transformed | [e.g. BigQuery `transformed` dataset]   | Cleaned, normalised, joined   |
| Serving     | [e.g. BigQuery `serving` dataset / API] | Aggregated, app-ready         |

### Data quality gates

List the assertions that must pass before data is promoted to the serving layer:

- [ ] [e.g. Row count non-zero]
- [ ] [e.g. Required fields non-null]
- [ ] [e.g. Totals reconcile with source]

---

## API Endpoints (if applicable)

| Method | Route      | Auth     | Description |
| ------ | ---------- | -------- | ----------- |
| GET    | `/api/...` | required | ...         |
| POST   | `/api/...` | required | ...         |

---

## Error States

List every meaningful error the user might encounter and how the app handles it:

- [ ] Network failure
- [ ] Auth token expired
- [ ] [App-specific errors]

---

## Tech Stack Decisions

| Layer      | Choice               | Why                                   |
| ---------- | -------------------- | ------------------------------------- |
| Frontend   | Next.js 15           | App Router, TypeScript, Vercel-native |
| Styling    | Tailwind CSS         | Fast iteration, Claude writes it well |
| Database   | [e.g. Supabase]      | [reason]                              |
| Auth       | [e.g. Supabase Auth] | [reason]                              |
| Deployment | Vercel               | Next.js native, preview deployments   |

---

## Environment Variables

```
# .env.example
NEXT_PUBLIC_APP_URL=http://localhost:3000
# Add all required vars here with placeholder values
```

---

## Open Questions

Things that need a decision before or during build:

- [ ] Question 1
- [ ] Question 2
