// ─────────────────────────────────────────────────────────────────────────────
//  Saving / opening files in a way that works everywhere:
//   • Website & desktop app → normal browser download / new tab
//   • Android app → the phone's "Save / Send to…" share sheet, and files open
//     in an in-app browser tab (Chrome Custom Tab)
//  The Android app exposes its native plugins on window.Capacitor.Plugins, so
//  the website build needs no extra packages.
// ─────────────────────────────────────────────────────────────────────────────
import { isNativeApp } from "@/lib/platform";

const plugins = () => (window as any).Capacitor?.Plugins ?? {};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Download a generated file (Excel, CSV, image…). On the phone app: save/share sheet. */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const { Filesystem, Share } = plugins();
  if (isNativeApp && Filesystem && Share) {
    const safeName = fileName.replace(/[\\/:*?"<>|]/g, "_");
    const data = await blobToBase64(blob);
    const { uri } = await Filesystem.writeFile({ path: safeName, data, directory: "CACHE" });
    try {
      await Share.share({ title: safeName, files: [uri], dialogTitle: "Save or send file" });
    } catch (e: any) {
      // User closed the share sheet — not an error
      if (!/cancel/i.test(String(e?.message ?? e))) throw e;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Download a file that lives at a URL (e.g. a signed storage link). */
export async function saveFromUrl(url: string, fileName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  await saveFile(await res.blob(), fileName);
}

/** Open a link or file for viewing. On the phone app: in-app browser tab. */
export async function openExternal(url: string): Promise<void> {
  const { Browser } = plugins();
  if (isNativeApp && Browser) {
    await Browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
