# Kronos Guard and Digi Anti: Functional Parity Review

**Review date:** 14 August 2026  
**Scope:** Publicly observable Digi Anti materials and the shipped Kronos Guard codebase. This is a functional comparison, not a claim of affiliation, certification, or visual replication.

## Executive assessment

Kronos Guard matches the principal **group-moderation workflow** documented for Digi Anti: Persian-first command handling, reply/mention/ID targeting, ban, mute, warnings, internal moderator/VIP roles, filters, welcome/goodbye templates, and bounded cleanup. It intentionally adds an owner-only Mini App, real-time forced-join lockdown, a scheduled expiry reconciler, an audit trail, protected payment receipts, and a channel marketplace. It does **not** implement Digi Anti’s entertainment/information commands, nor does it claim exact textual-command parity for every observed Digi alias.

The public Digi Anti profile identifies the bot as `@digi4bot`, presents Persian onboarding, and directs users to start the bot. [1] Its published privacy policy describes storing Telegram IDs, role/status data, activity counters, warnings, group settings, and configured content; it also states that group-related data is deleted after removal of the bot. [2]

## Capability matrix

| Digi Anti capability observed or documented | Kronos Guard status | Implementation or intentional difference |
|---|---|---|
| Persian-first group moderation | **Implemented** | Persian-first responses, with 12 supported locales for core start, language-selection, and forced-join flows. |
| Slashless moderation commands | **Implemented** | Ban, kick, mute, warn, unban, and unmute accept slashless input; the command parser also accepts `/` as a convenience. |
| Reply, numeric-ID, and mention targeting | **Implemented** | Deterministic moderation parser supports reply, numeric ID, and `@username` references. |
| Timed mute | **Implemented** | Timed mutes are stored with expiry and reversed through idempotent scheduled reconciliation. |
| Timed ban | **Extension** | Temporary bans are also scheduled for reversal; this is beyond the specific Digi Anti observation recorded in the research notes. |
| Special ban alias | **Extension** | `سیک` maps to ban and returns the requested dedicated Persian response. |
| Content locks by type | **Implemented** | More than 30 lock dimensions are available with delete, warn, or mute enforcement and role exemptions. Configuration is owner-controlled in the Mini App; exact free-text lock/unlock aliases are not claimed to be a clone. |
| Internal administrators and VIP users | **Implemented** | Slashless add, remove, and list commands persist moderator/VIP roles. The Mini App has separate, safeguarded **internal Kronos** role controls. |
| Telegram owner/admin visibility | **Implemented with deliberate separation** | The directory displays observed Telegram owner/administrator/member status. It does not promote or demote Telegram roles; that action remains Telegram-native and requires explicit administrator permissions. |
| Ban/mute lists and mass cleanup lists | **Partial** | Owner audit history and moderation records are available in the dashboard. Dedicated conversational "list bans" / "clear all mutes" commands are not represented as complete parity. |
| Warning threshold and follow-up action | **Implemented** | Configurable warning threshold, mute/ban response, and duration are stored per group. |
| Word filters | **Implemented** | Per-group filter rules and custom commands are supported. |
| Welcome/goodbye messages and variables | **Implemented** | Configurable templates support current user and group context, including `{name}`, `{userid}`, `{chatid}`, date/time, and legacy-style bracket variables. |
| Bounded cleanup | **Implemented** | `حذف N`, `/delete N`, and `/clear N` are bounded to 1–100 messages and require appropriate group authority. |
| Inline/keypad configuration panel | **Implemented differently** | Instead of reproducing Digi Anti’s inline bot panel, Kronos Guard provides an owner-only Telegram Mini App dashboard. |
| Forced join | **Extension** | Real-time membership re-checks lock interactions immediately after a member leaves a required channel; re-entry is verified before release. |
| Anti-spam and anti-raid signals | **Extension** | Flood, duplicate, link-spam, anti-raid alerts, content locks, and durable owner-alert handling are included. |
| Audit records and owner operations | **Extension** | Moderation, configuration, payment, and role events are auditable by the authorized owner. |
| Channel listing marketplace | **Extension** | Ten Telegram Stars/day, manual card/crypto receipt review, protected receipt files, and owner approval are available. |
| Entertainment, finance, news, or fortune commands | **Not planned** | Joke, currency, Hafez fortune, market/news, and voting-style features are outside the moderation/administration scope. |
| Multiple interchangeable bot instances | **Not planned** | Kronos Guard is deployed for the configured `@Kronosguard_bot` instance. |

## Important operating boundaries

> **The Mini App does not assign or revoke Telegram administrator status.** It shows observed Telegram role status and separately manages internal Kronos moderator/VIP roles. Owner, Telegram administrator, and configured group-owner accounts are protected from internal role changes at the server layer.

Kronos Guard’s known-member directory contains **observed** members only. A person appears after the bot has observed a message or a Telegram membership event; the system does not fabricate a complete group roster or infer Telegram membership without evidence. This maintains an accurate operational record and avoids claiming data Telegram has not delivered to the bot.

## Verification record

The claims marked **Implemented** above are grounded in the deployed project’s source, database schema, and automated tests. The current regression suite covers parsing, authorization, cleanup boundaries, forced-join lockdown, payment transitions, protected receipt access, Mini App owner authentication, moderation history/settings persistence, observed member roles, and server-side protected-role rejection. Features marked **Partial** or **Not planned** are deliberately retained as such rather than represented as shipped parity.

## References

[1]: https://t.me/digi4bot "Digi Anti public Telegram profile"
[2]: https://digianti.com/privacy "Digi Anti privacy policy"

## Live Telegram observation — 15 August 2026

A user-authorized Telegram Web session was used for passive inspection of the public `@digi4bot` search/profile surface. The visible chat evidence showed Persian conversational responses to repeated bot mentions, escalating anti-spam/attention responses, a mute countdown, a silence state, and a separate entertainment-style `میو` interaction with points and cooldown messaging. The search surface also showed the public bot handle and related chat references. These observations are recorded as capability signals only; no proprietary implementation, hidden command list, or inaccessible content was copied, and no message was sent to the reference bot during this passive inspection. Source: `https://web.telegram.org/` (Telegram Web session, observed 2026-08-15); public profile reference: `https://t.me/digi4bot`.
## Live public-surface observation — 15 August 2026

Source: Telegram Web, `https://web.telegram.org/k/#@digi4bot`, public bot surface observed through the authorized account. The visible interface showed a public bot profile labeled `↻ DIGI ANTI ⇦` with approximately `551 059 users`, an `Add bot to group` entry, and buttons labelled `گروه پشتیبانی`, `تنظیمات گروه`, `بزرگترین لینکدونی`, `language`, and `راهنمای ربات`. A visible onboarding/help message listed configurable group features including welcome text, user name, ID, user card, group link, group name, group ID, member name, date/time, and anti-spam/anti-flood style options. The public surface also showed `/start` and `• لغو` controls.

This is an observation of publicly visible UI only; no proprietary text was copied into product code, no access control was bypassed, and no message was sent to the reference bot during this observation. These findings are candidates for a capability matrix, not a claim that every visible item is implemented or appropriate for Kronos Guard.

