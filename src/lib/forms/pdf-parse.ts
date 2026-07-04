import { PDFDocument } from "pdf-lib";
import { createComponentLogger } from "../logger";
import type { Bbox } from "./field-schema";

const log = createComponentLogger("pdf-parse");

export interface AcroFormField {
  name: string;
  type: string;
  page: number;
  bbox: Bbox;
}

function findWidgetPageIndex(
  pdfDoc: PDFDocument,
  widgetRef: { toString(): string }
): number {
  const pages = pdfDoc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const pageRef = pages[i].ref;
    if (pageRef.toString() === widgetRef.toString()) {
      return i + 1;
    }
  }
  return 1;
}

export async function scanAcroFormFields(pdfBytes: Uint8Array): Promise<AcroFormField[]> {
  const startedAt = Date.now();

  try {
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const results: AcroFormField[] = [];

    for (const field of fields) {
      const widgets = field.acroField.getWidgets();

      for (const widget of widgets) {
        const rect = widget.getRectangle();
        const pageRef = widget.P();
        const page = pageRef ? findWidgetPageIndex(pdfDoc, pageRef) : 1;

        results.push({
          name: field.getName(),
          type: field.constructor.name,
          page,
          bbox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        });
      }
    }

    log.info("acroform scan completed", {
      fieldCount: results.length,
      durationMs: Date.now() - startedAt,
    });

    return results;
  } catch (error) {
    log.warn("acroform scan failed or no form present", {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    return [];
  }
}
