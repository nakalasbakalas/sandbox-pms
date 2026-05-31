# Dependency Upgrade Plan

## Completed in This Hardening Pass

The low-risk dependency batch has been upgraded and validated locally:

- React and React DOM to `19.2.6`
- React type packages to current `19.x`
- Tailwind CSS, `@tailwindcss/vite`, and `@tailwindcss/postcss` to `4.3.0`
- `@vitejs/plugin-react-swc` to `4.3.1`
- Zod to `4.4.3`

## Held Back Deliberately

### Vite 8

`vite@8.0.14` installs, but `@github/spark@0.46.2` currently declares peer support for Vite `^7.0.0 || ^6.4.1`. Keep Vite on `7.3.3` until the Spark plugin publishes Vite 8 peer support or the app removes that plugin dependency.

### Prisma 7

`prisma@7.8.0` and `@prisma/client@7.8.0` require moving the datasource URL into `prisma.config.ts` and updating runtime clients to use a PostgreSQL driver adapter. A compatibility migration was tested, but the current Prisma 7 toolchain introduced moderate `npm audit` findings through Prisma's dev stack. Keep Prisma on audited-clean `6.19.3` until a Prisma 7 release resolves that advisory.

## Review Cadence

Dependabot runs daily for npm updates. Revisit the held major upgrades when:

- `@github/spark` supports Vite 8.
- Prisma 7 has no known moderate-or-higher audit findings in this app.
- A branch can run `npm run launch:check` and `npm run test:e2e:db` against a disposable database.
