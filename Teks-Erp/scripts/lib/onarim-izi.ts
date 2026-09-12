// =============================================================================
// ONARIM İZİ — toplu düzeltme betiklerinin TEK audit satırı (2026-09-12)
// =============================================================================
// NEDEN VAR: `--apply` alan betiklerin bir kısmı canlı iş verisini değiştirip
// HİÇBİR iz bırakmıyordu (ölçüldü 2026-09-12: 27 betiğin 6'sı). Ham SQL yazanlar
// İKİ KAT kördü — `AuditService` çağrılmıyor VE `updatedAt` tazelenmiyor
// (Prisma'nın `@updatedAt`i uygulama katmanındadır, DB trigger'ı yok). Yani o
// koşumlar veri üzerinden HİÇBİR yöntemle tespit edilemiyordu: "iz yok" değil,
// **"iz aramanın yolu yok"**.
//
// NEDEN YARDIMCI (her betiğe kopyalamak değil): aynı soruyu cevaplayan kalıp
// altı dosyaya kopyalanırsa zamanla altı farklı kurala dönüşür — biri sürümü
// unutur, biri ham-SQL şerhini düşürür. Yükün ŞEKLİ sözleşmedir: yarın bu
// satırları okuyan kişi hepsinde aynı alanları bulmalı.
//
// ⚠️ AUDIT BEST-EFFORT'TUR ve yazmadan SONRA çağrılır: iz düşerse onarım geri
// alınmaz (alınamaz da — zaten commit oldu), ama SESSİZ de kalmaz. Çağıran
// `false` dönüşünde kendi çıktısını "tek iz" olarak saklamayı söyler.
//
// ⚠️ BAŞARI ÖLÇÜSÜNÜN VARSAYIMI — TEK SÜREÇLİ KOŞUM: başarı, `AuditService`in
// GLOBAL `failureCount` sayacının değişmemesiyle ölçülür. Bu sayaç sürece
// aittir, çağrıya değil: aynı süreçte PARALEL başka bir audit düşerse burada
// yanlış negatif çıkar ("yazamadım" der, oysa yazdı). Onarım betikleri tek
// atışlık ve tek akışlı olduğu için bugün doğru — ama uzun ömürlü bir süreçten
// (sunucu, kuyruk işçisi) çağrılırsa bu ölçü GEÇERSİZDİR; orada dönüş değerine
// güvenme, satırı `SystemLog`tan doğrula.
// =============================================================================
import { AuditService } from "../../src/services/audit.service";
import { hedefDbAdi } from "./hedef-db-kapisi";
import type { SystemEventName } from "../../src/constants/system-events";

const pkg = require("../../package.json") as { version?: string };

export interface OnarimIzi {
  /** Betiğin repo içi yolu — `scripts/x.ts`. */
  script: string;
  /**
   * `SystemLog.action` — ETKİYİ söyler, dosya adını değil.
   * ⚠️ KAPALI BİRLİK (`src/constants/system-events.ts`): serbest `string`ti ve bu
   * yüzden yedi onarım izinin Türkçesi hiç eklenmemişti — ekran ham kod basıyordu.
   * Yeni bir iz adı önce birliğe + etiket aynasına girer, sonra burada kullanılır.
   */
  action: SystemEventName;
  /** Etkilenen ana tablo (varsa). */
  tableName?: string;
  /**
   * Ham SQL ile yazan betikler için `true`: yüke "başka iz YOK" şerhi eklenir.
   * Yarın bu satırı okuyan kişi, aramayı nereye genişletmesi gerektiğini
   * satırın KENDİSİNDEN öğrensin — `updatedAt`e bakmak boşuna olacak.
   */
  hamSql?: boolean;
  /** Kaç kayıt · hangi ölçüm — betiğe özgü sayılar. */
  olcum: Record<string, unknown>;
}

/**
 * Onarım izini yazar. `true` = yazıldı, `false` = audit düştü (çağıran kendi
 * çıktısını tek iz olarak saklamayı söylemeli ve çıkış kodunu 1 yapmalı).
 */
export async function onarimIziYaz(iz: OnarimIzi): Promise<boolean> {
  const once = AuditService.getHealth().failureCount;
  await AuditService.logEvent({
    category: "SYSTEM",
    action: iz.action,
    ...(iz.tableName ? { tableName: iz.tableName } : {}),
    payload: {
      source: iz.script,
      veritabani: hedefDbAdi(),
      surum: pkg.version ?? "(okunamadı)",
      kosulanAt: new Date().toISOString(),
      ...iz.olcum,
      ...(iz.hamSql
        ? {
            not: "HAM SQL ile yazıldı — bu koşumun veri üzerinde BAŞKA izi YOK: `updatedAt` tazelenmedi, satır bazlı audit yok. Kapsam için bu satırdaki ölçümlere ve koşum çıktısına bakın.",
          }
        : {}),
    },
  });
  return AuditService.getHealth().failureCount === once;
}

/** Audit düştüğünde basılacak ortak uyarı — çağıran `process.exitCode = 1` yapar. */
export function izDustuUyarisi(script: string, hamSql: boolean): string {
  return (
    `\n⚠️  AUDIT SATIRI YAZILAMADI (${script}).` +
    (hamSql
      ? "\n   Bu koşumun veri üzerinde BAŞKA izi YOK (ham SQL — `updatedAt` de tazelenmez)."
      : "") +
    "\n   Yukarıdaki çıktıyı onarımın TEK izi olarak saklayın."
  );
}
