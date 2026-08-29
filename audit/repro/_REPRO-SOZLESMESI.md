# REPRO SCRIPT SÖZLEŞMESİ — `Teks-Erp/scripts/audit_repro_<bulgu-id>.ts`

Amaç: bir yarış/mükerrer bulgusunu DEV DB'de eşzamanlı istekle TETİKLEMEK (K3 kanıtı). Script repoda kalır; ekibin regresyon bekçisi olur. ÜRETİM KODUNA DOKUNULMAZ.

## Zorunlu iskelet (mevcut bekçilerin kalıbı — `scripts/test_kk1_duplicate_guard.ts`, `test_batch_number_format.ts`)
```ts
// =============================================================================
// AUDIT REPRO — <BULGU-ID>: <tek cümle amaç>
// Ortam: SADECE dev DB. Prod/uzak hedefte çalışmayı REDDEDER (aşağıdaki guard).
// Beklenen (sağlıklı sistem): <ör. N paralel istekten tam 1'i başarılı, değişmez korunur>
// Gözlenen: <çalıştırınca doldur — log audit/repro/<id>.log>
// Çalıştır: cd Teks-Erp && npx tsx scripts/audit_repro_<id>.ts
// =============================================================================
import "dotenv/config";
function devDbGuard(): void {
  const url = process.env.DATABASE_URL ?? "";
  if ((process.env.NODE_ENV ?? "") === "production" || (process.env.APP_ENV ?? "") === "production") throw new Error("REPRO: production ortamında koşturulamaz");
  let host = "", db = "";
  try { const u = new URL(url); host = u.hostname.toLowerCase(); db = decodeURIComponent(u.pathname.replace(/^\//, "")); } catch { throw new Error("REPRO: DATABASE_URL çözümlenemedi (fail-closed)"); }
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error(`REPRO: yerel olmayan host reddedildi: ${host}`);
  if (/saha|prod|canli|sahin/i.test(db) && db !== "adnansahin_db") throw new Error(`REPRO: prod kopyası/prod adı reddedildi: ${db}`);
}
devDbGuard();
import prisma from "../src/lib/prisma";
// ... servis import'ları (src/services/...)
```
- **Fixture damgası:** yarattığın her ana-veri/top/iş emri adı `AUDITREPRO-<id>-<rastgele6>` içermeli; sabit adla yaratma (nameFold UNIQUE seddi ikinci koşumu P2002'ye düşürür).
- **Temizlik `finally`'de, FK sırasına göre:** `rollVariance.deleteMany` (RESTRICT FK — fason kabulü/tambur yapan HER script), `rollMovement`, `rollOperation`, `sackAllocation`, `roll`, `workOrderStep`, `workOrder`, `batch`, `orderLine`, `order`, `subcontractor*`, ana veri; `systemLog` satırları (`userId` FK RESTRICT — dev'de audit_guard KAPALI, silinebilir). Diğer kişilerin verisine DOKUNMA — yalnız kendi damganı taşıyanları sil.
- **Eşzamanlılık:** `Promise.allSettled(Array.from({length: N}, () => servis.fn(...)))` — ayrı tx'ler paralel (beceri §9.2 meşru). N=2 ile başla, 5 ve 10'a çıkar; 10 tekrar koş, kaç tekrarda değişmez bozuldu say.
- **Ölçüm commit SONRASI, DB'DEN:** değişmezi `prisma.$queryRaw` ile yeniden oku (bellekteki dönüş değerine güvenme).
- **Çıktı:** `✅/❌` satırları + özet; `process.exitCode = fail > 0 ? 1 : 0`; stdout'u `audit/repro/<id>.log`'a yönlendir (`| tee`).
- **Yan etki sınırı:** yazıcıya/dış dünyaya giden yolları çağırma (etiket baskı, pg_dump, rclone); feature-flag'i değiştirirsen `finally`'de eski değere döndür.
- **Süre:** tek script < 2 dk; `pool` bağlantısını sonda kapat (`await prisma.$disconnect()`).
