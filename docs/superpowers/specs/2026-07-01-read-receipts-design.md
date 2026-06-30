# #16 — Read Receipts (Design-Only)

**Status:** Spec — not implemented. Requires SMTP DSN handling and tracking pixel infrastructure.

## Feature

Request a return receipt when sending an email. See when recipients opened your message.

## Design

### Requesting a Receipt
- Checkbox in compose: "Request read receipt"
- Sets `Disposition-Notification-To` header in outgoing message

### Receiving a Receipt Request
- When opening a message that requests a receipt, show a subtle banner:
  "The sender requested a read receipt. [Send] [Not now]"
- Sending the receipt triggers a DSN (Delivery Status Notification) email back to the sender

### Tracking (Optional Enhancement)
- For more reliable tracking (since many clients ignore DSN), embed a 1x1 tracking pixel
- When the recipient opens the message and loads images, the pixel request is logged
- Tracking pixel URL: `/api/track/open/:messageId`
- Show "Opened at [time]" in the sender's sent folder

### Backend
- New DB table: `read_receipts (message_id, recipient, status, opened_at)`
- Tracking pixel endpoint
- DSN email generation
- Modification to message fetch to check for receipt requests

### Estimated effort: 3-5 days (DSN generation + tracking infrastructure)
