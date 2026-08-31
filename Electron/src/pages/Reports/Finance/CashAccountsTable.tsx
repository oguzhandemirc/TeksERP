// =============================================================================
// KASA / BANKA — HESAP ÖZETİ TABLOSU
// =============================================================================
// ⚠️ "FARK" (kapanış − kayıtlı bakiye) BU RAPORUN ASIL İŞİDİR. Devir saklanan
// bakiyeden geriye hesaplanmaz, dönemden ÖNCEKİ hareketlerin toplamıdır —
// yani defter, denormalize bakiye kolonunun İKİNCİ bir doğrulama yoludur.
// Sıfır değilse ya bir hareket kaynağı unutulmuş ya bakiyeye elle dokunulmuş
// demektir; ikisi de sessiz kalmamalı.
//
// ⚠️ `storedComparable` false iken FARK KOLONU HİÇ BASILMAZ ("—"): kayıtlı
// bakiye her zaman "şu an"dır, geçmiş bir dönem sonuyla karşılaştırmak tanım
// gereği fark üretir ve o fark UYDURMADIR. 0 yazmak da yalan olurdu.
//
// ⚠️ GENEL TOPLAM satırı yalnız `totals` doluysa (tek para birimi) çizilir.
// Farklı para birimli kasaların toplamı "kasada 1,2 milyon var" yalanıdır.
// =============================================================================

import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtInt } from "../_components/formatters";
import { isZeroAmount, moneyStr } from "./service";
import {
  ACCOUNT_KIND_LABEL,
  type CashBookAccountSummary,
  type CashBookReport,
} from "./cashBookService";

interface Props {
  report: CashBookReport;
  selectedAccountId: string | null;
  onSelect: (account: CashBookAccountSummary) => void;
}

export function CashAccountsTable({ report, selectedAccountId, onSelect }: Props) {
  const showDiff = report.storedComparable;
  const totalsCurrency = report.accounts[0]?.currency;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Hesap Özeti</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Devir + dönem hareketleri. Satır dökümü için bir hesabın defterini açın.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{report.accounts.length} hesap</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Tür</th>
              <th className="px-3 py-2 text-left">Hesap</th>
              <th className="px-3 py-2 text-left">Para</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Devir</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Giriş</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Çıkış</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Kapanış</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Kayıtlı bakiye</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Fark</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Hareket</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {report.accounts.map((a) => {
              const drift = showDiff && a.storedDiff !== null && !isZeroAmount(a.storedDiff);
              return (
                <tr
                  key={a.accountId}
                  className={cn(
                    "border-t",
                    drift && "bg-destructive/5",
                    selectedAccountId === a.accountId && "bg-accent/40",
                  )}
                >
                  <td className="px-3 py-2 text-muted-foreground">{ACCOUNT_KIND_LABEL[a.accountKind]}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {a.name}
                      {!a.isActive ? (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">(pasif)</span>
                      ) : null}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{a.code}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{a.currency}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {moneyStr(a.opening, a.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-success">
                    {isZeroAmount(a.totalIn) ? "—" : moneyStr(a.totalIn, a.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-destructive">
                    {isZeroAmount(a.totalOut) ? "—" : moneyStr(a.totalOut, a.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                    {moneyStr(a.closing, a.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {moneyStr(a.storedBalance, a.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {!showDiff || a.storedDiff === null ? (
                      <span className="text-muted-foreground/50" title="Geçmiş dönem — karşılaştırılmadı">
                        —
                      </span>
                    ) : drift ? (
                      <span className="font-semibold text-destructive">
                        {moneyStr(a.storedDiff, a.currency)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">0,00</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtInt(a.movementCount)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="outline" size="icon" title="Defteri aç" onClick={() => onSelect(a)}>
                      <BookOpen className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {report.totals && totalsCurrency ? (
            <tfoot>
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className="px-3 py-2" colSpan={3}>
                  TOPLAM ({totalsCurrency})
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(report.totals.opening, totalsCurrency)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(report.totals.totalIn, totalsCurrency)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(report.totals.totalOut, totalsCurrency)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(report.totals.closing, totalsCurrency)}
                </td>
                <td className="px-3 py-2" colSpan={4} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </Card>
  );
}
