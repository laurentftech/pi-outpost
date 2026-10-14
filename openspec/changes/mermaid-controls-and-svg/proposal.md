# Consistent Mermaid controls and portable SVG downloads

## Why

Mermaid currently hides controls over the picture while structured-exchange uses
visible actions below it. Mermaid also lacks the SVG download available on other diagrams.

## What Changes

- Update Mermaid from 12.1.0 to 12.2.0 across all four consumers with an npm 11 lockfile.
- Share action styling with structured-exchange and show Mermaid actions below the picture.
- Offer portable SVG downloads inline and at full size using the existing document exporter.
- Export the direction actually shown, retain authored source, report failures and prevent
  duplicate or stale downloads when the source changes.

## Impact

UI diagram controls, SVG export, dependency manifests and lockfile. OpenLore orient
identified Mermaid.tsx, StructuredExchangeView.tsx and mermaidToImage.ts. With no graph
index available, targeted repository inspection confirmed the existing shared exporter
already supplies standalone dimensions, text labels and inline appearance. The delta
adds the missing behavior without changing the orientation requirements.
