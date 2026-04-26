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

export interface LeaveExportArgs {
  year: number;
  month: number; // 1-12
  employees: LeaveExportEmployee[];
  leaveRequests: LeaveExportRequest[];
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

/** Should this request count as a leave on the attendance sheet? */
function countsAsLeave(req: LeaveExportRequest): boolean {
  if (req.reverted_at) return false;
  if (req.status && req.status !== "approved") return false;
  // on_duty and permission keep the employee marked present
  if (req.type === "on_duty" || req.leave_category === "on_duty") return false;
  if (req.type === "permission" || req.leave_category === "permission") return false;
  return true;
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
  const { year, month, employees, leaveRequests } = args;
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

  // ── Build the leave grid: per employee, per day → { f: bool, a: bool } ─────
  // f = mark "L" in fore-noon, a = mark "L" in after-noon.
  const grid: Record<string, Array<{ f: boolean; a: boolean }>> = {};
  for (const emp of employees) {
    grid[emp.id] = Array.from({ length: totalDays }, () => ({ f: false, a: false }));
  }

  for (const req of leaveRequests) {
    if (!countsAsLeave(req)) continue;
    const emp = grid[req.employee_id];
    if (!emp) continue; // employee not in the active list (e.g. terminated)

    for (const d of eachLeaveDay(req)) {
      if (d.getFullYear() !== year || d.getMonth() !== month - 1) continue;
      const dayIdx = d.getDate() - 1;

      if (req.is_half_day) {
        // Half-day applies only to the start_date day for these requests
        if (isHalfDayMorning(req)) emp[dayIdx].f = true;
        else if (isHalfDayAfternoon(req)) emp[dayIdx].a = true;
        else {
          // Unknown half-day period — be conservative and mark forenoon
          emp[dayIdx].f = true;
        }
      } else {
        emp[dayIdx].f = true;
        emp[dayIdx].a = true;
      }
    }
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

  // ── Row 1: Month title ─────────────────────────────────────────────────────
  ws.mergeCells(1, 1, 1, totalCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Month of ${monthName} ${year}`;
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.font = { bold: true, size: 14 };
  ws.getRow(1).height = 22;

  // ── Row 2: Working days subtitle ──────────────────────────────────────────
  ws.mergeCells(2, 1, 2, totalCols);
  const subCell = ws.getCell(2, 1);
  subCell.value = `No.of Working Day - ${workingDays} Days`;
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  subCell.font = { bold: true, size: 11 };
  ws.getRow(2).height = 18;

  // ── Row 3: Day numbers (each day spans 2 columns) ─────────────────────────
  // ── Row 4: Weekday letters
  // ── Row 5: F / A
  // S.No header spans rows 3-5 col 1; Name header spans rows 3-5 col 2.
  ws.mergeCells(3, 1, 5, 1);
  ws.getCell(3, 1).value = "S.No";
  ws.mergeCells(3, 2, 5, 2);
  ws.getCell(3, 2).value = "Name";

  for (const m of dayMeta) {
    const startCol = 2 + (m.day - 1) * 2 + 1;
    const endCol = startCol + 1;

    // Row 3: day number, merged across F+A
    ws.mergeCells(3, startCol, 3, endCol);
    ws.getCell(3, startCol).value = m.day;

    // Row 4: weekday letter, merged across F+A
    ws.mergeCells(4, startCol, 4, endCol);
    ws.getCell(4, startCol).value = m.weekdayLetter;

    // Row 5: F | A
    ws.getCell(5, startCol).value = "F";
    ws.getCell(5, endCol).value = "A";
  }

  // Style header rows 3-5
  for (let r = 3; r <= 5; r++) {
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

  // ── Body rows: one per employee ───────────────────────────────────────────
  const sundayFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE57373" }, // soft red so "L" stays readable
  };
  const sundayHeaderFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEF9A9A" },
  };

  // Tint the Sunday column headers (rows 3-5) red so the day number stands out
  for (const m of dayMeta) {
    if (!m.isSunday) continue;
    const startCol = 2 + (m.day - 1) * 2 + 1;
    const endCol = startCol + 1;
    for (let r = 3; r <= 5; r++) {
      for (let c = startCol; c <= endCol; c++) {
        ws.getCell(r, c).fill = sundayHeaderFill;
      }
    }
  }

  let bodyRowIdx = 6;
  employees.forEach((emp, i) => {
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
      if (slot.f) fCell.value = "L";
      if (slot.a) aCell.value = "L";
      fCell.alignment = { horizontal: "center", vertical: "middle" };
      aCell.alignment = { horizontal: "center", vertical: "middle" };
      if (m.isSunday) {
        fCell.fill = sundayFill;
        aCell.fill = sundayFill;
      }
    }

    // Borders on every cell in the body row
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

  // ── Freeze the header so it sticks while scrolling employees / days ───────
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 5 }];

  // ── Save & trigger download ───────────────────────────────────────────────
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
