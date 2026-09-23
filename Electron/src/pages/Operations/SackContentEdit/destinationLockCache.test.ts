// BEKÇİ — sevk yönü kilidi önbelleği (2026-09-23, panel turu SY3 bulgusu): ilk sevkte seçilen yön
// karta yazılır ama kilit sorgusu 10 sn "boş" önbellekte kalıyordu ⇒ aynı carinin ikinci çuvalı
// yönü bir daha sordu. Sevkiyat kurma başarısı kilidi (bütün önekiyle) bayatlatmalı.
// Negatif sonda: `invalidateSackHub`taki `invalidateDestinationLock(qc)` satırı silindi → ⭐ ×.
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("@/services/apiClient", () => ({ default: { post: vi.fn(), get: vi.fn(), patch: vi.fn() } }));
import { invalidateSackHub } from "./useSackData";

const kilitli = (qc: QueryClient, key: unknown[]) => qc.getQueryState(key)?.isInvalidated;

describe("sevk yönü kilidi önbelleği", () => {
  it("⭐ sevkiyat kurulunca cari ve şube anahtarlı kilit sorguları bayatlar", () => {
    const qc = new QueryClient();
    qc.setQueryData(["destination-lock", "c1", null], { destination: null });
    qc.setQueryData(["destination-lock", "c1", "b1"], { destination: null });
    invalidateSackHub(qc, { shipment: true });
    expect(kilitli(qc, ["destination-lock", "c1", null])).toBe(true);
    expect(kilitli(qc, ["destination-lock", "c1", "b1"])).toBe(true);
  });
  it("sevkiyat değilse (çuval düzenleme) kilit dokunulmaz", () => {
    const qc = new QueryClient();
    qc.setQueryData(["destination-lock", "c1", null], { destination: null });
    invalidateSackHub(qc);
    expect(kilitli(qc, ["destination-lock", "c1", null])).toBe(false);
  });
});
