## Fix: Add recipientEmail validation to POST /contacts/:id/share

**Date:** 2026-06-30
**File:** `webmail-backend/src/apps-api.ts` (line 376)

**Issue:** The `POST /contacts/:id/share` route read `recipientEmail` from the request body but never validated it was present or well-formed. A request with a missing, null, or empty `recipientEmail` would proceed and return a 200 with vCard data but no actual sharing would occur — misleading the client.

**Fix:** Added a guard clause after the variable declarations:

```typescript
if (!shareTo || !shareTo.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid recipient email is required' });
}
```

This returns a 400 status with a clear error message if `recipientEmail` is missing, empty, or doesn't look like an email address (missing `@`), preventing the endpoint from silently succeeding without a valid target.

**Verification:** `npx tsc --noEmit` passes with zero errors.
