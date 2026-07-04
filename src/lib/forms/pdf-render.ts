import { PDFDocument, PDFCheckBox, PDFRadioGroup, StandardFonts, rgb } from "pdf-lib";
import {
  parseCheckboxValue,
  type AnnotatedField,
  type FieldOption,
  type Bbox,
} from "./field-schema";
import { createComponentLogger } from "../logger";

const log = createComponentLogger("pdf-render");

function fitFontSize(text: string, maxWidth: number, maxHeight: number): number {
  const base = Math.min(maxHeight * 0.7, 12);
  const estimatedWidth = text.length * base * 0.5;
  if (estimatedWidth <= maxWidth) return base;
  return Math.max(6, maxWidth / (text.length * 0.5));
}

function isTruthy(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "1" || v === "on" || v === "checked";
}

export interface RenderStats {
  acroformFieldCount: number;
  overlayFieldCount: number;
}

function drawCheckMark(
  page: ReturnType<PDFDocument["getPages"]>[number],
  bbox: Bbox,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>
) {
  const size = Math.min(bbox.width, bbox.height) * 0.8;
  page.drawText("X", {
    x: bbox.x + (bbox.width - size * 0.5) / 2,
    y: bbox.y + (bbox.height - size) / 2,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

async function fillOptionAcroform(
  form: ReturnType<PDFDocument["getForm"]>,
  option: FieldOption,
  selected: boolean
): Promise<boolean> {
  if (!option.pdf_field_name) return false;

  try {
    const acroField = form.getField(option.pdf_field_name);
    if (acroField instanceof PDFCheckBox) {
      if (selected) acroField.check();
      else acroField.uncheck();
      return true;
    }
    if (acroField instanceof PDFRadioGroup && selected) {
      acroField.select(option.value);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

async function fillSimpleField(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  field: AnnotatedField,
  value: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>
): Promise<"acroform" | "overlay" | "skipped"> {
  if (field.pdf_field_name) {
    try {
      const acroField = form.getField(field.pdf_field_name);
      if (acroField instanceof PDFCheckBox) {
        if (isTruthy(value)) acroField.check();
        else acroField.uncheck();
        return "acroform";
      }
      if (acroField instanceof PDFRadioGroup) {
        acroField.select(value);
        return "acroform";
      }
      if ("setText" in acroField && typeof acroField.setText === "function") {
        acroField.setText(value);
        return "acroform";
      }
    } catch {
      // fall through to overlay
    }
  }

  const pageIndex = Math.max(0, field.page - 1);
  const pages = pdfDoc.getPages();
  if (pageIndex >= pages.length) return "skipped";

  const page = pages[pageIndex];
  const fontSize = fitFontSize(value, field.bbox.width, field.bbox.height);

  page.drawText(value, {
    x: field.bbox.x + 2,
    y: field.bbox.y + (field.bbox.height - fontSize) / 2,
    size: fontSize,
    font,
    maxWidth: field.bbox.width - 4,
  });

  return "overlay";
}

async function fillRadioField(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  field: AnnotatedField,
  value: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>
): Promise<{ acroform: number; overlay: number }> {
  let acroform = 0;
  let overlay = 0;

  if (field.pdf_field_name) {
    try {
      const acroField = form.getField(field.pdf_field_name);
      if (acroField instanceof PDFRadioGroup) {
        acroField.select(value);
        return { acroform: 1, overlay: 0 };
      }
    } catch {
      // try per-option
    }
  }

  for (const option of field.options ?? []) {
    const selected = option.value === value;
    if (!selected) continue;

    const filled = await fillOptionAcroform(form, option, true);
    if (filled) {
      acroform++;
      continue;
    }

    if (option.bbox && option.page) {
      const pageIndex = Math.max(0, option.page - 1);
      const pages = pdfDoc.getPages();
      if (pageIndex < pages.length) {
        drawCheckMark(pages[pageIndex], option.bbox, font);
        overlay++;
      }
    }
  }

  return { acroform, overlay };
}

async function fillCheckboxField(
  pdfDoc: PDFDocument,
  form: ReturnType<PDFDocument["getForm"]>,
  field: AnnotatedField,
  value: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>
): Promise<{ acroform: number; overlay: number }> {
  const selectedValues = new Set(parseCheckboxValue(value));
  let acroform = 0;
  let overlay = 0;

  for (const option of field.options ?? []) {
    const selected = selectedValues.has(option.value);
    if (!selected) continue;

    const filled = await fillOptionAcroform(form, option, true);
    if (filled) {
      acroform++;
      continue;
    }

    if (option.bbox && option.page) {
      const pageIndex = Math.max(0, option.page - 1);
      const pages = pdfDoc.getPages();
      if (pageIndex < pages.length) {
        drawCheckMark(pages[pageIndex], option.bbox, font);
        overlay++;
      }
    }
  }

  return { acroform, overlay };
}

export async function renderFilledPdf(
  templateBytes: Uint8Array,
  fields: AnnotatedField[],
  values: Record<string, string>
): Promise<{ pdfBytes: Uint8Array; stats: RenderStats }> {
  const startedAt = Date.now();
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let acroformFieldCount = 0;
  let overlayFieldCount = 0;

  for (const field of fields) {
    const value = values[field.field_key]?.trim();
    if (!value) continue;

    if (field.field_type === "radio") {
      const stats = await fillRadioField(pdfDoc, form, field, value, font);
      acroformFieldCount += stats.acroform;
      overlayFieldCount += stats.overlay;
      continue;
    }

    if (field.field_type === "checkbox") {
      const stats = await fillCheckboxField(pdfDoc, form, field, value, font);
      acroformFieldCount += stats.acroform;
      overlayFieldCount += stats.overlay;
      continue;
    }

    const strategy = await fillSimpleField(pdfDoc, form, field, value, font);
    if (strategy === "acroform") acroformFieldCount++;
    if (strategy === "overlay") overlayFieldCount++;
  }

  try {
    form.flatten();
  } catch {
    // Flatten may fail on PDFs without AcroForm
  }

  const pdfBytes = await pdfDoc.save();

  log.info("pdf render completed", {
    acroformFieldCount,
    overlayFieldCount,
    totalFields: fields.length,
    filledKeys: Object.keys(values).filter((k) => values[k]?.trim()).length,
    durationMs: Date.now() - startedAt,
  });

  return { pdfBytes, stats: { acroformFieldCount, overlayFieldCount } };
}
