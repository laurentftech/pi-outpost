## 1. Server

- [x] 1.1 Reproduce against the running server: small PNG/JPEG/SVG served, a PNG and a JPEG above 1 MiB refused with 413.
- [x] 1.2 Measure inline images against `pdf.maxBytes` in `readFileRaw` and in the route's 413 (spec: ImageUnderThePdfLimit, ImageOverThePdfLimit, OversizeRejected).

## 2. Documentation

- [x] 2.1 Say in the README's `pdf.maxBytes` row that inline images share the limit.

## 3. Running app

- [x] 3.1 Open a Markdown file referencing a large PNG and JPEG in the running app and check the images decode.
