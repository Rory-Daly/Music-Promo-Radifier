# Coding Conventions

## TypeScript

- Strict mode always — no `any` types
- Prefer `type` over `interface` for simple shapes; use `interface` for objects that may be extended
- Export types from a central `src/types/` directory

## Components

- One component per file, co-located with its test
- File names match component names (PascalCase)
- Props typed explicitly — never infer from usage

## Styling

- Tailwind CSS only — no inline styles, no CSS modules unless unavoidable
- Mobile-first responsive design
- Use `cn()` utility for conditional class merging (install `clsx` + `tailwind-merge`)

## API / Server

- Validate all inputs at the boundary — never trust client data
- Use Zod for runtime validation
- Return consistent error shapes: `{ error: string, code: string }`
- Correct HTTP status codes always

## Logging

- Never log PII (names, emails, user IDs) in server-side `console.log` — these flow to Vercel logs and any connected log drains
- Narrow caught errors before logging: `err instanceof Error ? err.message : String(err)` — raw error objects from third-party SDKs can contain token fragments or full response bodies
- Log operational facts (file sizes, counts, durations), not user data

## Testing

- **Mandatory**: When you add a new component, hook, utility, or API route, write its test file as part of the same task — before marking the task complete. No exceptions.
- Co-locate tests: `Button.tsx` → `Button.test.tsx`
- Test user behaviour, not implementation details
- Arrange → Act → Assert pattern
- Every test: happy path + invalid input + (if applicable) auth failure
- Use the `test-writer` subagent for complex test scenarios

## Commits

Use conventional commits: `type(scope): description`
Types: `feat` / `fix` / `refactor` / `test` / `docs` / `chore` / `style`
Examples:

- `feat(auth): add Google OAuth login`
- `fix(api): handle missing user ID in profile endpoint`
- `chore(deps): update Tailwind to v4`
