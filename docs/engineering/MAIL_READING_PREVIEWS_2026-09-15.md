# Mail readability and attachment previews — 2026-09-15

## Scope and acceptance

The reported GCU screenshot shows inherited pale text on white panels and
explicit black text on a dark message surface. The user selected automatic
contrast correction that preserves the sender's backgrounds, then requested
PDF and picture previews inside webmail.

Acceptance: reproduce both contrast failures, repair mixed-background text,
retain readable sender colors and remote-image policy, react to theme changes,
and provide an explicit fallback for difficult designs. Open PDFs and common
pictures without saving them first; retain Download, keyboard dismissal/focus,
mobile layout, and visible loading/error recovery.

## Changes

- `webmail-frontend/src/mail/message-contrast.ts` measures computed text colors
  against composited solid ancestor backgrounds. Text below 4.5:1 gets black or
  white, whichever contrasts better. Existing readable colors and backgrounds
  are preserved. Reads are batched before writes; inherited colors are pinned
  so fixing a parent cannot break a child with a different background.
- `components/EmailBody.tsx` applies correction before paint to the existing
  sanitized, privacy-filtered HTML. Theme changes start from sender markup.
  Readable colors provides a theme-colored fallback. Messages over 5,000 DOM
  elements use that fallback automatically. Message identity resets the control.
- `components/AttachmentCard.tsx` exposes Preview for PDF, PNG, JPEG, GIF, WebP,
  BMP, and AVIF. Generic MIME types can use recognized filename extensions.
- `attachment-preview.ts` fetches the existing authenticated, folder/UID-scoped
  attachment URL without caching. Both declared and streamed sizes are capped
  at 25 MiB. File signatures determine the preview type; HTML/SVG or mismatched
  bytes cannot be displayed as active documents.
- `components/AttachmentPreview.tsx` provides a focus-managed modal, explicit
  loading/error/retry states, image rendering, and retained Download. Closing
  aborts the request and revokes image object URLs. Attachment cards are keyed
  by folder/message/attachment identity to prevent a preview carrying over.
- `components/PdfPreview.tsx` uses lazy-loaded PDF.js for canvas rendering,
  previous/next pages, fit-width/zoom, and a page-text disclosure. PDF scripting
  and XFA are not enabled; evaluation is disabled. Bitmap allocations are
  bounded. Rendering/loading work is cancelled on disposal.
- `index.css` styles the reading fallback and responsive attachment viewer.
  `package.json`/lock add PDF.js 5.4.624, compatible with this host's Node 20.
  No existing dependency resolutions changed. `vite.config.ts` bundles its
  versioned character maps, fonts, decoders, worker, and license locally;
  `THIRD_PARTY_NOTICES.md` records the dependency. No external document service
  receives attachment bytes.

## Proof

- Before editing, the synthetic fixture passed through the actual MessageViewer
  and failed `output/playwright/mail-contrast/check.js` with
  `Unreadable email text: contrast below 4.5:1`. The same check passes after
  correction, including white panels, black disclaimers, purple branding, and
  links. This demonstrates the screenshot's failure pattern; the original
  private GCU message was not accessed.
- Frontend full suite: **304 passed**, no skips/failures. Includes new contrast,
  rendered component/theme lifecycle, attachment type/signature, size-limit,
  cancellation, and card regressions.
- Frontend production build and final lint passed. `git diff --check` passed.
- Chromium checks against both development and the built app passed PDF
  rendering, page 2 content, last-page controls, 200% zoom, decoded image,
  Escape and focus restoration, 390px layout, preserved remote-image blocking,
  and readable fallback toggling. Built-app checks also passed request failure
  plus retry, corrupt PDF, mismatched file bytes, and image URL revocation.
- Runtime dependency audit: **0 vulnerabilities**. Full audit also reports two
  pre-existing development-tool advisories (browserslist and
  baseline-browser-mapping); those packages were not changed in this task.
- Local synthetic artifacts: `output/playwright/mail-contrast/` contains
  `contrast-desktop.png`, `pdf-desktop.png`, `pdf-mobile.png`, image screenshots,
  fixtures, and the setup/check/verify/failures browser scripts.

