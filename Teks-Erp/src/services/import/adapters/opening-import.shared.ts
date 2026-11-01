// Toplu açılış aktarımı (cari açılış bakiyesi · çek/senet portföyü · hizmet fiyatı) — ortak parçalar.
//
// Cari KİMLİĞİ karttır (müşteri ya da fason firma); hesap satırı `findCariAccountForCardTx` ile okunur,
// yazım yolu hesabı gerekiyorsa `ensureCariAccountTx` ile açar (tek fabrika). Önizleme hiçbir şey yazmaz.
import { Currency } from "@prisma/client";
import prisma from "../../../lib/prisma";
import { findCariAccountForCardTx } from "../../helpers/finance.helper";
import { resolvePartyToCardTx, type CardParty } from "../../helpers/party-card.helper";
import { findCoveringCloseTx, formatDayKeyTr } from "../../helpers/period-guard.helper";
import { resolveReference } from "../import-lookup";
import type { ImportColumn, ImportContext, PreparedRow } from "../import.types";
import { importKey } from "../import-key";

export const CURRENCY_VALUES = Object.values(Currency).map((value) => ({ value, label: value }));

/** Cari türü + kodu sütunları — kod önce, tam ad ikincil (uyarılı) eşleşir. */
export const CARI_COLUMNS: ImportColumn[] = [
  {
    key: "cariType",
    label: "Cari Türü",
    type: "enum",
    required: true,
    enumValues: [
      { value: "CUSTOMER", label: "Müşteri" },
      { value: "SUBCONTRACTOR", label: "Fason" },
    ],
    help: "Müşteri ya da Fason (fason firma kartı).",
    example: "Müşteri",
  },
  {
    key: "cariCode",
    label: "Cari Kodu",
    type: "text",
    required: true,
    maxLen: 100,
    help: "Müşteri/fason firma KODU; kod bulunamazsa tam ad ile eşleşir (uyarılı).",
    example: "M001",
  },
];

export interface ResolvedCari {
  /** Yazım yoluna giden taraf (müşteri VEYA fason profil). */
  party: { customerId: string | null; subcontractorId: string | null };
  /** Kimlik kartı — dosya-içi tekillik bu anahtarla (aynı firma kodla da adla da yazılmış olabilir). */
  card: CardParty;
  account: { id: string; isActive: boolean; mergedIntoId: string | null } | null;
}

/** Cari sütunlarını çözer; hata/uyarıyı satıra yazar. Hesap yoksa `account: null` (yazımda açılır). */
export async function resolveCari(row: PreparedRow, ctx: ImportContext): Promise<ResolvedCari | null> {
  const type = row.values.cariType;
  const code = row.values.cariCode;
  if (typeof type !== "string" || typeof code !== "string") return null;
  const entity = type === "SUBCONTRACTOR" ? "subcontractor" : "customer";
  const out = entity === "customer" ? await resolveReference("customer", code, ctx) : await resolveReference("subcontractor", code, ctx);
  if (out.error) {
    row.result.errors.push({ column: "cariCode", message: out.error.message, fix: out.error.fix });
    return null;
  }
  if (out.warning) row.result.warnings.push({ column: "cariCode", message: out.warning });
  if (!out.hit) return null;
  row.result.label = out.hit.name ?? code;
  const party = entity === "customer" ? { customerId: out.hit.id, subcontractorId: null } : { customerId: null, subcontractorId: out.hit.id };
  const card = await resolvePartyToCardTx(prisma, party);
  const account = await findCariAccountForCardTx(prisma, card, { id: true, isActive: true, mergedIntoId: true });
  if (account && !account.isActive) row.result.errors.push({ column: "cariCode", message: "Bu carinin hesabı PASİF — önce Cari Hesaplar ekranından aktifleştirin." });
  if (account?.mergedIntoId) row.result.errors.push({ column: "cariCode", message: "Bu cari başka bir cariye BİRLEŞTİRİLMİŞ — hedef cariyi yazın." });
  return { party, card, account };
}

export function cardKey(card: CardParty): string {
  return card.customerId ? `C:${card.customerId}` : `S:${card.subcontractorId ?? ""}`;
}

/** Dosya-içi tekillik (çözülmüş kimlikle): aynı koşum bağlamında ikinci satır hata alır. */
const SEEN = new WeakMap<ImportContext, Map<string, number>>();
export function claimInFile(ctx: ImportContext, row: PreparedRow, claim: { key: string; column: string; message: string }): void {
  const { key, column, message } = claim;
  let seen = SEEN.get(ctx);
  if (!seen) {
    seen = new Map();
    SEEN.set(ctx, seen);
  }
  const first = seen.get(key);
  if (first !== undefined && first !== row.input.rowNo) {
    row.result.errors.push({ column, message: `${message} (${first}. satırla aynı).` });
    return;
  }
  seen.set(key, row.input.rowNo);
}

/** Kapalı döneme düşen satırı önizlemede yakalar — yazım guard'ıyla aynı yüklem. */
export async function checkPeriodOpen(row: PreparedRow, cari: ResolvedCari, at: { currency: Currency; txnDate: Date; column: string }): Promise<void> {
  const { currency, txnDate, column } = at;
  if (!cari.account) return;
  const closed = await findCoveringCloseTx(prisma, { cariId: cari.account.id, currency, txnDate });
  if (closed) {
    row.result.errors.push({ column, message: `Tarih KAPALI döneme düşüyor (${currency} — ${formatDayKeyTr(closed.periodEnd)} kapanışı).` });
  }
}

/** Bileşik anahtar: boş parça varsa anahtar yok (zorunlu sütun hatası ayrıca düşer). */
export function joinKey(values: Record<string, unknown>, keys: readonly string[]): string | null {
  const parts = keys.map((k) => values[k]);
  if (parts.some((p) => typeof p !== "string" || p.trim() === "")) return null;
  return parts.map((p) => importKey(String(p))).join("|");
}

/** Servis 4xx'i geri sarmada bir DALDIR (atlama gerekçesi); diğerleri fırlar. */
export function revertBranchMessage(e: unknown): string | null {
  const status = (e as { statusCode?: number } | null)?.statusCode;
  if (e instanceof Error && (status === 400 || status === 404 || status === 409)) return e.message;
  return null;
}
