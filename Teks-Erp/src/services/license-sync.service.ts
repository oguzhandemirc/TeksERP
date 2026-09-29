// Lisans EŞİTLEME: DB olguları + parmak izi tazeleme, yoklama gövdesi, satıcı yanıtının
// doğrulanıp KABULÜ ve yoklama/taşıma turu. Yoklama işi ve API servisi bunu çağırır.
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { buildPollHealthSummary } from "../lib/poll-health-summary";
import { INSTALLATION_ID_SETTING_KEY } from "../constants/reserved-settings";
import {
  ENDPOINTS,
  LicenseResponseSchema,
  PollRequestSchema,
  TransferRequestSchema,
  TransferResponseSchema,
  checkLeaseBinding,
  isoToMs,
  msToIso,
  verifyEntitlement,
  verifyLease,
  type LicenseResponse,
  type SanctionLevel,
} from "../lib/license/protocol";
import { getLicenseStore, saveEntitlement, saveLease, saveTransfer } from "../lib/license/store";
import { measureFingerprint } from "../lib/license/fingerprint";
import {
  getLicenseConfig,
  getLicenseDbFacts,
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  peekObservationCounters,
  recordPollOutcome,
  resetObservationCounters,
  setDownloadTokens,
  setLicenseDbFacts,
  setMeasuredFingerprint,
  startAccumulationForLease,
  type LicenseSnapshot,
} from "../lib/license/runtime";
import { evaluateLicenseTransitions } from "./license-trail.service";
import {
  buildEnvironment,
  currentFingerprintDigest,
  egressTransport,
  invalidResponse,
  licenseError,
  requireReady,
  requireVendorUrl,
  vendorFailureToError,
  vendorPost,
  type VendorResult,
  type VendorTransport,
} from "./helpers/license-wire.helper";

// ── DB olguları + parmak izi ───────────────────────────────────────────────────
/** İlk açılış (dosya silmekle yenilenmez) ve defterdeki yüksek su. */
export async function refreshLicenseDbFacts(installationId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ first: Date | null; high: Date | null }>>`
    SELECT LEAST(
             (SELECT "createdAt" FROM system_settings WHERE key = ${INSTALLATION_ID_SETTING_KEY}),
             (SELECT min("createdAt") FROM users)
           ) AS first,
           (SELECT max("createdAt") FROM roll_operations) AS high`;
  const row = rows[0];
  setLicenseDbFacts({
    installationId,
    firstOpenMs: row?.first ? row.first.getTime() : null,
    ledgerHighWaterMs: row?.high ? row.high.getTime() : null,
  });
}

export async function refreshLicenseFingerprint(): Promise<void> {
  const store = getLicenseStore();
  if (!store?.key) return;
  setMeasuredFingerprint(await measureFingerprint(store.key.salt));
}

/** Yoklama gövdesi — protokolün KATI şemasından geçer (allowlist dışı alan kod yolunda patlar). */
export async function buildPollBody(nowMs: number = Date.now()): Promise<ReturnType<typeof PollRequestSchema.parse>> {
  const snap = getLicenseSnapshot(nowMs);
  const s = snap.state;
  return PollRequestSchema.parse({
    v: 1,
    sonKiraId: snap.lease?.document.kiraId ?? null,
    hak: snap.entitlement ? { hakId: snap.entitlement.document.hakId, surum: snap.entitlement.document.surum } : null,
    parmakIzi: currentFingerprintDigest(),
    durum: {
      gecerlilik: s.gecerlilik,
      nedenler: s.nedenler.map((n) => n.kod).slice(0, 40),
      kip: s.kip,
      hesaplananKademe: s.hesaplananKademe,
      uygulananKademe: s.uygulananKademe,
    },
    saat: { duvar: msToIso(nowMs), guvenilir: msToIso(s.saat.trustedMs), bulgu: s.saat.finding },
    ortam: buildEnvironment(),
    saglik: await buildPollHealthSummary(),
    gozlem: peekObservationCounters(),
  });
}

// ── Kira kabulü ─────────────────────────────────────────────────────────────────
export type LeaseSource = "yoklama" | "etkinlestirme" | "cevrimdisi" | "aktarma" | "tasima" | "dr-devral";

interface SanctionView {
  readonly kademe: SanctionLevel | null;
  readonly donmusModuller: readonly string[];
  readonly guncellemeDonuk: boolean;
  readonly devredildi: boolean;
}

function sanctionView(snap: LicenseSnapshot): SanctionView | null {
  const l = snap.lease?.document;
  if (!l) return null;
  return { kademe: l.yaptirim.kademe, donmusModuller: [...l.yaptirim.donmusModuller].sort(), guncellemeDonuk: l.yaptirim.guncellemeDonuk, devredildi: l.devredildi };
}

let doorbellKick: (() => void) | null = null;
/** Zil işi kendini kaydeder; ilk etkinleştirmede bağlantı beklemeden kurulur. */
export function onLicenseActivated(fn: () => void): void {
  doorbellKick = fn;
}


