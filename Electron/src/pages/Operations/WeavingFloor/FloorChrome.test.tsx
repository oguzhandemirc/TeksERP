// Tam ekran başlığı: veri tazelenemezse "Canlı" damgası uyarıya döner (TV'de kaydırma yok —
// uyarı başlıkta görünür); TV kipinde çıkış düğmesi yok.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FullscreenHeader } from "./FloorChrome";

const NOW = Date.parse("2026-10-10T08:30:00.000Z");

describe("FullscreenHeader", () => {
  it("canlı: yeşil 'Canlı' damgası, uyarı yok", () => {
    render(<FullscreenHeader now={NOW} sampleData={false} updatedAt={NOW} />);
    expect(screen.getByTestId("live-stamp").textContent).toContain("Canlı");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("⭐ bayat: 'Bağlantı yok · son veri' uyarısı, 'Canlı' yazmaz; TV'de çıkış düğmesi yok", () => {
    render(<FullscreenHeader now={NOW} sampleData={false} updatedAt={NOW - 60_000} stale />);
    const stamp = screen.getByRole("alert");
    expect(stamp.textContent).toContain("Bağlantı yok · son veri");
    expect(stamp.textContent).not.toContain("Canlı");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
