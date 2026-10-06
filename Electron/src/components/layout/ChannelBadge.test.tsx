import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * ⭐ İDDİA: deneme kurulumunun işareti pencerenin kendi başlığında GÖRÜNÜR, üretimde HİÇBİR ŞEY çizilmez.
 * Eski kanal paketi: etiket derleme anında kanal kaydından (lisans sınıfına BAKILMAZ — bugünkü görünüm birebir).
 * Ortak paket: etiket lisans sınıfından (TEST/DEMO). İki derlemenin sanal modülü ve lisans özeti taklit edilir.
 */
async function yukle({ label, ortak, sinif }: { label: string | null; ortak: boolean; sinif?: string | null }) {
  vi.resetModules();
  vi.doMock("@shared/channel", () => ({ CHANNEL_LABEL: label, CHANNEL_NAME: "Deneme Kanalı" }));
  vi.doMock("@shared/update-feed", () => ({ GROUP_FLOW: ortak }));
  vi.doMock("@/hooks/useLicenseStatus", () => ({ useLicenseStatus: () => (sinif === undefined ? null : { sinif }) }));
  return (await import("./ChannelBadge")).ChannelBadge;
}

afterEach(() => {
  cleanup();
  for (const m of ["@shared/channel", "@shared/update-feed", "@/hooks/useLicenseStatus"]) vi.doUnmock(m);
});

describe("ChannelBadge — eski kanal paketi", () => {
  it("⭐ etiket varsa görünür (ve kanalın adını açıklamada taşır)", async () => {
    const ChannelBadge = await yukle({ label: "TEST FABRİKA", ortak: false });
    render(<ChannelBadge />);
    expect(screen.getByText("TEST FABRİKA").getAttribute("title")).toContain("Deneme Kanalı");
  });

  it("⭐ üretim kanalında (null) hiçbir şey çizilmez — lisans sınıfı TEST olsa bile (adnansahin görünümü değişmez)", async () => {
    const ChannelBadge = await yukle({ label: null, ortak: false, sinif: "TEST" });
    const { container } = render(<ChannelBadge />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ChannelBadge — tek ortak paket (lisans sınıfından)", () => {
  it("⭐ TEST ve DEMO sınıfı görünür", async () => {
    for (const sinif of ["TEST", "DEMO"]) {
      const ChannelBadge = await yukle({ label: null, ortak: true, sinif });
      render(<ChannelBadge />);
      expect(screen.getByText(sinif).getAttribute("title"), sinif).toContain("lisansı");
      cleanup();
    }
  });

  it("⭐ üretim · diğer sınıflar · lisans özeti yok (giriş ekranı) → hiçbir şey çizilmez", async () => {
    for (const sinif of ["URETIM", "DR", "BAYI", "BARINDIRILAN", null, undefined]) {
      const ChannelBadge = await yukle({ label: null, ortak: true, sinif });
      const { container } = render(<ChannelBadge />);
      expect(container.innerHTML, String(sinif)).toBe("");
      cleanup();
    }
  });
});

describe("ChannelBadge — derlenen gerçek kimlik", () => {
  it("adnansahin etiket taşımaz; ortak paket gömülü etiket taşımaz", async () => {
    vi.resetModules();
    const { CHANNEL_LABEL, CHANNEL_CODE, UPDATE_GROUP_FEEDS } = await import("@shared/channel");
    if (CHANNEL_CODE === "adnansahin" || UPDATE_GROUP_FEEDS !== null) expect(CHANNEL_LABEL).toBeNull();
    else expect(typeof CHANNEL_LABEL === "string" || CHANNEL_LABEL === null).toBe(true);
  });
});
