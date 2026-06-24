/**
 * lib/dsb/pdf-chunks.ts
 * ----------------------------------------------------------------------------
 * Server-only PDF chunking utility for the DSB AI pipeline.
 *
 * Why this exists: Anthropic's Messages API caps PDF documents at 100 pages
 * per request. For long submission packets we split the source PDF into
 * ≤100-page chunks, call Claude N times, and merge the results in the route
 * handlers (see /api/dsb-extract and /api/dsb-ai-review).
 *
 * Uses `pdf-lib` (already a project dependency) to build fresh PDFs by copying
 * page references from the source document. Each chunk is a self-contained,
 * valid PDF that Claude can read independently.
 *
 * NOTE: Marked server-only via the `pdf-lib` import. Don't import this from
 * client components — the dependency tree pulls in Node Buffer.
 */

import { PDFDocument } from 'pdf-lib'

export interface PdfChunk {
  /** Bytes of a freshly-built PDF containing this chunk's pages. */
  bytes: Uint8Array
  /**
   * 0-based offset of this chunk's first page in the original PDF.
   * Chunk 0 → 0, chunk 1 → chunkSize, chunk 2 → 2*chunkSize, etc.
   * Used by callers to translate chunk-local page numbers (which is what
   * Claude returns) back to original-PDF page numbers.
   */
  pageOffset: number
  /** Number of pages in this chunk. */
  pageCount: number
}

/**
 * Open the PDF and return its page count. Cheap operation — no rendering.
 * Both /api/dsb-extract and /api/dsb-ai-review call this before deciding
 * whether they need to chunk.
 */
export async function pdfPageCount(bytes: Uint8Array | ArrayBuffer | Buffer): Promise<number> {
  const doc = await PDFDocument.load(toUint8(bytes), { ignoreEncryption: true })
  return doc.getPageCount()
}

/**
 * Split a PDF into chunks of at most `chunkSize` pages. Returns chunks in
 * document order (chunk 0 = pages 1..chunkSize, chunk 1 = pages chunkSize+1..2*chunkSize,
 * etc.). If the source PDF has ≤chunkSize pages, returns a single chunk
 * containing the entire document (re-serialized through pdf-lib so the bytes
 * are consistent with the multi-chunk path).
 *
 * @param bytes     Source PDF bytes.
 * @param chunkSize Maximum pages per chunk. Defaults to 100 to match the
 *                  Anthropic Messages API cap. Configurable for tests.
 */
export async function splitPdfIntoChunks(
  bytes: Uint8Array | ArrayBuffer | Buffer,
  chunkSize = 100,
): Promise<PdfChunk[]> {
  if (chunkSize < 1) throw new Error('chunkSize must be ≥ 1')

  const srcBytes = toUint8(bytes)
  const src = await PDFDocument.load(srcBytes, { ignoreEncryption: true })
  const totalPages = src.getPageCount()

  if (totalPages === 0) return []

  const chunks: PdfChunk[] = []
  // Walk the document in chunkSize-page windows. For each window, build a
  // fresh PDFDocument, copy the relevant page handles in, and serialize.
  for (let start = 0; start < totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalPages)
    const indices: number[] = []
    for (let i = start; i < end; i++) indices.push(i)

    const out = await PDFDocument.create()
    const copied = await out.copyPages(src, indices)
    for (const p of copied) out.addPage(p)

    const outBytes = await out.save()
    chunks.push({
      bytes: outBytes,
      pageOffset: start,
      pageCount: end - start,
    })
  }
  return chunks
}

/**
 * Coerce various binary inputs to a Uint8Array view that pdf-lib accepts.
 * Node's Buffer is already a Uint8Array subclass so it passes through; an
 * ArrayBuffer needs to be wrapped.
 */
function toUint8(bytes: Uint8Array | ArrayBuffer | Buffer): Uint8Array {
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  // Fallback: hopefully ArrayBuffer-like.
  return new Uint8Array(bytes as ArrayBuffer)
}
