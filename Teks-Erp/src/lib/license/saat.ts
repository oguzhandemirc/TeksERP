// Güvenilir saat — SAF kısım. Kiradan beri geçen süre duvar saatiyle değil, son kiradan
// beri BİRİKEN monotonik çalışma süresiyle ölçülür (makine kapalıyken birikmez: bu bir
// ALT sınırdır). `durum.json` okuma/yazma ve hrtime örnekleme fabrika motorunun işidir.
import { z } from "zod";
import type { KeyObject } from "node:crypto";
import {
  IsoTimeSchema,
  LICENSE_CLASSES,
  ModuleKeySchema,
  SANCTION_LEVELS,
  CLOCK_SKEW_MS,
  GRACE_MAX_DAYS,
  TYP,
  UuidSchema,
  publicKeyFromX,
  success,
  decodeDocument,
  signDocument,
  failure,
  forwardFailure,
  verifyJws,
  installationKeyId,
  type Result,
} from "./protocol";

export type ClockFinding = "SAAT_ILERI" | "SAAT_GERI";
export type ClockSource = "DUVAR" | "MONOTONIK" | "YUKSEK_SU";

export interface ClockInput {
  readonly wallMs: number;
  /** Hiç geri gitmeyen üst iz: son kira sunucu saati ∨ defterlerdeki en büyük createdAt. */
  readonly highWaterMs: number;
  /** Geçerli kiranın `sunucuSaati`; kira yoksa null. */
  readonly leaseServerTimeMs: number | null;
  /** Kabulde süreklilik tabanı (`leaseClockAnchor`); yoksa ya da kiranın sunucu saatinden gerideyse taban o saattir. */
  readonly baseMs?: number | null;
  /** Bu kira kabul edildiğinden beri biriken monotonik süre; ölçülemiyorsa null. */
  readonly monotonicElapsedMs: number | null;
  readonly pollIntervalMs: number;
  /**
   * Makinenin KAPALI geçirdiği, duvar saatiyle gözlenmiş süre (yalnız saat tutarlıyken yazılmış
   * durum kaydından türer). Tahmin bir ALT sınırdır; üst eşik bu süre kadar genişler ki hafta
   * sonu kapanan makine sahte SAAT_İLERİ görmesin. Güvenilir saatin alt sınırına GİRMEZ.
   */
  readonly downtimeCreditMs?: number;
}

export interface ClockResult {
  readonly trustedMs: number;
  readonly source: ClockSource;
  readonly finding: ClockFinding | null;
  /** Bulgu yüksek sudan mı duvar saatinden mi doğdu (portala rapor için). */
  readonly findingSource: "DUVAR" | "YUKSEK_SU" | null;
  /** Ölçülmüş tahmin (taban + kiradan beri monotonik): yalnız imzalı sunucu saatinden ve monotonik süreden türer; ölçülemediyse null. */
  readonly estimateMs: number | null;
  /** Üst eşiğe giren kapalı süre kredisi. */
  readonly creditMs: number;
}

/**
 * İleri ya da geri sıçramada ERKEN BİTİŞ YOK: güvenilir saat bilinen olguların (kira
 * sunucu saati + monotonik süre, yüksek su) gerisine düşmez ve duvar saati tahminin
 * ötesine kaçtıysa tahmine sabitlenir. Yüksek su tahminin ötesindeyse (geçmişte ileri
 * giden bir saatin yazdığı createdAt) yok sayılır ve raporlanır — bir kez zehirlenen iz
 * fabrikayı kalıcı olarak ek süreye itmesin.
 */
