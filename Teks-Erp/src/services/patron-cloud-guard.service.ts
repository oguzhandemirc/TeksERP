// =============================================================================
// Patron bulutu FABRİKA SEDDİ (G1) — buluttan gelen yazma ve rapor isteğine fabrika tarafı sınır
// =============================================================================
// Bulut ele geçerse bulutun kendi tavanı işe yaramaz; sınır fabrikada ölçülür:
//   · gelen kutusu anahtarı (`patronBulut.gelenKutusuEnabled`, varsayılan AÇIK = bugünkü davranış)
//   · gelen kutusu kayan pencere tavanı: son 60 dk / 24 sa MAKBUZ sayısı (makbuz = bulutun fabrikaya yaptırdığı iş,
//     ISLENDI + REDDEDILDI); aşımda `al` çağrılmaz, mesaj bulutta BEKLIYOR kalır (veri kaybı yok)
//   · rapor isteği saatlik tavanı (sayaç `cloud-sync/report-gate.ts`, süreç belleğinde)
// Ayarların TEK yazarı `updatePatronCloudGuardSettings` (`PUT /api/patron-bulut/ayarlar`, ayar şifreli).
// =============================================================================
import type { CloudInboxKind, CloudInboxOutcome } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { SETTING_KEYS, systemSettingService } from "./system-setting.service";

type SettingClient = Pick<typeof prisma, "systemSetting">;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Varsayılanlar — gerekçe arşiv notu "G1 fabrika seddi" (tahmini hacim haftada ~5; tavan yalnız geciktirir). */
export const INBOX_HOURLY_MAX_DEFAULT = 60;
export const INBOX_DAILY_MAX_DEFAULT = 300;
export const REPORT_HOURLY_MAX_DEFAULT = 60;
/** Panelin yazabileceği aralık — 0 kabul edilmez (durdurmanın yolu anahtardır). */
export const INBOX_MAX_RANGE = { min: 1, max: 10_000 } as const;
export const REPORT_MAX_RANGE = { min: 1, max: 1_000 } as const;

export const GUARD_SETTING_KEYS = [
  SETTING_KEYS.PATRON_BULUT_INBOX_ENABLED,
  SETTING_KEYS.PATRON_BULUT_INBOX_HOURLY_MAX,
  SETTING_KEYS.PATRON_BULUT_INBOX_DAILY_MAX,
  SETTING_KEYS.PATRON_BULUT_REPORT_HOURLY_MAX,
] as const;

export interface PatronCloudGuardSettings {
  readonly gelenKutusuAcik: boolean;
  readonly saatlikTavan: number;
  readonly gunlukTavan: number;
  readonly raporSaatlikTavan: number;
}

function intInRange(v: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= range.min && n <= range.max ? n : fallback;
}

/** Kayıt yok/çöp → varsayılan; anahtar yalnız açık `false` ile kapanır (bugünkü davranış açık). */
export async function readPatronCloudGuardSettings(client: SettingClient = prisma): Promise<PatronCloudGuardSettings> {
  const rows = await client.systemSetting.findMany({ where: { key: { in: [...GUARD_SETTING_KEYS] } }, select: { key: true, value: true } });
  const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
  const enabled = byKey.get(SETTING_KEYS.PATRON_BULUT_INBOX_ENABLED);
  return {
    gelenKutusuAcik: !(enabled === false || enabled === "false"),
    saatlikTavan: intInRange(byKey.get(SETTING_KEYS.PATRON_BULUT_INBOX_HOURLY_MAX), INBOX_MAX_RANGE, INBOX_HOURLY_MAX_DEFAULT),
    gunlukTavan: intInRange(byKey.get(SETTING_KEYS.PATRON_BULUT_INBOX_DAILY_MAX), INBOX_MAX_RANGE, INBOX_DAILY_MAX_DEFAULT),
    raporSaatlikTavan: intInRange(byKey.get(SETTING_KEYS.PATRON_BULUT_REPORT_HOURLY_MAX), REPORT_MAX_RANGE, REPORT_HOURLY_MAX_DEFAULT),
  };
}

export type PatronCloudGuardInput = Partial<PatronCloudGuardSettings>;

function assertRange(label: string, v: number | undefined, range: { min: number; max: number }): void {
  if (v === undefined) return;
  if (!Number.isInteger(v) || v < range.min || v > range.max) {
    throw AppError.badRequest(`${label} ${range.min} ile ${range.max} arasında tam sayı olmalı.`, { code: "PATRON_BULUT_AYAR_GECERSIZ" });
  }
}

