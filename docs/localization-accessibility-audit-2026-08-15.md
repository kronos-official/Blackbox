# Localization and accessibility audit — 2026-08-15

The Mini App localization layer provides twelve supported locales through the centralized dashboard dictionary. Tests cover locale selection, persistence, direction metadata, localized shell/panel copy, role labels, and English-copy leakage prevention. The English regression specifically rejects Persian-script fallback text in the English shell and panel copy.

RTL/LTR behavior is driven by the selected locale and document language/direction metadata. The authentication gate exposes an accessible live status and distinct preparing, connecting, verifying, and unavailable states. Loading transitions and reduced-motion-safe CSS behavior are covered by the existing dashboard and gate tests. The project also contains responsive, mobile-first panel layouts and keyboard-reachable UI primitives from the shared component library.

The remaining limitation is deliberate: visual confirmation of authenticated Mini App pages, identity-scoped group lists, and role-specific controls requires a genuine signed Telegram Mini App session for each role. The public preview can only show the authentication gate and must not be treated as evidence of authenticated dashboard rendering. Those live-only checks remain open in `todo.md`.
