// Lisans AYAK İZİ: yalnız durum geçişi, gözlem özeti ve yönetici eylemi (her başarısız yoklama
// DEĞİL). Audit bir iz yüzeyidir; lisans kararı buradan OKUNMAZ.
// Ayrıca lisans İZİ (G12 DB izi, `license.trace`): imzalı durum kaydının DB kopyası — okuması ve TEK yazıcısı burada.
// İz yazımı `durum.json` yazımının aynasıdır (saatlik sistem işi) ve kendi audit satırını YAZMAZ; insana görünen
// ayak izi iz kaybının yol açtığı durum geçişidir (`LICENSE_STATE_CHANGED`, nedenlerde `LISANS_IZI_KAYIP`).
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { uyari } from "../lib/logger";
import { getLicenseSnapshot, peekObservationCounters } from "../lib/license/runtime";
import { persistAccumulation } from "../lib/license/record-writer";
import { acknowledgeTraceWrite, flushLicenseTraceWrites, registerLicenseTraceWriter } from "../lib/license/accumulation";
import { markLicenseTraceUnknown, setLicenseTraceRow, type TraceRow } from "../lib/license/trace-row";
import { LICENSE_TRACE_SETTING_KEY } from "../constants/reserved-settings";

// ── Lisans izi (DB kopyası) ─────────────────────────────────────────────────────
/** Satırı okur; DB okunamazsa iz BİLİNMİYOR sayılır (kayıp üretmez). */
export async function refreshLicenseTrace(): Promise<void> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: LICENSE_TRACE_SETTING_KEY }, select: { value: true } });
    setLicenseTraceRow(row ? row.value : null);
  } catch {
    markLicenseTraceUnknown();
  }
}

/** Kaydın DB kopyasını yazar (motorun kuyruğundan, sırayla); düşerse dosya yine geçerlidir, bir sonraki yazım tazeler. */
async function writeLicenseTraceRow(row: TraceRow): Promise<void> {
  try {
    await prisma.systemSetting.upsert({
      where: { key: LICENSE_TRACE_SETTING_KEY },
      create: { key: LICENSE_TRACE_SETTING_KEY, value: row, description: "Lisans izi (durum kaydının kopyası) — yalnız lisans motoru yazar" },
      update: { value: row },
    });
    acknowledgeTraceWrite(row);
  } catch (err) {
    acknowledgeTraceWrite(null);
    uyari("lisans", "lisans izi DB'ye yazılamadı (dosya kopyası geçerli)", err instanceof Error ? err.message : err);
  }
}
registerLicenseTraceWriter(writeLicenseTraceRow);

const OBSERVATION_SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ── Ayak izi: geçiş + gözlem özeti ──────────────────────────────────────────────
let lastLoggedState: string | null = null;
let lastSummaryAt = Date.now();

/** Durum geçişini deftere yazar; ilk hazır ölçüm TABANDIR (her açılışta satır yazılmaz). */
export function evaluateLicenseTransitions(nowMs: number = Date.now()): void {
  const snap = getLicenseSnapshot(nowMs);
  if (!snap.durumHazir) return;
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
  if (!snap.durumHazir || snap.state.kip !== "gozlem" || !snap.activated) return false;
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

/** Saatlik bakım (açılışta da): birikimi ve merdivenleri yaz (dosya + DB izi), geçişleri değerlendir, günlük özet. */
export async function licenseHousekeeping(nowMs: number = Date.now()): Promise<void> {
  try {
    persistAccumulation(nowMs);
  } catch (err) {
    uyari("lisans", "durum kaydı yazılamadı", err instanceof Error ? err.message : err);
  }
  evaluateLicenseTransitions(nowMs);
  logObservationSummaryIfDue(nowMs);
  await flushLicenseTraceWrites();
}

export function adminAction(userId: string | null, eylem: string, payload: Record<string, unknown> = {}): void {
  void AuditService.logEvent({ category: "SYSTEM", action: "LICENSE_ADMIN_ACTION", userId, payload: { eylem, ...payload } });
}

/** Test-only: ayak izi tabanını sıfırlar. */
export function __resetLicenseTrailForTests(): void {
  lastLoggedState = null;
  lastSummaryAt = Date.now();
}
