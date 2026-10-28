import type { Attachment } from "./store";

const MAX_TEXT_BYTES = 400_000;
const MAX_PDF_BYTES = 25_000_000;
const MAX_IMAGE_SIDE = 1568;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|js|mjs|cjs|ts|tsx|jsx|py|html?|css|scss|xml|ya?ml|toml|ini|sql|sh|bash|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|lua|r|log|env|tex|srt|vtt)$/i;

export const ACCEPT = [
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,text/*",
  ".md,.markdown,.csv,.tsv,.json,.jsonl,.js,.mjs,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml,.toml,.ini,.sql,.sh,.go,.rs,.java,.kt,.swift,.c,.cpp,.h,.cs,.rb,.php,.lua,.r,.log,.tex,.srt,.vtt",
].join(",");

/** Downscales an image so the long side is at most 1568px and returns base64 JPEG/PNG. */
async function readImage(file: File): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const hgt = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = hgt;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, hgt);
  bitmap.close();
  // keep transparency for PNGs, JPEG for everything else
  const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const url = canvas.toDataURL(mediaType, 0.86);
  return { name: file.name || "image", size: file.size, kind: "image", mediaType, data: url.slice(url.indexOf(",") + 1) };
}

async function readPdf(file: File): Promise<Attachment> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join(""));
  }
  const text = pages.map((p, i) => `[Page ${i + 1}]\n${p.trim()}`).join("\n\n");
  if (!text.replace(/\[Page \d+\]/g, "").trim()) throw new Error(`${file.name} has no text layer (it may be a scan).`);
  return { name: file.name, size: file.size, kind: "text", text: text.slice(0, MAX_TEXT_BYTES) };
}

/** Reads a file the user attached. Throws with a user-facing message if it can't be used. */
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.type.startsWith("image/")) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error(`${file.name}: use PNG, JPEG, WebP or GIF images.`);
    return readImage(file);
  }
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
    return readPdf(file);
  }
  if (file.size > MAX_TEXT_BYTES) throw new Error(`${file.name} is larger than 400 KB.`);
  const text = await file.text();
  if (text.includes("\u0000")) throw new Error(`${file.name} isn't a text, PDF or image file.`);
  return { name: file.name, size: file.size, kind: "text", text };
}

export const dataUrlOf = (a: Attachment) => `data:${a.mediaType};base64,${a.data}`;
