import { describe, expect, it } from "vitest";
import { ASSET_MESSAGES, MAX_IMAGE_BYTES, checkImageFile, checkImageSrc, dataUriBytes } from "./assetGuard";

const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("görsel kaynak kapısı", () => {
  it("küçük data:image kabul", () => {
    expect(checkImageSrc(PNG_1PX)).toEqual({ ok: true });
    expect(checkImageSrc("data:image/svg+xml;utf8,<svg/>")).toEqual({ ok: true });
  });

  it("⭐ dış http(s), göreli yol ve protokolsüz adres Türkçe mesajla RED", () => {
    for (const src of ["https://ornek.com/logo.png", "http://10.0.0.5/a.jpg", "//cdn.ornek.com/a.png", "logo.png", "javascript:alert(1)"]) {
      expect(checkImageSrc(src)).toEqual({ ok: false, reason: "external", message: ASSET_MESSAGES.external });
    }
    expect(ASSET_MESSAGES.external).toMatch(/Dış adresten görsel eklenemez/);
  });

  it("görsel olmayan data: türü RED (html/js gömülemez)", () => {
    expect(checkImageSrc("data:text/html;base64,PHNjcmlwdD4=")).toMatchObject({ ok: false, reason: "type" });
    expect(checkImageSrc("data:application/javascript,alert(1)")).toMatchObject({ ok: false, reason: "type" });
  });

  it("300 KB sınırı: tam sınır kabul, bir bayt fazlası RED", () => {
    const b64 = (bytes: number) => "data:image/png;base64," + "A".repeat(Math.ceil(bytes / 3) * 4);
    expect(dataUriBytes(b64(MAX_IMAGE_BYTES))).toBe(MAX_IMAGE_BYTES);
    expect(checkImageSrc(b64(MAX_IMAGE_BYTES)).ok).toBe(true);
    expect(checkImageSrc(b64(MAX_IMAGE_BYTES + 3))).toMatchObject({ ok: false, reason: "size" });
  });

  it("boş kaynak RED", () => {
    expect(checkImageSrc("  ")).toMatchObject({ ok: false, reason: "empty" });
    expect(checkImageSrc(undefined)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("dosya kapısı: tür ve boyut yüklemeden önce", () => {
    expect(checkImageFile({ size: 1000, type: "image/png" }).ok).toBe(true);
    expect(checkImageFile({ size: MAX_IMAGE_BYTES + 1, type: "image/jpeg" })).toMatchObject({ reason: "size" });
    expect(checkImageFile({ size: 10, type: "application/pdf" })).toMatchObject({ reason: "type" });
  });
});
