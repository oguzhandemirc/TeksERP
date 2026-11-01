// Birleşmiş (K3d, `mergedIntoId` dolu) cari hesabın faturası bulutta HEDEF hesap altında görünür (D4-K3dk2).
// Fatura satırının `cariId`si "ne oldu"dur ve DEĞİŞMEZ; yalnız tel görünümü hedefe yönlenir. Açık tutar ve
// vade, hedefin yaşlandırma çekirdeğinden (`collectAgingRows`) okunur — cari-hesap `gecikmis` ile AYNI kaynak:
// virman bacağı kalemi aktarılan vadesiyle açar, hedefin kredisi onu sanal FIFO ile kapatır.
import { InvoiceStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { D } from "../services/helpers/finance.helper";
import { collectAgingRows, isOverdueBucket } from "../services/reports/finance-aging.report";

export interface MergedInvoiceView {
  targetCariId: string;
  /** Yalnız ONAYLI fatura için dolu; iptal/diğer durumda null (çağıran kendi formülünü kullanır). */
  aging: { open: string; overdue: boolean } | null;
}

/** Fatura kimliği → hedef görünümü; birleşmemiş hesabın faturası haritada YOK (tel çıktısı bayt-aynı kalır). */
export async function mergedInvoiceViews(
  rows: ReadonlyArray<{ id: string; cariId: string; status: string }>,
  nowMs: number,
): Promise<Map<string, MergedInvoiceView>> {
  const out = new Map<string, MergedInvoiceView>();
  const cariIds = [...new Set(rows.map((r) => r.cariId))];
  if (cariIds.length === 0) return out;
  const targetOf = await rootTargets(cariIds);
  if (targetOf.size === 0) return out;
  const targets = [...new Set(targetOf.values())].sort();
  const aging = await collectAgingRows({ asOf: new Date(nowMs), cariIds: targets, includeDetail: true });
  const itemBy = new Map<string, { open: string; overdue: boolean }>();
  for (const row of aging) {
    for (const it of row.items ?? []) {
      if (!it.invoiceId) continue;
      const net = D(it.netOpen);
      itemBy.set(`${row.cariId}:${it.invoiceId}`, { open: net.abs().toFixed(2), overdue: !net.isZero() && isOverdueBucket(it.bucket) });
    }
  }
  for (const r of rows) {
    const target = targetOf.get(r.cariId);
    if (!target) continue;
    const confirmed = r.status === InvoiceStatus.CONFIRMED;
    // Hedefte kalemi yoksa (birleşmede açığı sıfırdı ya da hedef kapattı) açık sıfırdır.
    out.set(r.id, { targetCariId: target, aging: confirmed ? (itemBy.get(`${target}:${r.id}`) ?? { open: "0.00", overdue: false }) : null });
  }
  return out;
}

/**
 * Hesap → zincirin SON (birleşmemiş) hedefi. Birleştirme zinciri mümkündür (A→B sonra B→C; virman kalemi
 * invoiceId'siyle C'ye taşınır), tek adım yetmez. Döngü/derinlik korumalı; birleşmemiş hesap haritada YOK.
 */
async function rootTargets(cariIds: string[]): Promise<Map<string, string>> {
  const next = new Map<string, string | null>();
  let frontier = cariIds;
  for (let depth = 0; frontier.length > 0 && depth < MAX_CHAIN; depth++) {
    const rows = await prisma.cariAccount.findMany({ where: { id: { in: frontier } }, select: { id: true, mergedIntoId: true } });
    for (const r of rows) next.set(r.id, r.mergedIntoId);
    frontier = [...new Set(rows.map((r) => r.mergedIntoId).filter((x): x is string => !!x && !next.has(x)))];
  }
  const out = new Map<string, string>();
  for (const id of cariIds) {
    const seen = new Set<string>([id]);
    let cur = next.get(id) ?? null;
    let last: string | null = null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      last = cur;
      cur = next.get(cur) ?? null;
    }
    if (last) out.set(id, last);
  }
  return out;
}
const MAX_CHAIN = 16;
