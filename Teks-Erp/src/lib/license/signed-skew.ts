// İmzalı saat sapması: sunucunun duvar saati ile satıcının İMZALI kira saati (`kira.sunucuSaati`) arasındaki fark.
// Yalnız UYARIdır — lisans kararına girmez; saatin geri/ileri alınmasını güvenilir saat zaten yakalar (SAAT_GERI ·
// SAAT_ILERI). Ölçüm canlı kira kabulünde alınır, süreç içinde monotonik saatle ileri taşınır; kalıcı değildir.
import { msToIso, SIGNED_SKEW_WARN_SECONDS } from "./protocol";
import type { Banner } from "./state";

export type SignedSkewStatus = "OLCULMEDI" | "TUTARLI" | "UYARI";

/** Canlı kabulde ölçülen örnek: sapma (duvar − imzalı) + o anın duvar saati ve monotonik damgası. */
export interface SignedSkewSample {
  readonly skewMs: number;
  readonly wallMs: number;
  readonly hrNs: bigint;
}

export interface SignedSkewView {
  readonly durum: SignedSkewStatus;
  /** Şu anki tahmini sapma (sn; + = sunucu saati ileride). Ölçülmediyse null. */
  readonly sapmaSn: number | null;
  /** Son canlı ölçümün anı (duvar saatiyle; ISO). */
  readonly olcumAni: string | null;
  readonly esikSn: number;
}

let sample: SignedSkewSample | null = null;

/** Canlı alışverişin imzalı kira saatiyle ölçer; taşınmış kira (dosya/QR) geçmiştedir, ölçüm sayılmaz. */
export function recordSignedSkew(leaseServerTimeMs: number, wallMs: number = Date.now(), hrNs: bigint = process.hrtime.bigint()): void {
  if (!Number.isFinite(leaseServerTimeMs)) return;
  sample = { skewMs: wallMs - leaseServerTimeMs, wallMs, hrNs };
}

/** Saf: ölçümden bu yana duvar saatinin monotonik saatten ayrıştığı kadar sapma büyür (elle kaydırılan saat görünür). */
export function projectSignedSkew(s: SignedSkewSample | null, nowWallMs: number, nowHrNs: bigint): SignedSkewView {
  if (!s) return { durum: "OLCULMEDI", sapmaSn: null, olcumAni: null, esikSn: SIGNED_SKEW_WARN_SECONDS };
  const monoMs = nowHrNs > s.hrNs ? Number((nowHrNs - s.hrNs) / 1_000_000n) : 0;
  const sapmaSn = Math.round((s.skewMs + (nowWallMs - s.wallMs) - monoMs) / 1000);
  return {
    durum: Math.abs(sapmaSn) >= SIGNED_SKEW_WARN_SECONDS ? "UYARI" : "TUTARLI",
    sapmaSn,
    olcumAni: msToIso(s.wallMs),
    esikSn: SIGNED_SKEW_WARN_SECONDS,
  };
}

export function currentSignedSkew(nowWallMs: number = Date.now(), nowHrNs: bigint = process.hrtime.bigint()): SignedSkewView {
  return projectSignedSkew(sample, nowWallMs, nowHrNs);
}

function sureMetni(sn: number): string {
  const dk = Math.round(Math.abs(sn) / 60);
  if (dk < 120) return `${dk} dk`;
  const sa = Math.round(dk / 60);
  return sa < 48 ? `${sa} saat` : `${Math.round(sa / 24)} gün`;
}

/** Panel BİLGİ bandı (lisans bandı değil): yalnız eşik aşılınca; yön ve büyüklük söylenir, saat programdan DEĞİŞTİRİLMEZ. */
export function signedSkewBanner(v: SignedSkewView): Banner | null {
  if (v.durum !== "UYARI" || v.sapmaSn === null) return null;
  const yon = v.sapmaSn > 0 ? "ileride" : "geride";
  return {
    metin: `Sunucu saati lisans sunucusunun imzalı saatinden ${sureMetni(v.sapmaSn)} ${yon}. Sunucuda Windows saat eşitlemesini (Saati otomatik ayarla) denetleyin; kayıt saatleri bu saatten yazılır.`,
    ton: "bilgi",
  };
}

/** Yoklama gövdesi alanı (sn, protokol aralığına kırpılır); ölçülmediyse alan hiç gitmez. */
export function signedSkewSecondsForWire(v: SignedSkewView = currentSignedSkew()): number | undefined {
  return v.sapmaSn === null ? undefined : Math.max(-1e9, Math.min(1e9, v.sapmaSn));
}

/** Test-only. */
export function __resetSignedSkewForTests(): void {
  sample = null;
}
