import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LicenseChain, LicenseDetail } from "@/types/license";
import { LicenseEntitlementCard } from "./LicenseEntitlementCard";
import { reasonLabel } from "./labels";

const hak = {
  hakId: "h1", surum: 2, lisansNo: "TKS-2026-0001", musteri: { id: "m", ad: "Deneme Tekstil" }, tesis: { id: "t", ad: "Merkez" },
  sinif: "URETIM", moduller: ["production.enabled"], kalici: true, bakimBitis: "2027-10-01T00:00:00.000Z", verilis: "2026-10-01T00:00:00.000Z", bayiId: null,
};
const zincir: LicenseChain = {
  hakImzacisi: { kind: "ARA", kid: "ara-2026-1", rootKid: "kok-2026-1", sertifika: { sertifikaId: "s1", siniflar: ["URETIM"], baslangic: "2026-09-01T00:00:00.000Z", bitis: "2027-03-01T00:00:00.000Z" } },
  kiraAlt: { kid: "alt-2026-1", baslangic: "2026-09-01T00:00:00.000Z", bitis: "2027-03-01T00:00:00.000Z" },
  iptal: { sira: 3, verilis: "2026-09-30T00:00:00.000Z", kayitSayisi: 2, pin: 4, durum: "KAYIP" },
};

// Kart yalnız `hak`, `durum.hesaplanan.modulTavani` ve `zincir` okur.
function detay(ek: Partial<LicenseDetail> = {}): LicenseDetail {
  return { hak, durum: { hesaplanan: { modulTavani: { applies: false } } }, ...ek } as unknown as LicenseDetail;
}

/** LİSANS EKRANI — HAK kartı (L2-7): güven zinciri satırları; eski backend (zincir yok) satırsız. */
describe("Lisans ekranı — HAK kartı (güven zinciri)", () => {
  it("⭐ ara imzacı ve kayıp iptal belgesi Türkçe satır olarak görünür", () => {
    renderWithProviders(<LicenseEntitlementCard d={detay({ zincir })} />);
    expect(screen.getByText("İmzalayan")).toBeTruthy();
    expect(screen.getByText("Ara imzacı (ara-2026-1) · sertifika 01.03.2027 bitiş")).toBeTruthy();
    expect(screen.getByText("Kayıp · sıra 3 · 2 kayıt")).toBeTruthy();
  });

  it("eski backend zincir göndermez → satır yok", () => {
    renderWithProviders(<LicenseEntitlementCard d={detay()} />);
    expect(screen.queryByText("İmzalayan")).toBeNull();
    expect(screen.queryByText("İptal belgesi")).toBeNull();
  });

  it("iptal belgesi kayıp nedeninin Türkçe etiketi var", () => {
    expect(reasonLabel("IPTAL_BELGESI_KAYIP")).toBe("İptal belgesi kayıp");
  });
});
