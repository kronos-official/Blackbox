# Owner validation blockers — 2026-08-15

## Verified in the available environment

The published Telegram webhook accepts slashless group updates after Privacy Mode was disabled. In the authorized group `-1003795743979`, the live `وضعیت گروه` test produced a processed webhook event and a `status_viewed` audit record. The historical event `120001` occurred before the reply-safe and centralized bot-error releases; its handling path is now classified and covered by regression tests. The current production checkpoint is published at `https://kronosmod-nul7benn.manus.space`.

## Still requiring owner-controlled Telegram interaction

The following cannot be truthfully closed from the available session without opening the signed Mini App as the relevant Telegram identities: role-scoped panel visibility for owner, group owner, group administrator, moderator, VIP, and ordinary member; authenticated dashboard responsive/accessibility behavior; required-channel membership verification from an end-user account; and the Mini App menu session-isolation check.

These are not code failures inferred from the deterministic suite. They are owner-validation gates because Telegram signs the Mini App identity and Bot API role/member responses at runtime. No synthetic Telegram identity, member, payment, receipt, or live result is used to close them.

## Safe owner validation sequence

1. Open the published Mini App from Telegram as the bot owner and verify the owner dashboard and locale selector.
2. Repeat with one authorized group administrator, one moderator/VIP identity, and one ordinary member; confirm each sees only the permitted groups, panels, and controls.
3. In the authorized group, exercise one non-destructive status command and inspect the new audit entry.
4. If forced-join testing is required, use an owner-provided test channel and a disposable test account; do not use production payment or role changes.

Until this sequence is performed, the project should be described as **production-published with code-level and authorized-group validation complete, while signed Mini App and end-user validation remain owner-controlled**.