/**
 * Satıcı yanıtını DOĞRULAR ve kabul eder: kira + HAK bu kuruluma, bu anahtara ve birbirine
 * bağlı olmalı; eski kira geri oynatılamaz. Yazım sırası durum → HAK → kira (yarım kalan
 * yazım bir sonraki yoklamada kendini onarır). İmza doğrulaması BURADA — panel/telefon yanıtı taklit edemez.
 */
export async function acceptLicenseResponse(
  raw: unknown,
  source: LeaseSource,
  userId: string | null = null,
): Promise<{ yeniKira: boolean; kiraId: string }> {
  const ctx = requireReady();
  const parsed = LicenseResponseSchema.safeParse(raw);
  if (!parsed.success) throw invalidResponse("Lisans yanıtı biçimsiz.");
  const resp: LicenseResponse = parsed.data;
  const roots = getLicenseConfig().roots;
  const lease = verifyLease(resp.kira, roots);
  if (!lease.ok) throw invalidResponse(`Kira doğrulanamadı: ${lease.message}`, lease.code);
  const leaseDoc = lease.value.document;
  if (leaseDoc.kurulumId !== ctx.installationId || leaseDoc.kurulumAnahtarKimligi !== ctx.key.kid) {
    throw invalidResponse("Kira bu kuruluma ya da bu kurulum anahtarına ait değil.");
  }
  const entitlementJws = resp.hak ?? ctx.store.entitlementJws;
  if (!entitlementJws) throw invalidResponse("Yanıt HAK belgesi taşımıyor ve kurulumda HAK yok.");
  const entitlement = verifyEntitlement(entitlementJws, roots);
  if (!entitlement.ok) throw invalidResponse(`HAK doğrulanamadı: ${entitlement.message}`, entitlement.code);
  if (entitlement.value.document.kurulumId !== ctx.installationId) throw invalidResponse("HAK bu kuruluma ait değil.");
  const binding = checkLeaseBinding(lease.value, entitlement.value);
  if (!binding.ok) throw invalidResponse(`Kira HAK'a bağlı değil: ${binding.message}`, binding.code);

  const before = getLicenseSnapshot();
  const previous = before.lease?.document ?? null;
  if (previous && previous.kiraId === leaseDoc.kiraId) {
    setDownloadTokens(resp.indirmeBelirtecleri);
    return { yeniKira: false, kiraId: leaseDoc.kiraId };
  }
  if (previous && isoToMs(leaseDoc.verilis) < isoToMs(previous.verilis)) {
    throw licenseError(409, "LICENSE_LEASE_STALE", "Gelen kira kurulumdakinden eski; yeniden denenemez.");
  }
  const priorSanction = sanctionView(before);
  const firstActivation = !ctx.store.leaseJws;

  startAccumulationForLease(leaseDoc);
  if (resp.hak && resp.hak !== ctx.store.entitlementJws) saveEntitlement(resp.hak);
  saveLease(resp.kira);
  setDownloadTokens(resp.indirmeBelirtecleri);
  if (getLicenseStore()?.transfer) saveTransfer(null);
  recordPollOutcome({ ok: true });
  invalidateLicenseSnapshot();

  const after = getLicenseSnapshot();
  void AuditService.logEvent({
    category: "SYSTEM",
    action: "LICENSE_LEASE_ACCEPTED",
    userId,
    recordId: leaseDoc.kiraId,
    payload: {
      kaynak: source,
      hakSurum: leaseDoc.hakSurum,
      bitis: leaseDoc.bitis,
      zorlama: leaseDoc.zorlama,
      yaptirimKademesi: leaseDoc.yaptirim.kademe,
      ilkEtkinlestirme: firstActivation,
    },
  });
  const nextSanction = sanctionView(after);
  if (JSON.stringify(priorSanction) !== JSON.stringify(nextSanction)) {
    void AuditService.logEvent({
      category: "SYSTEM",
      action: "LICENSE_SANCTION_CHANGED",
      recordId: leaseDoc.kiraId,
      payload: { onceki: priorSanction, yeni: nextSanction },
    });
  }
  evaluateLicenseTransitions();
  if (firstActivation) doorbellKick?.();
  return { yeniKira: true, kiraId: leaseDoc.kiraId };
}

// ── Kira alışverişleri SIRALI ───────────────────────────────────────────────────
// Zil yoklaması ile yöneticinin eylemi (şimdi yokla · etkinleştir · DR · taşıma) aynı anda satıcıya
// giderse yanıtlar ters sırada kabul edilir: yeni kira önce yazılır, eskisi LICENSE_LEASE_STALE
// ile düşer ya da başarısız yoklama sayılır — işlem satıcıda başarılıyken. İstek + kabul tek kuyruk.
let exchangeTail: Promise<unknown> = Promise.resolve();

