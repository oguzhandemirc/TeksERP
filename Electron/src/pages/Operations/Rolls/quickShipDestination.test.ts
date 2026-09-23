// BEKÇİ — Hızlı Sevk'te sevk yönü (karar A, 2026-09-23): zincir boşken yön SORULUR (çuvallı sevkle aynı
// `resolveDestination`), Yurtdışı seçimi Hızlı Sevk'i kapatır (gerekçe sunucudan), Yurtiçi seçimi
// `destinationChosen: true` ile gider ve karta yazılır. Gövde de ölçülür (SY2 dersi: bileşen testi
// gövdeyi görmez). Negatif sondalar: ① `quickShipDestination`daki seçilen-EXPORT dalı silindi → ⭐ §1b ×
// · ② `quickShip` gövdesi `{ ...payload, destinationChosen: undefined }` → ⭐ §2a ×.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DestinationLock } from "@/pages/Operations/SackContentEdit/destinationDefault";

const post = vi.fn(async () => ({ data: { success: true, data: { id: "s1", shipmentNo: "S1" } } }));
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...(a as [])), get: vi.fn(), patch: vi.fn() } }));
import { quickShip, quickShipDestination } from "./quickShipService";

const bos: DestinationLock = { destination: null, source: null, exportCode: null, quickShipBlockedReason: null, quickShipPickExportReason: "SUNUCU METNİ" };
const kilitli: DestinationLock = { destination: "EXPORT", source: "CUSTOMER", exportCode: null, quickShipBlockedReason: "KİLİT METNİ", quickShipPickExportReason: null };

describe("§1 quickShipDestination", () => {
  it("§1a zincir boş, seçim yok → yön yok, seçim bekler (örtük Yurtiçi YOK)", () => {
    const y = quickShipDestination(bos, null);
    expect(y).toMatchObject({ destination: null, needsPick: true, blocked: false });
  });
  it("⭐ §1b zincir boş + Yurtdışı seçildi → kapalı, gerekçe sunucunun seçim metni", () => {
    expect(quickShipDestination(bos, "EXPORT")).toMatchObject({ blocked: true, blockedReason: "SUNUCU METNİ" });
  });
  it("§1b' eski sunucu metin göndermese de Yurtdışı seçimi kapatır", () => {
    expect(quickShipDestination({ ...bos, quickShipPickExportReason: undefined }, "EXPORT")).toMatchObject({ blocked: true, blockedReason: null });
  });
  it("⭐ §1c zincir boş + Yurtiçi seçildi → açık, chosen (karta yazılır)", () => {
    expect(quickShipDestination(bos, "DOMESTIC")).toMatchObject({ destination: "DOMESTIC", chosen: true, blocked: false });
  });
  it("§1d kilitli ihracat → kapalı, kilit metni; seçim yok sayılır", () => {
    expect(quickShipDestination(kilitli, "DOMESTIC")).toMatchObject({ destination: "EXPORT", chosen: false, blocked: true, blockedReason: "KİLİT METNİ" });
  });
});

describe("§2 quickShip gövdesi", () => {
  beforeEach(() => post.mockClear());
  const govde = () => (post.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1];
  it("⭐ §2a açık ilk seçim gövdeye girer", async () => {
    await quickShip({ rollIds: ["r1"], customerId: "c1", destination: "DOMESTIC", destinationChosen: true });
    expect(govde()).toMatchObject({ destination: "DOMESTIC", destinationChosen: true });
  });
  it("§2b niyet yoksa anahtar gitmez", async () => {
    await quickShip({ rollIds: ["r1"], customerId: "c1", destination: "DOMESTIC" });
    expect("destinationChosen" in govde()).toBe(false);
  });
});
