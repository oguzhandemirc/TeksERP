// =============================================================================
// KART ↔ HESAP KÖPRÜSÜ (cari kart ↔ hesap birleşimi Z-A, karar A) — 2026-09-18
// =============================================================================
// Kart varsa hesabı vardır: hesap kartın yaratıldığı TX'te doğar (`ensureCariAccountTx`), terimler
// (vade · para birimi · vergi dairesi · risk limiti) HESAPTA kalır ve kart formunun "Finans" bölümü
// onları `finance:write` ile yazar; okuma `finance:read` ile OPT-IN (operasyon kullanıcısına sızmaz).
//
// ⚠️ NEDEN DİNAMİK IMPORT: `customer.service` her routerdan (sipariş içi hızlı ekleme, şube, alias…)
// import edilir. Finans helper'ını STATİK bağlamak `test_finance_regime_gate`in türetilmiş kapsamında
// on küsur fabrika router'ını "ticarete dokunuyor" yapardı — ve bekçi haklı olurdu: statik kenar modül
// yüklenince kurulur. Köprü bu yüzden yalnız `finance.enabled` AÇIKKEN yüklenir (kapalı fabrikada
// finans tablosuna tek yazım yok — bugünkü davranış bayt bayt); modül sonradan açılınca eski kartları
// `scripts/migrate_cari_accounts_backfill.ts` tamamlar. Emsal: `shipment-auto-draft.helper` kancası.
// =============================================================================
import type { Currency, Prisma } from "@prisma/client";
import { readFinanceEnabled } from "../system-setting.service";

export interface CustomerFinanceInput {
  paymentTermDays?: number | null;
  defaultCurrency?: Currency;
  taxOffice?: string | null;
  riskLimit?: Prisma.Decimal.Value | null;
}

export interface CustomerFinanceView {
  cariAccountId: string;
  paymentTermDays: number | null;
  defaultCurrency: Currency;
  taxOffice: string | null;
  riskLimit: string | null;
  isActive: boolean;
}

/** Kart yaratma TX'i içinde: finans açıksa hesap doğar, kapalıysa hiçbir şey yazılmaz (null). */
export async function bornCariAccountTx(tx: Prisma.TransactionClient, customerId: string): Promise<string | null> {
  if (!(await readFinanceEnabled(tx))) return null;
  const { ensureCariAccountTx } = await import("./finance.helper");
  const acc = await ensureCariAccountTx(tx, { customerId });
  return acc.id;
}

/** Terimleri hesaba yaz (yoksa hesap doğar — kendi tx'i). Çağıran `finance:write` + modül kapısını geçmiş olmalı. */
export async function writeCustomerFinanceTerms(customerId: string, input: CustomerFinanceInput, userId?: string): Promise<string> {
  const { cariService } = await import("../cari.service");
  return cariService.writeTermsForCustomer(customerId, input, userId);
}

/** Opt-in okuma (`finance:read`): kartın hesabı ve terimleri; hesap yoksa null. */
export async function readCustomerFinance(customerId: string): Promise<CustomerFinanceView | null> {
  if (!(await readFinanceEnabled())) return null;
  const { readCariTermsByCustomer } = await import("./finance.helper");
  const acc = await readCariTermsByCustomer(customerId);
  if (!acc) return null;
  return { cariAccountId: acc.id, paymentTermDays: acc.paymentTermDays, defaultCurrency: acc.defaultCurrency, taxOffice: acc.taxOffice, riskLimit: acc.riskLimit == null ? null : acc.riskLimit.toString(), isActive: acc.isActive };
}
