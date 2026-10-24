// =============================================================================
// Akış etiketi (top · kartela · çuval) KOPYA ADEDİ — TEK ÇÖZÜCÜ (2026-10-24)
// =============================================================================
// Soru: "bu baskıda kaç etiket çıkar?" Cevabın tek yeri burası; `label.service`
// akış yolları (tekil/toplu top, kartela, çuval) `resolveFlowLabelCopies`ten
// geçer, `readLabelCopies`i doğrudan çağırmaz (bekçi `test_label_copies_source`).
//
//   GLOBAL  → BUGÜNKÜ API davranışı AYNEN: istek varsa sessizce 1..LABEL_COPIES_MAX'a
//             kırpılır (eski `clampRollCopies`), yoksa/biçimsizse genel adet (`label.copies`).
//   STATION → istek varsa 1..LABEL_COPIES_MAX (dışı 400 `LABEL_COPIES_RANGE`,
//             kırpma yok — fail-closed); yoksa istasyon varsayılanı
//             (`Station.defaultLabelCopies`, aktif çalışma oturumundan), o da
//             yoksa genel adet.
//
// KAPSAM DIŞI (bilinçli): tezgah/levent toplu basımı (1–200, `resolveBatchCopies`)
// ve serbest/stüdyo şablon baskısı (1–100) — orada adet her zaman operatörün
// aksiyon anındaki seçimidir; `label.copies` onları bugün de yönetmiyor.
// =============================================================================

import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import {
  LABEL_COPIES_MAX,
  readLabelCopies,
  readLabelCopiesSource,
  type LabelCopiesSource,
} from "../system-setting.service";

export interface LabelCopiesInput {
  mode: LabelCopiesSource;
  /** Genel adet (`readLabelCopies` — zaten 1..MAX'a kırpılmış). */
  globalCount: number;
  /** İstasyonun varsayılanı; null/undefined = tanımsız ya da istasyon bilinmiyor. */
  stationDefault?: number | null;
  /** İstemcinin istediği adet; undefined = istemedi. NaN = biçimsiz istek (STATION'da 400). */
  requested?: number;
}

function isValidCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= LABEL_COPIES_MAX;
}

function rangeError(): AppError {
  return AppError.badRequest(`Etiket adedi 1 ile ${LABEL_COPIES_MAX} arasında bir tam sayı olmalı.`, {
    code: "LABEL_COPIES_RANGE",
    min: 1,
    max: LABEL_COPIES_MAX,
  });
}

/** Bugünkü (GLOBAL) kırpma — eski `clampRollCopies` birebir: 0 → 1, 10 → MAX, 2.7 → 2. */
function clampLegacy(n: number): number {
  return Math.max(1, Math.min(LABEL_COPIES_MAX, Math.floor(n) || 1));
}

/** Saf çözücü — DB'siz; dört durum + sınır dışı 400 birim testinde ölçülür. */
export function resolveLabelCopies({ mode, globalCount, stationDefault, requested }: LabelCopiesInput): number {
  if (mode !== "STATION") {
    // Eski controller biçimsiz `?copies=`i undefined sayardı → NaN da genel adete düşer.
    return requested === undefined || Number.isNaN(requested) ? globalCount : clampLegacy(requested);
  }
  if (requested !== undefined) {
    if (!isValidCount(requested)) throw rangeError();
    return requested;
  }
  return isValidCount(stationDefault) ? stationDefault : globalCount;
}

/**
 * `?copies=` sorgu değerini çözücü girdisine çevirir: yok → undefined; tam sayı
 * metni → sayı; başka her şey → NaN (STATION modunda 400 olur, GLOBAL'de genel adet — eski davranış).
 */
export function parseCopiesQuery(raw: unknown): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string" && /^\d+$/.test(raw)) return parseInt(raw, 10);
  return Number.NaN;
}

/** Cihazın AÇIK çalışma oturumunun istasyon varsayılanı (oturum yok → null). */
async function readStationDefaultForDevice(deviceId: string | null | undefined): Promise<number | null> {
  if (!deviceId) return null;
  const session = await prisma.workSession.findFirst({
    where: { deviceId, endedAt: null },
    select: { station: { select: { defaultLabelCopies: true } } },
  });
  return session?.station.defaultLabelCopies ?? null;
}

/** Akış etiketi baskısının adedi — label.service akış yollarının TEK girişi. */
export async function resolveFlowLabelCopies(opts: {
  requested?: number;
  deviceId?: string | null;
}): Promise<number> {
  const [mode, globalCount] = [await readLabelCopiesSource(), await readLabelCopies()];
  if (mode !== "STATION") return resolveLabelCopies({ mode, globalCount, requested: opts.requested });
  const stationDefault = opts.requested === undefined ? await readStationDefaultForDevice(opts.deviceId) : null;
  return resolveLabelCopies({ mode, globalCount, stationDefault, requested: opts.requested });
}

/**
 * İstasyon yazma yolunun (BaseController — Zod'suz) doğrulaması: `defaultLabelCopies`
 * gönderildiyse null ("" → null) ya da 1..MAX tam sayı; değilse 400. DB CHECK son kapı.
 */
export function assertStationDefaultLabelCopies(data: Record<string, unknown>): void {
  if (!Object.prototype.hasOwnProperty.call(data, "defaultLabelCopies")) return;
  const v = data.defaultLabelCopies;
  if (v === null || v === "") {
    data.defaultLabelCopies = null;
    return;
  }
  if (!isValidCount(v)) {
    throw AppError.badRequest(
      `İstasyonun varsayılan etiket adedi 1 ile ${LABEL_COPIES_MAX} arasında bir tam sayı olmalı (boş = genel adet).`,
      { code: "LABEL_COPIES_RANGE", min: 1, max: LABEL_COPIES_MAX },
    );
  }
}
