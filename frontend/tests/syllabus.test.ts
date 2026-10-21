import { afterEach, describe, expect, it, vi } from "vitest";
import { describeIngestError } from "@/components/SyllabusIngestModal";
import { ApiError, api } from "@/lib/api";
import { createMockState } from "@/lib/mockData";
import {
  SYLLABUS_ACCEPT,
  SYLLABUS_MAX_BYTES,
  classifySyllabusFile,
  encodeSyllabusFile,
  toBase64,
} from "@/lib/syllabus";

describe("classifySyllabusFile", () => {
  it("sorts images and PDFs for upload and text for the paste buffer", () => {
    expect(
      classifySyllabusFile({ name: "page.PNG", type: "image/png", size: 10 }),
    ).toEqual({ ok: true, kind: "image", mimeType: "image/png" });
    expect(
      classifySyllabusFile({ name: "s.pdf", type: "application/pdf", size: 10 }),
    ).toMatchObject({ ok: true, kind: "document" });
    expect(
      classifySyllabusFile({ name: "s.txt", type: "text/plain", size: 10 }),
    ).toMatchObject({ ok: true, kind: "text" });
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(
      classifySyllabusFile({ name: "notes.md", type: "", size: 10 }),
    ).toEqual({ ok: true, kind: "text", mimeType: "text/markdown" });
    expect(
      classifySyllabusFile({ name: "IMG_0042.JPG", type: "", size: 10 }),
    ).toEqual({ ok: true, kind: "image", mimeType: "image/jpeg" });
  });

  it("rejects formats the backend cannot read, empty files, and oversize files", () => {
    const docx = classifySyllabusFile({
      name: "s.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 10,
    });
    expect(docx).toMatchObject({ ok: false });
    expect(!docx.ok && docx.error).toMatch(/export Word files to PDF/);
    expect(
      classifySyllabusFile({ name: "s.png", type: "image/png", size: 0 }),
    ).toMatchObject({ ok: false });
    const big = classifySyllabusFile({
      name: "scan.png",
      type: "image/png",
      size: SYLLABUS_MAX_BYTES + 1,
    });
    expect(!big.ok && big.error).toMatch(/limit is 6\.0 MB/);
  });

  it("offers the file picker every accepted type", () => {
    for (const token of ["image/png", "application/pdf", ".md", ".jpeg"]) {
      expect(SYLLABUS_ACCEPT.split(",")).toContain(token);
    }
    expect(SYLLABUS_ACCEPT).not.toMatch(/docx/);
  });
});

describe("syllabus encoding", () => {
  it("base64-encodes files larger than one fromCharCode chunk", () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("packages a dropped file for the ingest contract", async () => {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "p.png");
    expect(await encodeSyllabusFile(file, "image/png")).toEqual({
      name: "p.png",
      mime_type: "image/png",
      data_base64: "iVBORw==",
    });
  });
});

describe("api.ingestSyllabus", () => {
  afterEach(() => vi.unstubAllGlobals());

  const backend = (body: unknown, status = 200) => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  };
  const sent = (calls: { init: RequestInit }[]) =>
    JSON.parse(String(calls[0].init.body));

  it("posts trimmed text and returns the normalized state", async () => {
    const calls = backend(createMockState(Date.now()));
    const state = await api.ingestSyllabus({ text: "  Grading: Final 40%  " });
    expect(calls[0].url).toMatch(/\/api\/v1\/syllabus\/ingest$/);
    expect(calls[0].init.method).toBe("POST");
    expect(sent(calls)).toEqual({ syllabus_text: "Grading: Final 40%" });
    expect(state.courses.length).toBeGreaterThan(0);
  });

  it("sends a file once, never duplicated as image_base64", async () => {
    const calls = backend(createMockState(Date.now()));
    const file = {
      name: "page.png",
      mime_type: "image/png",
      data_base64: "iVBORw==",
    };
    await api.ingestSyllabus({ text: "   ", file });
    expect(sent(calls)).toEqual({ file });
  });

  it("refuses an empty ingest without calling the backend", async () => {
    const calls = backend({});
    await expect(api.ingestSyllabus({ text: " " })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(calls).toHaveLength(0);
  });

  it("surfaces the backend's refusal and rejects non-state answers", async () => {
    backend({ detail: "Syllabus extraction is unavailable" }, 503);
    await expect(api.ingestSyllabus({ text: "x" })).rejects.toMatchObject({
      kind: "http",
      status: 503,
      message: "HTTP 503: Syllabus extraction is unavailable",
    });
    backend({ ok: true });
    await expect(api.ingestSyllabus({ text: "x" })).rejects.toMatchObject({
      kind: "parse",
    });
  });
});

describe("describeIngestError", () => {
  it("explains each failure in plain language", () => {
    expect(
      describeIngestError(new ApiError("Cannot reach x", "network")),
    ).toMatch(/Cannot reach the Apex backend/);
    expect(describeIngestError(new ApiError("slow", "timeout"))).toMatch(
      /90s/,
    );
    expect(
      describeIngestError(new ApiError("HTTP 404", "http", 404)),
    ).toMatch(/no syllabus ingest endpoint/);
    expect(
      describeIngestError(new ApiError("HTTP 503: unavailable", "http", 503)),
    ).toBe("Extraction failed: HTTP 503: unavailable.");
    expect(describeIngestError(new Error("boom"))).toBe("boom");
  });
});
