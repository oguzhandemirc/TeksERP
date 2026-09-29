// Lisans AYAK İZİ: yalnız durum geçişi, gözlem özeti ve yönetici eylemi (her başarısız yoklama
// DEĞİL). Audit bir iz yüzeyidir; lisans kararı buradan OKUNMAZ.
import { AuditService } from "./audit.service";
import { uyari } from "../lib/logger";
import { getLicenseSnapshot, peekObservationCounters, persistAccumulation } from "../lib/license/runtime";

const OBSERVATION_SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ── Ayak izi: geçiş + gözlem özeti ──────────────────────────────────────────────
let lastLoggedState: string | null = null;
let lastSummaryAt = Date.now();

/** Durum geçişini deftere yazar; ilk hazır ölçüm TABANDIR (her açılışta satır yazılmaz). */
export function evaluateLicenseTransitions(nowMs: number = Date.now()): void {
  const snap = getLicenseSnapshot(nowMs);
  if (!snap.hazir) return;
  const s = snap.state;
  const key = JSON.stringify([s.gecerlilik, s.hesaplananKademe, s.uygulananKademe, s.kip]);
  if (lastLoggedState === null) {
    lastLoggedState = key;
    return;
  }
  if (key === lastLoggedState) return;
  const onceki = JSON.parse(lastLoggedState) as unknown[];
  lastLoggedState = key;
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "LICENSE_STATE_CHANGED",
    payload: {
      onceki: { gecerlilik: onceki[0], hesaplananKademe: onceki[1], uygulananKademe: onceki[2], kip: onceki[3] },
      yeni: { gecerlilik: s.gecerlilik, hesaplananKademe: s.hesaplananKademe, uygulananKademe: s.uygulananKademe, kip: s.kip },
      nedenler: s.nedenler.map((n) => n.kod),
    },
  });
}

/** Gözlem kipinde günde bir özet (etkin kurulumda) — zorlamaya geçiş kararının ölçüsü. */
export function logObservationSummaryIfDue(nowMs: number = Date.now()): boolean {
  if (nowMs - lastSummaryAt < OBSERVATION_SUMMARY_INTERVAL_MS) return false;
  const snap = getLicenseSnapshot(nowMs);
  // Etkin tanımı D3: kira dosyasının varlığı değil, motorun `activated` kararı (HAK/durum kaydı da sayar).
  if (!snap.hazir || snap.state.kip !== "gozlem" || !snap.activated) return false;
  lastSummaryAt = nowMs;
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "LICENSE_OBSERVATION_SUMMARY",
    payload: {
      gecerlilik: snap.state.gecerlilik,
      hesaplananKademe: snap.state.hesaplananKademe,
      nedenler: snap.state.nedenler.map((n) => n.kod),
      ...peekObservationCounters(),
    },
  });
  return true;
}

/** Saatlik bakım: birikimi diske yaz, geçişleri değerlendir, günlük özet. */
export function licenseHousekeeping(nowMs: number = Date.now()): void {
  try {
    persistAccumulation(nowMs);
  } catch (err) {
    uyari("lisans", "durum kaydı yazılamadı", err instanceof Error ? err.message : err);
  }
  evaluateLicenseTransitions(nowMs);
  logObservationSummaryIfDue(nowMs);
}

export function adminAction(userId: string | null, eylem: string, payload: Record<string, unknown> = {}): void {
  void AuditService.logEvent({ category: "SYSTEM", action: "LICENSE_ADMIN_ACTION", userId, payload: { eylem, ...payload } });
}

/** Test-only: ayak izi tabanını sıfırlar. */
export function __resetLicenseTrailForTests(): void {
  lastLoggedState = null;
  lastSummaryAt = Date.now();
}
