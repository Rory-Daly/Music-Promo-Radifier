# Testing Workflow

## Philosophy

Strict TDD (test-first always) is impractical for UI work where the component API is discovered during construction. This project uses **pragmatic TDD**: test-first where the contract is known upfront, test-alongside everywhere else. The non-negotiable rule is tests ship with the code — never after.

---

## By type

### Utilities, parsers, business logic — test first

The contract is known before you write a line. Write the tests first, then implement until they pass.

```typescript
// 1. Write the test
it('returns formatted date string', () => {
  expect(formatDate(new Date('2026-01-15'))).toBe('15 Jan 2026');
});

it('returns "Invalid date" for null input', () => {
  expect(formatDate(null)).toBe('Invalid date');
});

// 2. Now implement formatDate
```

### API routes — write failure cases first

The dangerous cases (unauthed access, invalid input) are the most important and their shape is always known upfront. Write those tests first, then implement the route, then add the happy-path test.

```typescript
// 1. Auth failure — write first
it('returns 401 when not authenticated', async () => {
  const res = await GET(new Request('http://localhost/api/resource'));
  expect(res.status).toBe(401);
});

// 2. Invalid input — write first
it('returns 400 when body is missing required fields', async () => {
  const res = await POST(new Request('http://localhost/api/resource', {
    method: 'POST', body: JSON.stringify({}),
  }));
  expect(res.status).toBe(400);
});

// 3. Implement the route

// 4. Happy path — write after
it('creates resource and returns 201', async () => { ... });
```

### Components — build first, test immediately after

Build the component, then write tests before moving to the next task. No "I'll add tests later."

```typescript
// After building <Button>, immediately write:
it('calls onClick when clicked', async () => {
  const onClick = vi.fn();
  render(<Button label="Save" onClick={onClick} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onClick).toHaveBeenCalledOnce();
});

it('is disabled when isLoading', () => {
  render(<Button label="Save" onClick={() => {}} isLoading />);
  expect(screen.getByRole('button')).toBeDisabled();
});
```

---

## Coverage targets

| Type            | Minimum | Critical paths (auth, data mutation) |
| --------------- | ------- | ------------------------------------ |
| Utilities / lib | 90%     | 100%                                 |
| API routes      | 80%     | 100%                                 |
| Components      | 70%     | 90%                                  |

---

## What not to test

- Implementation details (internal state, private methods, exact DOM structure)
- Framework behaviour (Next.js routing, library internals)
- Third-party library code
- Trivial getters/setters with no logic

---

## Running tests

```bash
npm test           # watch mode
npm run test:run   # single pass (CI / pre-commit)
npm run coverage   # coverage report
```
