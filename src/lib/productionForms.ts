// ─────────────────────────────────────────────────────────────────────────────
//  productionForms.ts
//  Shared helpers for the "Production Forms" feature:
//    • Word (.docx) — bookmark discovery + surgical text replacement, done as
//      a targeted string edit on word/document.xml (via JSZip) rather than a
//      full parse/rebuild, so every other byte of the original file — layout,
//      styles, images, headers/footers — is left completely untouched.
//    • Excel (.xlsx) — cell read/write via ExcelJS (already used elsewhere in
//      this app for the attendance export), which preserves formulas/styles.
//    • A small HTML → .docx converter (via the pure-JS `docx` package) used
//      only when the user edits body text in the in-app Word editor and hits
//      Save. It understands headings, paragraphs, bold/italic/underline and
//      lists — it does not attempt to reproduce tables, images, or complex
//      layouts, so very elaborate templates are best edited by downloading
//      the original instead.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from "jszip";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

// `part` is which XML piece inside the .docx the bookmark lives in — the main
// body (word/document.xml) or a header/footer (word/header1.xml, etc). Most
// real-world templates put the reference number in the header, so we have to
// track this instead of assuming everything is in the body.
export type WordFieldLocator = { type: "bookmark"; name: string; part?: string };
export type ExcelFieldLocator = { type: "cell"; sheet: string; cell: string };
export type FieldLocator = WordFieldLocator | ExcelFieldLocator;

export function formatRefNumber(prefix: string, padding: number, n: number): string {
  return `${prefix ?? ""}${String(n).padStart(padding, "0")}`;
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Word (.docx) helpers ─────────────────────────────────────────────────────

const DOCUMENT_XML_PATH = "word/document.xml";

export async function loadDocxZip(fileOrBuffer: Blob | ArrayBuffer): Promise<JSZip> {
  return JSZip.loadAsync(fileOrBuffer);
}

export async function getDocumentXml(zip: JSZip): Promise<string> {
  const entry = zip.file(DOCUMENT_XML_PATH);
  if (!entry) throw new Error("This doesn't look like a valid .docx file (word/document.xml missing).");
  return entry.async("text");
}

/** Every XML part that can hold visible text/bookmarks: the body plus any headers/footers. */
const HEADER_FOOTER_RE = /^word\/(header|footer)\d+\.xml$/;

export function listWordXmlParts(zip: JSZip): string[] {
  const parts = [DOCUMENT_XML_PATH];
  zip.forEach((relPath) => {
    if (HEADER_FOOTER_RE.test(relPath)) parts.push(relPath);
  });
  return parts;
}

export async function getXmlPart(zip: JSZip, part: string): Promise<string> {
  const entry = zip.file(part);
  if (!entry) throw new Error(`Missing ${part} in this .docx file.`);
  return entry.async("text");
}

/**
 * Scan the document body plus every header/footer for bookmarks (most
 * real-world templates — like ones with a company letterhead — put the
 * reference number in the header, not the body). Returns which XML part each
 * bookmark was found in, so the caller can patch the right one later.
 */
export async function listWordBookmarksWithParts(zip: JSZip): Promise<{ name: string; part: string }[]> {
  const parts = listWordXmlParts(zip);
  const found: { name: string; part: string }[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    let xml: string;
    try {
      xml = await getXmlPart(zip, part);
    } catch {
      continue;
    }
    for (const name of listWordBookmarks(xml)) {
      if (seen.has(name)) continue;
      seen.add(name);
      found.push({ name, part });
    }
  }
  return found;
}

/** Word auto-creates a few internal bookmarks (e.g. _GoBack) — hide those from the picker. */
export function listWordBookmarks(documentXml: string): string[] {
  const names = new Set<string>();
  const re = /<w:bookmarkStart\b[^>]*\bw:name="([^"]+)"[^>]*\/?>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(documentXml))) {
    const name = match[1];
    if (!name.startsWith("_")) names.add(name);
  }
  return Array.from(names);
}

/**
 * Replace the visible text inside a named bookmark's span with `value`.
 * If the bookmark wraps existing text runs, the first run is overwritten and
 * any additional runs in the span are blanked (so text doesn't duplicate).
 * If the bookmark is an empty marker (no runs inside), a new run is inserted.
 */
