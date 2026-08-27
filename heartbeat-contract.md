# Heartbeat contract notes

Source: `/home/ubuntu/skills/webdev-periodic-updates/SKILL.md` (project scheduling reference).

- Scheduled callback paths must start with `/api/scheduled/` and be explicitly mounted in `server/_core/index.ts` before Vite/static fallthrough.
- Both Heartbeat and AGENT callbacks authenticate through `sdk.authenticateRequest(req)` and require `user.isCron === true` plus `user.taskUid`.
- The owning business row needs an indexed nullable `schedule_cron_task_uid varchar(65)` field. Look up, update, pause, resume, and delete by authenticated `user.taskUid`, never by request body fields or schedule name.
- Callback handlers must be idempotent, wrapped in try/catch, return orphan-safe 2xx responses when the task UID has no row, and return structured JSON on 500. Platform retries 5xx and 429.
- Cron expressions are six-field UTC expressions with seconds and a minimum interval of 60 seconds; use `0` in the seconds field for minute/hour/day schedules.
- For end-user-driven schedules, create/update/delete operations call the Heartbeat SDK with the decoded `app_session_id` cookie value, not the raw Cookie header. The site must be deployed before creating platform jobs; save a checkpoint and ask the user to deploy before any schedule actions.
- Source URL is local skill documentation; the Heartbeat SDK contract is in `/home/ubuntu/kronos-guard/server/_core/heartbeat.ts`.
