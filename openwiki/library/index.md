# Files

- [Library API and Session](api.md) - The /api/library routes — the initData-to-cookie session exchange, the session, student and document guards, the subject shelf, and the watermarked page endpoint with its headers and burst counter.
- [Catalogue and Document Ingest](ingest.md) - How the library shelf is filled — the committed syllabus catalogue snapshot and its parser, the PDF-to-SVG vectoriser, the ingest tool that registers a document, and the tool that resolves a watermark token back to a student.
- [Library Subsystem](overview.md) - The library behind /library — how a Telegram student is resolved to a semester and the documents that belong to it, who may open the shelf, and how access, watermarking and reading fit together.
- [Library Reader Mini App](reader.md) - The React library reader in src/web — page boxes, the twelve-page window and why pages are dropped, the zoom geometry, the touch gestures, the remembered position and the Telegram back button.
