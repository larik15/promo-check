import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { SourceKind } from "../schema.js";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** A promotion loaded into memory, ready to send to an extraction provider. */
export interface PromoSource {
  kind: SourceKind;
  /** File name (no directories), or null for in-memory input. */
  file: string | null;
  /**
   * Plain text used to verify quotes. One entry per PDF page; a single entry
   * for email text; empty for images and for PDFs with no text layer.
   */
  pages: string[];
  /** Page count for PDFs, null otherwise. */
  pageCount: number | null;
  /** Raw bytes for PDFs and images. */
  data?: Uint8Array;
  /** Media type for PDFs and images. */
  mediaType?: "application/pdf" | ImageMediaType;
}

const EXT_KIND: Record<string, SourceKind> = {
  ".pdf": "pdf",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".txt": "email",
  ".eml": "email",
  ".md": "email",
  ".text": "email",
};

/** Detects a binary type from magic bytes. */
export function sniffMediaType(data: Uint8Array): "application/pdf" | ImageMediaType | null {
  const b = data;
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return "image/webp";
  return null;
}

/** Extracts per-page text from a PDF. Returns [] when the PDF has no text layer or cannot be read. */
export async function pdfPageTexts(data: Uint8Array): Promise<{ pages: string[]; pageCount: number | null }> {
  try {
    const { extractText } = await import("unpdf");
    // unpdf may detach the buffer it is given, so pass a copy.
    const { totalPages, text } = await extractText(new Uint8Array(data), { mergePages: false });
    const pages = text.map((t) => t ?? "");
    const hasText = pages.some((p) => p.trim().length > 0);
    return { pages: hasText ? pages : [], pageCount: totalPages };
  } catch {
    return { pages: [], pageCount: null };
  }
}

/** Builds a source from email (or any plain) text. */
export function sourceFromText(text: string, file: string | null = null): PromoSource {
  return { kind: "email", file, pages: [text], pageCount: null };
}

/** Builds a source from bytes. The type is detected from magic bytes. */
export async function sourceFromBytes(data: Uint8Array, file: string | null = null): Promise<PromoSource> {
  const mediaType = sniffMediaType(data);
  if (mediaType === "application/pdf") {
    const { pages, pageCount } = await pdfPageTexts(data);
    return { kind: "pdf", file, pages, pageCount, data, mediaType };
  }
  if (mediaType) {
    return { kind: "image", file, pages: [], pageCount: null, data, mediaType };
  }
  return sourceFromText(new TextDecoder("utf-8").decode(data), file);
}

/**
 * Loads a promotion from disk. PDFs and images are detected from their bytes;
 * anything else is read as email text (.txt, .eml, .md).
 */
export async function loadSource(path: string, kind?: SourceKind): Promise<PromoSource> {
  const data = new Uint8Array(await readFile(path));
  const file = basename(path);
  const detected = sniffMediaType(data);
  const expected = kind ?? (detected ? undefined : EXT_KIND[extname(path).toLowerCase()]);

  if (expected === "email") return sourceFromText(new TextDecoder("utf-8").decode(data), file);
  if (expected === "pdf" && detected !== "application/pdf") throw new Error(`${file} is not a PDF`);
  if (expected === "image" && (!detected || detected === "application/pdf"))
    throw new Error(`${file} is not a PNG, JPEG, GIF or WebP image`);
  return sourceFromBytes(data, file);
}

/** Base64-encodes bytes without newlines. */
export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}
