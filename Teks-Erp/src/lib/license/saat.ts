// Güvenilir saat — SAF kısım. Kiradan beri geçen süre duvar saatiyle değil, son kiradan
// beri BİRİKEN monotonik çalışma süresiyle ölçülür (makine kapalıyken birikmez: bu bir
// ALT sınırdır). `durum.json` okuma/yazma ve hrtime örnekleme fabrika motorunun işidir.
import { z } from "zod";
import type { KeyObject } from "node:crypto";
import {
  IsoTimeSchema,
  CLOCK_SKEW_MS,
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
  /** Bu kira kabul edildiğinden beri biriken monotonik süre; ölçülemiyorsa null. */
  readonly monotonicElapsedMs: number | null;
  readonly pollIntervalMs: number;
}

export interface ClockResult {
  readonly trustedMs: number;
  readonly source: ClockSource;
  readonly finding: ClockFinding | null;
  /** Bulgu yüksek sudan mı duvar saatinden mi doğdu (portala rapor için). */
  readonly findingSource: "DUVAR" | "YUKSEK_SU" | null;
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
    if (g.wallMs < floor - CLOCK_SKEW_MS) {
      return { trustedMs: floor, source: "YUKSEK_SU", finding: "SAAT_GERI", findingSource: "DUVAR" };
    }
    return { trustedMs: Math.max(g.wallMs, floor), source: "DUVAR", finding: null, findingSource: null };
  }
  const estimate = g.leaseServerTimeMs + Math.max(0, g.monotonicElapsedMs);
  const upperBound = estimate + g.pollIntervalMs + CLOCK_SKEW_MS;
  // Tahminin ötesindeki yüksek su alt sınır olarak HİÇ kullanılmaz: eşikte tavanlamak bile
  // güvenilir saati duvarın ilerisine iter ve sahte SAAT_GERİ üretir.
  const highWaterTrusted = floor <= upperBound;
  const lower = highWaterTrusted ? Math.max(estimate, floor) : estimate;
  const lowerSource: ClockSource = lower === estimate ? "MONOTONIK" : "YUKSEK_SU";
  if (g.wallMs < lower - CLOCK_SKEW_MS) {
    return { trustedMs: lower, source: lowerSource, finding: "SAAT_GERI", findingSource: "DUVAR" };
  }
  if (g.wallMs > upperBound) {
    return { trustedMs: lower, source: lowerSource, finding: "SAAT_ILERI", findingSource: "DUVAR" };
  }
  const trustedMs = Math.max(g.wallMs, lower);
  if (!highWaterTrusted) return { trustedMs, source: "DUVAR", finding: "SAAT_ILERI", findingSource: "YUKSEK_SU" };
  return { trustedMs, source: "DUVAR", finding: null, findingSource: null };
}

/**
 * Biriken süre: diskteki birikim + bu süreç yüklendiğinden beri geçen hrtime. hrtime geri
 * gidemez; gitmiş görünürse (farklı süreç, hatalı örnek) birikim KÜÇÜLTÜLMEZ.
 */
export function accumulatedRuntime(g: { readonly storedMs: number; readonly loadHrNs: bigint; readonly nowHrNs: bigint }): number {
  const diff = g.nowHrNs > g.loadHrNs ? Number((g.nowHrNs - g.loadHrNs) / 1_000_000n) : 0;
  return Math.max(0, g.storedMs) + diff;
}

/** `durum.json`: kurulum anahtarıyla imzalı, kiraya bağlı birikim kaydı. */
export const StateRecordSchema = z.object({
  v: z.literal(1),
  kurulumId: UuidSchema,
  kiraId: UuidSchema,
  birikenMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  yazildi: IsoTimeSchema,
  yuksekSu: IsoTimeSchema,
  /** Son kullanılabilir kiranın zorlama kararı: kira silinirse kip ona göre korunur. */
  sonKiraZorlamasi: z.boolean().nullable(),
  /** Her yazımda artar; geri yüklenmiş eski kopyayı ayırt etmeye yarar. */
  sira: z.number().int().min(0),
});
export type StateRecord = z.infer<typeof StateRecordSchema>;

export function signStateRecord(record: StateRecord, privateKey: KeyObject, publicKeyX: string): string {
  const kid = installationKeyId(publicKeyX);
  return signDocument({ typ: TYP.DURUM, schema: StateRecordSchema, payload: record, key: { kid, privateKey } });
}

export function verifyStateRecord(
  token: unknown,
  g: { readonly publicKeyX: string; readonly installationId: string },
): Result<StateRecord> {
  const key = publicKeyFromX(g.publicKeyX);
  if (!key) return failure("JWS_KID", "Kurulum açık anahtarı biçimsiz");
  const kid = installationKeyId(g.publicKeyX);
  const j = verifyJws(token, { typ: TYP.DURUM, findKey: (k) => (k === kid ? key : undefined) });
  if (!j.ok) return forwardFailure(j);
  const d = decodeDocument(StateRecordSchema, j.value.payload);
  if (!d.ok) return forwardFailure(d);
  if (d.value.kurulumId !== g.installationId) return failure("ISTEK_KURULUM", "Durum kaydı başka bir kuruluma ait");
  return success(d.value);
}

/** Durum kaydından bu kiraya ait monotonik birikimi okur; başka kiraya aitse ölçülemedi. */
export function monotonicElapsed(record: Result<StateRecord> | null, leaseId: string | null): number | null {
  if (!record || !record.ok || leaseId === null || record.value.kiraId !== leaseId) return null;
  return record.value.birikenMs;
}
