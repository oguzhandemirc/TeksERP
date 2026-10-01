// ÖDENMİŞ TARİH (P) — TEK KAYNAK (lisans v2 §1.1, K5): kiranın `odenmisTarih` alanı, portal görünümü ve bildirim
// taraması P'yi YALNIZ buradan alır (bekçi `test_odenmis_tarih`). P = sözleşme sonu (HAK geçerlilik bitişi) ile aktif
// taksit planındaki sıradaki ÖDENMEMİŞ kalemin vadesinin erkeni; ikisi de yoksa süresiz (null). P ödeme onayında
// kendiliğinden ilerler: kalem ODENDI olunca sıradaki vade P olur ve sonraki kira onu taşır.
import type { Hak, Kurulum, TaksitKalemDurumu } from "@prisma/client";
import { DAY_MS, hasCapability, parseJws, type LicenseCapability } from "../lisans-protokol";
import type { Db } from "../lib/prisma";

/** P'nin kaynağı: sözleşme sonu (peşin · vadeli · demo) · taksit vadesi · süresiz (kalıcı, ödemesi tamam). */
export type PaidThroughKind = "SOZLESME_SONU" | "TAKSIT" | "SURESIZ";

export interface PaidThrough {
  readonly tarih: Date | null;
  readonly tur: PaidThroughKind;
}

/** Ödenmemiş kalem durumları — GECIKTI da ödenmemiştir (P geçmişte kalır, fabrikada merdiven işler). */
export const UNPAID_INSTALLMENT_STATES: readonly TaksitKalemDurumu[] = ["BEKLIYOR", "GECIKTI"];

export interface InstallmentPlanLike {
  readonly aktif: boolean;
  readonly kalemler: readonly { readonly vade: Date; readonly durum: TaksitKalemDurumu }[];
}

/** SAF formül: `odenmisTarihi(hak, aktifTaksitPlanlari)`. Eşit tarihte sözleşme sonu kazanır (fabrikada P = gecerlilikBitis). */
export function odenmisTarihi(hak: Pick<Hak, "gecerlilikBitis">, plans: readonly InstallmentPlanLike[]): PaidThrough {
  let next: Date | null = null;
  for (const plan of plans) {
    if (!plan.aktif) continue;
    for (const item of plan.kalemler) {
      if (UNPAID_INSTALLMENT_STATES.includes(item.durum) && (next === null || item.vade.getTime() < next.getTime())) next = item.vade;
    }
  }
  const contractEnd = hak.gecerlilikBitis;
  if (next && (contractEnd === null || next.getTime() < contractEnd.getTime())) return { tarih: next, tur: "TAKSIT" };
  if (contractEnd) return { tarih: contractEnd, tur: "SOZLESME_SONU" };
  return { tarih: null, tur: "SURESIZ" };
}

/** Kurulumun P'si (kilit altında çağrılırsa taze): aktif planların en erken ödenmemiş kalemi + HAK geçerlilik bitişi. */
export async function paidThroughOf(db: Db, installationDbId: string, hak: Pick<Hak, "gecerlilikBitis">): Promise<PaidThrough> {
  const plans = await db.taksitPlani.findMany({
    where: { kurulumId: installationDbId, aktif: true },
    select: {
      aktif: true,
      kalemler: {
        where: { durum: { in: [...UNPAID_INSTALLMENT_STATES] } },
        select: { vade: true, durum: true },
        orderBy: [{ vade: "asc" }, { sira: "asc" }],
        take: 1,
      },
    },
  });
  return odenmisTarihi(hak, plans);
}

// ---------------------------------------------------------------- P modelinin geçerliliği ve bilgi bandı (tahmin)

/** Fabrikanın P modelini işletmesi için kira `odenmisTarih`, HAK `cevrimdisiUfukGun` taşımalı ve kurulum bunu bildirmeli. */
export const PAID_THROUGH_CAPABILITY: LicenseCapability = "odenmis-tarih";

function payloadHas(token: string, key: string): boolean {
  const parsed = parseJws(token);
  return parsed.ok && typeof parsed.value.payload === "object" && parsed.value.payload !== null && key in parsed.value.payload;
}

/** Kendi DB'mizdeki belgeler (imza yeniden doğrulanmaz): ikisi de alanı taşıyor ve kurulum yeteneği bildirdi mi. */
export function paidThroughModelActive(g: {
  readonly capabilities: readonly string[];
  readonly entitlementToken: string | null;
  readonly leaseToken: string | null;
}): boolean {
  if (!hasCapability(g.capabilities, PAID_THROUGH_CAPABILITY)) return false;
  if (!g.entitlementToken || !g.leaseToken) return false;
  return payloadHas(g.entitlementToken, "cevrimdisiUfukGun") && payloadHas(g.leaseToken, "odenmisTarih");
}

/** P − bu kadar gün: bilgi bandı (`ODEME_YAKLASIYOR`) penceresi — §1.3. */
export const REMINDER_WINDOW_DAYS = 30;
/** K1: son başarılı alışveriş bundan eskiyse kurulum "internetsiz" sayılır ve bant görünür. */
export const OFFLINE_AFTER_DAYS = 7;
/** §1.2 "internet VAR": son kabul edilen kira bundan yeni. */
export const ONLINE_WINDOW_MS = 24 * 3_600_000;

/**
 * Portal TAHMİNİ (karar fabrikadadır): P − 30 g ≤ şimdi < P ve (internetsiz ya da P sözleşme sonu) ise fabrika bandı
 * gösterir (K1). Satıcı yalnız kendi kayıtlarını görür; dosyayla yüklenen kirayı bilmez → tahmin bandı fazla gösterir.
 */
export function reminderBandVisible(p: PaidThrough, lastExchangeMs: number | null, nowMs: number): boolean {
  if (!p.tarih) return false;
  const due = p.tarih.getTime();
  if (nowMs < due - REMINDER_WINDOW_DAYS * DAY_MS || nowMs >= due) return false;
  const offline = lastExchangeMs === null || nowMs - lastExchangeMs > OFFLINE_AFTER_DAYS * DAY_MS;
  return offline || p.tur === "SOZLESME_SONU";
}

/**
 * Son başarılı kira alışverişi (K3'ün ikinci anahtarının satıcı tarafı): GÜNCEL anahtara istekle verilmiş son kira.
 * Kapanış kirası (eşleşmeyen tarafa) ve uzatma dosyası (istek yok; yüklendiği bilinmez) sayılmaz.
 */
export async function lastExchangeAt(db: Db, installation: Pick<Kurulum, "id" | "anahtarKimligi">): Promise<Date | null> {
  if (!installation.anahtarKimligi) return null;
  const row = await db.kira.findFirst({
    where: { kurulumId: installation.id, anahtarKimligi: installation.anahtarKimligi, karar: { notIn: ["KAPANIS", "DOSYA"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}
