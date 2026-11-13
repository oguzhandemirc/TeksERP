// =============================================================================
// Buluttan istenen rapor için fabrika kapısı (G1 seddi) — saf, süreç belleğinde
// =============================================================================
// Ele geçirilmiş bulut `rapor` zilini sürekli çalıp ağır rapor hesaplatmasın: iki yoklama arası en az
// REPORT_MIN_GAP_MS ve son 60 dk'da en çok `hourlyMax` hesap. Kapı kapalıysa `al` çağrılmaz (istek bulutta
// bekler). Sayaç bellekte: yeniden başlatma onu sıfırlar — tek süreçli backend'de yeniden başlatma seyrektir.
// =============================================================================
import type { CloudCallContext } from "./cloud-client";
import { REPORT_CLAIM_BATCH, claimAndRunReportRequests } from "./report-requests";

/** `ozet` zilinin aralığıyla aynı ("30 sn'de en çok bir"). */
export const REPORT_MIN_GAP_MS = 30 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type ReportGateDecision =
  | { readonly ok: true; readonly enFazla: number }
  | { readonly ok: false; readonly neden: "ARALIK" | "TAVAN" };

export interface ReportGateStatus {
  readonly sonSaat: number;
  readonly sonYoklama: number | null;
}

export class ReportGate {
  private lastClaimAt: number | null = null;
  private computed: number[] = [];

  private prune(nowMs: number): void {
    const from = nowMs - HOUR_MS;
    this.computed = this.computed.filter((t) => t > from);
  }

  /** Bu an `al` çağrılabilir mi; çağrılabilirse en çok kaç istek (`batch` ile kırpılmış kalan). */
  decide(nowMs: number, hourlyMax: number, batch: number): ReportGateDecision {
    if (this.lastClaimAt !== null && nowMs - this.lastClaimAt < REPORT_MIN_GAP_MS) return { ok: false, neden: "ARALIK" };
    this.prune(nowMs);
    const left = hourlyMax - this.computed.length;
    if (left <= 0) return { ok: false, neden: "TAVAN" };
    return { ok: true, enFazla: Math.min(batch, left) };
  }

  /** `al` çağrıldı (sonuç ne olursa olsun aralık başlar). */
  markClaim(nowMs: number): void {
    this.lastClaimAt = nowMs;
  }

  /** Hesaplanan her istek pencereye düşer. */
  markComputed(nowMs: number, count: number): void {
    for (let i = 0; i < count; i++) this.computed.push(nowMs);
  }

  status(nowMs: number): ReportGateStatus {
    this.prune(nowMs);
    return { sonSaat: this.computed.length, sonYoklama: this.lastClaimAt };
  }

  reset(): void {
    this.lastClaimAt = null;
    this.computed = [];
  }
}

/** Süreç geneli tek kapı — eşitleme işi yazar, panel durumu okur. */
export const reportGate = new ReportGate();

/**
 * Kapıdan geçen yoklama: kapalıysa `al` çağrılmaz ve nedeni döner; açıksa `enFazla` kalanla kırpılır,
 * hesaplanan istek sayısı pencereye düşer (dönüş).
 */
export async function runGatedReportClaims(ctx: CloudCallContext, nowMs: number, hourlyMax: number, gate: ReportGate = reportGate): Promise<"ARALIK" | "TAVAN" | number> {
  const d = gate.decide(nowMs, hourlyMax, REPORT_CLAIM_BATCH);
  if (!d.ok) return d.neden;
  gate.markClaim(nowMs);
  const r = await claimAndRunReportRequests(ctx, Date.now, d.enFazla);
  gate.markComputed(nowMs, r.claimed);
  return r.claimed;
}
