<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Project conventions

- Keep TanStack Start file-based routing and the root Outlet; these are the application's routing foundation.
- Configure Vite with direct framework, React, Tailwind, and Nitro plugins; preserve SSR and the dist/client and dist/server deployment layout without a proprietary adapter.
- Keep the server error wrappers and CSRF middleware; they provide readable failures and cross-site request protection.
- Use local assets and neutral route metadata; the starter must not depend on external placeholder images.
- Keep error boundaries provider-independent and log caught errors to the console; application code should not require proprietary browser telemetry hooks.
- Do not rewrite published Git history; synchronized collaborators rely on stable history.
