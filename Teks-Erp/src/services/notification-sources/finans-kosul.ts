// =============================================================================
// FİNANS KOŞUL KAYNAĞI — `finans.cek-senet-vade` (S4, KOSUL)
// =============================================================================
// "Vadesi bekleyen belge" kümesi KOPYALANMAZ: vade takviminin (`chequeService.dueSummary`) tek kaynağı
// `CHEQUE_DUE_LIVE_STATUSES`. Konu çek/senet; vadesi bugün + `gun` fabrika gününün sonuna kadar olan (geçmişler dahil)
// canlı belge açık kalır, tahsil/ciro/iade ile kümeden düşünce motor "çözüldü" yazar. Gün sınırı fabrika diliminden.
// Yük TUTAR taşımaz. `evaluate` fırlatırsa motor hiçbir koşulu kapatmaz (fail-closed) — hata burada yakalanmaz.
// =============================================================================
import { ChequeDocType, ChequeKind, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { factoryDateTr, factoryDayEnd } from "../../constants/time";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import type { ModulKey } from "../../constants/screen-catalog";
import { CHEQUE_DUE_LIVE_STATUSES } from "../cheque.service";
import { loadNotificationVisibilityEnv } from "../helpers/notification-visibility.helper";
import { effectiveNotificationParams } from "../helpers/notification-params.helper";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const CHEQUE_DUE_KIND = "finans.cek-senet-vade" satisfies NotificationKind;
const PERIOD_MS = 900_000;
const DAY_MS = 86_400_000;

/** Canlı (vadesi bekleyen) belge süzgeci — takvimle aynı küme, tek kaynaktan kurulur. */
export function chequeDueLiveWhere(): Prisma.ChequeWhereInput {
  return {
    OR: (Object.keys(CHEQUE_DUE_LIVE_STATUSES) as ChequeKind[]).map((kind) => ({ kind, status: { in: CHEQUE_DUE_LIVE_STATUSES[kind] } })),
  };
}

async function financeModuleOpen(): Promise<boolean> {
  const env = await loadNotificationVisibilityEnv(prisma, [CHEQUE_DUE_KIND]);
  return env.modules[getNotificationEntry(CHEQUE_DUE_KIND).modul as ModulKey] !== false;
}

/** `moduleOpen` yalnız bekçi enjeksiyonu içindir (lisans tavanı/ayar bağımsız ölçüm); üretim yolu modül okuyucusu. */
export async function chequeDueSubjects(now: Date = new Date(), moduleOpen: () => Promise<boolean> = financeModuleOpen): Promise<ConditionSubject[]> {
  if (!(await moduleOpen())) return [];
  const gun = Number(effectiveNotificationParams(CHEQUE_DUE_KIND).gun);
  const until = factoryDayEnd(new Date(now.getTime() + gun * DAY_MS));
  const rows = await prisma.cheque.findMany({
    where: { AND: [chequeDueLiveWhere(), { dueDate: { lte: until } }] },
    select: {
      id: true, docNo: true, kind: true, docType: true, dueDate: true,
      cari: { select: { customer: { select: { name: true } }, subcontractor: { select: { name: true } } } },
    },
    orderBy: { id: "asc" },
  });
  return rows.map((c) => ({
    key: c.id, type: "cheque", id: c.id,
    payload: {
      cekId: c.id, belgeNo: c.docNo,
      belgeTuru: c.docType === ChequeDocType.PROMISSORY_NOTE ? "senet" : "çek",
      yon: c.kind === ChequeKind.RECEIVED ? "Alınan" : "Verilen",
      cariAd: c.cari?.customer?.name ?? c.cari?.subcontractor?.name ?? "—",
      vade: factoryDateTr(c.dueDate),
    },
  }));
}

export function registerFinanceConditionSources(): void {
  registerConditionSource({ kind: CHEQUE_DUE_KIND, periodMs: PERIOD_MS, evaluate: () => chequeDueSubjects() });
}
