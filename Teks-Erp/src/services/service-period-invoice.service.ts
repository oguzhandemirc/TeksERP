// =============================================================================
// DÖNEM SONU HİZMET FATURASI (Gülkesim dalga 2 · H8, karar belgesi §5 "Dönem sonu", §4 trigger)
// =============================================================================
// Soru: "bu cariye bu ay sevk ettiğimiz emanet toplara yaptığımız, henüz faturalanmamış işler" → TEK taslak.
// Toplayıcı ve kilit sırası H7'nindir (`collectPeriodServiceBilling` → `collectServiceBillingDraft`;
// fatura tx'i `invoiceService.createDraft`): aktif bağı olan iş düşer, yarışı kısmi unique + 8023 kilitleri
// kapatır (aynı iş iki yoldan → 409 SERVICE_ALREADY_BILLED). Taslak `shipmentId` taşımaz. K3b: fasondan doğrudan
// sevkler (DSK) de dönemin sevkleridir.
// =============================================================================
import { Currency, InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import type { ApiResponse } from "../types/api.types";
import { factoryDayEndOfKey, factoryDayStartOfKey, factoryYmd } from "../constants/time";
import { collectPeriodServiceBilling, resolveCustomerServiceBillingTrigger } from "./helpers/service-billing.helper";
import { alreadyBilled } from "./helpers/service-billing-gate.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { formatDayKeyTr, periodDayKey } from "./helpers/period-guard.helper";
import { loadServiceBillingSettings, readFinanceDefaultVatRate } from "./system-setting.service";
import { invoiceService } from "./invoice.service";
import { settingScreenPath } from "../constants/panel-ayar-yolu";

export const SERVICE_PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ServicePeriodInput {
  cariId: string;
  /** `YYYY-MM` — sınırlar fabrika gününden (`constants/time.ts`). */
  period: string;
}

export interface ServicePeriodPreview {
  cariId: string;
  cariName: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  currency: Currency;
  shipmentCount: number;
  shipmentNos: string[];
  workCount: number;
  alreadyBilledWorkCount: number;
  totalMeters: string;
  lines: Array<{ itemId: string; description: string; qty: string; unit: string; unitPrice: string; amount: string }>;
  subtotal: string;
  periodClosed: string | null;
  warnings: string[];
}

/** Dönem → fabrika günü sınırları. Bozuk biçim 400; başlamamış dönem 400; taslak tarihi = min(şimdi, dönem sonu). */
function resolvePeriodBounds(period: string, now = new Date()): { from: Date; to: Date; issueDate: Date } {
  if (!SERVICE_PERIOD_PATTERN.test(period)) {
    throw AppError.badRequest("Dönem YYYY-AA biçiminde olmalı (ör. 2026-10).", { code: "SERVICE_PERIOD_INVALID" });
  }
  const [y, m] = period.split("-").map(Number);
  // Takvim ayının gün sayısı — saat dilimi yok, salt takvim (ayın 0. günü = önceki ayın sonu).
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  const from = factoryDayStartOfKey(`${period}-01`);
  const to = factoryDayEndOfKey(`${period}-${String(lastDay).padStart(2, "0")}`);
  if (from.getTime() > now.getTime()) {
    throw AppError.badRequest("Bu dönem henüz başlamadı.", { code: "SERVICE_PERIOD_FUTURE" });
  }
  return { from, to, issueDate: to.getTime() < now.getTime() ? to : now };
}

async function loadCustomerCari(cariId: string): Promise<{ id: string; name: string; customerId: string; currency: Currency }> {
  const cari = await prisma.cariAccount.findUnique({
    where: { id: cariId },
    select: { id: true, customerId: true, defaultCurrency: true, customer: { select: { name: true } } },
  });
  if (!cari) throw AppError.notFound("Cari hesap bulunamadı.");
  if (!cari.customerId) {
    throw AppError.badRequest("Dönem sonu hizmet faturası yalnız müşteri carisine kesilir.", { code: "SERVICE_PERIOD_NOT_CUSTOMER" });
  }
  return { id: cari.id, name: cari.customer?.name ?? "", customerId: cari.customerId, currency: (cari.defaultCurrency ?? Currency.TRY) as Currency };
}

/** Taslak tarihini kapsayan aktif cari dönem kapanışı (yoksa null) — kapalı döneme taslak doğmaz. */
async function findClosedPeriod(cariId: string, currency: Currency, issueDate: Date): Promise<Date | null> {
  const closed = await prisma.cariPeriodClose.findFirst({
    where: { cariId, currency, reopenedAt: null, periodEnd: { gte: periodDayKey(issueDate) } },
    orderBy: { periodEnd: "asc" },
    select: { periodEnd: true },
  });
  return closed?.periodEnd ?? null;
}

/** "Her sevkte" seçili müşteride dönem önizlemesinin uyarısı (bekçi metni buradan okur). */
export const CUSTOMER_PER_SHIPMENT_PERIOD_WARNING =
  'Bu carinin hizmet faturası "Her sevkte" seçili — taslak yalnız sevk faturasına girmemiş (faturasız kalmış) işleri toplar.';

async function buildPeriodDraft(input: ServicePeriodInput) {
  const settings = await loadServiceBillingSettings();
  if (!settings.enabled) {
    throw AppError.conflict(`Hizmet faturası kapalı — ${settingScreenPath("finance")} ekranından açın.`, { code: "SERVICE_BILLING_DISABLED" });
  }
  const cari = await loadCustomerCari(input.cariId);
  // H8b: "Her sevkte" seçili müşteride de dönem ucu açık — tetik sonradan değiştiyse faturasız kalan işi toplayan tek yol
  // budur; sevkte faturalanmış iş billedKeys + kısmi unique ile zaten düşer (çift fatura yok). Önizleme yalnız uyarır.
  const effective = await resolveCustomerServiceBillingTrigger(cari.customerId, settings);
  const bounds = resolvePeriodBounds(input.period);
  const draft = await collectPeriodServiceBilling({ customerId: cari.customerId, currency: cari.currency, settings, ...bounds });
  const vatRate = await readFinanceDefaultVatRate();
  const closedAt = await findClosedPeriod(cari.id, cari.currency, bounds.issueDate);
  return { settings, cari, bounds, draft, vatRate, closedAt, effective };
}

/** Önizleme: iş sayısı, metre, tutar, uyarılar — yazmaz. */
export async function previewServicePeriodDraft(input: ServicePeriodInput): Promise<ServicePeriodPreview> {
  const { cari, bounds, draft, closedAt, effective } = await buildPeriodDraft(input);
  const lines = draft.lines.map((l) => ({
    itemId: l.itemId, description: l.description, qty: l.qty.toFixed(3), unit: l.unit, unitPrice: l.unitPrice.toFixed(4),
    amount: l.qty.mul(l.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
  }));
  const meters = draft.links.reduce((a, l) => a.plus(l.billedMeters), new Prisma.Decimal(0));
  const subtotal = lines.reduce((a, l) => a.plus(l.amount), new Prisma.Decimal(0));
  const warnings = [...draft.warnings];
  if (effective.source === "CUSTOMER" && effective.trigger === "PER_SHIPMENT") warnings.push(CUSTOMER_PER_SHIPMENT_PERIOD_WARNING);
  if (closedAt) warnings.push(`Dönem ${formatDayKeyTr(closedAt)} kapanışıyla KAPALI — taslak oluşturulamaz.`);
  if (draft.links.length === 0 && draft.billedWorkCount > 0) warnings.push("Dönemin bütün işleri zaten faturalanmış.");
  return {
    cariId: cari.id, cariName: cari.name, period: input.period,
    periodStart: bounds.from.toISOString(), periodEnd: bounds.to.toISOString(), issueDate: bounds.issueDate.toISOString(),
    currency: cari.currency,
    shipmentCount: draft.shipments.length + draft.directShipments.length,
    shipmentNos: [...draft.shipments, ...draft.directShipments].map((s) => s.shipmentNo),
    workCount: draft.links.length, alreadyBilledWorkCount: draft.billedWorkCount,
    totalMeters: meters.toFixed(3), lines, subtotal: subtotal.toFixed(2),
    periodClosed: closedAt ? closedAt.toISOString().slice(0, 10) : null,
    warnings: [...new Set(warnings)],
  };
}

const SERVICE_PERIOD_REPLAY_SELECT = { id: true, docNo: true, type: true, status: true, cariId: true, issueDate: true } as const;

/** Token replay: kimlik = tür + cari + dönem (taslak tarihinin fabrika ayı). İptal edilmiş taslak 409. */
function servicePeriodReplay(input: ServicePeriodInput) {
  return tokenReplay<Prisma.InvoiceGetPayload<{ select: typeof SERVICE_PERIOD_REPLAY_SELECT }>, ApiResponse<{ id: string; docNo: string }>>({
    find: (db, clientToken) => db.invoice.findUnique({ where: { clientToken }, select: SERVICE_PERIOD_REPLAY_SELECT }),
    alive: (p) => {
      if (p.status !== InvoiceStatus.CANCELLED) return;
      throw AppError.conflict(`Bu taslak (${p.docNo}) oluşturulmuş ama sonra İPTAL edilmiş — pencereyi kapatıp yeniden açın.`, { code: "INVOICE_CANCELLED", docNo: p.docNo });
    },
    identity: (p) => [
      { ad: "type", mevcut: p.type, gelen: InvoiceType.SALES },
      { ad: "cariId", mevcut: p.cariId, gelen: input.cariId },
      { ad: "period", mevcut: factoryYmd(p.issueDate).slice(0, 7), gelen: input.period },
    ],
    collision: "Bu istemci anahtarı FARKLI bir fatura için kullanılmış. Pencereyi kapatıp yeniden açın.",
    collisionEk: (p) => ({ invoiceId: p.id }),
    respond: (p) => ({ success: true, data: { id: p.id, docNo: p.docNo }, message: "Dönem sonu hizmet taslağı zaten oluşturulmuş." }),
  });
}

/**
 * Dönem sonu hizmet taslağı. Kapanmış dönem 409 SERVICE_PERIOD_CLOSED; dönemin bütün işleri faturalıysa 409
 * SERVICE_ALREADY_BILLED; iş yoksa 400 SERVICE_PERIOD_EMPTY. Aynı token → aynı taslak.
 */
export async function createServicePeriodDraft(
  input: ServicePeriodInput & { clientToken: string },
  userId?: string,
): Promise<ApiResponse<{ id: string; docNo: string }>> {
  return servicePeriodReplay(input).run(input.clientToken, async () => {
    const { cari, bounds, draft, vatRate, closedAt } = await buildPeriodDraft(input);
    if (closedAt) {
      throw AppError.conflict(
        `${input.period} dönemi ${formatDayKeyTr(closedAt)} cari kapanışıyla KAPALI — Dönem Kapanışı ekranından yeniden açın.`,
        { code: "SERVICE_PERIOD_CLOSED", periodEnd: closedAt.toISOString().slice(0, 10) },
      );
    }
    if (draft.links.length === 0) {
      // 409 yalnız "bütün adaylar zaten bağlı"da; çözülemeyen/fiyatsız iş uyarısı varsa neden o uyarıdır (EMPTY).
      if (draft.billedWorkCount > 0 && draft.warnings.length === 0) throw alreadyBilled(draft.billedDocNo);
      throw AppError.badRequest(
        draft.warnings.length > 0 ? `Faturalanacak iş yok — ${draft.warnings.join(" ")}` : "Bu dönemde faturalanacak hizmet işi yok.",
        { code: "SERVICE_PERIOD_EMPTY" },
      );
    }
    const shipmentNos = [...draft.shipments, ...draft.directShipments].map((s) => s.shipmentNo);
    const shown = shipmentNos.slice(0, 12).join(", ") + (shipmentNos.length > 12 ? ` +${shipmentNos.length - 12}` : "");
    const notes = `${input.period} dönem sonu hizmet faturası — ${shipmentNos.length} sevkiyat (${shown}).${draft.warnings.length > 0 ? ` ⚠ ${draft.warnings.join(" ")}` : ""}`;
    return invoiceService.createDraft(
      {
        type: InvoiceType.SALES,
        customerId: cari.customerId,
        currency: cari.currency,
        issueDate: bounds.issueDate,
        notes: notes.slice(0, 500),
        lines: draft.lines.map((l) => ({ ...l, vatRate })),
        clientToken: input.clientToken,
        serviceLinks: draft.links,
        serviceShipmentIds: draft.shipments.map((s) => s.id),
      },
      userId,
    );
  });
}