export function runLeaseExchange<T>(fn: () => Promise<T>): Promise<T> {
  const run = exchangeTail.then(fn, fn);
  exchangeTail = run.catch(() => undefined);
  return run;
}

// ── Yoklama (iş çağırır) ────────────────────────────────────────────────────────
export type PollOutcome = "YAPILANDIRILMAMIS" | "HAZIR_DEGIL" | "ETKIN_DEGIL" | "BASARILI" | "BASARISIZ";

export function pollLicenseOnce(transport: VendorTransport = egressTransport): Promise<{ outcome: PollOutcome; code?: string }> {
  return runLeaseExchange(() => pollOnce(transport));
}

async function pollOnce(transport: VendorTransport): Promise<{ outcome: PollOutcome; code?: string }> {
  const store = getLicenseStore();
  const config = getLicenseConfig();
  if (!store || store.problem || !store.key || !getLicenseDbFacts().installationId) return { outcome: "HAZIR_DEGIL" };
  const activated = Boolean(store.leaseJws || store.transfer);
  if (!config.vendorUrl) {
    // Etkin bir kurulum adres kaybederse yenileyemez: bu da başarısız yoklamadır.
    if (activated) recordPollOutcome({ ok: false, code: "YAPILANDIRILMAMIS" });
    return { outcome: "YAPILANDIRILMAMIS" };
  }
  if (!activated) return { outcome: "ETKIN_DEGIL" };
  if (store.transfer) return pollTransfer(transport);

  let result: VendorResult;
  try {
    result = await vendorPost(ENDPOINTS.POLL, "yokla", await buildPollBody(), transport);
  } catch (err) {
    recordPollOutcome({ ok: false, code: "GOVDE_KURULAMADI" });
    throw err;
  }
  if (!result.ok) {
    recordPollOutcome({ ok: false, code: result.code });
    return { outcome: "BASARISIZ", code: result.code };
  }
  try {
    const accepted = await acceptLicenseResponse(result.json, "yoklama");
    if (!accepted.yeniKira) {
      recordPollOutcome({ ok: false, code: "KIRA_YENILENMEDI" });
      return { outcome: "BASARISIZ", code: "KIRA_YENILENMEDI" };
    }
    resetObservationCounters();
    return { outcome: "BASARILI" };
  } catch (err) {
    const code = err instanceof AppError ? String(err.details?.code ?? "YANIT_GECERSIZ") : "YANIT_GECERSIZ";
    recordPollOutcome({ ok: false, code });
    return { outcome: "BASARISIZ", code };
  }
}

async function pollTransfer(transport: VendorTransport): Promise<{ outcome: PollOutcome; code?: string }> {
  const transfer = getLicenseStore()?.transfer;
  try {
    const r = await sendTransfer(transfer?.gerekce ?? null, transport);
    if (r.durum === "ONAYLANDI") return { outcome: "BASARILI" };
    const code = r.durum === "REDDEDILDI" ? "TASIMA_REDDEDILDI" : "TASIMA_ONAYI_BEKLIYOR";
    recordPollOutcome({ ok: false, code });
    return { outcome: "BASARISIZ", code };
  } catch (err) {
    const code = err instanceof AppError ? String(err.details?.vendorCode ?? err.details?.code ?? "TASIMA_HATASI") : "TASIMA_HATASI";
    recordPollOutcome({ ok: false, code });
    return { outcome: "BASARISIZ", code };
  }
}

// ── Taşıma turu (API ve bekleyen talebin yoklaması) ─────────────────────────────
export async function sendTransfer(gerekce: string | null, transport: VendorTransport): Promise<{ durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI"; talepId: string }> {
  const ctx = requireReady();
  requireVendorUrl();
  const body = TransferRequestSchema.parse({
    v: 1,
    kurulumId: ctx.installationId,
    acikAnahtar: ctx.key.x,
    parmakIzi: currentFingerprintDigest(),
    ortam: buildEnvironment(),
    gerekce,
  });
  const r = await vendorPost(ENDPOINTS.TRANSFER, "tasima", body, transport);
  if (!r.ok) throw vendorFailureToError(r);
  const parsed = TransferResponseSchema.safeParse(r.json);
  if (!parsed.success) throw invalidResponse("Taşıma yanıtı biçimsiz.");
  const t = parsed.data;
  if (t.durum === "ONAYLANDI") {
    if (!t.lisans) throw invalidResponse("Onaylanan taşıma lisans taşımıyor.");
    await acceptLicenseResponse(t.lisans, "tasima");
    return { durum: t.durum, talepId: t.talepId };
  }
  if (t.durum === "REDDEDILDI") saveTransfer(null);
  else saveTransfer({ talepId: t.talepId, istendi: getLicenseStore()?.transfer?.istendi ?? msToIso(Date.now()), gerekce });
  return { durum: t.durum, talepId: t.talepId };
}


/** Test-only. */
export function __resetLicenseSyncForTests(): void {
  doorbellKick = null;
}
