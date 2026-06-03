// ─────────────────────────────────────────────────────────────────────────────
//  leaveExcelExport.ts
//  Builds the monthly attendance/leave grid spreadsheet that mirrors the
//  paper attendance sheet:
//
//    Row 1:  "Month of <Month> <Year>"                           (merged)
//    Row 2:  "No.of Working Day - <N> Days"                      (merged)
//    Row 3:  S.No | Name | 1 | 1 | 2 | 2 | … | 31 | 31           (day numbers; each day spans 2 columns)
//    Row 4:                | M | M | T | T | …                    (weekday letters)
//    Row 5:                | F | A | F | A | …                    (Fore-noon / After-noon)
//    Row 6+: 1   | Saravanan |   |   | L |   | … | … | …          (one row per employee)
//
//  Cell rules:
//    • Blank cell  → Present
//    • "L" cell    → Absent (full-day leave fills both F and A)
//    • Half-day    → "L" in just F (AM / first half) or just A (PM / second half)
//    • on_duty / permission → treated as Present (employee was at work, no L)
//    • Reverted leaves (reverted_at IS NOT NULL) are skipped
//    • Sundays → entire column shaded red so the rest day is visually obvious
//
//  Working day count (top row) = (days in month) − (number of Sundays).
//  Public holidays beyond Sunday aren't tracked in the DB yet, so we keep this
//  conservative; admins can edit the cell after download if they want to
//  subtract holidays.
// ─────────────────────────────────────────────────────────────────────────────

import ExcelJS from "exceljs";

export interface LeaveExportEmployee {
  id: string;
  full_name: string;
}

export interface LeaveExportRequest {
  employee_id: string;
  // ISO date strings, inclusive
  start_date: string;
  end_date: string | null;
  // Anything truthy here means it's no longer a leave
  reverted_at?: string | null;
  // We only count approved leaves on the sheet
  status?: string | null;
  // 'leave' | 'on_duty' | 'permission'
  type?: string | null;
  leave_category?: string | null;
  // Half-day fields
  is_half_day?: boolean | null;
  half_day_period?: string | null; // 'AM' | 'PM' | 'First Half' | 'Second Half'
}

export interface LeaveExportGroup {
  title: string; // shown as the section header (e.g. "Month of May 2026" or "MAPL - Month of May 2026")
  employees: LeaveExportEmployee[];
}

