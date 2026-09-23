// =============================================================================
// NUMARA SERİSİ — PANEL YAZMA YÜZEYİ (Faz C, 2026-09-22 · Faz D, 2026-09-23)
// =============================================================================
// Biçim (ön ek · tarih segmenti · hane · ayraç) VERİDİR; bu uçlar onu panele
// açar. Faz D'den beri 52 serinin HEPSİ altı bölümde GÖRÜNÜR (`panelGroup`);
// düzenlenebilirlik ayrı bir sorudur ve kilit üçlüsüne bakar — görünürlük
// kilidin yerine geçmez, tersine kilidin GEREKÇESİNİ ekrana getirir.
//
// ⚠️ ÖNİZLEME SUNUCUDA HESAPLANIR ve panel kendi biçimlendiricisini YAZMAZ.
// Bütün bu işin sebebi buydu: "programda P-2 yazarken çıktı P20260202" ancak
// iki yerde iki biçimlendirici olunca olur. Panel örnek kodu buradan ister.
//
// ⚠️ KAPI SIRASI LOAD-BEARING (`test_number_series_panel` ölçer):
//   verifyToken → requirePermission("settings:numbering") → requireSettingsPassword
//   → [servis] kilit üçlüsü (YAPISAL → SAYAÇ → İSTEMCİ) → assertSeriesFormatAllowed
// Kimlik ve yetki HTTP kenarında; "bu seriye dokunulabilir mi" ve "önerilen
// DEĞER geçerli mi" serviste. Ayrım bilinçli: ilki oturuma, ikincisi veriye bakar.
// =============================================================================

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { NumberSeriesDateSegment } from "@prisma/client";

import { verifyToken } from "../middlewares/auth.middleware";
import { requirePermission } from "../middlewares/rbac.middleware";
import { requireSettingsPassword } from "../middlewares/settings-password.middleware";
import { previewSeriesCode, resolveSeriesFormat } from "../services/number-series.service";
import {
  assertSeriesFormatAllowed,
  updateSeriesCounter,
  updateSeriesFormat,
  updateSeriesNumberSource,
} from "../services/helpers/series-write.helper";
import { listSeries, seriesImpactCount } from "../services/helpers/series-panel.helper";
import { seriesExhaustion } from "../services/helpers/series-exhaustion.helper";
import { numberSeriesCatalogEntry } from "../constants/number-series-catalog";

const router = Router();

// Kapı dosya başında (BE-30): sonradan eklenen uç guard'ı miras alır.
router.use(verifyToken, requirePermission("settings:numbering"));

/** Biçim gövdesi — okuma uçlarında da aynı şema (tek kaynak). */
const formatSchema = z
  .object({
    prefix: z.string().trim().min(1).max(6),
    dateSegment: z.nativeEnum(NumberSeriesDateSegment),
    digits: z.number().int().min(1).max(8),
    separator: z.string().max(2),
  })
  .strict();

/**
 * Sayaç gövdesi — `null` AYARI KALDIRIR (bugünkü davranışa döner).
 *
 * ⚠️ Üç alan da ZORUNLU (`.strict()` + opsiyonel DEĞİL): panel her zaman üçünü
 * birden gönderir ve "gönderilmeyen alan" ile "temizlenen alan" karışmaz. Zod
 * tanımadığı anahtarı sessizce silerdi; eksik alanı da `undefined` yapardı ve
 * `undefined` prisma'da "dokunma" demektir — kullanıcı bir alanı temizlediğini
 * sanırken eski değer kalırdı.
 */
const counterSchema = z
  .object({
    startValue: z.number().int().min(1).nullable(),
    step: z.number().int().min(1).nullable(),
    maxValue: z.number().int().min(1).nullable(),
  })
  .strict();

/** Numara kaynağı gövdesi — tek alan, kapalı küme. */
const sourceSchema = z.object({ numberSource: z.enum(["FREE", "SYSTEM", "MANUAL"]) }).strict();

