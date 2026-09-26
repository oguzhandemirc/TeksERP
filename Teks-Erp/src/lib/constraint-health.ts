// =============================================================================
// VALIDATE EDİLMEMİŞ KISITLAR — `/api/admin/health` → `unvalidatedConstraints`
// =============================================================================
// Bir migration ihlalli eski satır bulunca kısıtı NOT VALID bırakabilir (ör.
// `swatches_status_shape`, 20260926110000). Kısıt yeni yazımı yine ölçer ama eski
// satır taranmamıştır; bu hâl sessiz kalmasın diye sağlık panosunda ad listesiyle durur.
// Katalog sorgusu (tablo taraması yok) — 5 sn'lik yoklamaya güvenli.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma from "./prisma";

type Okuyucu = Pick<Prisma.TransactionClient, "$queryRaw">;

/** `public` şemasında `convalidated = false` kısıtların adları (sıralı); boş dizi = hepsi doğrulanmış. */
export async function readUnvalidatedConstraints(db: Okuyucu = prisma): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ conname: string }>>`
    SELECT conname::text AS conname FROM pg_constraint
     WHERE NOT convalidated AND connamespace = 'public'::regnamespace
     ORDER BY conname`;
  return rows.map((r) => r.conname);
}
