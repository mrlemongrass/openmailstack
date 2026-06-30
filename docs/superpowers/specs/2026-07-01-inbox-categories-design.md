# #17 — Inbox Categories (Design-Only)

**Status:** Spec — not implemented. Requires ML training data or complex rule engine.

## Feature

Gmail-style categorized inbox: Primary, Social, Promotions, Updates, Forums.

## Design

### Approach A: Rule-Based (Recommended for V1)
- User-defined rules: "From @linkedin.com → Social", "Subject contains 'invoice' → Finance"
- Default rules shipped with the app for common senders
- Sieve integration: rules map to Sieve filters on the backend

### Approach B: ML-Based (Future)
- Train a classifier on the user's labeled messages
- On-device or server-side inference
- Requires substantial training data per user

### UI
- Tab bar at the top of INBOX: Primary | Social | Promotions | Updates | Forums
- Unread counts per tab
- "Move to category" action for misclassified messages
- Settings page for configuring categories and rules

### Backend (Rule-Based)
- Reuse existing Sieve rule infrastructure
- Add category metadata to messages (custom IMAP flag or DB column)
- New endpoint: `POST /api/messages/categorize` — manually recategorize

### Estimated effort: 1-2 weeks (rule-based), 1-2 months (ML-based)
