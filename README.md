# Web application starter

A neutral starting point for websites, web applications, and SaaS products.

## Development

Use Node.js 22.12 or newer and Bun or npm.

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## Commands

- `npm run dev` — local development.
- `npm run build` — production output.
- `npm run preview` — preview production output after building.
- `npm test` — run automated tests.

## Structure

- `src/routes/index.tsx` — home page.
- `src/routes/__root.tsx` — shared document and error boundaries.
- `src/styles.css` — design tokens and global styles.
- `src/components/ui` — reusable interface controls.
- `src/start.ts` — request error handling and cross-site request protection.
- `src/server.ts` — server entry and fallback error responses.

The development configuration uses direct Vite, TanStack Start, React, Tailwind, and Nitro plugins without a proprietary adapter. Production output is written to `dist/client` and `dist/server` for Cloudflare deployment. Platform-managed editor scripts, hosting URLs, and automatically restored project instructions are outside the application source.

Authentication, payments, and persistent storage are not configured in this starter.