export function setWordBookmarkText(documentXml: string, bookmarkName: string, value: string): string {
  const startRe = new RegExp(`<w:bookmarkStart\\b[^>]*\\bw:name="${escapeRegExp(bookmarkName)}"[^>]*\\/?>`);
  const startMatch = startRe.exec(documentXml);
  if (!startMatch) {
    throw new Error(`Bookmark "${bookmarkName}" was not found in this document.`);
  }

  const idMatch = /\bw:id="([^"]+)"/.exec(startMatch[0]);
  const bookmarkId = idMatch?.[1];
  const startIdx = startMatch.index;
  const afterStartIdx = startIdx + startMatch[0].length;

  // Find the matching bookmarkEnd (same w:id if we have one, else the next one).
  const endRe = bookmarkId
    ? new RegExp(`<w:bookmarkEnd\\b[^>]*\\bw:id="${escapeRegExp(bookmarkId)}"[^>]*\\/?>`)
    : /<w:bookmarkEnd\b[^>]*\/?>/;
  const remainder = documentXml.slice(afterStartIdx);
  const endMatch = endRe.exec(remainder);
  if (!endMatch) {
    throw new Error(`Couldn't find the closing marker for bookmark "${bookmarkName}".`);
  }
  const endIdxAbs = afterStartIdx + endMatch.index;

  const span = documentXml.slice(afterStartIdx, endIdxAbs);
  const escaped = escapeXmlText(value);

  const runTextRe = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g;
  let replacedFirst = false;
  let newSpan: string;
  if (runTextRe.test(span)) {
    runTextRe.lastIndex = 0;
    newSpan = span.replace(runTextRe, (_full, open: string, _inner: string, close: string) => {
      if (!replacedFirst) {
        replacedFirst = true;
        // Preserve leading/trailing spaces reliably.
        const openTag = open.includes("xml:space") ? open : open.replace("<w:t", '<w:t xml:space="preserve"');
        return `${openTag}${escaped}${close}`;
      }
      return `${open}${close}`;
    });
  } else {
    // No text run inside the bookmark span — insert one right after the start tag.
    newSpan = `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>${span}`;
  }

  return documentXml.slice(0, afterStartIdx) + newSpan + documentXml.slice(endIdxAbs);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a .docx (as ArrayBuffer) to editable HTML for the in-app viewer. */
export async function docxToHtml(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value;
}

/**
 * Build a brand-new, simple .docx from edited HTML (headings, paragraphs,
 * bold/italic/underline, bullet & numbered lists). Used only when the user
 * saves changes made in the in-app rich text editor.
 */
export async function htmlToDocxBlob(html: string): Promise<Blob> {
  const container = document.createElement("div");
  container.innerHTML = html;

  const paragraphs: Paragraph[] = [];

  const headingMap: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    H1: HeadingLevel.HEADING_1,
    H2: HeadingLevel.HEADING_2,
    H3: HeadingLevel.HEADING_3,
    H4: HeadingLevel.HEADING_4,
  };

  function inlineRuns(node: Node, marks: { bold?: boolean; italics?: boolean; underline?: boolean } = {}): TextRun[] {
    const runs: TextRun[] = [];
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (text) runs.push(new TextRun({ text, bold: marks.bold, italics: marks.italics, underline: marks.underline ? {} : undefined }));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const tag = el.tagName;
        const nextMarks = {
          bold: marks.bold || tag === "B" || tag === "STRONG",
          italics: marks.italics || tag === "I" || tag === "EM",
          underline: marks.underline || tag === "U",
        };
        if (tag === "BR") {
          runs.push(new TextRun({ text: "", break: 1 }));
        } else {
          runs.push(...inlineRuns(el, nextMarks));
        }
      }
    });
    return runs;
  }

  container.childNodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;

    if (tag === "UL" || tag === "OL") {
      Array.from(el.children).forEach((li, i) => {
        const runs = inlineRuns(li);
        paragraphs.push(
          new Paragraph({
            children: runs.length ? runs : [new TextRun("")],
            bullet: tag === "UL" ? { level: 0 } : undefined,
            numbering: tag === "OL" ? { reference: "production-form-numbering", level: 0 } : undefined,
          })
        );
      });
      return;
    }

    if (headingMap[tag]) {
      paragraphs.push(new Paragraph({ heading: headingMap[tag], children: inlineRuns(el) }));
      return;
    }

    // Default: treat as a paragraph (covers <p>, <div>, or bare text wrappers).
    const runs = inlineRuns(el);
    paragraphs.push(new Paragraph({ children: runs.length ? runs : [new TextRun("")] }));
  });

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "production-form-numbering",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "start" }],
        },
      ],
    },
    sections: [{ children: paragraphs.length ? paragraphs : [new Paragraph("")] }],
  });

  return Packer.toBlob(doc);
}

// ── Excel (.xlsx) helpers ────────────────────────────────────────────────────

export async function loadWorkbook(arrayBuffer: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  return wb;
}

export function listSheetNames(wb: ExcelJS.Workbook): string[] {
  return wb.worksheets.map((ws) => ws.name);
}

export function setCellValue(wb: ExcelJS.Workbook, sheetName: string, cellRef: string, value: string) {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" was not found in this workbook.`);
  ws.getCell(cellRef).value = value;
}

export function getCellValue(wb: ExcelJS.Workbook, sheetName: string, cellRef: string): string {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return "";
  const v = ws.getCell(cellRef).value;
  if (v == null) return "";
  if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
  return String(v);
}

/** Simple grid snapshot for rendering an editable HTML table. */
export type SheetGrid = { rows: number; cols: number; cells: string[][] };

export function sheetToGrid(wb: ExcelJS.Workbook, sheetName: string, maxRows = 100, maxCols = 26): SheetGrid {
  const ws = wb.getWorksheet(sheetName);
  if (!ws) return { rows: 0, cols: 0, cells: [] };
  const rows = Math.min(ws.rowCount || 0, maxRows);
  const cols = Math.min(ws.columnCount || 0, maxCols);
  const cells: string[][] = [];
  for (let r = 1; r <= rows; r++) {
    const row: string[] = [];
    for (let c = 1; c <= cols; c++) {
      row.push(getCellValue(wb, sheetName, ws.getCell(r, c).address));
    }
    cells.push(row);
  }
  return { rows, cols, cells };
}

export async function workbookToBlob(wb: ExcelJS.Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function columnLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}
