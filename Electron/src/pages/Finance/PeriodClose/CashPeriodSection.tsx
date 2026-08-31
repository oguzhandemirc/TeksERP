// =============================================================================
// KASA/BANKA KAPANIŞ SEKMESİ — Dönem Kapanışı sayfasının hesap-bazlı yüzü (K-1)
// =============================================================================
// Cari sekmesiyle aynı kurgu, ÜÇ bilinçli farkla:
//
//   1. KAPSAM = HESAP (para birimi boyutu yok — hesap tek para birimlidir).
//      Kilit kartı bu yüzden yalnız hesap seçilince çizilir; satır para birimi
//      taşımadığı için sembol hesap kataloğundan çözülür (`useCashAccountOptions`
//      → `currencyByKey`), katalog yüklenmemişse sayı sembolsüz basılır.
//   2. "YENİDEN AÇ" YALNIZ HESABIN EN SON AKTİF KAPANIŞINDA ETKİN (LIFO —
//      `latestActiveCloseIds`). Backend zaten 409 ile kapılar; buradaki
//      pasif buton + tooltip aynı kuralı EKRANDA söyler ("bastım, olmadı"
//      yerine "neden basamıyorum"). Cari sekmesinde bu yüzey yok — oradaki
//      davranışa DOKUNULMADI (bayt paritesi); eklenecekse ayrı iş.
//   3. Doğrula/Yeniden Aç ortak Base diyaloglarını kullanır (LockStatusCard /
//      VerifyPeriodDialog / ReopenPeriodDialog dosyalarındaki "iki tüketici,
//      tek gövde" notları) — kopya form yok.
//
// Mount deseni PeriodClosePage'deki yorumla birebir: kapatma diyaloğu KOŞULLU
// (form durumu ölsün), doğrula/yeniden-aç SÜREKLİ mount + hedef id ile sürülür.
// =============================================================================

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { PeriodLockStatusCardBase } from "./LockStatusCard";
import { PeriodReopenDialogBase } from "./ReopenPeriodDialog";
import { PeriodVerifyDialogBase } from "./VerifyPeriodDialog";
import { CashAccountPicker, useCashAccountOptions, type CashAccountOption } from "./CashAccountPicker";
import { CashClosePeriodDialog } from "./CashClosePeriodDialog";
import {
  CASH_KIND_LABEL,
  cashAccountKey,
  fmtCashMoney,
  getCashPeriodStatus,
  latestActiveCloseIds,
  listCashPeriodCloses,
  reopenCashPeriod,
  verifyCashPeriodClose,
  type CashPeriodCloseRow,
} from "./cashService";
import { formatDayKey, formatInstant } from "./service";

interface Props {
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
}

