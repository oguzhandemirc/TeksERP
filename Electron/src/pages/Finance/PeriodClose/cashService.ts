// =============================================================================
// KASA/BANKA DÖNEM KAPANIŞI API İSTEMCİSİ (K-1)
// =============================================================================
// Cari kapanış istemcisinin (`./service.ts`) HESAP-bazlı ikizi. Ortak parçalar
// (tarih/para yardımcıları, `Decimalish`, `NeighbourClose`, `PeriodStatus`,
// `PeriodVerify`) KOPYALANMAZ — oradan import edilir; backend iki modülde aynı
// yanıt şeklini döndüğü için tipler bire bir paylaşılır.
//
// ⚠️ Yollar TAM yazılır ("/api/finance/cash-period-closes/...") —
// `apiClient.baseURL` `/api` İÇERMEZ (cari istemcisindeki notun aynısı).
//
// ⚠️ HESAP XOR — kasa VEYA banka, ikisi birden ASLA: backend hem Zod refine
// hem servis katmanında 400 verir. İstemci tarafında bu kural TEK fonksiyonda
// yaşar (`cashAccountParams`); parametreyi elle kuran her yer bu fonksiyondan
// geçmek zorunda. Elle `{ cashBoxId, bankAccountId }` yazmak, tek tuş hatasıyla
// iki anahtarı birden göndermeye açıktır ve bekçi (`cashService.test.ts`) bu
// yüzden fonksiyonun XOR'unu kilitler.
//
// ⚠️ KAPANIŞ SATIRI PARA BİRİMİ TAŞIMAZ (cari kapanışın aksine): hesap tek
// para birimlidir (şema kararı) ve backend listesi accountCode/accountName
// döner, currency DÖNMEZ. Sembollü basım için para birimi hesap kataloğundan
// (kasa/banka listeleri) çözülür; katalog yüklenemediyse `fmtCashMoney`
// sembolsüz ama DOĞRU sayı basar — yanlış sembol basmaktan iyidir.
// =============================================================================

import apiClient from "@/services/apiClient";
import { money, type Currency } from "../service";
import type { Decimalish, NeighbourClose, PeriodStatus, PeriodVerify } from "./service";

export type CashAccountKind = "CASH_BOX" | "BANK_ACCOUNT";

/** Backend uçlarının hesap referansı — daima TEK anahtar taşır (XOR). */
export interface CashAccountRefParams {
  cashBoxId?: string;
  bankAccountId?: string;
}

export interface CashPeriodCloseRow {
  id: string;
  accountKind: CashAccountKind;
  accountId: string;
  accountCode: string;
  accountName: string;
  /** `@db.Date` gün anahtarı — UTC gece yarısı. `formatDayKey` ile bas. */
  periodEnd: string;
  closingBalance: Decimalish;
  txnCount: number;
  notes: string | null;
  closedById: string | null;
  createdAt: string;
  /** Dolu ise mühür KIRILMIŞ — satır silinmez, işaretlenir (denetim izi). */
  reopenedAt: string | null;
  reopenedById: string | null;
  reopenReason: string | null;
}

export interface CashPeriodPreview {
  periodEnd: string;
  /** Kapsamın DIŞ sınırı (`hareket tarihi < cut`) — gerçek bir an. */
  cut: string;
  closingBalance: Decimalish;
  /** ÜÇ yazarın (tahsilat/ödeme · kasa hareketi · çek tahsilatı) TOPLAM adedi. */
  txnCount: number;
  totalIn: Decimalish;
  totalOut: Decimalish;
  account: { kind: CashAccountKind; id: string; code: string; name: string };
  alreadyClosed: boolean;
  blockingClose: NeighbourClose | null;
  previousClose: NeighbourClose | null;
}

type Paged<T> = { data: T[]; pagination: { total: number; totalPages: number } };

export const CASH_KIND_LABEL: Record<CashAccountKind, string> = {
  CASH_BOX: "Kasa",
  BANK_ACCOUNT: "Banka",
};

/**
 * Hesap türü + id → backend query/body parametresi. XOR'un TEK kaynağı.
 * Dönen nesnede daima tam olarak BİR anahtar bulunur.
 */
export function cashAccountParams(kind: CashAccountKind, id: string): CashAccountRefParams {
  return kind === "CASH_BOX" ? { cashBoxId: id } : { bankAccountId: id };
}

/**
 * Hesap kimliği — TÜR + id birlikte.
 *
 * ⚠️ Tür anahtarın PARÇASIDIR, süs değil: kasa ile banka ayrı tablolardır ve
 * iki tabloda aynı uuid'nin bulunmasını hiçbir kısıt engellemez. Yalnız id ile
 * anahtarlamak, o (teorik) çakışmada iki hesabın kapanışlarını tek hesaba
 * karıştırırdı — LIFO hesabı da yanlış satıra "en son" derdi.
 */
