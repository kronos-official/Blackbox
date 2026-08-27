# Pella free runtime notes

The Pella Telegram Bot wizard imports the repository source but does not retain Git build outputs ignored by `.gitignore`. The free server created on 27 August 2026 exposes a Node main-file setting and an environment-variable form. The repository supplies a root `index.js` shim and a checked-in `pella-release/` production bundle: set Pella's **Main File** to `index.js`. It starts the compiled Express/Telegraf service without requiring a host-side build command or TypeScript runtime.

The free tier is limited to 100 MB RAM and is renewed through Pella's free-tier mechanism. It is useful for verifying the Telegram worker, but production stability for the dashboard, market services, MySQL access, and SSE must be validated against actual runtime logs.

On 27 August 2026, Pella's Node 20 runtime installed production dependencies but omitted `devDependencies`; the first start therefore returned `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx' imported from /app/`. The production release bundle is the preferred workaround. `tsx` has also been moved to `dependencies` as a compatibility fallback.
