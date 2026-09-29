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
  isoToMs,
  msToIso,
  type LicenseResponse,
  type SanctionLevel,
} from "../lib/license/protocol";
import { getLicenseStore, saveEntitlement, saveLease, saveLicenseIdentity, saveTransfer } from "../lib/license/store";
import { measureFingerprint } from "../lib/license/fingerprint";
import { coreCheckLeaseBinding, coreVerifyEntitlement, coreVerifyLease } from "../lib/license/core-bridge";
import { runIntegrityCheck } from "../lib/license/integrity-check";
import { integrityCheckTarget, setIntegrityOutcome } from "../lib/license/integrity-state";
import { NATIVE_REQUIRED, getLicenseCore } from "../lib/license/native";
import { installHistoryPath, readInstallHistory } from "../lib/license/install-history";
import {
  getLicenseConfig,
  getLicenseSnapshot,
  getVendorClockSkewMs,
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
import { syncSupportAfterPoll } from "./support-sync.service";
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
/**
 * İlk açılış (dosya silmekle yenilenmez), defterdeki yüksek su ve DB'nin kurulum kimliği (YALNIZ
 * bilgi — lisans kimliği LICENSE_DIR'dedir; DB kopyası onu taşımaz).
 */
export async function refreshLicenseDbFacts(installationId: string): Promise<void> {
  // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): yüksek su defterde YAZILMIŞ en geç andır — geri alınan işlem
  // de o anda yazılmıştır; süzmek, bir geri almadan sonra saat-geri tespitinin alt sınırını geriletirdi.
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

/**
 * İmzalı dosya listesine karşı bütünlük (açılışta + günlük). Paket kökü süreç kökü (`app/`);
 * hazırlık PAKET anahtarının sınıf kuralı için doğrulanmış HAK'ın sınıfı verilir.
 */
export async function refreshLicenseIntegrity(): Promise<void> {
  const entitlementClass = getLicenseSnapshot().entitlement?.document.sinif ?? null;
  const { root, keys } = integrityCheckTarget();
  setIntegrityOutcome(await runIntegrityCheck({ root, keys, required: NATIVE_REQUIRED, core: getLicenseCore(), entitlementClass }));
}

function skewSeconds(): number | undefined {
  const ms = getVendorClockSkewMs();
  return ms === null ? undefined : Math.max(-1e9, Math.min(1e9, Math.round(ms / 1000)));
}

/** Yoklama gövdesi — protokolün KATI şemasından geçer (allowlist dışı alan kod yolunda patlar). */
export async function buildPollBody(nowMs: number = Date.now()): Promise<ReturnType<typeof PollRequestSchema.parse>> {
  const snap = getLicenseSnapshot(nowMs);
  const s = snap.state;
  const saticiSapmaSn = skewSeconds();
  return PollRequestSchema.parse({
    v: 1,
    // Zincir ucu: kira dosyası silinmiş/eskisiyle değiştirilmişse durum kaydının bildiği son kabul.
    sonKiraId: snap.lastKnownLease?.kiraId ?? null,
    hak: snap.entitlement ? { hakId: snap.entitlement.document.hakId, surum: snap.entitlement.document.surum } : null,
    parmakIzi: currentFingerprintDigest(),
    durum: {
      gecerlilik: s.gecerlilik,
      nedenler: s.nedenler.map((n) => n.kod).slice(0, 40),
      kip: s.kip,
      hesaplananKademe: s.hesaplananKademe,
      uygulananKademe: s.uygulananKademe,
    },
    saat: {
      duvar: msToIso(nowMs),
      guvenilir: msToIso(s.saat.trustedMs),
      bulgu: s.saat.finding,
      ...(saticiSapmaSn === undefined ? {} : { saticiSapmaSn }),
    },
    ortam: buildEnvironment(),
    saglik: await buildPollHealthSummary(),
    gozlem: peekObservationCounters(),
    // Kurulum kaydı yoksa alan hiç gitmez: eski satıcı KATI şemayla tanımadığı anahtarı reddeder.
    ...installRecordsField(),
  });
}

function installRecordsField(): { kurulumKayitlari?: ReturnType<typeof readInstallHistory> } {
  const dir = getLicenseStore()?.dir;
  if (!dir) return {};
  const records = readInstallHistory(installHistoryPath(dir));
  return records.length > 0 ? { kurulumKayitlari: records } : {};
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
 * bağlı olmalı; eski kira geri oynatılamaz (durum kaydının bildiği son kabul dahil — kira dosyasını
 * silip eski yanıtı yapıştırmak yaptırımı geri almaz). Lisans kimliği bilinmiyorsa (etkinleştirme)
 * BU anahtara bağlı imzalı kiradan öğrenilip LICENSE_DIR'e yazılır; yanıttaki `kurulumId` yalnız
 * kirayla aynıysa kabul (otorite imzalı kira). Yazım sırası kimlik → durum → HAK → kira (yarım kalan
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
  const lease = coreVerifyLease(resp.kira, roots);
  if (!lease.ok) throw invalidResponse(`Kira doğrulanamadı: ${lease.message}`, lease.code);
  const leaseDoc = lease.value.document;
  if (leaseDoc.kurulumAnahtarKimligi !== ctx.key.kid) throw invalidResponse("Kira bu kurulum anahtarına ait değil.");
  if (resp.kurulumId !== undefined && resp.kurulumId !== leaseDoc.kurulumId) {
    throw invalidResponse("Yanıttaki kurulum kimliği imzalı kirayla uyuşmuyor.");
  }
  if (ctx.licenseId !== null && leaseDoc.kurulumId !== ctx.licenseId) throw invalidResponse("Kira bu kuruluma ait değil.");
  const licenseId = leaseDoc.kurulumId;
  const entitlementJws = resp.hak ?? ctx.store.entitlementJws;
  if (!entitlementJws) throw invalidResponse("Yanıt HAK belgesi taşımıyor ve kurulumda HAK yok.");
  const entitlement = coreVerifyEntitlement(entitlementJws, roots);
  if (!entitlement.ok) throw invalidResponse(`HAK doğrulanamadı: ${entitlement.message}`, entitlement.code);
  if (entitlement.value.document.kurulumId !== licenseId) throw invalidResponse("HAK bu kuruluma ait değil.");
  const binding = coreCheckLeaseBinding(resp.kira, entitlementJws, roots);
  if (!binding.ok) throw invalidResponse(`Kira HAK'a bağlı değil: ${binding.message}`, binding.code);

  const before = getLicenseSnapshot();
  const known = before.lastKnownLease;
  if (known && known.kiraId === leaseDoc.kiraId) {
    // Aynı kira (ağ tekrarı): yeni değil. Silinen ya da eskisiyle değiştirilen dosyalar imzalı yanıttan onarılır.
    if (!getLicenseStore()?.identity) saveLicenseIdentity(licenseId);
    if (resp.hak && resp.hak !== getLicenseStore()?.entitlementJws) saveEntitlement(resp.hak);
    if (before.lease?.document.kiraId !== leaseDoc.kiraId) saveLease(resp.kira);
    setDownloadTokens(resp.indirmeBelirtecleri);
    invalidateLicenseSnapshot();
    return { yeniKira: false, kiraId: leaseDoc.kiraId };
  }
  if (known && isoToMs(leaseDoc.verilis) < known.verilisMs) {
    throw licenseError(409, "LICENSE_LEASE_STALE", "Gelen kira kurulumdakinden eski; yeniden denenemez.");
  }
  const priorSanction = sanctionView(before);
  const firstActivation = ctx.licenseId === null || !before.activated;

  if (getLicenseStore()?.identity?.kurulumId !== licenseId) saveLicenseIdentity(licenseId);
  startAccumulationForLease({ lease: leaseDoc, entitlement: entitlement.value, licenseId });
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
      kodTuru: resp.kodTuru ?? null,
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
  const snap = getLicenseSnapshot();
  const store = getLicenseStore();
  if (!snap.hazir || !store) return { outcome: "HAZIR_DEGIL" };
  if (!getLicenseConfig().vendorUrl) {
    // Etkin bir kurulum adres kaybederse yenileyemez: bu da başarısız yoklamadır.
    if (snap.activated) recordPollOutcome({ ok: false, code: "YAPILANDIRILMAMIS" });
    return { outcome: "YAPILANDIRILMAMIS" };
  }
  if (!snap.activated) return { outcome: "ETKIN_DEGIL" };
  if (store.transfer && store.transfer.durum !== "ONAYLANDI") return pollTransfer(transport);
  if (!snap.licenseId) return { outcome: "ETKIN_DEGIL" };

  let result: VendorResult;
  try {
    // Gövde istek başına kurulur: saat düzeltmeli yeniden denemede öğrenilen sapma da gider.
    result = await vendorPost(ENDPOINTS.POLL, "yokla", () => buildPollBody(), transport);
  } catch (err) {
    recordPollOutcome({ ok: false, code: "GOVDE_KURULAMADI" });
    throw err;
  }
  if (!result.ok) {
    recordPollOutcome({ ok: false, code: result.code });
    return { outcome: "BASARISIZ", code: result.code };
  }
  // Destek (3d-2): yanıtın `destek` alanı + giden kutusu — kira alışverişi kuyruğunun DIŞINDA, yoklamayı düşürmez.
  void syncSupportAfterPoll(result.json, transport);
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
    if (r.lisansAlindi) return { outcome: "BASARILI" };
    // D8: onayda lisans değil tek kullanımlık taşıma kodu doğar (portaldan iletilir) — kodla etkinleşme beklenir.
    const code = r.durum === "REDDEDILDI" ? "TASIMA_REDDEDILDI" : r.durum === "ONAYLANDI" ? "TASIMA_KODU_BEKLENIYOR" : "TASIMA_ONAYI_BEKLIYOR";
    recordPollOutcome({ ok: false, code });
    return { outcome: "BASARISIZ", code };
  } catch (err) {
    const code = err instanceof AppError ? String(err.details?.vendorCode ?? err.details?.code ?? "TASIMA_HATASI") : "TASIMA_HATASI";
    recordPollOutcome({ ok: false, code });
    return { outcome: "BASARISIZ", code };
  }
}

// ── Taşıma turu (API ve bekleyen talebin yoklaması) ─────────────────────────────
/**
 * Taşıma YALNIZ TALEP açar (D8): kimliği bilinmiyorsa kimliksiz imzalanır; satıcı onaylayınca taşıma
 * kodu portaldan gelir ve normal etkinleştirme yolundan kullanılır. Onay yanıtı lisans taşırsa (eski
 * satıcı) doğrulanıp kabul edilir.
 */
export async function sendTransfer(
  gerekce: string | null,
  transport: VendorTransport,
): Promise<{ durum: "BEKLIYOR" | "ONAYLANDI" | "REDDEDILDI"; talepId: string; lisansAlindi: boolean }> {
  const ctx = requireReady();
  requireVendorUrl();
  const body = TransferRequestSchema.parse({
    v: 1,
    kurulumId: ctx.licenseId ?? undefined,
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
  if (t.durum === "ONAYLANDI" && t.lisans) {
    await acceptLicenseResponse(t.lisans, "tasima");
    return { durum: t.durum, talepId: t.talepId, lisansAlindi: true };
  }
  const istendi = getLicenseStore()?.transfer?.istendi ?? msToIso(Date.now());
  if (t.durum === "REDDEDILDI") saveTransfer(null);
  else saveTransfer({ talepId: t.talepId, istendi, gerekce, durum: t.durum });
  return { durum: t.durum, talepId: t.talepId, lisansAlindi: false };
}


/** Test-only. */
export function __resetLicenseSyncForTests(): void {
  doorbellKick = null;
}