/** Tek yazar: doğrular, değişen anahtarları `systemSettingService.set` ile yazar (audit orada). */
export async function updatePatronCloudGuardSettings(input: PatronCloudGuardInput, userId: string | undefined): Promise<PatronCloudGuardSettings> {
  assertRange("Saatlik tavan", input.saatlikTavan, INBOX_MAX_RANGE);
  assertRange("Günlük tavan", input.gunlukTavan, INBOX_MAX_RANGE);
  assertRange("Saatlik rapor tavanı", input.raporSaatlikTavan, REPORT_MAX_RANGE);
  if (input.gelenKutusuAcik !== undefined && typeof input.gelenKutusuAcik !== "boolean") {
    throw AppError.badRequest("Gelen kutusu anahtarı açık ya da kapalı olmalı.", { code: "PATRON_BULUT_AYAR_GECERSIZ" });
  }
  if (input.gelenKutusuAcik !== undefined) {
    await systemSettingService.set(SETTING_KEYS.PATRON_BULUT_INBOX_ENABLED, input.gelenKutusuAcik, "Yönetim bulutundan sipariş/cari yazma (kapalıyken gelen kutusu çekilmez)", userId);
  }
  if (input.saatlikTavan !== undefined) {
    await systemSettingService.set(SETTING_KEYS.PATRON_BULUT_INBOX_HOURLY_MAX, input.saatlikTavan, "Yönetim bulutundan son 60 dakikada en çok işlenecek kayıt", userId);
  }
  if (input.gunlukTavan !== undefined) {
    await systemSettingService.set(SETTING_KEYS.PATRON_BULUT_INBOX_DAILY_MAX, input.gunlukTavan, "Yönetim bulutundan son 24 saatte en çok işlenecek kayıt", userId);
  }
  if (input.raporSaatlikTavan !== undefined) {
    await systemSettingService.set(SETTING_KEYS.PATRON_BULUT_REPORT_HOURLY_MAX, input.raporSaatlikTavan, "Yönetim bulutundan son 60 dakikada en çok hesaplanacak rapor", userId);
  }
  return readPatronCloudGuardSettings();
}

export type InboxQuotaBlock = "SAATLIK" | "GUNLUK";

export interface InboxQuota {
  readonly saatlik: { readonly sayi: number; readonly tavan: number };
  readonly gunluk: { readonly sayi: number; readonly tavan: number };
  /** Bu tur en çok kaç mesaj istenebilir (0 = `al` çağrılmaz). */
  readonly kalan: number;
  readonly dolu: InboxQuotaBlock | null;
}

/** Kayan pencere: son 60 dk ve son 24 sa makbuz sayısı. Gelen kutusu işi tek süreçte tek tur koşar → yarış yok. */
export async function measureInboxQuota(settings: PatronCloudGuardSettings, nowMs: number = Date.now()): Promise<InboxQuota> {
  const hour = await prisma.cloudInboxReceipt.count({ where: { createdAt: { gte: new Date(nowMs - HOUR_MS) } } });
  const day = await prisma.cloudInboxReceipt.count({ where: { createdAt: { gte: new Date(nowMs - DAY_MS) } } });
  const hourLeft = Math.max(0, settings.saatlikTavan - hour);
  const dayLeft = Math.max(0, settings.gunlukTavan - day);
  return {
    saatlik: { sayi: hour, tavan: settings.saatlikTavan },
    gunluk: { sayi: day, tavan: settings.gunlukTavan },
    kalan: Math.min(hourLeft, dayLeft),
    dolu: dayLeft === 0 ? "GUNLUK" : hourLeft === 0 ? "SAATLIK" : null,
  };
}

export interface InboxReceiptRow {
  readonly id: string;
  readonly at: string;
  readonly tur: CloudInboxKind;
  readonly sonuc: CloudInboxOutcome;
  readonly hesapAdi: string;
  readonly belgeNo: string | null;
  readonly varlikId: string | null;
  readonly kod: string | null;
  readonly mesaj: string | null;
}

export const RECENT_RECEIPTS_LIMIT = 50;

/** Panelin "buluttan gelenler" listesi — salt okunur makbuz okuması (en yeni önce, eşitlik bozucu id). */
export async function listRecentInboxReceipts(limit: number = RECENT_RECEIPTS_LIMIT): Promise<InboxReceiptRow[]> {
  const rows = await prisma.cloudInboxReceipt.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: { id: true, createdAt: true, kind: true, outcome: true, cloudAccountName: true, entityId: true, result: true },
  });
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return rows.map((r) => {
    const res = (r.result ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      tur: r.kind,
      sonuc: r.outcome,
      hesapAdi: r.cloudAccountName,
      belgeNo: str(res.belgeNo),
      varlikId: r.entityId,
      kod: str(res.kod),
      mesaj: str(res.mesaj),
    };
  });
}
