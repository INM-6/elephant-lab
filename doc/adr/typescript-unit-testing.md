# TypeScript Unit Testing

## Decision

**Chosen framework: Vitest**

For this project, Vitest is the preferred unit-testing framework. Jest remains a strong and mature alternative, but Vitest provides a better fit for a modern TypeScript codebase because of its TypeScript experience, modern module support, development speed, and Jest-compatible API.

---

## 1. Goals

The unit-testing setup should:

- Make it easy to write and maintain unit tests in TypeScript.
- Keep test configuration and tooling reasonably simple.
- Support modern ECMAScript Modules (ESM).
- Provide assertions, mocking, snapshots, and code coverage.
- Support fast local development and watch mode.
- Work well with a dedicated `tests/` directory.
- Be suitable for CI/CD.
- Avoid unnecessary tooling or duplicated configuration.

---

## 2. Candidate: Jest

[Jest](https://jestjs.io/) is a mature JavaScript/TypeScript testing framework with a large ecosystem and extensive documentation.

### Example

```ts
import { describe, expect, it } from '@jest/globals';
import { add } from '../src/math';

describe('add', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
});
```

### Pros

- **Very mature and widely adopted.**
  Jest has been used extensively across JavaScript and TypeScript projects for many years.

- **Large ecosystem.**
  There are many examples, integrations, plugins, and community resources available.

- **Excellent mocking support.**
  Jest provides powerful APIs such as `jest.fn()`, `jest.mock()`, and `jest.spyOn()`.

- **Rich feature set.**
  Jest provides assertions, snapshots, mocking, fake timers, coverage, and other testing capabilities.

- **Good choice for existing projects.**
  If a project already uses Jest, continuing to use it avoids the cost and risk of migration.

### Cons

- **More configuration can be required for TypeScript and modern module setups.**
  Depending on the project, TypeScript may involve Babel, `ts-jest`, or separate TypeScript compilation/type-checking.

- **ESM can require additional configuration.**
  Jest's current documentation still describes its ESM support as experimental, so projects using modern ESM may encounter additional configuration or limitations.

- **Can duplicate tooling in Vite-based projects.**
  Jest has its own transformation/configuration pipeline, whereas Vitest can reuse Vite's pipeline.

- **Potentially slower development feedback.**
  For some projects, especially larger ones, Vitest's Vite-based approach can provide faster feedback during development.

---

## 3. Candidate: Vitest

[Vitest](https://vitest.dev/) is a modern testing framework powered by Vite. It can also be used for backend/Node.js code and does not require the project itself to use Vite.

### Example

```ts
import { describe, expect, it } from 'vitest';
import { add } from '../src/math';

describe('add', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
});
```

### Pros

- **Excellent TypeScript experience.**
  Vitest runs on top of Vite, so TypeScript works naturally without requiring `ts-jest` or a separate test build step.

- **Modern ESM support.**
  Vitest is designed around modern JavaScript tooling and works naturally with ESM-style `import` and `export`.

- **Fast development workflow.**
  Vitest provides a watch mode designed to rerun affected tests quickly.

- **Jest-compatible API.**
  The API is intentionally similar to Jest. Familiar concepts include `describe`, `it`, `expect`, mocks, snapshots, and coverage.

- **Simple mocking API.**
  Jest-style functionality is available through `vi`, for example `vi.fn()`, `vi.mock()`, and `vi.spyOn()`.

- **Good Vite integration.**
  If the project uses Vite, Vitest can reuse the same configuration, plugins, and transformation pipeline.

- **Suitable for backend code as well.**
  Vitest is not limited to frontend applications and can be used for Node.js/TypeScript services.

### Cons

- **Smaller ecosystem than Jest.**
  Jest has existed longer and therefore has a larger ecosystem and more historical examples.

- **Some Jest-specific integrations require adaptation.**
  Code written specifically against Jest's APIs or internals may need changes when using Vitest.

- **Not identical to Jest.**
  Although the APIs are similar, there are differences in mocking, timers, globals, types, and some configuration behavior.

---

## 4. Comparison

| Criteria | Jest | Vitest |
|---|---|---|
| TypeScript experience | Good | Excellent |
| ESM experience | Good, but more configuration may be required | Excellent |
| Development speed | Good | Excellent |
| Watch mode | Yes | Yes |
| Assertions | Excellent | Excellent |
| Mocking | Excellent | Excellent |
| Snapshots | Yes | Yes |
| Code coverage | Yes | Yes |
| Ecosystem | Excellent | Very good and growing |
| Vite integration | Additional setup may be needed | Native |
| Backend/Node.js | Yes | Yes |
| Migration from Jest | N/A | Relatively straightforward |
| Configuration complexity | Can be higher | Generally low for modern projects |

---

## 5. Test Directory Structure

Tests will be kept in a dedicated `tests/` directory rather than next to production source files.

Recommended structure:

```text
project/
├── src/
│   ├── services/
│   │   ├── UserService.ts
│   │   └── OrderService.ts
│   ├── utils/
│   │   └── validation.ts
│   └── index.ts
│
├── tests/
│   ├── services/
│   │   ├── UserService.test.ts
│   │   └── OrderService.test.ts
│   └── utils/
│       └── validation.test.ts
│
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

This keeps production code and test code clearly separated while preserving a recognizable relationship between source files and their tests.

For example:

```text
src/services/UserService.ts
tests/services/UserService.test.ts
```

Vitest supports test files in dedicated directories and recognizes files containing `.test.` or `.spec.` by default.

---

## 6. Basic Vitest Setup

Install Vitest as a development dependency:

```bash
npm install -D vitest
```

Add a test script:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

A basic `vitest.config.ts` can explicitly define the dedicated test directory:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

Tests can then be run interactively with:

```bash
npm test
```

or once, which is useful for CI:

```bash
npm run test:run
```

---

## 7. Example Unit Test

Production code:

```ts
// src/math.ts

export function add(a: number, b: number): number {
  return a + b;
}
```

Test:

```ts
// tests/math.test.ts

import { describe, expect, it } from 'vitest';
import { add } from '../src/math';

describe('add', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('handles negative numbers', () => {
    expect(add(-2, 3)).toBe(1);
  });
});
```

The basic pattern is:

```ts
describe('unit under test', () => {
  it('describes expected behavior', () => {
    expect(actual).toBe(expected);
  });
});
```

---

## 8. Why Vitest Was Chosen

Vitest is preferred for this project for several reasons.

### 8.1 Modern TypeScript workflow

This project is TypeScript-based, so minimizing configuration around TypeScript is valuable. Vitest's Vite-based architecture provides TypeScript support without requiring `ts-jest` or a separate test transformation setup.

### 8.2 Modern ESM

The project can use modern `import`/`export` syntax without making the test framework itself a major source of ESM-specific configuration.

Jest supports ESM, but its documentation currently notes that ESM support is still experimental. This makes Vitest a more natural choice when modern ESM is an important part of the project's architecture.

### 8.3 Fast feedback during development

Unit tests should be run frequently during development. Vitest's watch mode and Vite-based architecture make fast feedback a core part of the development experience.

### 8.4 Familiar API

Choosing Vitest does not mean giving up the familiar Jest testing model.

The following concepts are essentially the same:

```text
Jest                 Vitest
--------------------------------
describe()           describe()
it() / test()        it() / test()
expect()              expect()
jest.fn()             vi.fn()
jest.mock()           vi.mock()
jest.spyOn()          vi.spyOn()
```

This also reduces the risk of the team being locked into a difficult-to-understand proprietary testing style.

### 8.5 Sufficient feature set

The project needs normal unit-testing capabilities rather than a highly specialized testing platform.

Vitest provides the required capabilities:

- Unit tests
- Assertions
- Mocks and spies
- Snapshots
- Coverage
- Async tests
- Watch mode
- Type testing capabilities
- Node.js/backend testing
- Browser/DOM testing through supported environments when needed

Therefore, Jest's larger ecosystem does not provide enough additional value for this project to outweigh the advantages of Vitest.

---

## 9. Decision

**Decision: Use Vitest for TypeScript unit testing.**

The primary reasons are:

1. **Better fit for a modern TypeScript/ESM project.**
2. **Less TypeScript-specific configuration.**
3. **Fast feedback during local development.**
4. **Strong mocking, assertion, snapshot, and coverage capabilities.**
5. **Jest-compatible API, reducing the learning curve.**
6. **Good support for both frontend and backend TypeScript code.**
7. **Lower tooling duplication when Vite is part of the project.**

Jest remains a valid choice and should be reconsidered if the project later needs a Jest-specific integration or joins an existing ecosystem that standardizes on Jest.

For a new project, however, **Vitest provides the better overall balance of simplicity, modern tooling, developer experience, and functionality.**

---

## 10. References

- Vitest documentation: https://vitest.dev/
- Vitest comparison with Jest: https://vitest.dev/guide/comparisons
- Vitest migration guide from Jest: https://vitest.dev/guide/migration/jest
- Jest documentation: https://jestjs.io/docs/getting-started
- Jest configuration documentation: https://jestjs.io/docs/configuration
