// Lisans EŞİTLEME: DB olguları + parmak izi tazeleme, yoklama gövdesi, satıcı yanıtının
// doğrulanıp KABULÜ ve yoklama/taşıma turu. Yoklama işi ve API servisi bunu çağırır.
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { buildPollHealthSummary } from "../lib/poll-health-summary";
import { INSTALLATION_ID_SETTING_KEY } from "../constants/reserved-settings";
import {
  ENDPOINTS,
  LicenseResponseSchema,
  PollRequestSchema,
  TransferRequestSchema,
  TransferResponseSchema,
  checkLiveResponseBinding,
  isoToMs,
  msToIso,
  type LicenseResponse,
} from "../lib/license/protocol";
import { getLicenseStore, saveLease, saveLicenseIdentity, saveTransfer } from "../lib/license/store";
import { capabilitiesField } from "../lib/license/capabilities";
import { adoptPackageRevocation } from "../lib/license/package-revocation-store";
import { measureFingerprint } from "../lib/license/fingerprint";
import { cacheFromRecordCopy, cacheToRecordCopy } from "../lib/license/fingerprint-cache";
import { setFingerprintCacheCopy, startAccumulationForLease } from "../lib/license/record-writer";
import { __resetSignedSkewForTests, recordSignedSkew, signedSkewSecondsForWire } from "../lib/license/signed-skew";

import { acceptNewEntitlement } from "./license-integrity.service";
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
} from "../lib/license/runtime";
import { evaluateLicenseTransitions, refreshLicenseTrace } from "./license-trail.service";
import { adoptFromRejected, adoptOffered, refreshLicenseRevocation, revocationOffer, type RevocationOffer } from "./license-revocation.service";
import { logLeaseAccepted, sanctionView, verifyResponseDocuments } from "./helpers/license-accept.helper";
import { syncSupportAfterPoll } from "./support-sync.service";
import { updateReportField } from "./update-status.service";
import { systemSettingService } from "./system-setting.service";
import { refreshUpdaterIntentQuietly } from "./update-intent.service";
import { isVerificationMode } from "../lib/dogrulama-kipi";
import {
  buildEnvironment,
  currentFingerprintDigest,
  egressTransport,
  encryptionKeyField,
  installRecordsField,
  invalidResponse,
  liveArrival,
  pollV2Fields,
  licenseError,
  requireReady,
  requireVendorUrl,
  vendorFailureToError,
  vendorPost,
  type ReadyContext,
  type ResponseArrival,
  type VendorResult,
  type VendorTransport,
} from "./helpers/license-wire.helper";

// ── DB olguları + parmak izi ───────────────────────────────────────────────────
/**
 * İlk açılış (dosya silmekle yenilenmez), defterdeki yüksek su ve DB'nin kurulum kimliği (YALNIZ
 * bilgi — lisans kimliği LICENSE_DIR'dedir; DB kopyası onu taşımaz).
 */