/**
 * İleri tarihli geçiş gövdesi — biçim + YÜRÜRLÜK TARİHİ (D4③).
 *
 * ⚠️ Alan OPSİYONEL ve AYNI uçta: ayrı bir uç açmak, "biçim değiştir" ile
 * "1 Ocak'tan itibaren biçim değiştir"i iki ayrı doğrulama zincirine bölerdi
 * (aynı kapılar iki kez yazılır, biri bayatlar).
 */
const formatWithEffectiveSchema = formatSchema
  .extend({ effectiveFrom: z.string().datetime().optional() })
  .strict();

const previewSchema = formatSchema.extend({ key: z.string().trim().min(1).max(64) }).strict();
const keyParamSchema = z.object({ key: z.string().trim().min(1).max(64) });

/**
 * @openapi
 * /api/number-series:
 *   get:
 *     tags: [NumberSeries]
 *     summary: Numara serileri — biçim, örnek kod ve BUGÜN düzenlenebilir mi
 *     description: |
 *       `editable` YALNIZ yapısal kilide bakmaz: sayaç hazırlığı (`SAYAC`) ve
 *       eski istemci kapısı (`ISTEMCI`) da "bugün düzenlenemez" der. `lockKind`
 *       üçünü ayırır çünkü üçü FARKLI GÜN kalkar ve panelde farklı cümle olmalı.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Seri listesi }
 */
router.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ success: true, data: listSeries() });
});

/**
 * @openapi
 * /api/number-series/preview:
 *   post:
 *     tags: [NumberSeries]
 *     summary: Aday biçim için ÖRNEK kod (sunucuda hesaplanır) + biçim kapısı
 *     description: |
 *       Panel kendi biçimlendiricisini YAZMAZ. Aday biçim geçersizse (ön ek
 *       karakteri · hane · ayraç · ön ek çakışması) 400/409 döner ve panel
 *       kullanıcıya kaydetmeden ÖNCE söyler.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ preview }" }
 *       400: { description: Geçersiz biçim }
 *       409: { description: Ön ek çakışması }
 */
