# #15 — Confidential Mode (Design-Only)

**Status:** Spec — not implemented. Requires SMS gateway integration.

## Feature

Send emails that expire after a set time, prevent forwarding/copying, and optionally require an SMS passcode to open.

## Design

### Sender-Side
- Toggle in compose: "Confidential mode"
- Options: expire after 1 day / 1 week / 1 month / custom
- Optional: "Require SMS passcode"
- Recipient list is recorded on the server

### Recipient-Side
- If the recipient has OpenMailStack: seamless — message shows with expiration badge, copy/forward disabled via Content Security Policy and UI restrictions
- If the recipient is external (Gmail, Outlook): they receive a link to view the message on the OpenMailStack server. If SMS passcode is required, the link sends them to a page that texts them a code

### Technical Requirements
- Messages stored only on server, never delivered via SMTP to external recipients
- External recipients get a notification email with a secure link
- SMS passcode: integration with Twilio or similar SMS gateway
- Expiration: server deletes messages after expiry date
- No-forward: UI restriction (not cryptographically enforced — Gmail's confidential mode has the same caveat)

### Backend
- New DB tables: `confidential_messages`, `confidential_recipients`, `confidential_passcodes`
- New endpoints: message view portal, passcode verification
- SMS gateway integration (configurable provider)

### Estimated effort: 1-2 weeks (SMS gateway is the bottleneck)