export async function refreshLicenseDbFacts(installationId: string): Promise<void> {
  // Lisans izi (G12 DB kopyası) olgularla birlikte okunur: okunamazsa iz BİLİNMİYOR (kayıp sayılmaz).
  await refreshLicenseTrace();
  // İptal belgesinin DB kopyası da (okunur + eksik/düşük kopya onarılır; okunamazsa BİLİNMİYOR).
  await refreshLicenseRevocation();
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

/** Parmak izini ölçer; 24 sa önbelleği dosya ∪ imzalı durum kaydı kopyasından köprüler, sonucu kayda kopyalar (K8). */
export async function refreshLicenseFingerprint(): Promise<void> {
  const store = getLicenseStore();
  if (!store?.key) return;
  const recordCache = cacheFromRecordCopy(getLicenseSnapshot().view.record?.parmakIziOnbellegi);
  const fp = await measureFingerprint(store.key.salt, undefined, { recordCache, persistCache: !isVerificationMode() });
  setFingerprintCacheCopy(cacheToRecordCopy(fp.onbellek));
  setMeasuredFingerprint(fp);
}

function skewSeconds(): number | undefined {
  const ms = getVendorClockSkewMs();
  return ms === null ? undefined : Math.max(-1e9, Math.min(1e9, Math.round(ms / 1000)));
}

/**
 * K10 — açık modül adları (yapılandırma, iş verisi DEĞİL). Okunamazsa ya da liste boşsa alan hiç gitmez: eski satıcı KATI
 * şemayla reddeder (satıcı önce) ve yoklama bu yüzden düşmez.
 */
async function openModulesField(): Promise<{ acikModuller?: string[] }> {
  try {
    const keys = await systemSettingService.getOpenModuleKeys();
    return keys.length > 0 ? { acikModuller: keys } : {};
  } catch {
    return {};
  }
}

/** Yoklama gövdesi — protokolün KATI şemasından geçer (allowlist dışı alan kod yolunda patlar). */
export async function buildPollBody(nowMs: number = Date.now()): Promise<ReturnType<typeof PollRequestSchema.parse>> {
  const snap = getLicenseSnapshot(nowMs);
  const s = snap.state;
  const saticiSapmaSn = skewSeconds();
  const signedSkewSn = signedSkewSecondsForWire();
  return PollRequestSchema.parse({
    v: 1,
    // Zincir ucu: kira dosyası silinmiş/eskisiyle değiştirilmişse durum kaydının bildiği son kabul.
    sonKiraId: snap.lastKnownLease?.kiraId ?? null,
    // `ozet`: HAK metninin bayt özeti — aynı kimlik ve sürümle basılmış yabancı HAK satıcıda ayrılır (G4 §2.2-6).
    hak: snap.entitlement ? { hakId: snap.entitlement.document.hakId, surum: snap.entitlement.document.surum, ozet: snap.entitlement.digest } : null,
    ...encryptionKeyField(),
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
      ...(signedSkewSn === undefined ? {} : { imzaliSapmaSn: signedSkewSn }),
    },
    ortam: buildEnvironment(),
    saglik: await buildPollHealthSummary(),
    gozlem: peekObservationCounters(),
    // Kurulum kaydı yoksa alan hiç gitmez: eski satıcı KATI şemayla tanımadığı anahtarı reddeder.
    ...installRecordsField(),
    // Güncelleyici yoksa ya da rapor şemadan geçmezse alan hiç gitmez (yoklama bu yüzden düşmez).
    ...updateReportField(),
    ...capabilitiesField(),
    ...pollV2Fields(snap),
    // Açık modül adları (K10): okunamazsa alan gitmez; satıcı ÖNCE kabul eder.
    ...(await openModulesField()),
  });
}

// ── Kira kabulü ─────────────────────────────────────────────────────────────────
/** `dosya`: portalın istek gerektirmeyen uzatma dosyası (çevrimdışı yanıtla aynı uç, ayrı ayak izi). */
export type LeaseSource = "yoklama" | "etkinlestirme" | "cevrimdisi" | "aktarma" | "dosya" | "tasima" | "dr-devral" | "donanim";

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
 * G4: kira ve HAK eldeki ile gelen iptal belgesinin yenisiyle doğrulanır; kabulde o belge benimsenir, rette
 * yalnız eldeki kiranın ALT'ına dokunmuyorsa (`adoptFromRejected`). Canlı yanıt, kendi isteğinin nonce'una bağlı
 * olmalıdır (`checkLiveResponseBinding`, 6.3c) — araya girip eski ya da başka bir yanıtı oynatmak RED.
 */
export async function acceptLicenseResponse(
  raw: unknown,
  source: LeaseSource,
  /** Canlı alışveriş (isteğin nonce'uyla) mı, elle taşınan yanıt mı — çağıran söyler; kaynak adı tek başına ayırmaz (`donanim` iki yolda). */
  delivery: ResponseArrival,
  userId: string | null = null,
): Promise<{ yeniKira: boolean; kiraId: string }> {
  const ctx = requireReady();
  const parsed = LicenseResponseSchema.safeParse(raw);
  if (!parsed.success) throw invalidResponse("Lisans yanıtı biçimsiz.");
  // Kök imzalı PAKET iptal listesi kiradan bağımsızdır: doğrulanır ve daha yeniyse sessizce benimsenir.
  adoptPackageRevocation(parsed.data.paketIptal);
  const offer = revocationOffer(parsed.data.iptal);
  try {
    return acceptVerifiedResponse(parsed.data, ctx, offer, { source, userId, delivery });
  } catch (err) {
    adoptFromRejected(offer, source);
    throw err;
  }
}

