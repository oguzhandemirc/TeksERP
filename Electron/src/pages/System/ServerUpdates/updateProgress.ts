import type { UpdateHistoryItem, UpdateStatus } from "@/types/server-update";

// Canlı güncelleme penceresinin SAF durum makinesi. Girdi yalnız `GET /api/guncelleme/durum` (güncelleyicinin
// `durum.json`u) ve ulaşılabilirliktir; panel karar üretmez, gördüğünü gösterir. Adım adları sözleşme §8 tablosudur.

export type ProgressPhase = "HAZIRLIK" | "YEDEK" | "VERITABANI" | "DENEME" | "BASLATMA";

export const PHASES: ReadonlyArray<{ key: ProgressPhase; label: string }> = [
  { key: "HAZIRLIK", label: "Hazırlık" },
  { key: "YEDEK", label: "Yedek" },
  { key: "VERITABANI", label: "Veritabanı" },
  { key: "DENEME", label: "Deneme" },
  { key: "BASLATMA", label: "Başlatma" },
];

const STEP_PHASE: Record<string, ProgressPhase> = {
  BACKEND_DURDUR: "HAZIRLIK",
  YEDEK: "YEDEK",
  GECIS: "VERITABANI",
  GOC: "VERITABANI",
  DOGRULAMA: "DENEME",
  BASLAT: "BASLATMA",
  ONAY: "BASLATMA",
};

/** `adim` → aşama. `GERI_DON:<adım>` geri almadır. Tanınmayan/boş adım → aşama yok (pencere "hazırlanıyor" der). */
export function phaseOfStep(adim: string | null): { phase: ProgressPhase | null; rollback: boolean } {
  if (!adim) return { phase: null, rollback: false };
  const rollback = adim.startsWith("GERI_DON:");
  const name = rollback ? adim.slice("GERI_DON:".length) : adim;
  return { phase: STEP_PHASE[name] ?? null, rollback };
}

export type ProgressOutcome = "BASARILI" | "GERI_DONDU" | "BASARISIZ";

export type ProgressState =
  | { kind: "idle" }
  | { kind: "running"; version: string; adim: string | null; startedAt: number; unreachable: boolean }
  | { kind: "done"; outcome: ProgressOutcome; version: string };

export interface ProgressObservation {
  /** Bu turda BAŞARIYLA okunan durum; okunamadıysa undefined (eski veri verilmez). */
  status: UpdateStatus | undefined;
  /** Sunucuya hiç ulaşılamadı (yanıt yok / 5xx): yeniden başlatma sırasında beklenen hal. */
  unreachable: boolean;
  now: number;
}

const applying = (s: UpdateStatus): boolean => s.yerel?.durum === "UYGULANIYOR" && (s.yerel.urun === null || s.yerel.urun === "backend" || s.yerel.urun === "pg");

/** Biten işlemin sonucu: önce hedef sürüme ait `son`, yoksa kurulu sürümden. */
function outcomeOf(s: UpdateStatus, version: string): ProgressOutcome {
  if (s.son && s.son.hedefSurum === version) return s.son.sonuc === "BASARILI" ? "BASARILI" : s.son.sonuc === "GERI_DONDU" ? "GERI_DONDU" : "BASARISIZ";
  if (s.yerel?.durum === "HATA") return "BASARISIZ";
  return s.kuruluSurum === version ? "BASARILI" : "GERI_DONDU";
}

export function nextProgress(prev: ProgressState, o: ProgressObservation): ProgressState {
  const s = o.status;
  if (s && applying(s)) {
    const version = s.yerel?.surum ?? s.bekleyen?.surum ?? s.kuruluSurum;
    const startedAt = prev.kind === "running" && prev.version === version ? prev.startedAt : o.now;
    return { kind: "running", version, adim: s.yerel?.adim ?? null, startedAt, unreachable: false };
  }
  if (prev.kind === "running") {
    if (!s) return o.unreachable && !prev.unreachable ? { ...prev, unreachable: true } : prev;
    return { kind: "done", outcome: outcomeOf(s, prev.version), version: prev.version };
  }
  return prev.kind === "done" ? prev : { kind: "idle" };
}

/** Son başarılı backend denemelerinin ortanca süresi (sn); veri yoksa null — pencere "birkaç dakika" der. */
export function estimateSeconds(gecmis: UpdateHistoryItem[]): number | null {
  const d = gecmis
    .filter((g) => g.urun === "backend" && g.sonuc === "BASARILI")
    .slice(0, 5)
    .map((g) => (Date.parse(g.bitis) - Date.parse(g.baslangic)) / 1000)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
  return d.length === 0 ? null : Math.round(d[Math.floor(d.length / 2)]!);
}
