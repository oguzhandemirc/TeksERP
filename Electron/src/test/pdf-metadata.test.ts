// PDF filigranı (lisans Faz 2e): printToPDF çıktısına lisans sahibi + lisans no meta verisi.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyPdfLicenseMeta, sanitizePdfLicenseMeta } from "../../electron/ipc/pdf-metadata";

async function blankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

describe("PDF lisans filigranı", () => {
  it("meta verisine lisans sahibi + lisans no yazılır", async () => {
    const out = await applyPdfLicenseMeta(await blankPdf(), { lisansSahibi: "Örnek Tekstil · Merkez", lisansNo: "TKS-2026-0042" });
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getAuthor()).toBe("Örnek Tekstil · Merkez");
    expect(doc.getSubject()).toBe("Lisans TKS-2026-0042 · Örnek Tekstil · Merkez");
    expect(doc.getKeywords()).toBe("lisans:TKS-2026-0042");
    expect(doc.getProducer()).toBe("TeksERP");
  });

  it("meta yoksa yalnız üretici yazılır, yazar boş kalır", async () => {
    const doc = await PDFDocument.load(await applyPdfLicenseMeta(await blankPdf(), null), { updateMetadata: false });
    expect(doc.getProducer()).toBe("TeksERP");
    expect(doc.getAuthor()).toBeUndefined();
  });

  it("ayrıştırılamayan girdi olduğu gibi döner (PDF üretimi düşmez)", async () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(await applyPdfLicenseMeta(junk, { lisansSahibi: "X", lisansNo: "TKS-2026-0001" })).toBe(junk);
  });

  it("renderer'dan gelen biçimsiz meta YOK sayılır; kontrol karakteri temizlenir", () => {
    expect(sanitizePdfLicenseMeta({ lisansSahibi: "A", lisansNo: "ABC-1" })).toBeNull();
    expect(sanitizePdfLicenseMeta({ lisansSahibi: "", lisansNo: "TKS-2026-0001" })).toBeNull();
    expect(sanitizePdfLicenseMeta("TKS-2026-0001")).toBeNull();
    expect(sanitizePdfLicenseMeta({ lisansSahibi: "A\nB", lisansNo: "TKS-2026-0001" })).toEqual({ lisansSahibi: "A B", lisansNo: "TKS-2026-0001" });
  });

  it("main süreç her PDF'i filigrandan geçirir (pdf.ipc.ts bağlama)", () => {
    const src = readFileSync(resolve(__dirname, "../../electron/ipc/pdf.ipc.ts"), "utf8");
    expect(src).toMatch(/return await applyPdfLicenseMeta\(pdf, licenseMeta\)/);
    expect(src).toMatch(/handleTrusted\("pdf:setLicenseMeta"/);
  });
});
