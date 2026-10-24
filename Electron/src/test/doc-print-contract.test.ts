import { describe, expect, it } from "vitest";
import { DOC_PRINT_COPIES_MAX, classifyPrintFailure, parseDocPrintRequest } from "@shared/doc-print";

// =============================================================================
// doc-print IPC sözleşmesi (izlenebilirlik A2): ana süreç renderer'dan gelen basım isteğini
// kapalı listeyle doğrular; Chromium'un ham hata metni renderer'a sınıf koduyla gider.
// Ölçülen metinler (Electron 42, yazıcısız Mac): "No printers available on the network",
// "Invalid deviceName provided".
// =============================================================================

describe("parseDocPrintRequest — kapalı liste", () => {
  it("geçerli istek geçer, boş yazıcı adı düşer", () => {
    expect(parseDocPrintRequest({ html: "<p/>", silent: false, deviceName: "  " })).toEqual({ html: "<p/>", silent: false });
    expect(parseDocPrintRequest({ html: "<p/>", silent: true, deviceName: "HP", copies: 2 })).toEqual({
      html: "<p/>",
      silent: true,
      deviceName: "HP",
      copies: 2,
    });
  });

  it("sessiz basım yazıcı adı olmadan REDDEDİLİR", () => {
    expect(parseDocPrintRequest({ html: "<p/>", silent: true })).toBeNull();
  });

  it("bilinmeyen anahtar, yanlış tür ve sınır dışı kopya REDDEDİLİR", () => {
    expect(parseDocPrintRequest({ html: "<p/>", silent: false, url: "file:///etc/passwd" })).toBeNull();
    expect(parseDocPrintRequest({ html: "", silent: false })).toBeNull();
    expect(parseDocPrintRequest({ html: "<p/>", silent: "evet" })).toBeNull();
    expect(parseDocPrintRequest({ html: "<p/>", silent: false, copies: 0 })).toBeNull();
    expect(parseDocPrintRequest({ html: "<p/>", silent: false, copies: DOC_PRINT_COPIES_MAX + 1 })).toBeNull();
    expect(parseDocPrintRequest(null)).toBeNull();
    expect(parseDocPrintRequest([])).toBeNull();
  });
});

describe("classifyPrintFailure — ham metin sınıfa iner", () => {
  it("iptal → IPTAL", () => {
    expect(classifyPrintFailure("cancelled")).toEqual({ status: "IPTAL" });
  });
  it("yazıcı yok / geçersiz ad sınıflanır, gerisi BILINMEYEN", () => {
    expect(classifyPrintFailure("No printers available on the network")).toEqual({ status: "HATA", errorCode: "SURUCU_YOK" });
    expect(classifyPrintFailure("Invalid deviceName provided")).toEqual({ status: "HATA", errorCode: "YAZICI_BULUNAMADI" });
    expect(classifyPrintFailure("Print job failed: C:\\Users\\x")).toEqual({ status: "HATA", errorCode: "BILINMEYEN" });
    expect(classifyPrintFailure(undefined)).toEqual({ status: "HATA", errorCode: "BILINMEYEN" });
  });
});
