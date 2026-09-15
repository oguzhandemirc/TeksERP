// =============================================================================
// YAŞLANDIRMA — TEK PARA BİRİMİ BLOĞU
// =============================================================================
// ⚠️ AYRI BLOK, AYRI TABLO: 1.000 USD alacak ile 30.000 TL alacak TOPLANMAZ.
// Backend de blokları ayrı döner; burada tek tabloda birleştirmek, ekranda
// toplanabilir görünen iki sütun üretirdi.
//
// ⚠️ "FARK" KOLONU SIFIR OLSA DA BASILIR. Sıfırı gizlemek "ölçülmedi" ile
// "sapma yok"u aynı boşluğa indirirdi; oysa bu raporun varlık sebebi ikisini
// ayırmaktır. Sıfır sessiz (gri), sıfır olmayan gürültülü (kırmızı + ikon).
//
// ⚠️ TOPLAM SATIRI BACKEND'DEN gelir ve EKRANDAKİ SÜZGEÇTEN ETKİLENMEZ.
// İstemcide toplamak float toplaması olurdu (kuruş kayar) ve süzgeç altında
// "toplam" kelimesi zaten yanıltıcıdır — bu yüzden süzgeç aktifken sayfa
// üstünde bant çıkar.
// =============================================================================

import { AlertTriangle, FileText, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CARI_KIND_LABEL, isZeroAmount, moneyStr, type AgingCariRow, type AgingCurrencyBlock, type AgingReport } from "./service";

interface Props {
  block: AgingCurrencyBlock;
  buckets: AgingReport["buckets"];
  /** Ekranda gösterilecek satırlar (arama süzgeci uygulanmış olabilir). */
  rows: AgingCariRow[];
  /** Kesit "şu an"ı kapsıyor mu — kayıtlı bakiye karşılaştırması ancak o zaman anlamlı. */
  storedComparable: boolean;
  onOpenDetail: (row: AgingCariRow) => void;
  /** Yoksa "Cari ekstresi" düğmesi ÇİZİLMEZ — `finance/statement` raporu kapalıyken sayfa vermez (K5: kapalı yüzey belirmez). */
  onOpenStatement?: (row: AgingCariRow) => void;
}

export function AgingBlockTable({ block, buckets, rows, storedComparable, onOpenDetail, onOpenStatement }: Props) {
  const t = block.totals;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">{block.currency} bakiyeler</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rows.length} cari · Açık {moneyStr(t.openTotal, block.currency)} · Vadesi geçen{" "}
            {moneyStr(t.overdueTotal, block.currency)}
          </p>
        </div>
        {/* TL karşılığı: kur yoksa BASILMAZ. "0" yazmak 30 kat yanlış bir
            toplamı sessizce doğru gösterirdi. */}
        {block.currency !== "TRY" ? (
          block.totalsTry ? (
            <p className="text-xs text-muted-foreground">
              TL karşılığı: <strong>{moneyStr(block.totalsTry.openTotal, "TRY")}</strong> · Vadesi geçen{" "}
              {moneyStr(block.totalsTry.overdueTotal, "TRY")}
              <span className="ml-1 opacity-70">
                ({block.rateDate ?? "—"} · {block.tryRate})
              </span>
            </p>
          ) : (
            <p className="text-xs text-warning">
              Rapor günü kuru bulunamadı — TL karşılığı basılmadı.
            </p>
          )
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Cari</th>
              {buckets.map((b) => (
                <th key={b.key} className="whitespace-nowrap px-3 py-2 text-right">
                  {b.label}
                </th>
              ))}
              <th className="whitespace-nowrap px-3 py-2 text-right">Açık toplam</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Kapatılmamış tahsilat</th>
              <th className="whitespace-nowrap px-3 py-2 text-right">Fark</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const drift = !isZeroAmount(r.reconDiff);
              return (
                <tr key={r.cariId} className={cn("border-t", drift && "bg-destructive/5")}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{r.code}</span> · {CARI_KIND_LABEL[r.kind]}
                      {r.oldestDaysOverdue !== null ? (
                        <span className="ml-1 text-destructive">· en eski {r.oldestDaysOverdue} gün</span>
                      ) : null}
                    </div>
                  </td>
                  {buckets.map((b) => (
                    <td
                      key={b.key}
                      className={cn(
                        "whitespace-nowrap px-3 py-2 text-right tabular-nums",
                        isZeroAmount(r.net[b.key]) && "text-muted-foreground/40",
                      )}
                    >
                      {isZeroAmount(r.net[b.key]) ? "—" : moneyStr(r.net[b.key], block.currency)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                    {moneyStr(r.openTotal, block.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {isZeroAmount(r.unappliedCredit) ? "—" : moneyStr(r.unappliedCredit, block.currency)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {drift ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {moneyStr(r.reconDiff, block.currency)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">0,00</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        title="Açık fatura dökümü"
                        onClick={() => onOpenDetail(r)}
                      >
                        <ListTree className="h-4 w-4" />
                      </Button>
                      {onOpenStatement ? (
                        <Button
                          variant="outline"
                          size="icon"
                          title="Cari ekstresi"
                          onClick={() => onOpenStatement(r)}
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className="px-3 py-2">TOPLAM ({block.currency})</td>
              {buckets.map((b) => (
                <td key={b.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {moneyStr(t.net[b.key], block.currency)}
                </td>
              ))}
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {moneyStr(t.openTotal, block.currency)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {moneyStr(t.unappliedCredit, block.currency)}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Kayıtlı bakiye karşılaştırması yalnız kesit BUGÜNÜ kapsıyorsa anlamlı;
          geçmiş bir kesitte fark tanım gereği doğar ve UYDURMADIR. */}
      {!storedComparable ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          Geçmiş bir kesit seçildiği için kayıtlı cari bakiyesiyle karşılaştırma yapılmadı (kayıtlı bakiye
          her zaman “şu an”ı gösterir).
        </p>
      ) : null}
    </Card>
  );
}