export function evaluateClock(g: ClockInput): ClockResult {
  const floor = Math.max(g.highWaterMs, g.leaseServerTimeMs ?? Number.NEGATIVE_INFINITY);
  if (g.leaseServerTimeMs === null || g.monotonicElapsedMs === null) {
    const unmeasured = { estimateMs: null, creditMs: 0 } as const;
    if (g.wallMs < floor - CLOCK_SKEW_MS) {
      return { trustedMs: floor, source: "YUKSEK_SU", finding: "SAAT_GERI", findingSource: "DUVAR", ...unmeasured };
    }
    return { trustedMs: Math.max(g.wallMs, floor), source: "DUVAR", finding: null, findingSource: null, ...unmeasured };
  }
  const estimate = Math.max(g.leaseServerTimeMs, g.baseMs ?? g.leaseServerTimeMs) + Math.max(0, g.monotonicElapsedMs);
  const creditMs = Math.max(0, g.downtimeCreditMs ?? 0);
  const upperBound = estimate + creditMs + g.pollIntervalMs + CLOCK_SKEW_MS;
  const measured = { estimateMs: estimate, creditMs } as const;
  // Tahminin ötesindeki yüksek su alt sınır olarak HİÇ kullanılmaz: eşikte tavanlamak bile
  // güvenilir saati duvarın ilerisine iter ve sahte SAAT_GERİ üretir.
  const highWaterTrusted = floor <= upperBound;
  const lower = highWaterTrusted ? Math.max(estimate, floor) : estimate;
  const lowerSource: ClockSource = lower === estimate ? "MONOTONIK" : "YUKSEK_SU";
  if (g.wallMs < lower - CLOCK_SKEW_MS) {
    return { trustedMs: lower, source: lowerSource, finding: "SAAT_GERI", findingSource: "DUVAR", ...measured };
  }
  if (g.wallMs > upperBound) {
    return { trustedMs: lower, source: lowerSource, finding: "SAAT_ILERI", findingSource: "DUVAR", ...measured };
  }
  const trustedMs = Math.max(g.wallMs, lower);
  if (!highWaterTrusted) return { trustedMs, source: "DUVAR", finding: "SAAT_ILERI", findingSource: "YUKSEK_SU", ...measured };
  return { trustedMs, source: "DUVAR", finding: null, findingSource: null, ...measured };
}

/** Yeni kiranın saat çapası: tahmin tabanı (sunucu saatini aşmıyorsa null — alan yazılmaz) + devreden üst eşik kredisi. */
export interface LeaseClockAnchor {
  readonly baseMs: number | null;
  readonly creditMs: number;
}

/**
 * Kabulde süreklilik: yeni kiranın tahmini = max(kiranın sunucu saati, kabul anındaki ÖLÇÜLMÜŞ tahmin) + kabulden beri
 * monotonik — taşınmış (eski tarihli) kira tahmini geri çekemez. Tabana duvar ve yüksek su girmez (ileri sıçrama
 * aklanmaz); duvarın kapalı süre kredisiyle örtülen kısmı yeni kiraya kredi olarak devreder. Saat payı içindeki fark
 * ölçüm gürültüsüdür: taze kiranın tabanı kendi saatidir (alan yazılmaz).
 */
export function leaseClockAnchor(prev: Pick<ClockResult, "estimateMs" | "creditMs">, g: { readonly leaseServerTimeMs: number; readonly wallMs: number }): LeaseClockAnchor {
  if (prev.estimateMs === null) return { baseMs: null, creditMs: 0 };
  const top = Math.max(g.leaseServerTimeMs, prev.estimateMs);
  return {
    baseMs: top - g.leaseServerTimeMs > CLOCK_SKEW_MS ? Math.round(top) : null,
    creditMs: Math.max(0, Math.round(Math.min(g.wallMs, prev.estimateMs + prev.creditMs) - top)),
  };
}

/**
 * Biriken süre: diskteki birikim + bu süreç yüklendiğinden beri geçen hrtime. hrtime geri
 * gidemez; gitmiş görünürse (farklı süreç, hatalı örnek) birikim KÜÇÜLTÜLMEZ.
 */
export function accumulatedRuntime(g: { readonly storedMs: number; readonly loadHrNs: bigint; readonly nowHrNs: bigint }): number {
  const diff = g.nowHrNs > g.loadHrNs ? Number((g.nowHrNs - g.loadHrNs) / 1_000_000n) : 0;
  return Math.max(0, g.storedMs) + diff;
}

/**
 * Son kullanılabilir kiranın SUNUCU KARARLARI (yaptırım + devir): kira silinse ya da
 * bozulsa da kalıcıdır — ek süre ve dosya silme onları gevşetmez.
 */
export const SanctionSnapshotSchema = z.object({
  kademe: z.enum(SANCTION_LEVELS).nullable(),
  mesaj: z.string().max(500).nullable(),
  kisitlamaTarihi: IsoTimeSchema.nullable(),
  donmusModuller: z.array(ModuleKeySchema).max(64),
  guncellemeDonuk: z.boolean(),
  devredildi: z.boolean(),
});
export type SanctionSnapshot = z.infer<typeof SanctionSnapshotSchema>;

/** Kök türü: HAK'ı imzalayan zincirin kökü üretim mi hazırlık mı (sınıf pininin parçası). */
export const ROOT_KINDS = ["kok", "hazirlik"] as const;
export type RootKind = (typeof ROOT_KINDS)[number];

