// =============================================================================
// BEKÇİ — `invalidateSackHub` silinen çuvalın dökümünü TAZELEMEZ
// =============================================================================
// ⭐ NEDEN YAZILDI: sahada ölçüldü (fabrika logu 2026-09-04 → 09-06, iki gün).
//    Her başarılı çuval silmesinden sonra şu üçlü tekrarlıyordu:
//      POST /sacks/<id>/remove    → 200   (çuval silindi)
//      GET  /sacks/<id>/contents  → 404   (panel silinen çuvalı yeniden sordu)
//    ve genel axios interceptor'ı 404'ü kırmızı toast'a çeviriyordu. Operatör
//    başarılı bir işlemin hemen ardından hata görüyordu — iki günde 13 kez.
//
//    Sebep: `invalidateSackHub` `["sack-contents"]` ÖN EKİNİ tazeliyor, yani
//    silinen çuvalınkini de. Editör o anda hâlâ mount'lu olduğu için sorgu
//    yeniden koşuyor.
//
// ⭐ NEGATİF SONDA (2026-09-06, ölçüldü): `predicate` satırı kaldırılınca §1
//    KIRMIZI (silinen çuvalın sorgusu da `isInvalidated` oluyor).
// =============================================================================
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateSackHub } from "./useSackData";

const SILINEN = "silinen-cuval-id";
const YASAYAN = "yasayan-cuval-id";

function kurulum(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["sack-contents", SILINEN], { data: { rolls: [] } });
  qc.setQueryData(["sack-contents", YASAYAN], { data: { rolls: [] } });
  return qc;
}

const bayat = (qc: QueryClient, id: string): boolean =>
  qc.getQueryCache().find({ queryKey: ["sack-contents", id] })?.state.isInvalidated ?? false;

describe("invalidateSackHub", () => {
  it("§1 silinen çuvalın dökümü tazelenmez, diğerleri tazelenir", () => {
    const qc = kurulum();
    // körlük zemini: iki sorgu da gerçekten cache'te ve taze
    expect(bayat(qc, SILINEN)).toBe(false);
    expect(bayat(qc, YASAYAN)).toBe(false);

    invalidateSackHub(qc, { silinenSackId: SILINEN });

    expect(bayat(qc, SILINEN)).toBe(false); // ⭐ 404 üretecek olan sorgu
    expect(bayat(qc, YASAYAN)).toBe(true);
  });

  it("§2 silme yoksa TÜM çuval dökümleri tazelenir (bugünkü davranış korunur)", () => {
    const qc = kurulum();
    invalidateSackHub(qc);
    expect(bayat(qc, SILINEN)).toBe(true);
    expect(bayat(qc, YASAYAN)).toBe(true);
  });

  it("§3 silinen id verilse de diğer aileler (pool/sack-search) tazelenir", () => {
    const qc = kurulum();
    qc.setQueryData(["pool"], { x: 1 });
    qc.setQueryData(["sack-search"], { x: 1 });

    invalidateSackHub(qc, { silinenSackId: SILINEN });

    expect(qc.getQueryCache().find({ queryKey: ["pool"] })?.state.isInvalidated).toBe(true);
    expect(qc.getQueryCache().find({ queryKey: ["sack-search"] })?.state.isInvalidated).toBe(true);
  });
});
