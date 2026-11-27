// ─────────────────────────────────────────────────────────────────────────────
//  Drag & drop files anywhere there is an upload button.
//  While dragging files, the nearest area that holds a file picker (the upload
//  box, or the whole dialog/form around it) is outlined; dropping hands the
//  files to that picker exactly as if they had been chosen with it — so every
//  upload in the app (bills, SO/PO documents, invoices, meeting files,
//  project documents, forms, tasks, notes …) accepts dropped files.
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE = "data-file-drop-active";
let active: HTMLElement | null = null;

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

function inputsIn(el: Element): HTMLInputElement[] {
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((i) => !i.disabled);
}

/** Nearest element around the pointer that contains a usable file input (stays inside an open dialog). */
function zoneFor(target: EventTarget | null): HTMLElement | null {
  let el = target instanceof Element ? target : null;
  const dialog = el?.closest('[role="dialog"]') ?? document.querySelector('[role="dialog"]');
  if (dialog && el && !dialog.contains(el)) el = dialog;      // dropping on the dimmed page → the open dialog
  for (; el && el !== document.documentElement; el = el.parentElement) {
    // a camera-only picker isn't enough — keep looking for one that takes files
    if (inputsIn(el).some((i) => !i.hasAttribute("capture"))) return el as HTMLElement;
    if (el === dialog) break;
  }
  return null;
}

function accepts(input: HTMLInputElement, file: File): boolean {
  const acc = (input.accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!acc.length) return true;
  const name = file.name.toLowerCase(), type = (file.type || "").toLowerCase();
  return acc.some((a) => a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a);
}

/** Best picker for these files: accepts them, prefers "multiple", avoids camera-only inputs. */
function pickInput(zone: HTMLElement, files: File[]): HTMLInputElement | null {
  const all = inputsIn(zone);
  const score = (i: HTMLInputElement) =>
    (files.every((f) => accepts(i, f)) ? 100 : files.some((f) => accepts(i, f)) ? 50 : 0) +
    (i.multiple ? 10 : 0) + (i.hasAttribute("capture") ? -5 : 0) + (i.accept ? 0 : 1);
  return all.sort((a, b) => score(b) - score(a))[0] ?? null;
}

function setActive(el: HTMLElement | null) {
  if (active === el) return;
  active?.removeAttribute(ACTIVE);
  active = el;
  active?.setAttribute(ACTIVE, "");
}

export function installGlobalFileDrop() {
  if ((window as any).__fileDropInstalled) return;
  (window as any).__fileDropInstalled = true;
  let leaveTimer: number | undefined;

  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();                                   // never let the browser open the file
    const zone = zoneFor(e.target);
    if (e.dataTransfer) e.dataTransfer.dropEffect = zone ? "copy" : "none";
    setActive(zone);
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => setActive(null), 150);
  });

  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const zone = zoneFor(e.target);
    setActive(null);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!zone || !files.length) return;
    const input = pickInput(zone, files);
    if (!input) return;
    const usable = files.filter((f) => accepts(input, f));
    const chosen = (usable.length ? usable : files).slice(0, input.multiple ? undefined : 1);
    try {
      const dt = new DataTransfer();
      chosen.forEach((f) => dt.items.add(f));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));   // React's onChange runs as if picked
    } catch { /* very old browser — ignore */ }
  });
}
