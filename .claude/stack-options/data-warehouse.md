# Stack Option: Data Warehouse + Analytics

Run this prompt in a new project to configure the template for a data warehousing
and analytics platform — ingesting data from external sources into BigQuery and
surfacing it as dashboards in a Next.js app.

**When to use:** projects where the primary value is data ingestion, transformation,
and visualisation. Finance, operations, and business intelligence dashboards.

**What this sets up:**

- CLAUDE.md updated with BigQuery, Cube.dev, data pipeline rules, and agent triggers
- PROJECT_SPEC.md drafted with data models and data flow sections
- `docs/data-conventions.md` — BigQuery, pipeline, schema, and data quality rules
- `docs/cube-conventions.md` — Cube.dev schema, pre-aggregation, and query conventions
- `.claude/agents/data-engineer.md` — specialist subagent for ETL, BigQuery, and Cube work

---

## Prompt

```
I'm setting up a data warehousing and analytics project using the claude-app-template.
The project ingests data from external sources into BigQuery and surfaces it as
dashboards and charts in a Next.js web app.

Please tailor this template for that context by completing all steps below.

---

## Step 1 — Update CLAUDE.md

Add to the Tech Stack section:
- **Data warehouse:** BigQuery
- **Ingestion:** [describe your sources, e.g. Xero API / QuickBooks / manual CSV upload]
- **Transformation:** BigQuery SQL + dbt (or pure BigQuery SQL — your choice based on complexity)
- **Semantic layer:** Cube.dev (sits between BigQuery and the app — caching, metrics definitions, access control)
- **Charting:** ECharts (run .claude/stack-options/echarts.md separately if not already done)

Add to the Key triggers section:
- Any data pipeline task → data-engineer subagent, check docs/data-conventions.md
- Any BigQuery query → must follow cost-safe patterns in docs/data-conventions.md
- Any new data source → update PROJECT_SPEC.md Data Sources section before writing code
- Any schema change → follow schema evolution rules in docs/data-conventions.md

Add a Key rules section for data work:
- Every pipeline/load job must be idempotent — re-runnable without duplicating data
- No SELECT * in any BigQuery query — always name columns explicitly
- All queries must prune partitions — never scan full tables
- Data quality gates must pass before promoting data to the serving layer
- Application layer queries data via Cube API — not direct BigQuery (pipelines/admin excepted)

---

## Step 2 — Fill in PROJECT_SPEC.md

Replace the placeholder sections with the following structure. Fill in bracketed
values with project-specific details before finishing this task.

### Data Sources
List each source:
- Name, type (API / file upload / webhook / etc.)
- Ingestion frequency (real-time / hourly / daily / on-demand)
- Raw landing location in BigQuery (dataset and table naming convention)

### Users
[Who uses this — internal finance team / external clients / both. Note if
multi-tenant access control is required.]

### Data Models (draft — refine as project develops)

**chart_of_accounts**
- account_id, account_code, account_name, account_type, parent_account_id,
  is_active, source_system, ingested_at

**transactions**
- transaction_id, account_id, period_id, amount, currency, description,
  transaction_date, source_system, source_id (for dedup), ingested_at

**periods**
- period_id, period_start, period_end, period_label, fiscal_year, fiscal_quarter

**dim_entity** (if multi-tenant)
- entity_id, entity_name, source_system, created_at

Add further models as needed for your domain.

### Data Flow

```

[Source Systems]
↓ (API pull / webhook / file upload)
[Raw Layer — BigQuery]
raw\_[source].[table] ← append-only, never modified after landing
↓ (dbt models or BigQuery SQL jobs)
[Transformed Layer — BigQuery]
transformed.[table] ← cleaned, typed, deduplicated
↓ (dbt models or BigQuery SQL jobs)
[Serving Layer — BigQuery]
serving.[table] ← aggregated, dashboard-ready, partition-optimised
↓
[Cube.dev]
Pre-aggregations cached ← millisecond query response, reduced BQ scan cost
↓
[Next.js App]
API routes → charts and dashboards

