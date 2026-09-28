// ─────────────────────────────────────────────────────────────────────────────
//  attendanceExport.ts
//  Downloads whatever the Attendance page is showing as an .xlsx file.
// ─────────────────────────────────────────────────────────────────────────────
import ExcelJS from "exceljs";
import { saveFile } from "@/lib/nativeFiles";

export type ExportColumn = { header: string; key: string; width?: number };

export async function exportRowsToExcel(
  fileName: string,
  sheetName: string,
  title: string,
  columns: ExportColumn[],
  rows: Record<string, unknown>[],
) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));

  // Title row
  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center" };

  // Header row
  const header = ws.getRow(2);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getColumn(i + 1).width = c.width ?? 16;
  });
  header.height = 20;

  // Data rows
  rows.forEach((r, idx) => {
    const row = ws.getRow(idx + 3);
    columns.forEach((c, i) => {
      const v = r[c.key];
      row.getCell(i + 1).value = v === null || v === undefined ? "" : (v as ExcelJS.CellValue);
    });
  });

  // Borders
  for (let r = 2; r <= rows.length + 2; r++) {
    for (let c = 1; c <= columns.length; c++) {
      ws.getCell(r, c).border = {
        top: { style: "thin" }, left: { style: "thin" },
        bottom: { style: "thin" }, right: { style: "thin" },
      };
    }
  }
  ws.views = [{ state: "frozen", ySplit: 2 }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  await saveFile(blob, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}