export function rootKindOf(rootKid: string): RootKind {
  return rootKid.startsWith("hazirlik-") ? "hazirlik" : "kok";
}

/** Son kabul edilen HAK'ın pini: yerel dosya daha eski sürüme ya da başka sınıfa/köke dönerse geri alma sayılır. */
export const EntitlementPinSchema = z.object({
  hakId: UuidSchema,
  surum: z.number().int().min(1),
  sinif: z.enum(LICENSE_CLASSES),
  kokTuru: z.enum(ROOT_KINDS),
  /** Son bilinen modül tavanı (G12 §3.1-2): HAK doğrulanamazsa bu uygulanır; eski kayıtta yok. */
  moduller: z.array(ModuleKeySchema).max(64).optional(),
  /** HAK'ın kip alt sınırı: HAK silinse de kip bunun altına inmez. */
  kipAltSiniri: z.literal("zorla").optional(),
});
export type EntitlementPin = z.infer<typeof EntitlementPinSchema>;

/** İz türleri (G12 §3.1-4): kira dosyası · durum kaydı dosyası · fabrika DB'sindeki lisans izi. */
export const TRACE_KINDS = ["KIRA", "DURUM", "IZ"] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

/**
 * Son kabul edilen kiranın süre çapası — kira silinir ya da bozulursa ayakta kalan izlerden okunur (silmek süreyi
 * uzatmaz). `odenmis` P'dir (yalnız P modeli işliyorduysa; `null` = süresiz); `eski` v1 çapası min(bitiş, vade).
 */
export const RememberedAnchorSchema = z.object({
  kiraId: UuidSchema,
  odenmis: IsoTimeSchema.nullable().optional(),
  eski: IsoTimeSchema,
  eskiNeden: z.enum(["VADE_DOLDU", "KIRA_SURESI_DOLDU"]),
  ekSureGun: z.number().int().min(0).max(GRACE_MAX_DAYS),
});
export type RememberedAnchor = z.infer<typeof RememberedAnchorSchema>;

const CachedFactorRecordSchema = z.object({ ozet: z.string().regex(/^[A-Za-z0-9_-]{43}$/), an: IsoTimeSchema, yol: z.string().max(64).nullable() });

