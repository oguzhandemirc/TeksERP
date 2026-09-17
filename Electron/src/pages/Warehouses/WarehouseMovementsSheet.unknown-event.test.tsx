// =============================================================================
// DEPO HAREKET DÖKÜMÜ — BİLİNMEYEN OLAY TÜRÜ EKRANI ÇÖKERTMEZ (2026-09-12)
// =============================================================================
// Kilitlenen kural: backend panelden ÖNDE gidebilir (yeni hareket türü yazılır,
// panel henüz güncellenmemiştir). O satır ham koduyla basılır, satır ÇİZİLİR,
// ekran atmaz. Ölçülen kusur: 1.3.1 paneli `WAREHOUSE_EVENT_META[m.eventType]`
// sonucunu korumasız deref ediyordu → `CANCEL_REVERSAL` (sayım stornosu) ve
// ardından `PRODUCTION` (her finalize) Depolar → Hareketler ekranını App-kök
// hata perdesine düşürüyordu — depoyu açan HERKESTE, tetikleyende değil.
//
// Üç sonda: ① saf helper bilinmeyen türe künye döner (label = ham kod)
//           ② bileşen bilinmeyen türlü satırla RENDER EDİLİR (throw yok, kod ekranda)
//           ③ tripwire: bileşen sözlüğü DOĞRUDAN indekslemez (`WAREHOUSE_EVENT_META[`)
//              — deref yolu geri gelemez (ayrışan yüzey sınıfı, tek kaynak `eventMeta`).
// Negatif sonda (yazılırken ölçüldü): bileşende `eventMeta(m.eventType)` yerine
// `WAREHOUSE_EVENT_META[m.eventType]` konunca ② throw ile, ③ metinle KIRMIZI.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { eventBadgeClass, eventMeta, type WarehouseMovementRow } from "./movements";
// Statik import: `vi.mock` hoist edilir, mock yine geçerli; modül yükü (takvim bileşeni dahil) test
// zamanlayıcısının DIŞINDA kalır — `it` içindeki dinamik import 5 sn tavanını yük altında aşıyordu.
import { WarehouseMovementsSheet } from "./WarehouseMovementsSheet";

const BILINMEYEN = "YENI_TUR_2099";

const bilinmeyenSatir: WarehouseMovementRow = {
  id: "mv-1",
  // Bilinçli tip kırma: sözlükte olmayan bir tür — sunucunun panelden önde
  // olduğu an tam olarak budur.
  eventType: BILINMEYEN as unknown as WarehouseMovementRow["eventType"],
  direction: "IN",
  isReversal: false,
  qty: "12.500",
  notes: null,
  createdAt: "2026-09-12T10:00:00.000Z",
  fromWarehouseId: null,
  toWarehouseId: "wh-1",
  fromWarehouse: null,
  toWarehouse: { id: "wh-1", code: "DP-MERKEZ", name: "Merkez" } as WarehouseMovementRow["toWarehouse"],
  roll: { id: "r-1", barcode: "T120926A0001", width: null, item: null, color: null },
  sack: null,
  transfer: null,
  goodsReceipt: null,
  shipment: null,
  rollReturn: null,
  stockCount: null,
  user: null,
};

vi.mock("./service", () => ({
  listWarehouseMovements: vi.fn(async () => ({ data: [bilinmeyenSatir], nextCursor: null })),
}));

describe("① saf helper — sözlükte olmayan tür", () => {
  it("künye döner: etiket ham kod, 'tanınmayan' ipucu, storno değil, unknown işaretli", () => {
    const meta = eventMeta(BILINMEYEN);
    expect(meta.label).toBe(BILINMEYEN);
    expect(meta.unknown).toBe(true);
    // Operatör "eksik çeviri mi, gerçek tür mü" ayırabilsin: ipucu bunu SÖYLER.
    expect(meta.hint).toMatch(/Tanınmayan/);
  });
  it("rozet tonu BAĞDAN gelir (isReversal), türden değil — bilinmeyen tür bağsızsa düz ton", () => {
    expect(eventBadgeClass(false)).not.toContain("amber");
    expect(eventBadgeClass(true)).toContain("amber");
  });
  it("bilinen tür değişmedi (regresyon)", () => {
    expect(eventMeta("ENTRY").label).not.toBe("ENTRY");
  });
});

describe("② bileşen — bilinmeyen türlü satır ekranı çökertmez", () => {
  it("⭐ satır çizilir ve ham kod ekranda okunur", async () => {
    const warehouse = { id: "wh-1", code: "DP-MERKEZ", name: "Merkez" } as unknown as Parameters<
      typeof WarehouseMovementsSheet
    >[0]["warehouse"];
    expect(() => renderWithProviders(<WarehouseMovementsSheet warehouse={warehouse} onClose={() => {}} />)).not.toThrow();
    // Satır gerçekten çizildi: ham kod rozette, top hücrede.
    const rozet = await screen.findByText(BILINMEYEN);
    expect(await screen.findByText("T120926A0001")).toBeTruthy();
    // Tanınmayan tür rozette "tanınmayan" olduğu BELLİ: ipucu + kesik kenar
    // (ham kod eksik çeviri değil, sunucunun önde olduğu bir tür diye okunur).
    expect(rozet.getAttribute("title")).toMatch(/Tanınmayan/);
    expect(rozet.className).toContain("border-dashed");
  });
});

describe("③ tripwire — bileşen sözlüğü doğrudan indekslemez", () => {
  it("sözlük adı bileşende HİÇ geçmez (cast'li indeks de yakalanır); tek kaynak `eventMeta`", () => {
    const kaynak = readFileSync(resolve(__dirname, "WarehouseMovementsSheet.tsx"), "utf8");
    // Yalnız `META[` aramak yetmezdi: `(META as Record<…>)[x]` sızardı (negatif
    // sondada ölçüldü). Bileşenin sözlüğe hiç ihtiyacı yok — helper her şeyi verir.
    expect(kaynak.includes("WAREHOUSE_EVENT_META")).toBe(false);
    expect(kaynak.includes("eventMeta(")).toBe(true);
  });
});