router.post("/preview", (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key, ...fmt } = previewSchema.parse(req.body ?? {});
    const current = resolveSeriesFormat(key);
    // Çakışma/karakter/hane kapısı ÖNİZLEMEDE de koşar: kullanıcı hatayı
    // kaydet düğmesinde değil yazarken görsün.
    assertSeriesFormatAllowed(key, { ...fmt, retiredPrefixes: current.retiredPrefixes });
    res.status(200).json({
      success: true,
      data: { preview: previewSeriesCode({ ...fmt, retiredPrefixes: [], infix: current.infix }) },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/number-series/{key}/impact:
 *   get:
 *     tags: [NumberSeries]
 *     summary: Bu seriyle numaralanmış KAYIT sayısı (etki cümlesinin kaynağı)
 *     description: |
 *       Panel "bugüne kadarki N kaydın numarası değişmez" derken bu sayıyı
 *       kullanır. Kataloğunda sayım kaynağı olmayan seri `null` döner ve panel
 *       sayı YAZMAZ — "0" demek ölçülmemiş bir şeye sıfır demek olurdu.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: "{ count: number | null }" }
 */
router.get("/:key/impact", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = keyParamSchema.parse(req.params);
    numberSeriesCatalogEntry(key); // tanınmayan anahtar → 500 yerine net hata
    res.status(200).json({ success: true, data: { count: await seriesImpactCount(key) } });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/number-series/{key}:
 *   patch:
 *     tags: [NumberSeries]
 *     summary: Serinin biçimini değiştir (ayar şifresi ister)
 *     description: |
 *       Eski ön ek EMEKLİYE ayrılır ve okutulmaya devam eder; GEÇMİŞ
 *       YENİDEN NUMARALANMAZ. Sayacın kapsamı bu andan itibaren daralır
 *       (`formatChangedAt`).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: "Geçersiz biçim · kilitli seri · sayaç hazır değil · istemci eski" }
 *       409: { description: Ön ek çakışması }
 */
router.patch(
  "/:key",
  requireSettingsPassword,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = keyParamSchema.parse(req.params);
      const { effectiveFrom, ...fmt } = formatWithEffectiveSchema.parse(req.body ?? {});
      const row = await updateSeriesFormat(
        key,
        fmt,
        req.user?.userId,
        effectiveFrom ? new Date(effectiveFrom) : undefined,
      );
      res.status(200).json({
        success: true,
        data: row,
        message: effectiveFrom
          ? `${row.label} biçimi ${new Date(effectiveFrom).toLocaleDateString("tr-TR")} tarihinden itibaren değişecek. Bugünkü numaralar etkilenmez.`
          : `${row.label} biçimi güncellendi. Bundan sonra açılacak kayıtlar yeni numarayı alır; geçmiş değişmez.`,
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/number-series/{key}/exhaustion:
 *   get:
 *     tags: [NumberSeries]
 *     summary: Tükenme durumu — yürürlükteki dönemde sınırın ne kadarı kullanıldı
 *     description: |
 *       ÜÇ SONUÇ: `percent` sayı ise ölçüldü · `null` ise ÖLÇÜLEMEDİ ve `reason`
 *       gerekçeyi taşır (üst sınır tanımlı değilse yüzde tanımsızdır). `digits`
 *       vekil sınır SAYILMAZ: taşma haneyi genişletir, sayaç dolmaz.
 *     security: [{ bearerAuth: [] }]
 */
router.get("/:key/exhaustion", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = keyParamSchema.parse(req.params);
    numberSeriesCatalogEntry(key); // tanınmayan anahtar → 400 (fail-closed)
    res.status(200).json({ success: true, data: await seriesExhaustion(key) });
  } catch (e) {
    next(e);
  }
});

/**
 * @openapi
 * /api/number-series/{key}/counter:
 *   patch:
 *     tags: [NumberSeries]
 *     summary: Sayaç ayarları — başlangıç · artış adımı · üst sınır
 *     description: |
 *       BİÇİM ucundan AYRI ve bu bilinçli: ikisi farklı kilitlere tabi. Biçimi
 *       yapısal olarak kilitli bir serinin (ör. iş emri no) sayacı mevcut
 *       kodların maksimumundan türüyorsa ayar ORADA anlamlıdır.
 *
 *       `null` gönderilen alan AYARI KALDIRIR ve seri bugünkü davranışa döner
 *       (başlangıç 1, adım 1, üst sınır yok).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: "Kendi sayaç mekanizması olan seri · geçersiz değer · sınır < başlangıç" }
 */
router.patch(
  "/:key/counter",
  requireSettingsPassword,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = keyParamSchema.parse(req.params);
      const counter = counterSchema.parse(req.body ?? {});
      const row = await updateSeriesCounter(key, counter, req.user?.userId);
      res.status(200).json({
        success: true,
        data: row,
        message: `${row.label} sayaç ayarları güncellendi. Bundan sonra üretilecek numaralar etkilenir; geçmiş değişmez.`,
      });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/number-series/{key}/source:
 *   patch:
 *     tags: [NumberSeries]
 *     summary: Numara kaynağı — sistem üretir · elle zorunlu · serbest
 *     description: |
 *       `FREE` (varsayılan) BUGÜNKÜ davranıştır: elle değer gelirse kabul edilir,
 *       gelmezse sunucu üretir. `SYSTEM` elle geleni REDDEDER (davranış değişikliği),
 *       `MANUAL` elle değeri ZORUNLU kılar.
 *
 *       Ayar YALNIZ elle yolu olan seride anlamlıdır; diğerlerinde 400.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Güncellendi }
 *       400: { description: "Elle yolu olmayan seri · geçersiz değer" }
 */
router.patch(
  "/:key/source",
  requireSettingsPassword,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { key } = keyParamSchema.parse(req.params);
      const { numberSource } = sourceSchema.parse(req.body ?? {});
      const row = await updateSeriesNumberSource(key, numberSource, req.user?.userId);
      res.status(200).json({
        success: true,
        data: row,
        message: `${row.label} numara kaynağı güncellendi.`,
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
