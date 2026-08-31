// =============================================================================
// KASA HAREKETLERİ API İSTEMCİSİ (F3) — masraf · gelir · açılış · virman · iptal
// =============================================================================
// ⚠️ NEDEN YEREL İSTEMCİ (ortak `Finance/service.ts` DEĞİL): `PeriodClose/
// cashService.ts` emsali. Ortak dosya zaten 400+ satır ve dört ekran tarafından
// paylaşılıyor; kasa defterinin kendi sözleşmesi (hesap XOR, virmanın iki
// bacağı, iptalin grup kapsamı) oraya taşınırsa her okuyan onu da okumak
// zorunda kalır. Paylaşılan parçalar KOPYALANMAZ, import edilir: para basımı
// (`money`), hesap XOR'u (`cashAccountParams`), gün sınırı (`Cheques/dates`).
//
// ⚠️ Yollar TAM yazılır ("/api/finance/...") — `apiClient.baseURL` `/api`
// İÇERMEZ. Öneksiz yol 404 alır ve çağıran hatayı yutarsa ekran "kayıt yok"
// gösterir (2026-08-12 FilterBar vakası).
//
// ⚠️ ÜÇ YAZMA UCU DA `suppressErrorToast` İLE GİDER — ve bu, ÇAĞIRANA BORÇ
// YÜKLER: bu fonksiyonlardan birini çağıran her yüzey hatayı KENDİ İÇİNDE
// göstermek ZORUNDADIR (`cashTxnErrorText`). Gerekçe `OpeningBalanceDialog`
// emsalinin aynısı: buradaki 400/409'lar birer YAPILACAK LİSTESİDİR
// ("dönemi yeniden açın", "önce açılışı iptal edin", "Kurlar ekranından
// girin") — birkaç saniyede kaybolan toast, kullanıcıyı yolun ortasında
// bırakır; diyalog açık kalır ve cümle orada durur. Ama hata alanını çizmeyi
// unutan bir çağıran SESSİZ BAŞARISIZLIK üretir → kural mekanik olarak
// kilitli: `cashTxnRules.test.ts` §5 diyalog kaynaklarını tarar.
// =============================================================================

import apiClient from "@/services/apiClient";
import axios from "axios";
import type { Currency } from "../service";
import { buildListQuery, type CashTxnFilterState } from "./cashTxnRules";

export type CashTxnKind = "EXPENSE" | "INCOME" | "OPENING" | "TRANSFER_OUT" | "TRANSFER_IN";
export type CashTxnStatus = "ACTIVE" | "CANCELLED";
export type CashTxnDirection = "IN" | "OUT";

export interface CashTxnRow {
  id: string;
  docNo: string;
  kind: CashTxnKind;
  /** Yönün TEK KAYNAĞI budur — türden yeniden türetme (DB CHECK'i de bunu tutar). */
  direction: CashTxnDirection;
  status: CashTxnStatus;
  currency: Currency;
  amount: number | string;
  txnDate: string;
  category: string | null;
  description: string | null;
  reference: string | null;
  /** Dolu ise satır bir VİRMAN bacağıdır — iptali grubun tamamını alır. */
  transferGroupId: string | null;
  cashBox: { id: string; name: string } | null;
  bankAccount: { id: string; name: string } | null;
}

type Paged<T> = { data: T[]; pagination: { total: number; page: number; totalPages: number } };

/** Backend hesap referansı — daima TEK anahtar (XOR, `cashAccountParams`). */
export interface AccountRefBody {
  cashBoxId?: string;
  bankAccountId?: string;
}

/**
 * Hata metni — backend cümlesi AYNEN, uydurma YOK.
 *
 * ⚠️ Yanıt gövdesi yoksa (ağ/timeout) "kaydedilemedi" DENMEZ: zaman aşımı
 * "yazılmadı" demek DEĞİLDİR (KK1 dersi). Cümle önce doğrulatır.
 */
export function cashTxnErrorText(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as
      | { message?: string; errors?: Array<{ message?: string }> }
      | undefined;
    const fieldMessages = (body?.errors ?? []).map((e) => e?.message).filter((m): m is string => Boolean(m));
    if (fieldMessages.length > 0) return fieldMessages.join(" • ");
    if (body?.message) return body.message;
    if (!error.response) {
      return "Sunucuya ulaşılamadı — işlemin kaydedilip kaydedilmediği BİLİNMİYOR. Listeyi yenileyip kontrol edin, yoksa tekrar deneyin.";
    }
  }
  return fallback;
}