## Boundaries

Initial implementation was locally verified before release authorization.
Existing contact-group work in the checkout was preserved. Browser API responses
were fixtures, so browser results do not claim verification of the original
private messages or physical devices. Live release evidence follows below.

Automatic contrast uses computed RGB/RGBA solid backgrounds. Image/gradient
backgrounds, blending, opacity effects, non-RGB color spaces, and text embedded
inside pictures are not universally measurable; the explicit Readable colors
fallback helps with styled HTML but cannot repair pixels in images. Layout and
sender font sizes are retained. Extremely wide sender tables remain scrollable
under the existing message pane behavior.

Encrypted/corrupt PDFs have a Download fallback. Interactive PDF forms,
annotations, text selection over the page canvas, and HEIC/TIFF/SVG/Office
preview are outside this change. Page text is available when the PDF provides
it; scanned images do not gain OCR. Browser/device support for image formats
still applies. Confirmation of the original two messages and physical
Safari/Android behavior remains a user acceptance step.

PDF.js integration reference: https://mozilla.github.io/pdf.js/examples/


## Live release — 2026-09-15

User explicitly authorized commit, push, and deployment. The feature commit
`18155137` and worker MIME correction `1aa89c7a` were pushed to `origin/main`.
Runtime release is **`1aa89c7a`**, built/deployed from the clean detached checkout
`/root/openmailstack-mail-release-20260915`. Uncommitted contact-group work was
not included; all 76 committed backend JavaScript runtime files matched the
pre-release live backend.

Release validation found the host's Nginx MIME table recognizes `.js` but not
`.mjs`. The build now emits the PDF module worker with a `.js` suffix, preserving
module-worker behavior without changing global server MIME configuration. The
public worker responds as `application/javascript`, and an actual browser
renders the PDF using public production assets.

The isolated release suite passed **303 tests** (the earlier 304 included the
unrelated local contact-group regression). Frontend lint/build and backend
build passed. Public-site Chromium fixture checks passed mixed-background
contrast, PDF pages/zoom, picture decoding, Escape/focus restoration, remote
image blocking, readable fallback, and desktop/390px controls. These used
synthetic API responses, not customer messages; physical Safari/Android and the
original private GCU/classroom messages remain outside this evidence.

Both guarded stages ran public pre/post IMAPS and ActiveSync suites. Both
post-deploy suites passed routine Ping; both guarded commands exited 0 with no
cleanup warnings. No rollback was needed or exercised. Snapshots are root-owned
mode 0700:

- Bridge: `/var/backups/openmailstack/protocol-guarded-webmail-20260915T212900Z`
- Active: `/var/backups/openmailstack/protocol-guarded-webmail-20260915T213741Z`

Final staging smoke passed services/listeners, configuration, Rspamd functional
scan, HTTPS/SMTP STARTTLS/IMAPS, webmail/admin/autoconfiguration endpoints, and
anonymous API rejection. All **260 frontend files** and **76 backend JavaScript
files** match the clean release. The public index and ten selected runtime/PDF
assets match; local/public readiness returns 401. Backend is active/running with
zero restarts, outbound mode is active, and the warning/error-priority journal
had zero entries since release began.

Evidence logs: `/tmp/oms-mail-reading-release-tests.log`,
`/tmp/oms-mail-reading-release-build.log`, `/tmp/oms-mail-reading-bridge.log`,
`/tmp/oms-mail-reading-active.log`, `/tmp/oms-mail-reading-staging.log`, and
`/tmp/oms-mail-reading-artifacts.json`. Public browser setup and screenshots are
under `output/playwright/mail-contrast/`.

Existing advisories remain outside this feature release: frontend full audit
reports browserslist (high) and baseline-browser-mapping (moderate); frontend
runtime-only audit is clean. The unchanged backend runtime audit reports
multer/nodemailer (high) and imapflow/mailparser/mysql2/qs (moderate). Staging also
prints existing Postfix deprecated-option and Rspamd timeout notices while its
checks pass. A separate dependency/configuration maintenance pass is recommended.