export function CashPeriodSection({ formOpen, onFormOpenChange }: Props) {
  const [account, setAccount] = useState<CashAccountOption | null>(null);
  const [includeReopened, setIncludeReopened] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<CashPeriodCloseRow | null>(null);
  const [reopenTarget, setReopenTarget] = useState<CashPeriodCloseRow | null>(null);

  const { currencyByKey } = useCashAccountOptions();
  const currencyOf = (r: Pick<CashPeriodCloseRow, "accountKind" | "accountId">) =>
    currencyByKey.get(cashAccountKey(r.accountKind, r.accountId)) ?? null;

  // Tek sayfa + kırpma bandı — cari sekmesindeki gerekçenin aynısı.
  const PAGE_SIZE = 200;
  const q = useQuery({
    queryKey: ["finance", "cash-period-closes", account ? cashAccountKey(account.kind, account.id) : "", includeReopened],
    queryFn: () =>
      listCashPeriodCloses({
        page: 1,
        pageSize: PAGE_SIZE,
        account: account ? { kind: account.kind, id: account.id } : null,
        includeReopened,
      }),
  });

  const rows = q.data?.data ?? [];
  const total = q.data?.pagination.total ?? rows.length;
  const latestActive = latestActiveCloseIds(rows);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <CashAccountPicker className="w-72" nullable value={account} onChange={setAccount} />
        <Button
          variant={includeReopened ? "default" : "outline"}
          onClick={() => setIncludeReopened((v) => !v)}
          title="Yeniden açılmış kapanışlar da listelensin (denetim görünümü)"
        >
          Yeniden açılanlar
        </Button>
      </div>

      {account ? (
        <PeriodLockStatusCardBase
          label={`${account.code} — ${account.name} (${CASH_KIND_LABEL[account.kind]})`}
          sealedRecordsHint="tahsilat/ödeme, kasa hareketi ve çek tahsilatı"
          fmtMoney={(v) => fmtCashMoney(v, account.currency)}
          queryKey={["finance", "cash-period-status", account.kind, account.id]}
          fetchStatus={() => getCashPeriodStatus(account.kind, account.id)}
        />
      ) : null}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : q.isError && rows.length === 0 ? (
        /* Sessiz boş liste YASAK — PeriodClosePage dosya başındaki not. */
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Kapanış listesi alınamadı.</p>
            <p className="mt-0.5 text-xs">
              Bu ekran şu an dönemlerin açık olduğunu SÖYLEMİYOR — bilinmiyor. Kayıt girmeden önce
              listeyi yenileyin.
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
              Tekrar dene
            </Button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          {includeReopened
            ? "Bu filtreyle kapanış kaydı yok."
            : "Aktif kapanış yok — seçili kapsamda tüm dönemler açık. Yeniden açılmış eski kapanışlar için “Yeniden açılanlar” düğmesine basın."}
        </div>
      ) : (
        <div className="space-y-2">
          {q.isError && (
            <p className="flex items-start gap-2 rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Liste tazelenemedi — aşağıdaki kayıtlar son başarılı okumaya aittir ve eski olabilir.
              Bu arada yapılmış bir kapanış burada görünmeyebilir.
            </p>
          )}
          {total > rows.length && (
            <p className="text-xs text-muted-foreground">
              Toplam {total} kapanış var, ilk {rows.length} tanesi gösteriliyor. Aradığınızı görmüyorsanız
              hesap seçerek daraltın.
            </p>
          )}
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Hesap</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-left">Dönem Sonu</th>
                  <th className="px-3 py-2 text-right">Mühürlü Bakiye</th>
                  <th className="px-3 py-2 text-right">Hareket</th>
                  <th className="px-3 py-2 text-left">Kapatıldı</th>
                  <th className="px-3 py-2 text-left">Not</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const reopened = Boolean(r.reopenedAt);
                  const isLatestActive = latestActive.has(r.id);
                  return (
                    <tr key={r.id} className={`border-t ${reopened ? "opacity-60" : ""}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.accountName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{r.accountCode}</div>
                      </td>
                      <td className="px-3 py-2">{CASH_KIND_LABEL[r.accountKind]}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDayKey(r.periodEnd)}
                        {reopened && (
                          <Badge className="ml-2 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            Yeniden açıldı
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {fmtCashMoney(r.closingBalance, currencyOf(r))}
                      </td>
                      <td className="px-3 py-2 text-right">{r.txnCount}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatInstant(r.createdAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.notes ?? "—"}
                        {reopened && (
                          <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
                            Açılma: {formatInstant(r.reopenedAt)} — {r.reopenReason ?? "gerekçe yok"}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {!reopened && (
                            <>
                              <Button
                                variant="outline"
                                size="icon"
                                title="Mühürlü rakamı bugünkü defterle karşılaştır (salt okuma)"
                                onClick={() => setVerifyTarget(r)}
                              >
                                <ShieldCheck className="h-4 w-4" />
                              </Button>
                              <PermissionGate permission="finance:close">
                                {/* LIFO yüzeyi — dosya başı, madde 2. `title`
                                    pasif butonda da okunur (sebep görünür). */}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!isLatestActive}
                                  title={
                                    isLatestActive
                                      ? undefined
                                      : "Önce bu hesabın daha yeni kapanışı açılmalı — dönemler son kapanandan geriye doğru açılır (LIFO)."
                                  }
                                  onClick={() => setReopenTarget(r)}
                                >
                                  <Unlock className="mr-1 h-3.5 w-3.5" />
                                  Yeniden Aç
                                </Button>
                              </PermissionGate>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mount deseni: kapatma KOŞULLU, doğrula/yeniden-aç SÜREKLİ (dosya başı). */}
      {formOpen && <CashClosePeriodDialog open={formOpen} onOpenChange={onFormOpenChange} />}
      <PeriodVerifyDialogBase
        targetId={verifyTarget?.id ?? null}
        summary={
          verifyTarget && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <span className="font-medium">
                {verifyTarget.accountCode} — {verifyTarget.accountName}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {CASH_KIND_LABEL[verifyTarget.accountKind]} · Dönem sonu {formatDayKey(verifyTarget.periodEnd)}
              </span>
            </div>
          )
        }
        fmtMoney={(v) => fmtCashMoney(v, verifyTarget ? currencyOf(verifyTarget) : null)}
        queryKey={["finance", "cash-period-verify", verifyTarget?.id]}
        fetchVerify={verifyCashPeriodClose}
        onOpenChange={() => setVerifyTarget(null)}
      />
      <PeriodReopenDialogBase
        targetId={reopenTarget?.id ?? null}
        summary={
          reopenTarget && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-4 text-sm">
              <div className="font-medium">
                {reopenTarget.accountCode} — {reopenTarget.accountName}
              </div>
              <div className="text-muted-foreground">
                Dönem sonu: <span className="text-foreground">{formatDayKey(reopenTarget.periodEnd)}</span> · Tür:{" "}
                <span className="text-foreground">{CASH_KIND_LABEL[reopenTarget.accountKind]}</span>
              </div>
              <div className="text-muted-foreground">
                Mühürlü bakiye:{" "}
                <span className="font-medium text-foreground">
                  {fmtCashMoney(reopenTarget.closingBalance, currencyOf(reopenTarget))}
                </span>{" "}
                · {reopenTarget.txnCount} hareket
              </div>
            </div>
          )
        }
        doReopen={reopenCashPeriod}
        onOpenChange={() => setReopenTarget(null)}
      />
    </div>
  );
}
