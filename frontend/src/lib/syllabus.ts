// Syllabus intake: which dropped files the ingest desk accepts and how they
// are encoded for POST /api/v1/syllabus/ingest.

import type { SyllabusFile } from "@/lib/api";

/** The backend's upload ceiling (6 MiB decoded). */
export const SYLLABUS_MAX_BYTES = 6 * 1024 * 1024;
/** Shorter than this is a course title, not a syllabus. */
export const SYLLABUS_MIN_CHARS = 40;
/** The backend's syllabus_text ceiling. */
export const SYLLABUS_MAX_CHARS = 100_000;

const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
};

const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DOCUMENTS = new Set(["application/pdf"]);
const TEXT = new Set(["text/plain", "text/markdown"]);

export const SYLLABUS_ACCEPT = [
  ...new Set(Object.values(BY_EXTENSION)),
  ...Object.keys(BY_EXTENSION).map((extension) => `.${extension}`),
].join(",");

/** image and document upload as files; text is read into the paste buffer. */
export type SyllabusFileKind = "image" | "document" | "text";

export type SyllabusClassification =
  | { ok: true; kind: SyllabusFileKind; mimeType: string }
  | { ok: false; error: string };

/** Trusts the browser's MIME type, falling back to the extension (some OSes report none). */
export function classifySyllabusFile(file: {
  name: string;
  type: string;
  size: number;
}): SyllabusClassification {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = (file.type || BY_EXTENSION[extension] || "").toLowerCase();
  const kind: SyllabusFileKind | null = IMAGES.has(mimeType)
    ? "image"
    : DOCUMENTS.has(mimeType)
      ? "document"
      : TEXT.has(mimeType)
        ? "text"
        : null;
  if (!kind) {
    return {
      ok: false,
      error: `${file.name} is not a supported syllabus. Use PNG, JPG, WEBP, GIF, PDF, TXT, or MD (export Word files to PDF).`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: `${file.name} is empty.` };
  }
  if (file.size > SYLLABUS_MAX_BYTES) {
    return {
      ok: false,
      error: `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(SYLLABUS_MAX_BYTES)}. Crop the photo or export fewer pages.`,
    };
  }
  return { ok: true, kind, mimeType };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Chunked so multi-megabyte files never blow the argument limit of fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function encodeSyllabusFile(
  file: Blob & { name: string },
  mimeType: string,
): Promise<SyllabusFile> {
  return {
    name: file.name,
    mime_type: mimeType,
    data_base64: toBase64(new Uint8Array(await file.arrayBuffer())),
  };
}
