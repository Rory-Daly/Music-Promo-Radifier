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

## 3. Run the initial migration

The schema lives in `data/supabase/migrations/0001_init.sql`. Apply it via the SQL editor:

1. Supabase dashboard → **SQL Editor → New query**.
2. Paste the entire contents of `data/supabase/migrations/0001_init.sql`.
3. Click **Run**. Should complete in a second or two.

This creates:

- `users`, `artists`, `artist_memberships` (tenancy core)
- `tracks`, `clips`, `hooks`, `renders`, `posts` (content tables)
- RLS policies that enforce per-artist access through `is_member_of()`
- A trigger that mirrors `auth.users` rows into `public.users` on signup
- `updated_at` triggers on mutable tables

If you change the schema later, add `0002_*.sql` etc. and run them in order. We'll move to the Supabase CLI (`supabase db push`) once we set up a local dev workflow.

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

## Local dev shortcuts

For now we connect directly to the hosted Supabase. When iteration becomes painful, install the Supabase CLI:

```bash
brew install supabase/tap/supabase
supabase init
supabase start    # runs Postgres + Auth in Docker
```

That's a v2 setup. For v1 we ship from the hosted instance.