/** `durum.json`: kurulum anahtarıyla imzalı, kiraya bağlı birikim kaydı. Aynı JWS fabrika DB'sinde lisans izi olarak da durur. */
export const StateRecordSchema = z.object({
  v: z.literal(1),
  kurulumId: UuidSchema,
  /** `null` = KİRASIZ kayıt: izler kaybolduktan sonra yazılır, hiçbir kiranın monotonik birikimini taşımaz. */
  kiraId: UuidSchema.nullable(),
  birikenMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  yazildi: IsoTimeSchema,
  yuksekSu: IsoTimeSchema,
  /** Son kullanılabilir kiranın zorlama kararı: kira silinirse kip ona göre korunur. */
  sonKiraZorlamasi: z.boolean().nullable(),
  /** Son kullanılabilir kiranın sunucu kararları; kira yoksa null. */
  sonYaptirim: SanctionSnapshotSchema.nullable(),
  /** Her yazımda artar; geri yüklenmiş eski kopyayı ayırt etmeye yarar. */
  sira: z.number().int().min(0),
  // Aşağıdakiler sonradan eklendi (isteğe bağlı: eski kayıt okunur, ilk yazımda dolar).
  /** Kabul edilen son kira: diskteki kira bundan ESKİYSE geri alınmıştır. */
  sonKira: z.object({ kiraId: UuidSchema, verilis: IsoTimeSchema }).nullable().optional(),
  /** Kabul edilen son HAK'ın sürüm/sınıf/kök pini. */
  sonHak: EntitlementPinSchema.nullable().optional(),
  /** Bu kira boyunca biriken, duvar saatiyle gözlenmiş kapalı kalma süresi (üst eşik kredisi; kabulde önceki kiradan devreden dahil). */
  kapaliMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  /** Yazım anında duvar saati tahminle tutarlı mıydı; değilse `yazildi` kapalı süreye kredi VERMEZ. */
  duvarTutarli: z.boolean().optional(),
  /** Satıcının `ISTEK_ZAMAN` ile bildirdiği son sapma (duvar − satıcı, sn); null = ölçülmedi/tutarlı. */
  saticiSapmaSn: z.number().int().min(-1e9).max(1e9).nullable().optional(),
  /** Bütünlük uyuşmazlığının ilk görüldüğü an (ek süre buradan sayılır); yalnız yeni paket sıfırlar. */
  butunlukIlk: IsoTimeSchema.nullable().optional(),
  /** Damganın ait olduğu imzalı paket (`butunluk.jws` paketId); farklı paket kurulunca damga düşer. */
  butunlukPaketId: UuidSchema.nullable().optional(),
  // Lisans v2 G12 (L2-6): belirsizlik ve parmak izi merdivenleri, iz kaybı, son bilinen çapa.
  /** Son kabul edilen kiranın süre çapası (kira silinince ayakta kalan izden okunur). */
  sureCapasi: RememberedAnchorSchema.nullable().optional(),
  /** Süren ölçülemedinin ÇALIŞMA SÜRESİ birikimi; yalnız yeni kira kabulü sıfırlar. */
  belirsizlik: z.object({ birikenMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), ilk: IsoTimeSchema.nullable() }).optional(),
  /** Parmak izi eşiğin altındayken biriken çalışma süresi; eşik yeniden tutunca sıfırlanır. */
  parmakIziUyusmazMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  /** Son kiradan beri görülen iz kayıpları (kalıcı bayrak; yalnız yeni kira kabulü siler). */
  izKaybi: z.object({ ilk: IsoTimeSchema, izler: z.array(z.enum(TRACE_KINDS)).min(1).max(3) }).nullable().optional(),
  /** Üç iz birden yok bulunduğu an (K7: ek süre buradan, 14 günlük uyarı atlanır). */
  ekSureCapasi: IsoTimeSchema.nullable().optional(),
  /** Fabrika DB'sindeki lisans izi bu kayıtla en az bir kez yazıldı (izin silinmesi ancak bundan sonra kayıptır). */
  izKurulu: z.boolean().optional(),
  /** Parmak izi 24 sa önbelleğinin kopyası (yalnız tuzlu özet; K8). */
  parmakIziOnbellegi: z
    .object({ f1: CachedFactorRecordSchema.optional(), f2: CachedFactorRecordSchema.optional(), f3: CachedFactorRecordSchema.optional(), f4: CachedFactorRecordSchema.optional(), f5: CachedFactorRecordSchema.optional() })
    .optional(),
  // Lisans v2 G4 (L2-7).
  /** İptal pini: görülen en yüksek iptal sırası (kira beyanı ∨ elde tutulan belge); elde daha düşüğü kalırsa belge kayıptır. */
  iptalSira: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  /** Kabulde süreklilik tabanı (`leaseClockAnchor`): bu kiranın tahmini buradan sayılır; yoksa kiranın sunucu saatinden. */
  saatTabani: IsoTimeSchema.optional(),
});
export type StateRecord = z.infer<typeof StateRecordSchema>;

export function signStateRecord(record: StateRecord, privateKey: KeyObject, publicKeyX: string): string {
  const kid = installationKeyId(publicKeyX);
  return signDocument({ typ: TYP.DURUM, schema: StateRecordSchema, payload: record, key: { kid, privateKey } });
}

/** İmza + şema; kurulum bağı ÇAĞIRANIN (lisans kimliği henüz bilinmiyorsa kayıttan benimsenebilir). */
export function verifyStateRecordSignature(token: unknown, g: { readonly publicKeyX: string }): Result<StateRecord> {
  const key = publicKeyFromX(g.publicKeyX);
  if (!key) return failure("JWS_KID", "Kurulum açık anahtarı biçimsiz");
  const kid = installationKeyId(g.publicKeyX);
  const j = verifyJws(token, { typ: TYP.DURUM, findKey: (k) => (k === kid ? key : undefined) });
  if (!j.ok) return forwardFailure(j);
  return decodeDocument(StateRecordSchema, j.value.payload);
}

export function verifyStateRecord(
  token: unknown,
  g: { readonly publicKeyX: string; readonly installationId: string },
): Result<StateRecord> {
  const d = verifyStateRecordSignature(token, g);
  if (!d.ok) return d;
  if (d.value.kurulumId !== g.installationId) return failure("ISTEK_KURULUM", "Durum kaydı başka bir kuruluma ait");
  return success(d.value);
}

/** Durum kaydından bu kiraya ait monotonik birikimi okur; başka kiraya aitse ölçülemedi. */
export function monotonicElapsed(record: Result<StateRecord> | null, leaseId: string | null): number | null {
  if (!record || !record.ok || leaseId === null || record.value.kiraId === null || record.value.kiraId !== leaseId) return null;
  return record.value.birikenMs;
}
