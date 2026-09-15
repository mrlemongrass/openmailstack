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