```

---

## Step 3 — Create docs/data-conventions.md

Create this file with the following content (expand each section with
project-specific detail as it becomes known):

### BigQuery Query Conventions
- Always name columns explicitly — no SELECT *
- Always include a partition filter on date/timestamp columns — never scan full tables
- Use LIMIT in exploratory or development queries
- Prefer aggregations in the serving layer over query-time aggregation in the app
- Use parameterised queries via the BigQuery client — never interpolate user input into SQL
- Add a cost estimate comment on any query expected to scan >1GB

### Pipeline Idempotency
- Every load job must be re-runnable without duplicating data
- Use MERGE or INSERT ... IF NOT EXISTS patterns, never plain INSERT
- Each source record must carry a stable source_id for deduplication
- Load jobs must be atomic — write to a staging table, then swap or merge
- Record job metadata (run_id, started_at, rows_loaded, status) in a pipeline_runs table

### Schema Evolution
- Adding a nullable column: safe — do it directly
- Adding a NOT NULL column: add as nullable first, backfill, then enforce constraint
- Renaming a column: add the new column, dual-write, migrate downstream, drop old
- Removing a column: deprecate with a comment for one release cycle before dropping
- Never change a column's type in place — add a new column with the correct type

### Data Quality Gates
Before promoting data from transformed → serving layer, assert:
- Row count is within expected range (no silent empty loads)
- No NULLs in required fields (account_id, transaction_date, amount)
- No duplicate source_ids in the current load window
- Referential integrity — all account_ids exist in chart_of_accounts
- Amount values are within plausible range (no orders-of-magnitude outliers)
- Date ranges are sensible (no future dates, no dates before source system launch)

Document each assertion in a data_quality_checks table with check_name, status,
rows_checked, rows_failed, run_id, checked_at.

### Chart and Visualisation Conventions
(See docs/charts.md if ECharts stack option has been run — otherwise document
your charting library choice and conventions here.)
- Charts always show a loading skeleton, never a blank space
- Charts always handle empty data gracefully with a visible empty state message
- Accessible: axes labelled, colours not the only differentiator, tooltips on hover
- Data fetched server-side where possible; client-side only for interactive filters

---

## Step 4 — Create .claude/agents/data-engineer.md

Create a data-engineer subagent with the following specification:

**Role:** Data pipeline engineer specialised in ETL/ELT design, BigQuery schema
design, query optimisation, and data quality. Called for any task involving
data ingestion, transformation, pipeline logic, or warehouse schema changes.

**Capabilities:**
- Design and implement idempotent ingestion pipelines
- Write BigQuery SQL following cost-safe conventions (docs/data-conventions.md)
- Design partitioned, clustered BigQuery schemas
- Write dbt models with appropriate materialisation strategies
- Implement data quality assertions and reconciliation logic
- Optimise slow or expensive queries

**Always does:**
- Reads docs/data-conventions.md before writing any pipeline or query
- Checks PROJECT_SPEC.md Data Models section before creating new tables
- Adds a pipeline_runs log entry for every load job
- Writes data quality assertions alongside every transformation
- Uses MERGE or INSERT ... IF NOT EXISTS — never plain INSERT

**Never does:**
- SELECT * in any query
- Query without a partition filter
- Interpolate user input into SQL strings
- Create a schema change without following the schema evolution rules

---

## Step 5 — Cube.dev integration

### Add to CLAUDE.md
- Application layer queries data via the Cube API — not direct BigQuery
- Direct BigQuery access is only used for pipeline/admin tasks
- Cube schema files live in cube/schema/ — one file per domain entity
- Pre-aggregations are required for any query used in a dashboard

### Create docs/cube-conventions.md with:

**Schema conventions**
- One schema file per domain entity (accounts.js, transactions.js, periods.js)
- Measure names: snake_case, descriptive (total_revenue not revenue)
- Dimension names: match the underlying BigQuery column names where possible
- Always define a primary key dimension for each cube
- Document the business definition of every measure with a description field

**Pre-aggregation rules**
- Every dashboard query must have a corresponding pre-aggregation
- Pre-aggregations are partitioned by time dimension (day/month/quarter)
- Use rollupJoin for cross-cube pre-aggregations
- Name pre-aggregations descriptively: monthly_revenue_by_account, not agg1

**Query patterns in the app**
- Use the Cube REST API via fetch in Next.js API routes or server components
- Never expose the Cube API token to the client — all Cube queries go server-side
- Shape Cube query results to ECharts series format in the API route, not the component
- Cache Cube API responses at the Next.js layer for frequently-viewed dashboards

**Access control**
- Use Cube's security context for row-level filtering (multi-tenant entity isolation)
- Pass the authenticated user's entity_id into the Cube security context via JWT
- Never pass access control filters as query parameters from the client

**Environment variables to add to .env.example:**
- CUBE_API_URL — Cube deployment URL
- CUBE_API_TOKEN — server-side only, never exposed to client

---

## Step 6 — Final checks

- Confirm .env.example has placeholder entries for: BIGQUERY_PROJECT_ID,
  BIGQUERY_DATASET, GOOGLE_APPLICATION_CREDENTIALS (or equivalent service account config)
- Add BIGQUERY_PROJECT_ID and related vars to .env.example if not already present
- Confirm data-engineer appears in the agents table in docs/agents.md
- Confirm docs/data-conventions.md and docs/cube-conventions.md are both linked from CLAUDE.md
- Confirm CUBE_API_URL and CUBE_API_TOKEN are in .env.example

---

Here is the current state of the project files:

[PASTE CONTENTS OF CLAUDE.md HERE]

---

[PASTE CONTENTS OF PROJECT_SPEC.md HERE]
```
