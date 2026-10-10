# UI prototype archive (not part of the build)

These files were added to `src/` by a different tool while the real application was being built.
They are a **mock-data visual prototype**: products, cart and sales live in client-side state
(`retail-context.tsx`, `mock-data.ts`), nothing is saved, and there is no authentication or
authorization. They were moved here, unmodified, so the real billing screens could use the same
routes. They are excluded from TypeScript, ESLint and the test runner.

Nothing here is used by the application. It is kept for design reference only (layout, copy,
visual language). To restore a file, copy it back under `src/` at the same relative path.
