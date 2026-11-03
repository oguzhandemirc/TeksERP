import { afterEach, describe, expect, it } from "vitest";
import { TERIM, terimDokumaAyarla } from "./terim";
import { TERM_REGIME_STORAGE_KEY, applyStoredTermRegime, applyTermRegime } from "./terim-rejim";

// K20: WorkOrder adı dokuma rejiminden çözülür — kapalı "İş Emri", açık/bilinmiyor "Terbiye İş Emri".
describe("terim rejimi (K20)", () => {
  afterEach(() => {
    terimDokumaAyarla(true);
    localStorage.removeItem(TERM_REGIME_STORAGE_KEY);
  });

  it("varsayılan (rejim bildirilmeden) bugünkü ad", () => {
    expect(TERIM.terbiyeIsEmri.tekil).toBe("Terbiye İş Emri");
  });

  it("dokuma kapalı → İş Emri ailesi; menü/düğme biçimleri", () => {
    expect(applyTermRegime({ productionEnabled: true, dokumaEnabled: false })).toBe(true);
    expect(TERIM.terbiyeIsEmri.tekil).toBe("İş Emri");
    expect(`Yeni ${TERIM.terbiyeIsEmri.tekil}`).toBe("Yeni İş Emri");
    expect(TERIM.terbiyeIsEmri.cogul).toBe("İş Emirleri");
    expect(`${TERIM.terbiyeIsEmri.tekil} Şablonları`).toBe("İş Emri Şablonları");
    expect(TERIM.terbiyeIsEmri.cumleBasi.yalin).toBe("İş emri");
    expect(TERIM.terbiyeIsEmri.cekimKucuk.yonelme).toBe("iş emrine");
    expect(localStorage.getItem(TERM_REGIME_STORAGE_KEY)).toBe("0");
  });

  it("dokuma açık → Terbiye İş Emri; üretim kapalıysa dokuma etkin değil", () => {
    applyTermRegime({ productionEnabled: true, dokumaEnabled: true });
    expect(TERIM.terbiyeIsEmri.cogul).toBe("Terbiye İş Emirleri");
    applyTermRegime({ productionEnabled: false, dokumaEnabled: true });
    expect(TERIM.terbiyeIsEmri.tekil).toBe("İş Emri");
  });

  it("alanı tanımayan yanıt rejime dokunmaz; açılış son bilinen rejimi uygular", () => {
    expect(applyTermRegime({})).toBe(false);
    expect(TERIM.terbiyeIsEmri.tekil).toBe("Terbiye İş Emri");
    localStorage.setItem(TERM_REGIME_STORAGE_KEY, "0");
    applyStoredTermRegime();
    expect(TERIM.terbiyeIsEmri.tekil).toBe("İş Emri");
  });

  it("getter'lı katalog rejim değişimini izler (modül düzeyinde donmaz)", () => {
    const katalog = { get ad() { return TERIM.terbiyeIsEmri.cogul; } };
    terimDokumaAyarla(false);
    expect(katalog.ad).toBe("İş Emirleri");
    terimDokumaAyarla(true);
    expect(katalog.ad).toBe("Terbiye İş Emirleri");
  });
});
