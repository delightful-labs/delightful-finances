# Repository working agreements

- Follow `.specify/memory/constitution.md` and the active feature artifacts under `specs/`.
- Do not use `switch` statements or `case` clauses; use discriminated-union narrowing, lookup records, or clear conditional expressions.
- Work on one task at a time. Do not start another task until the current change has been shown to the user and reviewed.
- Use a small related set of files per focused review cycle, typically 3–6 implementation files. Multiple routes/components may change together. Discuss larger batches first; do not edit dozens of files without explicit authorization.
- Presentation components receive data and callbacks through props and render without Jazz sessions/queries or XState actors. Pages orchestrate those integrations through reusable script modules and compose pure components. Do not put rendered HTML at the same level as Jazz/XState initialization; UI-library components and localization are allowed. Do not create components merely to relocate page templates.
- Keep components small and reusable. Do not invent visual styling or add decorative UI unless the user approves that direction.
- Name entity validation files to match their schema files (for example, `schema/transactions.ts` and `validation/transactions.ts`). Keep canonical validation and its derived form adapters together.
- Do not add or run tests until the user has reviewed and approved the implementation that those tests will cover. After approval, add the needed unit and Playwright coverage and run only the relevant checks.
- Use the repository Prettier configuration. Do not format unrelated files.
- Whenever starting a development server, tell the user and provide its URL so they can open the same server.
- Never commit unless the user explicitly authorizes the commit.
- Delightful Labs operates through open source and open learning. Create its GitHub repositories as public unless the user explicitly requests otherwise.