function acceptVerifiedResponse(
  resp: LicenseResponse,
  ctx: ReadyContext,
  offer: RevocationOffer,
  g: { readonly source: LeaseSource; readonly userId: string | null; readonly delivery: ResponseArrival },
): { yeniKira: boolean; kiraId: string } {
  const { lease, entitlement, licenseId } = verifyResponseDocuments(resp, ctx, offer.picked?.jws ?? null);
  const leaseDoc = lease.document;
  if (g.delivery !== "TASINMIS") {
    const bound = checkLiveResponseBinding(getLicenseConfig().roots, {
      lease: leaseDoc,
      leaseToken: resp.kira,
      binding: resp.yanitBagi,
      nonce: g.delivery.nonce,
      sinif: entitlement.document.sinif,
      revocation: offer.picked?.view ?? null,
    });
    if (!bound.ok) throw invalidResponse(`Yanıt bu isteğe bağlı değil: ${bound.message}`, bound.code);
  }
  const who = { source: g.source, userId: g.userId, arrival: g.delivery === "TASINMIS" ? ("TASINMIS" as const) : ("CANLI" as const) };
  const before = getLicenseSnapshot();
  const known = before.lastKnownLease;
  if (known && known.kiraId === leaseDoc.kiraId) {
    // Aynı kira (ağ tekrarı): yeni değil. Silinen ya da eskisiyle değiştirilen dosyalar imzalı yanıttan onarılır.
    adoptOffered(offer, who.source);
    if (!getLicenseStore()?.identity) saveLicenseIdentity(licenseId);
    if (resp.hak && resp.hak !== getLicenseStore()?.entitlementJws) acceptNewEntitlement(resp.hak);
    if (before.lease?.document.kiraId !== leaseDoc.kiraId) saveLease(resp.kira);
    setDownloadTokens(resp.indirmeBelirtecleri);
    invalidateLicenseSnapshot();
    refreshUpdaterIntentQuietly(); // yeni belirteç güncelleyicinin niyetine (§5.1)
    return { yeniKira: false, kiraId: leaseDoc.kiraId };
  }
  if (known && isoToMs(leaseDoc.verilis) < known.verilisMs) {
    throw licenseError(409, "LICENSE_LEASE_STALE", "Gelen kira kurulumdakinden eski; yeniden denenemez.");
  }
  const priorSanction = sanctionView(before);
  const firstActivation = ctx.licenseId === null || !before.activated;

  adoptOffered(offer, who.source);
  if (getLicenseStore()?.identity?.kurulumId !== licenseId) saveLicenseIdentity(licenseId);
  startAccumulationForLease({ lease: leaseDoc, entitlement, licenseId, iptalSira: offer.picked?.view.document.sira ?? null, arrival: who.arrival });
  if (resp.hak && resp.hak !== ctx.store.entitlementJws) acceptNewEntitlement(resp.hak);
  saveLease(resp.kira);
  // Yalnız canlı yeni kira ölçer: taşınmış kiranın (dosya/QR) imzalı saati geçmiştedir, sapma sayılmaz.
  if (who.arrival === "CANLI") recordSignedSkew(isoToMs(leaseDoc.sunucuSaati));
  setDownloadTokens(resp.indirmeBelirtecleri);
  if (getLicenseStore()?.transfer) saveTransfer(null);
  recordPollOutcome({ ok: true });
  invalidateLicenseSnapshot();
  refreshUpdaterIntentQuietly();
  logLeaseAccepted({ resp, leaseDoc, ...who, firstActivation, priorSanction });
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
  if (!snap.imzaHazir || !store) return { outcome: "HAZIR_DEGIL" };
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
    const accepted = await acceptLicenseResponse(result.json, "yoklama", liveArrival(result));
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
    await acceptLicenseResponse(t.lisans, "tasima", liveArrival(r));
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
  __resetSignedSkewForTests();
}
