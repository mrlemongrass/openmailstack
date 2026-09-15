# Inline attachment previews — 2026-09-15

## Scope and acceptance

Display supported pictures and the first page of PDFs beneath the message body,
with the existing full Preview and Download actions. Automatically render only
when the combined supported attachment size is at most 25 MB. Match the existing
preview limit and size display convention: 25 × 1024 × 1024 bytes (26,214,400).

- Count PDF and supported raster images; unrelated attachments do not consume
  the automatic-preview budget.
- Above the combined limit, keep compact cards and individual Preview/Download.
  A single file above the existing 25 MB preview limit offers Download only.
- Unknown, zero, invalid or unsafe sizes disable automatic rendering for the
  message. Manual preview retains its bounded fetch.
- Load on visibility; release the file, object URL and PDF task when offscreen,
  collapsed or replaced. Keep a height placeholder to preserve scroll position.
- Show only PDF page one inline; clicking opens existing paging, zoom and download.
- Provide per-message Hide/Show previews. A new message starts expanded.
- Preserve sender artwork and the separate remote-image privacy policy.

## Implementation

`MessageAttachments` applies the aggregate policy before any attachment fetch.
`InlineAttachment` observes visibility and reuses `AttachmentPreview` content.
The shared loader caps each automatic request at its declared size, checking both
Content-Length and streamed bytes. Incorrect metadata cannot enlarge its reserved
share of the aggregate budget; a visible error directs the reader to manual
Preview or Download. Files are still signature checked and fetched through the
existing authenticated attachment endpoint. No new backend endpoints or packages.

Changed areas: MessageViewer, attachment policy/loader, AttachmentCard,
AttachmentPreview, PdfPreview, two new components, preview styles, regression tests.

## Local proof

- Full frontend suite: 310 passed, zero failures/skips.
- Frontend lint and TypeScript/production build passed.
- Unit/React coverage: exact combined boundary, multiple-file overflow,
  unsupported exclusions, unknown sizes, underreported response cancellation,
  individual Download-only boundary, visibility cleanup, collapse and identity reset.
- Chromium checks passed against both development and production builds at
  1440px and 390px: inline PDF/image, first-page label, full preview/paging,
  collapse/download, lazy scrolling and offscreen unmount, combined/unknown/
  individual limits, incorrect metadata recovery, and remote-image blocking.
- Backend build passed; all 96 generated backend JavaScript files match the
  currently deployed runtime, including the preceding contact-group release.
- Local artifacts: `output/playwright/inline-attachments/{setup,verify}.js`,
  `desktop.png`, `mobile.png`. The fixture intercepts application APIs and uses
  synthetic files. No private message or attachment was read.

## Limits

The byte budget bounds automatically fetched file data, not decoded memory or
cumulative bandwidth when revisiting a preview. PDFs retain the existing bounded
canvas allocation. Only supported raster formats render inline; SVG and other
unsupported attachments remain downloadable. Offscreen previews reload when
revisited. Existing PDF password/corruption errors and manual Download recovery
remain. Browser fixtures use synthetic messages, not private mailbox content;
physical Safari/Android and original customer attachment confirmation remain
separate acceptance checks.

## Release evidence

Runtime commit `f1b50cbd` was pushed to `origin/main`. Deployment runs from an
isolated checkout at that commit, including the already released contact-group
changes. The isolated frontend build matched all 260 tested distribution files.

The first guard attempt stopped before mutation because the fresh checkout lacked
backend Node dependencies. After installing the locked dependencies, the next
run cleared the pending canary journal and proved zero database, EAS/PIM, mailbox,
Postfix and web-session residue before proceeding.

Bridge deployment passed both public protocol gates, including post-deploy Ping,
with enforced canary cleanup. Rollback snapshot:
`/var/backups/openmailstack/protocol-guarded-webmail-20260915T222555Z`.

The public site passed the same synthetic Chromium workflow at desktop/390px,
with zero browser console errors/warnings. All 260 frontend and 96 backend files
matched the isolated build. Eleven public index/assets matched their hashes;
JavaScript worker and WebAssembly MIME types were correct. Both anonymous auth
probes returned 401. Backend was active/running with zero unexpected restarts.
After the final active installation, the same 260/96 file parity, eleven public
responses, auth checks and zero-restart service health were reverified. Outbound
release mode is active. Staging smoke passed secure web/SMTP/IMAPS handshakes,
service/config checks, the Rspamd scan, discovery, DKIM and web endpoint checks.
It retained the existing Postfix `smtpd_use_tls` deprecation and Rspamd
`task_timeout` warnings. The final active guard passed both public protocol gates, including Ping and
enforced canary cleanup, with no cleanup warnings or skips. Its rollback snapshot
is `/var/backups/openmailstack/protocol-guarded-webmail-20260915T223416Z`.
Both snapshots are root-owned mode 0700. No rollback was needed or exercised.
The pending canary-run journal directory is empty.

No dependencies were changed. Existing audit findings remain: two frontend
development-tool advisories (one high, one moderate), and six backend advisories
(two high, four moderate), as documented in the preceding mail-reading release.
No dependency fixes are bundled into this bounded UI change.
