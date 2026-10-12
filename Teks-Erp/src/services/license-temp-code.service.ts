// YAZARAK ETKİNLEŞTİRME servis yüzü: istek kodu, geçici açılış kodunun kabulü, tam etkinleştirmede kapanış ve satıcıya
// tüketim bildirimi (kuyruk). Ayak izinde düz kod YOKTUR — yalnız son 4 karakter ve bitiş.
import { DAY_MS, ENDPOINTS, TempConsumedRequestSchema, TempConsumedResponseSchema, msToIso } from "../lib/license/protocol";
import { getLicenseConfig, getLicenseSnapshot, invalidateLicenseSnapshot } from "../lib/license/runtime";
import { getLicenseStore } from "../lib/license/store";
import {
  checkTempCode,
  currentTempRequest,
  markTempConsumedNotified,
  pendingTempConsumed,
  renewTempRequest,
  storeTempOpening,
  type TempCodeReason,
} from "../lib/license/temp-opening";
import { egressTransport, licenseError, vendorPost, type VendorTransport } from "./helpers/license-wire.helper";
import { adminAction } from "./license-trail.service";

const REJECTION_TEXT: Readonly<Record<TempCodeReason, string>> = {
  BICIM: "Kod eksik ya da fazla: 23 grup × 5 karakter olmalı.",
  KARAKTER: "Kodda geçersiz bir karakter var.",
  SAGLAMA: "Kod yanlış yazılmış (sağlama tutmuyor); grupları yeniden kontrol edin.",
  SURUM: "Kod bu program sürümünce tanınmıyor.",
  IMZACI: "Kodu imzalayan anahtar tanınmıyor.",
  IMZA: "Kod doğrulanamadı: bu kurulumun ekrandaki istek koduna verilmemiş ya da yanlış yazılmış.",
  SURESI_GECMIS: "Kodun süresi geçmiş; yeni kod isteyin.",
  TEKRAR: "Bu kod daha önce kullanıldı; her kod yalnız bir kez kullanılır.",
};

export interface TempRequestView {
  readonly istekKodu: string;
  readonly olusturuldu: string;
  readonly gecici: { readonly bitis: string; readonly kalanGun: number; readonly kodSonu: string } | null;
}

function requireUsableStore(): void {
  const s = getLicenseStore();
  if (!s || s.problem || !s.key) throw licenseError(409, "LICENSE_STORE_UNAVAILABLE", "Lisans deposu kullanılamıyor.");
}

function requireNotActivated(): void {
  if (getLicenseSnapshot().activated) throw licenseError(409, "LICENSE_ALREADY_ACTIVE", "Kurulum zaten etkin; geçici açılış kodu gerekmez.");
}

function tempView(nowMs: number): TempRequestView["gecici"] {
  const t = getLicenseSnapshot(nowMs).gecici;
  if (!t) return null;
  return { bitis: msToIso(t.endMs), kalanGun: Math.max(0, Math.ceil((t.endMs - nowMs) / DAY_MS)), kodSonu: t.last4 };
}

/** Ekrandaki istek kodu (TI-…): tüketilene ya da yenilenene dek aynı kalır. */
export function getTempRequest(nowMs: number = Date.now()): TempRequestView {
  requireUsableStore();
  requireNotActivated();
  const r = currentTempRequest(nowMs);
  if (!r) throw licenseError(409, "LICENSE_STORE_UNAVAILABLE", "Lisans deposu kullanılamıyor.");
  return { istekKodu: r.gosterim, olusturuldu: r.olusturuldu, gecici: tempView(nowMs) };
}

export function renewTempRequestCode(userId: string | null, nowMs: number = Date.now()): TempRequestView {
  requireUsableStore();
  requireNotActivated();
  renewTempRequest(nowMs);
  adminAction(userId, "gecici-istek-yenile");
  return getTempRequest(nowMs);
}

/** Kodu doğrular ve kabul eder; ret 400 `TEMP_CODE_INVALID` (`neden`, KARAKTER'de `konum`). Etkin kurulumda 409. */
export function acceptTempCode(raw: string, userId: string | null, nowMs: number = Date.now()): TempRequestView {
  requireUsableStore();
  requireNotActivated();
  // Süre güvenilir saatten: saati geri almak süresi geçmiş kodu canlandırmaz.
  const trustedMs = Math.max(nowMs, getLicenseSnapshot(nowMs).state.saat.trustedMs);
  const c = checkTempCode(raw, { roots: getLicenseConfig().roots, nowMs: trustedMs });
  if (!c.ok) {
    adminAction(userId, "gecici-kod", { sonuc: c.neden });
    const where = c.konum === undefined ? "" : ` (${Math.floor(c.konum / 5) + 1}. grup, ${(c.konum % 5) + 1}. karakter)`;
    throw licenseError(400, "TEMP_CODE_INVALID", `${REJECTION_TEXT[c.neden]}${where}`, {
      neden: c.neden,
      ...(c.konum === undefined ? {} : { konum: c.konum }),
    });
  }
  storeTempOpening(c.value, nowMs);
  invalidateLicenseSnapshot();
  adminAction(userId, "gecici-kod", { sonuc: "kabul", kodSonu: c.value.last4, bitis: msToIso(c.value.endMs) });
  void flushTempConsumption().catch(() => undefined);
  return getTempRequest(nowMs);
}

let flushing: Promise<number> | null = null;

/** Bildirilmemiş tüketimleri satıcıya iletir (imzalı, idempotent); düşerse kuyrukta kalır, saatlik bakım yeniden dener. */
export function flushTempConsumption(transport: VendorTransport = egressTransport): Promise<number> {
  flushing ??= sendPending(transport).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function sendPending(transport: VendorTransport): Promise<number> {
  const key = getLicenseStore()?.key;
  const pending = pendingTempConsumed();
  if (pending.length === 0 || !key || !getLicenseConfig().vendorUrl || !getLicenseSnapshot().imzaHazir) return 0;
  const body = TempConsumedRequestSchema.parse({ v: 1, acikAnahtar: key.x, ozetler: pending });
  const r = await vendorPost(ENDPOINTS.TEMP_CODE_CONSUMED, "gecici-tuketim", body, transport);
  if (!r.ok || !TempConsumedResponseSchema.safeParse(r.json).success) return 0;
  markTempConsumedNotified(pending);
  return pending.length;
}
