import type { PdfEngine } from "@embedpdf/models"

const PDFIUM_VERSION = "2.14.4"
const PDFIUM_WASM_URL = `https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@${PDFIUM_VERSION}/dist/pdfium.wasm`

let sharedEnginePromise: Promise<PdfEngine> | null = null

export function loadSharedPdfEngine() {
  sharedEnginePromise ??= import("@embedpdf/engines/pdfium-worker-engine").then(
    ({ createPdfiumEngine }) => createPdfiumEngine(PDFIUM_WASM_URL, {})
  )

  return sharedEnginePromise
}
