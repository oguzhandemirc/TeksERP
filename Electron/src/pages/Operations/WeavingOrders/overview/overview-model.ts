// =============================================================================
// DOKUMA İŞİ GENEL BAKIŞ — saf görünüm modeli (React yok, test edilir)
// =============================================================================
// İlerleme paydası hedef metredir; pay fasonda KABUL metresi, kendi tezgahımızda
// doğan topların metresidir (koşum metresi ayrı KPI, karıştırılmaz). Hedef yoksa
// iş açık uçludur — % yazılmaz. Ölçülmeyen metre null'dır, 0 değil.
// =============================================================================
import type { WeavingExecutionKind, WeavingOrderStatus } from "../types";
import type { CappedList, OverviewProgress } from "./types";

/** "Şu an tezgahta" bölümü boşken durum cümlesi. */
export function liveEmptyText(status: WeavingOrderStatus, kind: WeavingExecutionKind | undefined): string {
  if (status === "COMPLETED") return "İş kapatıldı — tezgahta değil";
  if (status === "CANCELLED") return "İş iptal edildi — tezgahta değil";
  if (kind === "SUBCONTRACTED") return "Fasonda dokunuyor — sevk ve kabul Fason panelinde";
  if (status === "PLANNED") return "Henüz tezgaha verilmedi — koşum tabletten ya da Tezgah Salonu'ndan açılır";
  return "Şu an açık koşum yok";
}

export type ProgressView =
  | { kind: "open-ended" }
  | { kind: "unmeasured" }
  | { kind: "pct"; pct: number; doneM: number };

/** İlerleme: hedef null → açık uçlu; pay null → ölçülemedi. */
export function progressView(p: OverviewProgress, kind: WeavingExecutionKind | undefined): ProgressView {
  if (p.plannedM === null || p.plannedM <= 0) return { kind: "open-ended" };
  const done = kind === "SUBCONTRACTED" ? p.fasonReceivedM : p.rollMeters;
  if (done === null) return { kind: "unmeasured" };
  return { kind: "pct", pct: (done / p.plannedM) * 100, doneM: done };
}

/** Bölüm sayacı: kırpılmışsa "son N / toplam M", değilse toplam. */
export function listCount(list: CappedList<unknown>): string {
  return list.truncated ? `son ${list.items.length} / toplam ${list.total}` : String(list.total);
}

/** Sunucu listeyi göndermediyse (eski backend) bölüm çizilmez. */
export function isList<T>(v: CappedList<T> | null | undefined): v is CappedList<T> {
  return !!v && Array.isArray(v.items);
}
