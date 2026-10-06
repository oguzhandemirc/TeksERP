import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * ⭐ İDDİA: deneme kurulumunun işareti pencerenin kendi başlığında GÖRÜNÜR, üretimde HİÇBİR ŞEY çizilmez.
 * Tek ortak paket: etiket lisans sınıfından (TEST/DEMO); lisans özeti taklit edilir.
 */
async function yukle({ sinif }: { sinif?: string | null }) {
  vi.resetModules();
  vi.doMock("@/hooks/useLicenseStatus", () => ({ useLicenseStatus: () => (sinif === undefined ? null : { sinif }) }));
  return (await import("./ChannelBadge")).ChannelBadge;
}

afterEach(() => {
  cleanup();
  vi.doUnmock("@/hooks/useLicenseStatus");
});

describe("ChannelBadge — tek ortak paket (lisans sınıfından)", () => {
  it("⭐ TEST ve DEMO sınıfı görünür", async () => {
    for (const sinif of ["TEST", "DEMO"]) {
      const ChannelBadge = await yukle({ sinif });
      render(<ChannelBadge />);
      expect(screen.getByText(sinif).getAttribute("title"), sinif).toContain("lisansı");
      cleanup();
    }
  });

  it("⭐ üretim · diğer sınıflar · lisans özeti yok (giriş ekranı) → hiçbir şey çizilmez", async () => {
    for (const sinif of ["URETIM", "DR", "BAYI", "BARINDIRILAN", null, undefined]) {
      const ChannelBadge = await yukle({ sinif });
      const { container } = render(<ChannelBadge />);
      expect(container.innerHTML, String(sinif)).toBe("");
      cleanup();
    }
  });
});
