// =============================================================================
// VARSAYILAN DEPO — açılış uzlaştırması (ARTIK TEK YETKİLİ DEĞİL)
// =============================================================================
// NEDEN MIGRATION DEĞİL: migration'a INSERT gömmek uuid'yi ve adı TAŞA yazar;
// taze kurulumun seed'iyle çatallanır, geri alınamaz ve her ortamda (fabrika,
// ticaret, dev, CI) aynı satırın iki farklı kopyası doğabilir. İzin kataloğu
// uzlaştırmasıyla aynı gerekçe ve aynı kalıp: KODU DEPLOY ETMEK = SATIRI GETİRMEK.
//
// ── 2026-09-12: UZLAŞTIRMA İHTİYAÇ ANINA TAŞINDI ────────────────────────────
// Bu iş eskiden TEK yetkiliydi ve üç deliği vardı — üçü de "boot'ta yapıyoruz"
// kararının sonucuydu, tek tek kapatılamazlardı:
//   ① boot + 5 sn'lik pencere (taze kurulumda o aralıkta gelen yazma deposuz),
//   ② iş DÜŞERSE sunucu ayakta kalır ve o andan sonra HER top deposuz doğar,
//   ③ `started` bayrağı tek koşum — bir daha denenmez.
// Kararı kaldırmak üçünü birden sildi: `resolveTargetWarehouseId` varsayılanı
// bulamazsa `ensureDefaultWarehouse`i KENDİSİ çağırıyor. Bu iş yine koşuyor
// (açılışta depoyu hazır bulundurmak hâlâ iyi), ama artık TEK yol değil.
//
// ⚠️ MANTIK BU DOSYADA DEĞİL: `services/helpers/warehouse.helper.ts`te yaşıyor.
// Sebebi dairesel import — çözümleyici uzlaştırmayı çağırıyor, uzlaştırma da
// sabitlerini o dosyadan alıyordu. Fonksiyon aşağıda YENİDEN DIŞA AÇILIYOR:
// 17 çağrı yeri (bekçiler + `setup-ticaret`) bu yoldan import ediyor ve
// hiçbirinin değişmesi gerekmedi.
// =============================================================================
import { ensureDefaultWarehouse } from "../services/helpers/warehouse.helper";
import { hata } from "../lib/logger";

export { ensureDefaultWarehouse };
export type { DefaultWarehouseResult } from "../services/helpers/warehouse.helper";

const STARTUP_DELAY_MS = 5 * 1000;

let started = false;

/**
 * Açılışta BİR KEZ koşar (izin kataloğu uzlaştırmasıyla aynı kalıp).
 *
 * ⚠️ Bu iş DÜŞERSE artık veri kusuru DOĞMAZ: ilk ihtiyaçta çözümleyici aynı
 * uzlaştırmayı çağırır ve o da başarısızsa istek 409 alır (fail-closed).
 * Yani buradaki hata bir UYARIDIR, sessiz bir bozulmanın habercisi değil.
 */
export function startDefaultWarehouseReconciler(): void {
  if (started) return;
  started = true;

  setTimeout(() => {
    void ensureDefaultWarehouse().catch((err) => {
      hata(
        "warehouse",
        "AÇILIŞ UZLAŞTIRMASI BAŞARISIZ — varsayılan depo hazırlanamadı. " +
          "Veri kusuru doğurmaz (ilk ihtiyaçta tekrar denenir, olmazsa istek 409 alır), " +
          "ama DB'de bir sorun olduğunun işaretidir.",
        err,
      );
    });
  }, STARTUP_DELAY_MS).unref();
}
