// =============================================================================
// İzin kataloğu boot-time uzlaştırması
// =============================================================================
// NEDEN VAR: `requirePermission("x:y")` yazıldığı anda o kodun DB'de bir satırı
// OLMAK ZORUNDA — yoksa Admin dışı HERKES 403 alır ve sebebi ekranda anlaşılmaz.
// `prisma/seed.ts` YALNIZ ilk kurulumda koştuğu için mevcut bir fabrikada yeni
// izinler hiç doğmuyordu; veri migration'ı yazmak da "unutulabilir bir adım"
// olarak kalıyordu. 2026-08-01'de fiilen unutuldu (kurşun bypass ekranı canlıya
// çıktı, izin satırı yoktu, teşhis saatler aldı).
//
// Bu iş onu MEKANİKLEŞTİRİR: backend her açılışta katalogu DB ile karşılaştırır
// ve EKSİKLERİ yazar → kodu deploy etmek = katalogu getirmek.
//
// SÖZLEŞME — YALNIZ EKLE, ASLA SİLME/GÜNCELLEME:
//   • Katalogdan bir kod kaldırılsa bile canlıdaki satır ve ona bağlı kullanıcı
//     atamaları KORUNUR — kimsenin yetkisi sessizce düşmez. Gerçek kaldırma
//     bilinçli bir veri migration'ının işidir.
//   • Mevcut satırın `description`/`module`/`category` alanları EZİLMEZ; fabrika
//     panelden düzeltmiş olabilir. Uzlaştırma yalnız YOK olan `code` satırlarını
//     doğurur.
//   • Tek sorgu: `createMany({ skipDuplicates: true })`. İki boot yarışsa bile
//     `code @unique` + ON CONFLICT DO NOTHING sayesinde güvenli.
//
// BEST-EFFORT: hata sunucuyu DÜŞÜRMEZ (audit deseniyle aynı) ama sessizce de
// yutulmaz — console.error ile gürültülü loglanır ve SystemLog'a olay yazılır.
//
// archive-scheduler.ts / backup-scheduler.ts ile aynı kalıp: `startX()` server.ts
// içinden çağrılır, gerçek iş ayrı bir async fonksiyondadır (test doğrudan onu
// çağırabilsin). Fark: bu iş TEK SEFERLİKTİR — periyodik timer yok.
// =============================================================================

import prisma from "../lib/prisma";
import { PERMISSION_CATALOG, type PermissionCatalogEntry } from "../constants/permission-catalog";
import { AuditService } from "../services/audit.service";
import { reconcileRoleTemplates } from "./role-template-catalog.job";
import { reconcileReasonPresets } from "./reason-preset-catalog.job";
import { reconcileNumberSeries } from "./number-series-catalog.job";
import { bilgi, hata, uyari } from "../lib/logger";

// Soğuk açılışta DB (özellikle Windows sunucuda PostgreSQL servisi) backend'den
// sonra hazır olabiliyor. Emsal job'lar bunu 60sn sabit gecikmeyle çözüyor; bu iş
// TEK bir sorgu olduğu ve izinlerin İLK isteklerden önce yerinde olması gerektiği
// için kısa gecikme + sınırlı yeniden deneme tercih edildi: mutlu yolda ~3sn'de
// biter, DB geç gelirse 3 + 4x15 = ~63sn'lik pencereyi (emsalin 60sn'i kadar)
// kapsar. Tükenirse gürültülü log bırakır — sessiz kaybolma yok.
const STARTUP_DELAY_MS = 3 * 1000;
const RETRY_DELAY_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

let started = false;

export type PermissionReconcileResult = {
  /** Katalogdaki toplam izin kodu sayısı. */
  total: number;
  /** DB'ye yeni yazılan kodlar (yarışta başka process yazdıysa bu liste DB'ye değil, bu koşumun tespitine dayanır). */
  added: string[];
  /** DB'de olup katalogda OLMAYAN kodlar — bilgi amaçlı; ASLA silinmez. */
  extra: string[];
};

/**
 * Katalogdaki izin kodlarını DB ile uzlaştırır: eksik olanları yazar.
 * Var olan satırlara DOKUNMAZ, hiçbir satırı SİLMEZ.
 *
 * Hata durumunda `throw` eder — çağıran (`startPermissionCatalogReconciler`)
 * yeniden dener ve en sonunda gürültülü loglar. Doğrudan çağrılabilir
 * (test/script), sunucuya bağımlılığı yoktur.
 */
