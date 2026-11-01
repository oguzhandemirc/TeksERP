// =============================================================================
// BEKÇİ — Cari kilidi rozet + şerit yüzeyleri (D4-I3): §1 rozet metni sunucudan, kilitsiz/eski backend'de çizilmez ·
//   §2 ⭐ sevk önizlemesinde `cariHold` sarı şeritte, aynı satır uyarı listesinde TEKRAR ETMEZ; alan yoksa şerit yok
// =============================================================================
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CariHoldBadge } from "./CariHoldBadge";
import { ShipmentPreviewPanel } from "@/pages/Operations/SackContentEdit/ShipmentPreviewPanel";

const SERVER_TEXT = "Cari kilitli (sevk) — müşterinin kendi emaneti sevk edilir";
const HOLD_WARN = "Bu müşterinin carisi kilitli (Borç) — sevk durduruldu. Kilidi Ayşe koydu.";
const base = { sacks: [], lines: [], totals: { totalMeters: 10, sackCount: 1, surplusMeters: 0 } };

describe("cari kilidi yüzeyleri", () => {
  it("§1 rozet: metin sunucudan; kilitsiz ya da alan yoksa çizilmez", () => {
    const { rerender } = render(<CariHoldBadge view={{ held: true, holdText: SERVER_TEXT }} />);
    expect(screen.getByLabelText(SERVER_TEXT)).toHaveTextContent("Kilitli");
    rerender(<CariHoldBadge view={{ held: false, holdText: null }} />);
    expect(screen.queryByText("Kilitli")).toBeNull();
    rerender(<CariHoldBadge view={undefined} />);
    expect(screen.queryByText("Kilitli")).toBeNull();
  });

  it("§2 ⭐ önizleme: şerit bir kez, diğer uyarılar listede kalır", () => {
    render(
      <ShipmentPreviewPanel
        isLoading={false}
        preview={{ ...base, warnings: ["Siparişsiz çuval var", HOLD_WARN], cariHold: { sebepEtiketi: "Borç", koyan: "Ayşe", message: HOLD_WARN, warning: HOLD_WARN } }}
      />,
    );
    expect(screen.getByText("Cari kilitli — sevk durur")).toBeInTheDocument();
    expect(screen.getAllByText(HOLD_WARN)).toHaveLength(1);
    expect(screen.getByText("Siparişsiz çuval var")).toBeInTheDocument();
  });

  it("§3 eski backend (cariHold yok): şerit yok, uyarılar aynen", () => {
    render(<ShipmentPreviewPanel isLoading={false} preview={{ ...base, warnings: [HOLD_WARN] }} />);
    expect(screen.queryByText(/Cari kilitli —/)).toBeNull();
    expect(screen.getByText(HOLD_WARN)).toBeInTheDocument();
  });
});