export interface LeaveExportArgs {
  year: number;
  month: number; // 1-12
  employees: LeaveExportEmployee[];
  leaveRequests: LeaveExportRequest[];
  /** Optional additional employee tables rendered below the main table with their own headers. */
  additionalGroups?: LeaveExportGroup[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]; // Sun=0 … Sat=6

function daysInMonth(year: number, month: number): number {
  // month is 1-12; new Date(year, month, 0) gives last day of "month" in JS terms
  return new Date(year, month, 0).getDate();
}

function isHalfDayMorning(req: LeaveExportRequest): boolean {
  const p = (req.half_day_period ?? "").toUpperCase();
  return p === "AM" || p === "FIRST HALF" || p === "FIRST" || p === "F";
}

function isHalfDayAfternoon(req: LeaveExportRequest): boolean {
  const p = (req.half_day_period ?? "").toUpperCase();
  return p === "PM" || p === "SECOND HALF" || p === "SECOND" || p === "A";
}

/** Returns the mark for this request: "L" for leave, "W" for WFH, or null to skip */
function markFor(req: LeaveExportRequest): "L" | "W" | null {
  if (req.reverted_at) return null;
  if (req.status && req.status !== "approved") return null;
  // on_duty and permission keep the employee marked present
  if (req.type === "on_duty" || req.leave_category === "on_duty") return null;
  if (req.type === "permission" || req.leave_category === "permission") return null;
  // WFH is present-but-remote — mark distinctly so it isn't read as a leave
  if (req.leave_category === "work_from_home") return "W";
  return "L";
}

/** Iterate every day inclusively between start_date and end_date for a request */
function* eachLeaveDay(req: LeaveExportRequest): Generator<Date> {
  const start = new Date(req.start_date + "T00:00:00");
  const end = req.end_date ? new Date(req.end_date + "T00:00:00") : start;
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    yield new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
}

export async function exportLeavesToExcel(args: LeaveExportArgs): Promise<void> {
  const { year, month, employees, leaveRequests, additionalGroups = [] } = args;
  const monthName = MONTH_NAMES[month - 1];
  const totalDays = daysInMonth(year, month);

  // Pre-compute per-day weekday letter and Sunday flag
  const dayMeta = Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(year, month - 1, i + 1);
    return {
      day: i + 1,
      weekdayLetter: WEEKDAY_LETTERS[d.getDay()],
      isSunday: d.getDay() === 0,
    };
  });
  const workingDays = totalDays - dayMeta.filter((m) => m.isSunday).length;

  type Mark = "L" | "W" | null;

  function buildGrid(emps: LeaveExportEmployee[]) {
    const grid: Record<string, Array<{ f: Mark; a: Mark }>> = {};
    for (const emp of emps) {
      grid[emp.id] = Array.from({ length: totalDays }, () => ({ f: null as Mark, a: null as Mark }));
    }
    for (const req of leaveRequests) {
      const mark = markFor(req);
      if (!mark) continue;
      const emp = grid[req.employee_id];
      if (!emp) continue;
      for (const d of eachLeaveDay(req)) {
        if (d.getFullYear() !== year || d.getMonth() !== month - 1) continue;
        const dayIdx = d.getDate() - 1;
        if (req.is_half_day) {
          if (isHalfDayMorning(req)) emp[dayIdx].f = mark;
          else if (isHalfDayAfternoon(req)) emp[dayIdx].a = mark;
          else emp[dayIdx].f = mark;
        } else {
          emp[dayIdx].f = mark;
          emp[dayIdx].a = mark;
        }
      }
    }
    return grid;
  }

  // ── Build the workbook ─────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "TaskFlow";
  wb.created = new Date();
  const ws = wb.addWorksheet(`${monthName} ${year}`);

  // Column count: 2 fixed (S.No, Name) + 2 per day (F + A)
  const totalCols = 2 + totalDays * 2;

  // Column widths
  ws.getColumn(1).width = 5;   // S.No
  ws.getColumn(2).width = 22;  // Name
  for (let i = 3; i <= totalCols; i++) ws.getColumn(i).width = 3.2;

  const sundayFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE57373" },
  };
  const sundayHeaderFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEF9A9A" },
  };
  const wfhFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFBBDEFB" },
  };

  /**
   * Render one full table (title + subtitle + day headers + body) starting at the given row.
   * Returns the next free row after the table.
   */
  function renderTable(startRow: number, title: string, emps: LeaveExportEmployee[]): number {
    const grid = buildGrid(emps);

    // Title
    ws.mergeCells(startRow, 1, startRow, totalCols);
    const titleCell = ws.getCell(startRow, 1);
    titleCell.value = title;
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    titleCell.font = { bold: true, size: 14 };
    ws.getRow(startRow).height = 22;

    // Subtitle
    const subRow = startRow + 1;
    ws.mergeCells(subRow, 1, subRow, totalCols);
    const subCell = ws.getCell(subRow, 1);
    subCell.value = `No.of Working Day - ${workingDays} Days       (Legend:  L = Leave   W = Work From Home   blank = Present)`;
    subCell.alignment = { horizontal: "center", vertical: "middle" };
    subCell.font = { bold: true, size: 11 };
    ws.getRow(subRow).height = 18;

    // Header rows: day number / weekday / F-A
    const hdr1 = startRow + 2;
    const hdr2 = startRow + 3;
    const hdr3 = startRow + 4;

    ws.mergeCells(hdr1, 1, hdr3, 1);
    ws.getCell(hdr1, 1).value = "S.No";
    ws.mergeCells(hdr1, 2, hdr3, 2);
    ws.getCell(hdr1, 2).value = "Name";

    for (const m of dayMeta) {
      const startCol = 2 + (m.day - 1) * 2 + 1;
      const endCol = startCol + 1;

      ws.mergeCells(hdr1, startCol, hdr1, endCol);
      ws.getCell(hdr1, startCol).value = m.day;

      ws.mergeCells(hdr2, startCol, hdr2, endCol);
      ws.getCell(hdr2, startCol).value = m.weekdayLetter;

      ws.getCell(hdr3, startCol).value = "F";
      ws.getCell(hdr3, endCol).value = "A";
    }

    for (let r = hdr1; r <= hdr3; r++) {
      const row = ws.getRow(r);
      row.height = 16;
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.font = { bold: true, size: 10 };
        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      });
    }

    // Sunday column header tint
    for (const m of dayMeta) {
      if (!m.isSunday) continue;
      const startCol = 2 + (m.day - 1) * 2 + 1;
      const endCol = startCol + 1;
      for (let r = hdr1; r <= hdr3; r++) {
        for (let c = startCol; c <= endCol; c++) {
          ws.getCell(r, c).fill = sundayHeaderFill;
        }
      }
    }

    // Body
    let bodyRowIdx = hdr3 + 1;
    emps.forEach((emp, i) => {
      const row = ws.getRow(bodyRowIdx);
      row.height = 18;
      row.getCell(1).value = i + 1;
      row.getCell(2).value = emp.full_name;
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
      row.getCell(2).alignment = { horizontal: "left", vertical: "middle" };

      for (const m of dayMeta) {
        const dayIdx = m.day - 1;
        const startCol = 2 + dayIdx * 2 + 1;
        const endCol = startCol + 1;
        const slot = grid[emp.id][dayIdx];
        const fCell = row.getCell(startCol);
        const aCell = row.getCell(endCol);
        fCell.alignment = { horizontal: "center", vertical: "middle" };
        aCell.alignment = { horizontal: "center", vertical: "middle" };

        if (m.isSunday) {
          fCell.fill = sundayFill;
          aCell.fill = sundayFill;
        } else {
          if (slot.f) fCell.value = slot.f;
          if (slot.a) aCell.value = slot.a;
          if (slot.f === "W") fCell.fill = wfhFill;
          if (slot.a === "W") aCell.fill = wfhFill;
        }
      }

      for (let c = 1; c <= totalCols; c++) {
        row.getCell(c).border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      }
      bodyRowIdx++;
    });

    return bodyRowIdx;
  }

  // Main table
  let nextRow = renderTable(1, `Month of ${monthName} ${year}`, employees);

  // Additional groups (e.g. MAPL), each separated by a blank row
  for (const g of additionalGroups) {
    if (!g.employees.length) continue;
    nextRow += 2; // blank gap
    nextRow = renderTable(nextRow, `${g.title} - Month of ${monthName} ${year}`, g.employees);
  }

  // Freeze the main header
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 5 }];

  // Save & trigger download
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Attendance_${monthName}_${year}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

