// KİRA ZİNCİRİ kararı (SAF) — plan §4, protokol §13: VM/konteyner kopyasına karşı asıl savunma.
// Her yenileme elindeki kirayı (`sonKiraId`) sunar, sunucu zincirin ucunu tutar:
//   uçta               → NORMAL (uçun çocuğu)
//   uç yok             → ROOT (onaylı taşımadan sonra yeni zincir)
//   (b) uçun ebeveyni, aynı makine, tekrar penceresi içinde → REPEAT (AYNI kira döner, yeni satır yok)
//   (a) geride, aynı makine (snapshot geri alma, eski LICENSE_DIR) → CATCH_UP (uyarı yok)
//   (c) geride, FARKLI makine aynı ucu ileri taşıyor → FORK (kopya şüphesi)
//   uç bir UZATMA DOSYASI kirasıysa (karar DOSYA) ve aynı makine ucun ebeveyniyle gelirse → dosya henüz yüklenmemiştir:
//   olağan yenileme (NORMAL; 15 dk içinde REPEAT) — "yakala" sayılmaz, kopya eşiğine girmez.
// Kapanış kirası (KAPANIS) hiçbir zaman uç olmaz: onu sunan taraf olağan karardan geçer (çatal → yine kapanış).
import {
  FINGERPRINT_FACTORS,
  FINGERPRINT_THRESHOLD,
  FingerprintSchema,
  compareFingerprints,
  type Fingerprint,
} from "../lisans-protokol";

export type ChainDecision = "NORMAL" | "ROOT" | "REPEAT" | "CATCH_UP" | "FORK";

export interface ChainTip {
  readonly id: string;
  readonly previousId: string | null;
  readonly createdAtMs: number;
  /** Uçtaki kirayı isteyenin ölçtüğü parmak izi. */
  readonly clientFingerprint: Fingerprint;
  /** Uç portalın çevrimdışı uzatma dosyasıyla basıldı (istek yok; fabrika dosyayı henüz yüklememiş olabilir). */
  readonly fromFile?: boolean;
}

/** Aynı makine mi: iki tarafta ölçülebilen hiçbir etken farklı değil ve en az iki etken ölçülebilir. */
export function sameMachine(a: Fingerprint, b: Fingerprint): boolean {
  const d = compareFingerprints(a, b);
  return d.mismatched.length === 0 && d.measurable >= FINGERPRINT_THRESHOLD.minMeasurable;
}

export function decideChain(g: {
  readonly presentedLeaseId: string | null;
  readonly tip: ChainTip | null;
  readonly measured: Fingerprint;
  readonly nowMs: number;
  readonly repeatWindowMs: number;
}): ChainDecision {
  if (!g.tip) return "ROOT";
  if (g.presentedLeaseId === g.tip.id) return "NORMAL";
  if (!sameMachine(g.measured, g.tip.clientFingerprint)) return "FORK";
  const presentsParent = g.presentedLeaseId !== null && g.tip.previousId === g.presentedLeaseId;
  const isRetryOfTip = presentsParent && g.nowMs - g.tip.createdAtMs <= g.repeatWindowMs;
  if (isRetryOfTip) return "REPEAT";
  return presentsParent && g.tip.fromFile ? "NORMAL" : "CATCH_UP";
}

export type ForkSide = "REQUESTER_IS_OTHER" | "REQUESTER_IS_OWNER" | "AMBIGUOUS";

/**
 * Çatalda hangi taraf kabul edilen kümeye uyar? Yalnız biri uyuyorsa o sahiptir; ikisi de ya da
 * hiçbiri uyuyorsa AYIRT EDİLEMEZ — o zaman kimseye kira reddi yapılmaz (asla anında durdurma).
 */
export function forkSide(accepted: Fingerprint, requester: Fingerprint, tipHolder: Fingerprint): ForkSide {
  const requesterMatches = sameMachine(accepted, requester);
  const tipMatches = sameMachine(accepted, tipHolder);
  if (tipMatches && !requesterMatches) return "REQUESTER_IS_OTHER";
  if (requesterMatches && !tipMatches) return "REQUESTER_IS_OWNER";
  return "AMBIGUOUS";
}

/** Kabul edilen kümenin kayması: ölçülen etken yenisini yazar, ölçülemeyen eskisini korur. */
export function driftAccepted(accepted: Fingerprint, measured: Fingerprint): Fingerprint {
  const out = { ...accepted };
  for (const f of FINGERPRINT_FACTORS) if (measured[f] !== null) out[f] = measured[f];
  return out;
}

/** DB'deki JSON'u parmak izine çevirir (bozuksa hepsi ölçülemedi). */
export function readFingerprint(value: unknown): Fingerprint {
  const parsed = FingerprintSchema.safeParse(value);
  return parsed.success ? parsed.data : { f1: null, f2: null, f3: null, f4: null, f5: null };
}
