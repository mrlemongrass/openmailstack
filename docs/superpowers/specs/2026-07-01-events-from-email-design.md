# #9 — Events from Email Auto-Detection (Roadmap)

**Status:** Spec — not implemented. Requires ML/NLP or structured email parsing.

## Feature

Parse hotel bookings, flight confirmations, restaurant reservations, event tickets from email and auto-add to calendar.

## Design Options

### Option A: Schema.org Email Markup (Recommended V1)
- Parse `application/ld+json` script tags in HTML emails
- Many airlines, hotels, and event platforms now embed structured data
- Extract Reservation/Event/Flight schema types
- Create calendar events automatically
- Show a banner: "Event detected in this email — [Add to calendar]"

### Option B: ML-Based Parsing
- Train or use an NLP model to extract date, time, location, and event type from email text
- Requires substantial training data
- Higher accuracy but more complex

### Option C: Rule-Based Patterns
- Regex patterns for common confirmation emails (airlines, hotels, OpenTable, Eventbrite)
- Extract dates with date-fns parsing
- Fragile — breaks when email templates change

## Recommended Path
1. Start with Option A (Schema.org parsing) — covers ~60% of commercial confirmations
2. Add Option C (rules) for the top 10-20 most common senders
3. Option B (ML) as a longer-term investment

## Backend
- New endpoint: `POST /api/calendar/extract-events` or run automatically on message fetch
- Email parsing happens in the existing message-fetch pipeline
- Detected events stored as tentative until user confirms

## Estimated Effort
- Schema.org parsing: 2-3 days
- Rule-based patterns: 3-5 days
- ML approach: 2-4 weeks
