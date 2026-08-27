# Pella free runtime notes

The Pella Telegram Bot wizard imports the repository source but does not retain Git build outputs ignored by `.gitignore`. The free server created on 27 August 2026 exposes a Node main-file setting and an environment-variable form. The repository now supplies a root `index.js` shim: set Pella's **Main File** to `index.js`. It launches the typed Express/Telegraf service through `tsx` and defaults to production mode without requiring a host-side build command.

The free tier is limited to 100 MB RAM and is renewed through Pella's free-tier mechanism. It is useful for verifying the Telegram worker, but production stability for the dashboard, market services, MySQL access, and SSE must be validated against actual runtime logs.