export async function reconcilePermissionCatalog(): Promise<PermissionReconcileResult> {
  // Katalogda mükerrer kod olması bir yazım hatasıdır; DB'ye taşımadan burada ele.
  // Map<string,...> bilinçli: katalog `as const` olduğu için anahtar tipi literal
  // union olur ve DB'den gelen düz `string` ile karşılaştırılamaz.
  const catalogByCode = new Map<string, PermissionCatalogEntry>(
    PERMISSION_CATALOG.map((p) => [p.code, p]),
  );
  const total = catalogByCode.size;

  const existing = await prisma.permission.findMany({ select: { code: true } });
  const existingCodes = new Set(existing.map((p) => p.code));

  const missing = [...catalogByCode.values()].filter((p) => !existingCodes.has(p.code));
  const extra = [...existingCodes].filter((code) => !catalogByCode.has(code)).sort();

  if (missing.length === 0) {
    bilgi("permission-catalog", `${total} izin kodu güncel — eklenecek satır yok.`);
    if (extra.length > 0) {
      // Katalogdan çıkarılmış / elle eklenmiş kodlar. KORUNUR (atamaları koparmamak
      // için); yalnız görünür olsun diye yazılır.
      bilgi("permission-catalog", `DB'de katalog dışı ${extra.length} izin var (korunuyor): ${extra.join(", ")}`,
      );
    }
    return { total, added: [], extra };
  }

  const result = await prisma.permission.createMany({
    data: missing.map((p) => ({
      code: p.code,
      module: p.module,
      category: p.category,
      description: p.description,
    })),
    skipDuplicates: true, // eşzamanlı iki boot yarışında da güvenli (code @unique)
  });

  const codes = missing.map((p) => p.code);
  bilgi("permission-catalog", `${result.count} EKSİK izin DB'ye yazıldı: ${codes.join(", ")}`,
  );
  if (result.count !== codes.length) {
    // Aradaki fark = başka bir process (paralel boot / seed) aynı anda yazmış.
    // Sonuç yine doğru; yalnız iz bırakılır.
    bilgi("permission-catalog", `${codes.length - result.count} satır bu arada başka bir süreç tarafından yazılmış (yarış — sorun değil).`,
    );
  }
  if (extra.length > 0) {
    bilgi("permission-catalog", `DB'de katalog dışı ${extra.length} izin var (korunuyor): ${extra.join(", ")}`,
    );
  }

  // İz: "izin ne zaman doğdu" sorusu yetki şikayetlerinde ilk sorulan şey.
  // Best-effort (AuditService kendi hatasını yutar).
  await AuditService.logEvent({
    category: "SYSTEM",
    action: "PERMISSION_CATALOG_RECONCILED",
    tableName: "permissions",
    payload: { total, insertedCount: result.count, codes, extraCount: extra.length },
  });

  return { total, added: codes, extra };
}

/**
 * Açılışta BİR KEZ koşar (periyodik timer yok — katalog ancak yeni bir deploy ile
 * değişir). Hata sunucuyu düşürmez; sınırlı sayıda yeniden dener, tükenirse
 * gürültülü loglar.
 *
 * ÜÇ FAZ, sırayla: (1) izin kodları, (2) rol şablonları
 * (`role-template-catalog.job.ts`), (3) hazır sebep katalogları
 * (`reason-preset-catalog.job.ts`). İlk ikisinde sıra ZORUNLUDUR (şablon
 * satırları izin satırlarına FK ile bağlı); üçüncüsü bağımsızdır ama aynı
 * yeniden-deneme politikasını paylaşsın diye aynı zincirde koşar.
 */
export function startPermissionCatalogReconciler(): void {
  if (started) return;
  started = true;

  const attempt = (n: number): void => {
    // ⚠️ SIRA LOAD-BEARING: rol şablonları izin satırlarına FK ile bağlı.
    // Ayrı bir timer'la koşturmak ikisini yarıştırır ve ilk boot'ta yeni roller
    // izinleri "DB'de yok" diye eksik kurulur — bu yüzden aynı zincirde, aynı
    // yeniden-deneme politikasıyla ve izinlerden SONRA.
    void reconcilePermissionCatalog()
      .then(() => reconcileRoleTemplates())
      // (3) Hazır sebep katalogları — FK bağı YOK ama aynı zincirde koşar:
      // soğuk açılışta DB'nin hazır olmama ihtimali ortak, dolayısıyla
      // yeniden-deneme politikası da ortak olmalı. Ayrı timer, aynı hatayı iki
      // farklı yerde ele almak demekti.
      .then(async () => {
        const r = await reconcileReasonPresets();
        bilgi(
          "reason-presets",
          r.created.length > 0
            ? `${r.created.length} yeni sistem sebebi eklendi: ${r.created.join(", ")}`
            : `katalog güncel (${r.existing} sistem + ${r.custom} fabrika satırı)`,
        );
      })
      // (4) Numara serileri — aynı zincir, aynı gerekçe (soğuk açılışta DB hazır
      // olmayabilir). Düşerse numara üretimi katalog tohumuyla sürer (fail-safe).
      .then(async () => {
        const r = await reconcileNumberSeries();
        bilgi(
          "number-series",
          r.created.length > 0
            ? `${r.created.length} yeni numara serisi eklendi: ${r.created.join(", ")}`
            : `katalog güncel (${r.existing} seri)`,
        );
      })
      .catch((err) => {
        if (n < MAX_ATTEMPTS) {
          // Soğuk açılışta DB henüz ayakta olmayabilir — uyarı, hata değil.
          uyari("permission-catalog", `uzlaştırma denemesi ${n}/${MAX_ATTEMPTS} başarısız (DB hazır olmayabilir), ` +
              `${RETRY_DELAY_MS / 1000}sn sonra tekrar denenecek:`,
            err instanceof Error ? err.message : err,
          );
          setTimeout(() => attempt(n + 1), RETRY_DELAY_MS).unref();
          return;
        }
        // Buraya düşmek = yeni izinler DB'de YOK demektir → Admin dışı kullanıcılar
        // ilgili ekranlarda 403 alır. Sessiz yutma YOK.
        hata("permission-catalog", `UZLAŞTIRMA BAŞARISIZ (${MAX_ATTEMPTS} deneme). ` +
            "Yeni izinler ve/veya rol şablonları DB'ye YAZILAMADI — Admin dışı kullanıcılar " +
            "yeni ekranlarda 403 alabilir. Sunucuyu yeniden başlatın ya da elle kontrol edin.",
          err,
        );
        void AuditService.logEvent({
          category: "SYSTEM",
          action: "PERMISSION_CATALOG_RECONCILE_FAILED",
          tableName: "permissions",
          payload: {
            attempts: MAX_ATTEMPTS,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      });
  };

  setTimeout(() => attempt(1), STARTUP_DELAY_MS).unref();
}
