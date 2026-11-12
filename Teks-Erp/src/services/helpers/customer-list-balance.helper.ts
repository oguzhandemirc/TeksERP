// =============================================================================
// CARİ LİSTESİ BAKİYESİ — sayfadaki kartların cari hesap bakiyeleri (cari-be madde 2)
// =============================================================================
// Kaynak `CariBalance` (tek yazar `applyCariBalanceTx`); kart → hesap seçimi tekil çözücünün (`findCariAccountForCardTx`)
// toplu ikizi: aynı where iki bacağı, aynı `CARD_ACCOUNT_ORDER`, kart başına İLK hesap. Sayfa başına TEK sorgu (N+1 yok).
// Para birimi başına satır; toplanmaz. Alan yalnız `finance:read` ∧ finans modülü açıkken yanıta girer.
// =============================================================================
import prisma from "../../lib/prisma";
import { readFinanceEnabled } from "../system-setting.service";
import { cariAccountWhereForCustomers } from "./cari-card-where.helper";
import { CARD_ACCOUNT_ORDER } from "./finance.helper";

export type ListBalance = { currency: string; balance: string };

/** Kart kimliği → sıfır olmayan bakiyeler (para birimi sırasıyla). Hesabı olmayan kart haritada YOK. */
export async function balancesByCustomer(customerIds: ReadonlyArray<string>): Promise<Map<string, ListBalance[]>> {
  const ids = [...new Set(customerIds)];
  if (ids.length === 0) return new Map();
  const accounts = await prisma.cariAccount.findMany({
    where: cariAccountWhereForCustomers(ids),
    orderBy: CARD_ACCOUNT_ORDER,
    select: { customerId: true, subcontractor: { select: { customerId: true } }, balances: { select: { currency: true, balance: true }, orderBy: { currency: "asc" } } },
  });
  const out = new Map<string, ListBalance[]>();
  for (const acc of accounts) {
    const card = acc.customerId ?? acc.subcontractor?.customerId ?? null;
    if (!card || out.has(card)) continue; // kart başına ilk hesap = tekil çözücünün seçtiği
    out.set(card, acc.balances.filter((b) => !b.balance.isZero()).map((b) => ({ currency: b.currency, balance: b.balance.toFixed(2) })));
  }
  return out;
}

/** Liste yanıtına `balances` ekler; izin ya da modül yoksa yanıt DEĞİŞMEZ (alan yok, sorgu yok). */
export async function withCustomerListBalances<T extends { data: unknown }>(res: T, canReadFinance: boolean): Promise<T> {
  if (!canReadFinance || !(await readFinanceEnabled())) return res;
  const rows = res.data as Array<{ id: string }>;
  const map = await balancesByCustomer(rows.map((r) => r.id));
  return { ...res, data: rows.map((r) => ({ ...r, balances: map.get(r.id) ?? [] })) };
}