export function cashAccountKey(kind: CashAccountKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * LIFO yüzeyi: hesap başına EN SON aktif kapanışın id kümesi.
 *
 * Backend reopen'ı zaten LIFO ile kapılar (daha yeni aktif kapanış varken 409);
 * bu yardımcı aynı kuralı EKRANDA söyler — "Yeniden Aç" yalnız hesabın en son
 * aktif kapanışında etkindir, diğer aktif satırlarda buton sebep yazan
 * tooltip'le pasiftir ("bastım, olmadı" yerine "neden basamıyorum").
 *
 * ⚠️ Yeniden açılmış satırlar HİÇ SAYILMAZ: en yeni kapanış reopen edilmişse
 * "en son AKTİF" ondan önceki satırdır — backend'in `reopenedAt: null`
 * süzgeciyle bire bir aynı küme.
 *
 * Girdi sırasından bağımsızdır (periodEnd karşılaştırılır, dizi sırası değil).
 * Sayfalama güvenli: liste `periodEnd desc` sıralı geldiği için bir hesabın
 * HERHANGİ bir satırı sayfadaysa en yenisi de o sayfadadır (prefix özelliği).
 */
export function latestActiveCloseIds(
  rows: ReadonlyArray<Pick<CashPeriodCloseRow, "id" | "accountKind" | "accountId" | "periodEnd" | "reopenedAt">>,
): Set<string> {
  const best = new Map<string, { id: string; t: number }>();
  for (const r of rows) {
    if (r.reopenedAt) continue;
    const t = new Date(r.periodEnd).getTime();
    if (Number.isNaN(t)) continue;
    const key = cashAccountKey(r.accountKind, r.accountId);
    const cur = best.get(key);
    if (!cur || t > cur.t) best.set(key, { id: r.id, t });
  }
  return new Set(Array.from(best.values(), (v) => v.id));
}

/**
 * Para basımı — para birimi BİLİNİYORSA sembollü (`money`), bilinmiyorsa
 * sembolsüz ama binlik ayraçlı sayı. Kapanış satırı para birimi taşımadığı
 * için birim hesap kataloğundan gelir; katalog o an yüklenememiş olabilir.
 * O durumda "—" basmak yanlış olurdu (değer ELDE) — sayı sembolsüz basılır.
 */
export function fmtCashMoney(
  value: Decimalish | null | undefined,
  currency: Currency | null | undefined,
): string {
  if (currency) return money(value, currency);
  const n = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Kapanış listesi. Hesap süzgeci opsiyonel; `includeReopened` denetim görünümü. */
export async function listCashPeriodCloses(params: {
  page: number;
  pageSize: number;
  account?: { kind: CashAccountKind; id: string } | null;
  includeReopened?: boolean;
}): Promise<Paged<CashPeriodCloseRow>> {
  const res = await apiClient.get("/api/finance/cash-period-closes", {
    params: {
      page: params.page,
      pageSize: params.pageSize,
      ...(params.account ? cashAccountParams(params.account.kind, params.account.id) : {}),
      includeReopened: params.includeReopened ? "true" : undefined,
    },
  });
  return res.data;
}

/** "Bu hesap nereye kadar kapalı" — kilit rozeti. `null` HATA DEĞİL. */
export async function getCashPeriodStatus(kind: CashAccountKind, id: string): Promise<PeriodStatus> {
  const res = await apiClient.get("/api/finance/cash-period-closes/status", {
    params: cashAccountParams(kind, id),
  });
  return res.data.data as PeriodStatus;
}

/** ÖNİZLEME — hiçbir şey yazmaz. `periodEnd` düz takvim günü ("2025-12-31"). */
export async function getCashPeriodPreview(params: {
  kind: CashAccountKind;
  id: string;
  periodEnd: string;
}): Promise<CashPeriodPreview> {
  const res = await apiClient.get("/api/finance/cash-period-closes/preview", {
    params: { ...cashAccountParams(params.kind, params.id), periodEnd: params.periodEnd },
  });
  return res.data.data as CashPeriodPreview;
}

/** DOĞRULAMA — salt okuma; drift ALARMDIR, hiçbir şeyi düzeltmez. */
export async function verifyCashPeriodClose(id: string): Promise<PeriodVerify> {
  const res = await apiClient.get(`/api/finance/cash-period-closes/${id}/verify`);
  return res.data.data as PeriodVerify;
}

/** DÖNEMİ KAPAT (mühürler). Gövde backend'de `.strict()` — fazla alan 400. */
export async function closeCashPeriod(body: {
  kind: CashAccountKind;
  id: string;
  periodEnd: string;
  notes?: string | null;
}) {
  const res = await apiClient.post("/api/finance/cash-period-closes", {
    ...cashAccountParams(body.kind, body.id),
    periodEnd: body.periodEnd,
    notes: body.notes ?? null,
  });
  return res.data as { data: { id: string; periodEnd: string }; message?: string };
}

/** YENİDEN AÇ — gerekçe ZORUNLU (backend min 3 karakter), satır silinmez. */
export async function reopenCashPeriod(id: string, reason: string) {
  const res = await apiClient.post(`/api/finance/cash-period-closes/${id}/reopen`, { reason });
  return res.data as { data: { id: string; periodEnd: string }; message?: string };
}
