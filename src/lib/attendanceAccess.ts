/** Attendance (everyone's punches): all admins and Anu. Also enforced in the database — TRILO_attendance_access.sql. */
export const ATTENDANCE_EMAILS = ["anu@triloautomation.com"];

export function canSeeAttendance(profile?: { role?: string | null; email?: string | null } | null): boolean {
  if (!profile) return false;
  return ["admin", "super_admin"].includes(profile.role ?? "") || ATTENDANCE_EMAILS.includes((profile.email ?? "").toLowerCase());
}