/** Hareket listesi. Parametreler saf katmanda kurulur (`buildListQuery`). */
export async function listCashTransactions(
  filters: CashTxnFilterState,
  page: number,
  pageSize: number,
): Promise<Paged<CashTxnRow>> {
  const res = await apiClient.get("/api/finance/cash-transactions", {
    params: { page, pageSize, ...buildListQuery(filters) },
  });
  return res.data;
}

export interface CashTxnCreateBody extends AccountRefBody {
  kind: "EXPENSE" | "INCOME" | "OPENING";
  amount: string;
  /** ISO an — yerel gün başlangıcı (`dayStartIso`). Yoksa backend "şimdi" yazar. */
  txnDate?: string;
  category?: string | null;
  description?: string | null;
  reference?: string | null;
  /** Mantıksal deneme başına TEK token — tekrar denemede AYNISI gönderilir. */
  clientToken?: string;
}

/**
 * Masraf / gelir / açılış fişi.
 *
 * ⚠️ Gövde backend'de `.strict()`: TANIMSIZ BİR ANAHTAR 400'dür. Bu yüzden
 * alanlar tek tek ve KOŞULLU yazılır — `{...body}` yayılımı, form durumundan
 * kazara sızan bir anahtarı (ör. `currency`) sunucuya taşırdı. Para birimi
 * zaten HESAPTAN gelir, gönderilmez.
 */
export async function createCashTxn(body: CashTxnCreateBody) {
  const payload: Record<string, unknown> = {
    kind: body.kind,
    amount: body.amount,
    ...(body.cashBoxId ? { cashBoxId: body.cashBoxId } : {}),
    ...(body.bankAccountId ? { bankAccountId: body.bankAccountId } : {}),
    ...(body.txnDate ? { txnDate: body.txnDate } : {}),
    ...(body.clientToken ? { clientToken: body.clientToken } : {}),
    category: body.category ?? null,
    description: body.description ?? null,
    reference: body.reference ?? null,
  };
  const res = await apiClient.post("/api/finance/cash-transactions", payload, { suppressErrorToast: true });
  return res.data as { data: { id: string; docNo: string }; message?: string };
}

export interface CashTransferBody {
  fromCashBoxId?: string;
  fromBankAccountId?: string;
  toCashBoxId?: string;
  toBankAccountId?: string;
  amount: string;
  txnDate?: string;
  description?: string | null;
  clientToken?: string;
}

/** VİRMAN — tek uç, İKİ satır (aynı tx). Gövde yine `.strict()`. */
export async function transferCash(body: CashTransferBody) {
  const payload: Record<string, unknown> = {
    amount: body.amount,
    ...(body.fromCashBoxId ? { fromCashBoxId: body.fromCashBoxId } : {}),
    ...(body.fromBankAccountId ? { fromBankAccountId: body.fromBankAccountId } : {}),
    ...(body.toCashBoxId ? { toCashBoxId: body.toCashBoxId } : {}),
    ...(body.toBankAccountId ? { toBankAccountId: body.toBankAccountId } : {}),
    ...(body.txnDate ? { txnDate: body.txnDate } : {}),
    ...(body.clientToken ? { clientToken: body.clientToken } : {}),
    description: body.description ?? null,
  };
  const res = await apiClient.post("/api/finance/cash-transactions/transfer", payload, {
    suppressErrorToast: true,
  });
  return res.data as { data: { ids: string[]; docNos: string[] }; message?: string };
}

/**
 * İPTAL — kayıt SİLİNMEZ, `CANCELLED` işaretlenir ve bakiye ters yönde
 * düzeltilir. Virmanda İKİ BACAK BİRDEN gider (id'lerden HERHANGİ biri yeter;
 * backend grubu kendisi çözer — iki ayrı istek atmak yarım iptal riskidir).
 *
 * Sebep OPSİYONEL (backend `reason?`), boşsa hiç gönderilmez: boş string
 * kayda "gerekçe var ama boş" diye geçerdi.
 */
export async function cancelCashTxn(id: string, reason?: string) {
  const trimmed = reason?.trim();
  const res = await apiClient.post(
    `/api/finance/cash-transactions/${id}/cancel`,
    trimmed ? { reason: trimmed } : {},
    { suppressErrorToast: true },
  );
  return res.data as { data: { ids: string[] }; message?: string };
}
