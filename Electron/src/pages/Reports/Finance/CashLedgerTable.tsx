// =============================================================================
// KASA / BANKA DEFTERİ — TEK HESABIN SATIR DÖKÜMÜ + YÜRÜYEN BAKİYE
// =============================================================================
// ⚠️ YÜRÜYEN BAKİYE YALNIZ TEK HESAPTA ANLAMLI: iki hesabın hareketleri tek
// sütunda toplanırsa çıkan sayı hiçbir hesabın bakiyesi olmaz (üstelik para
// birimleri farklı olabilir). Backend de `rows`'u yalnız tek hesap seçiliyken
// döner; bu bileşen o sözleşmenin ekran karşılığıdır.
//
// ⚠️ İLK SATIR "DEVİR"DİR ve bir HAREKET DEĞİLDİR. Onsuz kapanış bakiyesi —
// defterin en çok bakılan sayısı — okunamaz; kullanıcı satırları toplayıp
// bakiyeyi bulamaz.
//
// ⚠️ İPTAL EDİLEN BELGE GİZLENMEZ. İptal bir HAREKETTİR: belge tarihinde asıl
// satır, iptal anında ters satır. Gizlenseydi "kasa bugün neden 5.000 azaldı"
// sorusunun cevabı hiçbir satırda görünmezdi. Ters satır soluk + "İPTAL"
// rozetiyle işaretlenir, ÜSTÜ ÇİZİLMEZ — tutar bakiyeye gerçekten etki eder.
// =============================================================================

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtDate } from "../_components/formatters";
import { moneyStr } from "./service";
import {
  CASH_KIND_LABEL,
  CASH_SOURCE_LABEL,
  type CashBookAccountSummary,
  type CashBookReport,
} from "./cashBookService";

interface Props {
  account: CashBookAccountSummary;
  report: CashBookReport;
  isLoading?: boolean;
}

export function CashLedgerTable({ account, report, isLoading }: Props) {
  const rows = report.rows ?? [];
  const cur = account.currency;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">
            {account.name} <span className="font-mono text-xs text-muted-foreground">({account.code})</span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Devir {moneyStr(account.opening, cur)} → Kapanış {moneyStr(account.closing, cur)} · {rows.length}{" "}
            hareket
          </p>
        </div>
        {report.rowsTruncated ? (
          <span className="text-xs font-medium text-warning">
            Satırlar kırpıldı — daha dar bir tarih aralığı seçin.
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rows.length === 0 ? (
        <div className="m-4 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Bu dönemde hareket yok. Bakiye devirden geliyor — tarih aralığını genişletin.
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left">Tarih</th>
                <th className="px-3 py-2 text-left">Belge No</th>
                <th className="px-3 py-2 text-left">Kaynak</th>
                <th className="px-3 py-2 text-left">Karşı taraf / Açıklama</th>
                <th className="px-3 py-2 text-right">Giriş</th>
                <th className="px-3 py-2 text-right">Çıkış</th>
                <th className="px-3 py-2 text-right">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-3 py-2" colSpan={6}>
                  Dönem devri (dönemden önceki hareketlerin toplamı)
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{moneyStr(account.opening, cur)}</td>
              </tr>
              {rows.map((r) => (
                <tr key={r.id} className={cn("border-t", r.cancelled && "opacity-60")}>
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.docNo}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    <div>{CASH_SOURCE_LABEL[r.source]}</div>
                    {r.kind ? (
                      <div className="text-xs">{CASH_KIND_LABEL[r.kind] ?? r.kind}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span>{r.counterparty ?? "—"}</span>
                      {r.cancelled ? (
                        <Badge className="bg-muted text-muted-foreground">İPTAL</Badge>
                      ) : null}
                    </div>
                    {r.description ? (
                      <div className="text-xs text-muted-foreground">{r.description}</div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-success">
                    {r.direction === "IN" ? moneyStr(r.amount, cur) : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-destructive">
                    {r.direction === "OUT" ? moneyStr(r.amount, cur) : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                    {moneyStr(r.running, cur)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/50 font-semibold">
                <td className="px-3 py-2" colSpan={4}>
                  Dönem toplamı
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(account.totalIn, cur)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(account.totalOut, cur)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(account.closing, cur)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
