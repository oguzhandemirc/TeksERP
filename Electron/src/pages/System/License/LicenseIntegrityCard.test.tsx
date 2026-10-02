import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { LicenseIntegrity } from "@/types/license";
import { LicenseIntegrityCard } from "./LicenseIntegrityCard";

const base: LicenseIntegrity = {
  cekirdek: "native",
  cekirdekNeden: null,
  zorunlu: true,
  durum: "GECERLI",
  kod: null,
  denetlendi: "2026-09-29T10:00:00.000Z",
  paketId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
  paketSurumu: "2.12.0",
  derlemeTarihi: "2026-09-28T20:00:00.000Z",
  anahtar: "paket-2026",
  sayilar: { dosya: 15210, eksik: 0, degisik: 0, fazla: 0, okunamayan: 0 },
  ilkUyusmazlik: null,
};

/** LİSANS EKRANI — paket bütünlüğü kartı: çekirdek kaynağı, durum, paketId; dosya adı yok, yalnız sayılar. */
describe("Lisans ekranı — paket bütünlüğü kartı", () => {
  it("geçerli pakette çekirdek kaynağı, paket kimliği ve dosya sayısı görünür", () => {
    renderWithProviders(<LicenseIntegrityCard b={base} />);
    expect(screen.getByTestId("lisans-cekirdek").textContent).toBe("Native çekirdek");
    expect(screen.getByTestId("lisans-paket-kimligi").textContent).toBe(base.paketId);
    expect(screen.getByText("Uyuşuyor")).toBeTruthy();
    expect(screen.getByText(/15210 dosya · 0 eksik · 0 değişmiş · 0 fazla/)).toBeTruthy();
    expect(screen.queryByText("İlk uyuşmazlık")).toBeNull();
  });

  it("uyuşmazlıkta bulgu Türkçe, fazla sayısı ve ek sürenin başladığı ilk uyuşmazlık görünür", () => {
    renderWithProviders(
      <LicenseIntegrityCard
        b={{ ...base, durum: "GECERSIZ", kod: "BUTUNLUK_FAZLA", sayilar: { dosya: 15210, eksik: 0, degisik: 0, fazla: 3, okunamayan: 0 }, ilkUyusmazlik: "2026-09-20T08:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("Uyuşmuyor")).toBeTruthy();
    expect(screen.getByText("Pakette listede olmayan dosya var")).toBeTruthy();
    expect(screen.getByText(/3 fazla/)).toBeTruthy();
    expect(screen.getByText("İlk uyuşmazlık")).toBeTruthy();
  });

  it("korumalı pakette okunamayan listeli dosya Türkçe bulgu ve okunamayan sayısıyla görünür", () => {
    renderWithProviders(
      <LicenseIntegrityCard b={{ ...base, durum: "GECERSIZ", kod: "BUTUNLUK_OKUNAMAYAN", sayilar: { dosya: 15210, eksik: 0, degisik: 0, fazla: 0, okunamayan: 2 } }} />,
    );
    expect(screen.getByText("Uyuşmuyor")).toBeTruthy();
    expect(screen.getByText("Listedeki dosyalar okunamıyor (korumalı pakette değişmiş sayılır)")).toBeTruthy();
    expect(screen.getByText(/2 okunamadı/)).toBeTruthy();
  });

  it("TS çekirdeğine düşüşte neden görünür; tanınmayan kod ham gösterilir", () => {
    renderWithProviders(<LicenseIntegrityCard b={{ ...base, cekirdek: "ts", cekirdekNeden: "DOSYA_YOK", durum: "OLCULEMEDI", kod: "BUTUNLUK_YENI_KOD" }} />);
    expect(screen.getByTestId("lisans-cekirdek").textContent).toBe("TS çekirdeği (geliştirme)");
    expect(screen.getByText("DOSYA_YOK")).toBeTruthy();
    expect(screen.getByText("BUTUNLUK_YENI_KOD")).toBeTruthy();
  });

  it("eski backend alanı göndermezse kart çökmez, bilgi yok der", () => {
    renderWithProviders(<LicenseIntegrityCard b={undefined} />);
    expect(screen.getByText(/eski sürüm/)).toBeTruthy();
  });
});
