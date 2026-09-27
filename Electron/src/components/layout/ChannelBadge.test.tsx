import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * ⭐ İDDİA: hazırlık kanalının etiketi ("TEST FABRİKA") pencerenin kendi başlığında GÖRÜNÜR;
 * üretim kanalında (etiket `null`) HİÇBİR ŞEY çizilmez — fabrikanın bugünkü görünümü birebir.
 * Kanal derleme anında gömülür; burada iki derlemenin sanal modülü taklit edilir.
 */
async function yukle(label: string | null) {
  vi.resetModules();
  vi.doMock("@shared/channel", () => ({ CHANNEL_LABEL: label, CHANNEL_NAME: "Deneme Kanalı" }));
  return (await import("./ChannelBadge")).ChannelBadge;
}

afterEach(() => {
  cleanup();
  vi.doUnmock("@shared/channel");
});

describe("ChannelBadge — kanal etiketi", () => {
  it("⭐ etiket varsa görünür (ve kanalın adını açıklamada taşır)", async () => {
    const ChannelBadge = await yukle("TEST FABRİKA");
    render(<ChannelBadge />);
    const etiket = screen.getByText("TEST FABRİKA");
    expect(etiket.getAttribute("title")).toContain("Deneme Kanalı");
  });

  it("⭐ üretim kanalında (null) hiçbir şey çizilmez", async () => {
    const ChannelBadge = await yukle(null);
    const { container } = render(<ChannelBadge />);
    expect(container.innerHTML).toBe("");
  });

  it("derlenen gerçek kanal (dinlenme: adnansahin) etiket taşımaz", async () => {
    vi.resetModules();
    const { CHANNEL_LABEL, CHANNEL_CODE } = await import("@shared/channel");
    if (CHANNEL_CODE === "adnansahin") expect(CHANNEL_LABEL).toBeNull();
    else expect(typeof CHANNEL_LABEL === "string" || CHANNEL_LABEL === null).toBe(true);
  });
});
