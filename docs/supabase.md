# Supabase setup

Legatograph's multi-artist app layer runs on Supabase: Postgres + Auth + Storage + Row-Level Security. The standalone CLIs (`hooks:detect`, `reel:compose`, `reel:auto`) don't need Supabase — only the Next.js app does.

## 1. Create a Supabase project

1. Sign in at the [Supabase dashboard](https://supabase.com/dashboard).
2. Click **New project** → free tier is fine to start. Pick a region close to Brisbane (e.g. **Sydney `ap-southeast-2`**).
3. Set a database password and save it somewhere safe. You won't need it for the app — Supabase Auth handles user passwords — but it'll matter for direct Postgres access later.
4. Wait ~1 minute for provisioning to finish.

## 2. Grab the API keys

In the project: **Settings → API**. Copy three values into `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key shown on the page>
SUPABASE_SERVICE_ROLE_KEY=<the service role key shown on the page>
```

- The **anon** key is safe to expose to the browser (it only allows what RLS allows).
- The **service role** key bypasses RLS. **Never** ship it to the browser. We use it for server-side admin tasks like running migrations or background jobs.

## 3. Run the migrations

Prefer the CLI (see [Migration workflow with the Supabase CLI](#migration-workflow-with-the-supabase-cli) below) — it tracks state, fails loudly on partial application, and avoids the silent-skip problems we hit early on. The SQL editor remains a useful fallback for diagnostics and one-off statements.

To apply manually via the SQL editor: open **SQL Editor → New query**, paste each file under `data/supabase/migrations/` in numeric order, run them one after another.

The initial migration creates:

- `users`, `artists`, `artist_memberships` (tenancy core)
- `tracks`, `clips`, `hooks`, `renders`, `posts` (content tables)
- RLS policies that enforce per-artist access through `is_member_of()`
- A trigger that mirrors `auth.users` rows into `public.users` on signup
- `updated_at` triggers on mutable tables

Subsequent migrations add storage buckets (`0002`) and the security-definer artist-creation RPC (`0003`).

## 4. Configure Auth redirect URLs

In **Authentication → URL Configuration**:

- **Site URL:** `http://localhost:3000` for local dev. Add your Vercel URL once deployed.
- **Redirect URLs:** add `http://localhost:3000/auth/callback` (and the production equivalent later).

This is what the magic link points back to. Without it Supabase will reject the redirect.

## 5. Verify locally

```bash
npm run dev
```

Then open `http://localhost:3000`. You should be redirected to `/sign-in` (middleware sees no session). Enter your email, click the link in your inbox, and you'll land on the dashboard with a fresh artist auto-created from your email handle.

## Troubleshooting

- **"Invalid login URL" in Supabase logs** → check the redirect URLs in step 4.
- **Magic link goes to localhost on production** → set `Site URL` to the production domain.
- **RLS denies everything** → make sure you're signed in. The middleware should redirect you to `/sign-in` if not, but server-rendered queries with no session get nothing.
- **Trigger didn't create a `public.users` row** → re-run the migration; the trigger creation is idempotent. Or insert manually: `insert into public.users (id, email) select id, email from auth.users where id = auth.uid();`

## Migration workflow with the Supabase CLI

The CLI is already installed as a devDependency. All commands assume you're at the repo root.

### One-time setup

1. **Authenticate:**

   ```bash
   npx supabase login
   ```

2. **Link this checkout to your Supabase project.** Your project ref is the prefix before `.supabase.co` (find it in the [dashboard](https://supabase.com/dashboard) → project settings → "Reference ID"):

   ```bash
   npm run db:link -- --project-ref <your-ref>
   ```

   This writes a local pointer under `data/supabase/.temp/` (gitignored).

3. **If you've already applied migrations manually via the SQL editor**, tell the CLI those versions are live so it doesn't re-run them:

   ```bash
   npm run db:repair -- --status applied 0001 0002 0003
   ```

   Skip this on a fresh project that has never had migrations applied.

### Day-to-day

| Action | Command |
|---|---|
| Apply pending migrations to the linked project | `npm run db:push` |
| List which migrations are local vs. remote | `npm run db:status` |
| Scaffold a new migration file | `npm run db:new <name>` |
| Pull the live schema back into a local migration | `npm run db:pull` |
| Run any other Supabase CLI command | `npm run db -- <args>` |

### Auditing the live project

If something feels off (RLS denies, missing bucket, table-not-found), paste [`data/supabase/diagnostics/audit.sql`](../data/supabase/diagnostics/audit.sql) into the [SQL editor](https://supabase.com/dashboard/project/_/sql) and run it. Each section emits a result set you can compare against the inline "Expected" comments. Common gaps:

- Missing policies on `artists`, `artist_memberships` → re-apply the relevant `create policy` blocks from `0001_init.sql`.
- Missing storage buckets → run `0002_storage_buckets.sql`, or create them in **Storage → New bucket** (tracks/clips private, renders public).
- Missing `create_artist_with_owner` function → run `0003_create_artist_rpc.sql`.

### Local Postgres stack (optional)

`npm run db -- start` boots Postgres + Auth + Storage + Studio in Docker for offline development. Not required for the cloud flow; useful when you want to iterate on migrations without round-tripping to Supabase.
