// SY-J1: teklif dövizi ön seçimi notu — VARSAYILAN (ayar TRY) iken not YOK (ekran bugünkü gibi).
import { describe, expect, it } from "vitest";
import { suggestionHint } from "./quote-currency";

describe("suggestionHint", () => {
  it("VARSAYILAN ya da veri yok → not yok", () => {
    expect(suggestionHint(undefined)).toBeUndefined();
    expect(suggestionHint({ doviz: "TRY", kaynak: "VARSAYILAN", fiyatListesiNo: null })).toBeUndefined();
  });
  it("fiyat listesi → liste numarasıyla; ayar → ayar notu", () => {
    expect(suggestionHint({ doviz: "EUR", kaynak: "FIYAT_LISTESI", fiyatListesiNo: "FL-0001" })).toBe("Müşterinin yayındaki fiyat listesinden (FL-0001)");
    expect(suggestionHint({ doviz: "USD", kaynak: "AYAR", fiyatListesiNo: null })).toBe("Maliyet sunum dövizi ayarından");
  });
});
