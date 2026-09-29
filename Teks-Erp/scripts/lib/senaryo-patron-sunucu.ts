// SENARYO P — fabrika backend'inin giriş noktası: gerçek `src/server.ts` + Senaryo L enjeksiyonları
// (güven çapası, sahte parmak izi) + IPC test kancaları. Kancalar zamanlayıcının ÇAĞIRDIĞI fonksiyonları
// aynı süreçte çağırır (yeni davranış yok): `senaryo-bulut-tur` → `runCloudSyncTick`,
// `senaryo-gelen-kutusu` → `runCloudInboxOnce`. Koşucu `senaryo-patron.ts`; 127.0.0.1, `_test` DB.
import "./senaryo-lisans-ayar";
import "../../src/server";
import { __forceNextCloudSyncRoundForTests, getCloudSyncStatus, runCloudSyncTick } from "../../src/jobs/cloud-sync.job";
import { runCloudInboxOnce } from "../../src/jobs/cloud-inbox.job";

type Kanca = { tip?: unknown };

/** Aralık beklemeden BİR tur: zamanlayıcının turu sürüyorsa (exclusive) biter, sonra zorlanır. */
async function zorlaTur(uzlastirma: boolean): Promise<void> {
  const once = getCloudSyncStatus().lastRoundAt ?? 0;
  for (let i = 0; i < 120; i++) {
    __forceNextCloudSyncRoundForTests({ reconcile: uzlastirma });
    await runCloudSyncTick();
    const st = getCloudSyncStatus();
    if (!st.eligible || (st.lastRoundAt ?? 0) > once) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("zorla tur 60 sn'de koşamadı (açık tur bitmedi)");
}

process.on("message", (m: unknown) => {
  const tip = m && typeof m === "object" ? (m as Kanca).tip : undefined;
  if (tip === "senaryo-bulut-tur") {
    zorlaTur((m as { uzlastirma?: unknown }).uzlastirma === true)
      .then(() => process.send?.({ tip: "senaryo-bulut-tur-tamam", durum: getCloudSyncStatus() }))
      .catch((err: Error) => process.send?.({ tip: "senaryo-bulut-tur-tamam", hata: err.message }));
  } else if (tip === "senaryo-bulut-durum") {
    process.send?.({ tip: "senaryo-bulut-durum-tamam", durum: getCloudSyncStatus() });
  } else if (tip === "senaryo-gelen-kutusu") {
    runCloudInboxOnce()
      .then((r) => process.send?.({ tip: "senaryo-gelen-kutusu-tamam", sonuc: r }))
      .catch((err: Error) => process.send?.({ tip: "senaryo-gelen-kutusu-tamam", hata: err.message }));
  }
});
