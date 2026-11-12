// Ajanda: planlanan günü verilmiş sevkiyat seçili günün listesinde "Planlı sevkiyat" bölümünde çıkar,
// tarihsiz sevkiyat ayrı "(tarihsiz)" bölümünde kalır; gecikme vurgusu yok; eski sunucu (alan yok) çizilir.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { AgendaBox } from "./box-types";
import type { PanoErisim } from "./usePanoErisim";
import { PanoAgenda } from "./PanoAgenda";

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ navigateActive }) }));

const erisim = { canGo: () => true } as unknown as PanoErisim;

function box(extra: Partial<AgendaBox["isler"]> = {}): AgendaBox {
  return {
    gun: "2026-11-20", ay: "2026-11", kesildi: false,
    planliSevkiyat: { toplam: 1, kalemler: [{ id: "u1", no: "SVK-TARIHSIZ", musteri: "Beta", olusturuldu: "2026-11-01T08:00:00.000Z" }] },
    isler: { alisTeslim: null, isEmriBaslangic: null, dokumaBaslangic: null, ...extra },
    ayGunleri: Array.from({ length: 30 }, (_, i) => ({ gun: `2026-11-${String(i + 1).padStart(2, "0")}`, alis: 0, isEmri: 0, dokuma: 0, sevk: i === 19 ? 1 : 0, toplam: i === 19 ? 1 : 0 })),
  } as AgendaBox;
}

describe("PanoAgenda — planlı sevkiyat güne yerleşir", () => {
  it("tarihli sevkiyat gün listesinde, tarihsiz ayrı bölümde; tıklama sevkiyat detayına", () => {
    render(<PanoAgenda d={box({ sevkiyat: { toplam: 1, kalemler: [{ id: "s1", no: "SVK-20", musteri: "Alfa", gun: "2026-11-20" }] } })} erisim={erisim} onPick={() => {}} />);
    expect(screen.getByText("Planlı sevkiyat")).toBeTruthy();
    expect(screen.getByText("SVK-20")).toBeTruthy();
    expect(screen.getByText("Planlı sevkiyat (tarihsiz)")).toBeTruthy();
    expect(screen.getByText("SVK-TARIHSIZ")).toBeTruthy();
    expect(screen.queryByText(/gecik/i)).toBeNull();
    fireEvent.click(screen.getByText("SVK-20"));
    expect(navigateActive).toHaveBeenCalledWith("/operations/shipments/s1");
    expect(screen.getByRole("button", { name: /^20\.11\.2026, 1 planlı iş/ })).toBeTruthy();
  });

  it("eski sunucu (isler.sevkiyat yok) — gün boş, tarihsiz liste çizilir", () => {
    render(<PanoAgenda d={box()} erisim={erisim} onPick={() => {}} />);
    expect(screen.getByText("Bu gün için planlı iş yok")).toBeTruthy();
    expect(screen.getByText("SVK-TARIHSIZ")).toBeTruthy();
  });
});
