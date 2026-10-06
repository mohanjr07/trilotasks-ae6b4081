// Turns the on-screen digital copy into an A4 PDF. The two libraries are
// loaded on demand from cdnjs, so the app bundle doesn't grow.
import { saveFile } from "@/lib/nativeFiles";

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loaded.delete(src); reject(new Error("Couldn't load the PDF tools — check the internet connection")); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src)!;
}

export async function downloadElementAsPdf(el: HTMLElement, fileName: string) {
  await Promise.all([
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
  ]);
  const html2canvas = (window as any).html2canvas;
  const { jsPDF } = (window as any).jspdf;

  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  // Original Word form rendered page-by-page → one PDF page per Word page
  const pages = Array.from(el.querySelectorAll<HTMLElement>("section.docx-preview"));
  if (pages.length) {
    for (let i = 0; i < pages.length; i++) {
      const c: HTMLCanvasElement = await html2canvas(pages[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      if (i > 0) pdf.addPage();
      const ratio = Math.min(210 / c.width, 297 / c.height);
      pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", (210 - c.width * ratio) / 2, 0, c.width * ratio, c.height * ratio);
    }
    await saveFile(pdf.output("blob"), fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
    return;
  }

  const canvas: HTMLCanvasElement = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, windowWidth: 900 });
  const pageW = 210, pageH = 297, margin = 8;
  const imgW = pageW - margin * 2;
  const pxPerMm = canvas.width / imgW;
  const pageHpx = Math.floor((pageH - margin * 2) * pxPerMm);

  // Slice the tall image into A4 pages
  for (let y = 0, page = 0; y < canvas.height; y += pageHpx, page++) {
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = Math.min(pageHpx, canvas.height - y);
    slice.getContext("2d")!.drawImage(canvas, 0, y, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
    if (page > 0) pdf.addPage();
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margin, margin, imgW, slice.height / pxPerMm);
  }
  await saveFile(pdf.output("blob"), fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`);
}
