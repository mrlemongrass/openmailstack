# #14 — Follow-Up Nudge (Design-Only)

**Status:** Spec — not implemented. Requires backend job infrastructure.

## Feature

"Sent 3 days ago, no reply received. Follow up?"

When a sent message goes unanswered for N days (configurable, default 3), the app nudges the sender to follow up.

## Design

### Detection
- Backend job (cron/timer) scans `sent` folder daily
- For each message: check if any message in `INBOX` has `In-Reply-To` or `References` matching the sent message's `Message-ID`
- If no reply found after N days → flag as "needs follow-up"

### UI
- In the sent folder, flagged messages show a subtle "Follow up?" badge
- Clicking opens a compose pre-filled with the original recipients + subject
- Snooze-like presets: "Remind me in 1 day", "Remind me in 3 days", "Dismiss"

### Backend
- New DB table: `followup_nudges (owner, sent_uid, sent_date, dismissed_at)`
- New endpoint: `GET /api/messages/followups` returns flagged messages
- New endpoint: `POST /api/messages/followups/dismiss` dismisses a nudge
- Requires periodic job infrastructure (cron or setInterval in the Node process)

### Estimated effort: 3-4 days (backend-heavy)
