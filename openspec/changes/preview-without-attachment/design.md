## Context
Requested intent contradicts the main preview-file-attachments spec: it mandates automatic attachment for loaded previews and tool-readable binaries. OpenLore orient located the attachment helpers; targeted rg located the App effect and explicit tree control. Graph tools unavailable; CLI orient/rg fallback used. User intent takes precedence, so delta removes the five automatic-attachment requirements and introduces preview isolation, retaining Reference files from the file tree unchanged.

## Decisions
Remove automatic App effects and their state/callback bookkeeping. Opening is read-only with respect to composer attachments. Existing path pin, @ mention, upload/drop/paste actions stay explicit. No preview readiness or byte-fetch logic is needed to build prompt context. Existing pure attachment conversion helpers remain for compatibility; they are no longer called by App previewing.
