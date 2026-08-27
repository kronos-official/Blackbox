# Kronos Guard — Security and Operations Audit

_Date: 2026-08-15_

This audit records the implemented safeguards around group safety and Telegram update processing. It is intentionally limited to behavior that is represented in code and tests; it does not claim validation of a Telegram account or group that was not supplied by the owner.

## Findings and controls

| Area | Implemented control | Evidence |
|---|---|---|
| Anti-spam and flood | Per-group/user event windows, bounded event append, configurable enforcement, and stale-window cleanup | `server/telegram/groupSafety.ts`, `server/telegram/groupSafety.test.ts` |
| Duplicate updates | Duplicate-message window keyed by group/user/message context, with stale cleanup | `server/telegram/groupSafety.ts` |
| Anti-raid | Join-window counting with deterministic threshold evaluation and stale cleanup | `server/telegram/groupSafety.ts` |
| Moderator exemptions | Explicit role/exemption checks before lock and safety enforcement | `server/telegram/groupSafety.ts`, role-policy tests |
| Audit records | Handler errors, moderation actions, role changes, payment transitions, and status views use structured audit paths | `server/telegram/bot.ts`, dashboard and Telegram audit tests |
| Race prevention | Webhook initialization is awaited, failed boot promises are cleared for retry, and payment/maintenance flows are idempotent | `server/telegram/routes.ts`, heartbeat and payment tests |
| Error handling | Telegram API errors are classified; stale reply targets use safe fallback; unexpected exceptions retain update/chat/actor context in audit | `server/telegram/replySafe.ts`, `server/telegram/botError.ts` |
| Rate limiting | Safety event windows are bounded and pruned; no unbounded per-request state is retained after the retention horizon | `pruneSafetyWindows()` and regression test |
| Telegram API usage | Bot actions are permission-scoped, state-aware before claiming success, and avoid attempting unsupported member enumeration | Telegram moderation, authorization, and dashboard tests |

## Residual limitations

Telegram privacy mode, Bot API member-enumeration limits, administrator permissions, channel accessibility, and signed Mini App identity can only be validated against a live Telegram session. The production audit therefore records only owner-authorized live evidence and keeps those limitations explicit.

## Operational conclusion

The code paths covered above have automated regression coverage and the production quality gate is green. The remaining live-only checks are tracked in `todo.md` and must not be represented as completed based solely on local tests.
