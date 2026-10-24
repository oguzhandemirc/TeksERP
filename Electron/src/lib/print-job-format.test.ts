// Bekçi (izlenebilirlik A3): satır biçimi — SIMULE başarı sayılmaz, PDF "Kaydedildi",
// eski istemci "yazıcı bilinmiyor", toplu etiket "N top etiketi (toplu)".
import { describe, expect, it } from "vitest";
import { isPrintSuccess, printPrinterText, printStatusView, printSubjectText } from "./print-job-format";

const base = { peripheral: null, printerName: null, printerAddress: null, appVersion: "1.6.8", transport: "TCP_9100" as const };

describe("yazdırma geçmişi satır biçimi", () => {
  it("SIMULE başarı değildir ve SİMÜLASYON rozeti taşır", () => {
    expect(isPrintSuccess({ status: "SIMULE" })).toBe(false);
    expect(printStatusView({ status: "SIMULE", outputKind: "PRINTER" })).toEqual({ label: "Simüle", tone: "simulated", flag: "SİMÜLASYON" });
    expect(isPrintSuccess({ status: "ILETILDI" })).toBe(true);
  });

  it("PDF'te İLETİLDİ 'Kaydedildi', yazıcıda 'İletildi'", () => {
    expect(printStatusView({ status: "ILETILDI", outputKind: "PDF" }).label).toBe("Kaydedildi");
    expect(printStatusView({ status: "ILETILDI", outputKind: "PRINTER" }).label).toBe("İletildi");
    expect(printPrinterText({ ...base, outputKind: "PDF", printerName: "x" })).toBe("PDF");
  });

  it("renk sınıfları: hata kırmızı, iptal gri, belirsiz amber", () => {
    expect(printStatusView({ status: "HATA", outputKind: "PRINTER" }).tone).toBe("danger");
    expect(printStatusView({ status: "IPTAL", outputKind: "PRINTER" }).tone).toBe("muted");
    expect(printStatusView({ status: "BELIRSIZ", outputKind: "PRINTER" }).tone).toBe("warning");
  });

  it("eski istemci (sürüm + yol boş) → 'eski istemci · yazıcı bilinmiyor'", () => {
    expect(printPrinterText({ ...base, outputKind: "PRINTER", appVersion: null, transport: null })).toBe("eski istemci · yazıcı bilinmiyor");
    expect(printPrinterText({ ...base, outputKind: "PRINTER", printerName: "Sevkiyat Argox" })).toBe("Sevkiyat Argox");
    expect(
      printPrinterText({ ...base, outputKind: "PRINTER", printerName: "ham", peripheral: { id: "p", name: "Kayıtlı Argox", code: null } }),
    ).toBe("Kayıtlı Argox");
  });

  it("ne basıldı: numara + tür; toplu etiket adetli", () => {
    expect(printSubjectText({ subjectKind: "ETIKET_TOP", subjectNo: "T120726F0001", itemCount: null, docVersion: null, subjectIds: [] })).toBe(
      "T120726F0001 · Top etiketi",
    );
    expect(printSubjectText({ subjectKind: "ETIKET_TOPLU", subjectNo: null, itemCount: 12, docVersion: null, subjectIds: [] })).toBe(
      "12 top etiketi (toplu)",
    );
    expect(printSubjectText({ subjectKind: "BELGE", subjectNo: "SP-2026-0148", itemCount: null, docVersion: 2, subjectIds: [] })).toBe(
      "SP-2026-0148 v2 · Belge",
    );
  });
});
