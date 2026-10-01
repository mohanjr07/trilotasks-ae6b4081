// Same person with two accounts → shown as ONE person in the Excel export and
// the Leave Balance tab. The accounts stay separate in the app.
// Key = lower-case full name, value = the name to show.
export const PERSON_MERGE: Record<string, string> = {
  "anu": "Anu V",
  "anu v": "Anu V",
};

export const mergedName = (fullName: string | null | undefined): string | undefined =>
  PERSON_MERGE[(fullName ?? "").trim().toLowerCase()];
