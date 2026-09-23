import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RefreshButton } from "@/components/RefreshButton";
import { SACK_HUB_KEYS, invalidateSackHub } from "./useSackData";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// K16 (2026-09-23, e2e kabul turu): tabletin açtığı parti Paketleme / Çuvallar'da "Yenile"ye basılınca
// görünmüyordu — düğme `["packing"]` tazeliyordu; react-query öneki dizi ELEMANI eşler, `"packing"`
// `"packing-groups"`ı kapsamaz.
const bayat = (qc: QueryClient, key: unknown[]) => qc.getQueryCache().find({ queryKey: key, exact: true })?.state.isInvalidated;
const PARTI = ["packing-groups", "c1", "OPEN"];
const OZET = ["packing-lot-summary", "c1"];

describe("Paketleme / Çuvallar — Yenile parti listesini tazeler", () => {
  it("sayfadaki düğme kurgusu (SACK_HUB_KEYS) parti listesi + özeti bayat işaretler", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300_000 } } });
    qc.setQueryData(PARTI, { data: [] });
    qc.setQueryData(OZET, { data: {} });
    render(
      <QueryClientProvider client={qc}>
        <RefreshButton queryKey="sack-search" extraKeys={SACK_HUB_KEYS.map((k) => [...k])} silent />
      </QueryClientProvider>,
    );
    expect(bayat(qc, PARTI)).toBe(false); // körlük zemini
    await userEvent.click(screen.getByRole("button", { name: /Yenile/ }));
    expect(bayat(qc, PARTI)).toBe(true);
    expect(bayat(qc, OZET)).toBe(true);
  });

  it("invalidateSackHub (sevk · iptal · geri al diyalogları) parti ailesini de tazeler", () => {
    const qc = new QueryClient();
    qc.setQueryData(PARTI, { data: [] });
    qc.setQueryData(OZET, { data: {} });
    invalidateSackHub(qc);
    expect(bayat(qc, PARTI)).toBe(true);
    expect(bayat(qc, OZET)).toBe(true);
  });
});

// Tripwire: sayfanın liste sorgusu ailesi SACK_HUB_KEYS'te; beyanlı istisnalar gerekçeli.
const ISTISNA: Record<string, string> = {
  "sack-mismatch": "hesap önizlemesi — kaynağı değişince kendi anahtarıyla yeniden sorulur",
  kartela: "katalog verisi, başka istemci değiştirmez",
  "destination-lock": "invalidateDestinationLock ayrı yardımcıyla tazelenir",
  shipments: "sevkiyat ailesi — invalidateSackHub({ shipment: true }) dalı",
  "shipment-detail": "sevkiyat ailesi — invalidateSackHub({ shipment: true }) dalı",
  "shipment-preview": "form önizlemesi, girdi değişince yeniden sorulur",
  "sack-tags": "tek çuvalın ek bilgisi — editörün kendi mutasyonu tazeler",
  "sack-notes": "tek çuvalın ek bilgisi — editörün kendi mutasyonu tazeler",
  "feature-flags": "ayar, çuval listesi değil",
  "sack-bulk-distribute-preview": "diyalog içi önizleme, girdi değişince yeniden sorulur",
};
describe("tripwire — Yenile kapsamı", () => {
  const kok = path.resolve(__dirname);
  const dosyalar = fs.readdirSync(kok).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  it("SackContentEdit'teki her useQuery anahtar başı hub ailesinde ya da beyanlı istisnada", () => {
    const aile = new Set(SACK_HUB_KEYS.map((k) => k[0]));
    const eksik: string[] = [];
    for (const f of dosyalar) {
      const s = fs.readFileSync(path.join(kok, f), "utf-8");
      for (const m of s.matchAll(/useQuery[\s\S]{0,200}?queryKey:\s*\[\s*"([^"]+)"/g)) {
        const bas = m[1] ?? ""; if (!aile.has(bas) && !(bas in ISTISNA)) eksik.push(`${f}: ${bas}`);
      }
    }
    expect(eksik).toEqual([]);
  });
  it("sayfa düğmesi SACK_HUB_KEYS kullanır; üç diyalog invalidateSackHub çağırır", () => {
    expect(fs.readFileSync(path.join(kok, "SackContentEditPage.tsx"), "utf-8")).toMatch(/extraKeys=\{SACK_HUB_KEYS/);
    for (const f of ["../Shipments/CancelShipmentDialog.tsx", "../Shipments/UndoDispatchDialog.tsx", "../SackStore/DispatchConfirmDialog.tsx"]) {
      expect(fs.readFileSync(path.join(kok, f), "utf-8"), f).toMatch(/invalidateSackHub\(qc/);
    }
  });
});
