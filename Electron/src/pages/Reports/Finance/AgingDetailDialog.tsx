// =============================================================================
// AÇIK FATURA DÖKÜMÜ — tek carinin yaşlandırma satırının arkasındaki belgeler
// =============================================================================
// ⚠️ AYRI İSTEK, BİLİNÇLİ: backend fatura kırılımını yalnız `cariId` + `detail`
// birlikte geldiğinde üretir. Tüm cariler için satır dökümü, ekranın hiç
// kullanmayacağı on binlerce satırlık bir yanıt olurdu (perf kuralı 7).
//
// ⚠️ VADE UYDURULMAZ. `dueSource` üç değer taşır ve ekranda AYRI okunur:
// belgenin kendi vadesi (DOCUMENT) · cari vade gününden türetilmiş (PAYMENT_TERM)
// · hiç yok (NONE → "Vadesiz"). İkincisini birincisiymiş gibi göstermek,
// muhasebeciyi hiç kararlaştırılmamış bir vadeye dayanarak müşteriyi aramaya
// gönderir.
//
// ⚠️ "Sanal mahsup" DEFTERE YAZILMAZ: kapamaya bağlanmamış tahsilat/çek rapor
// anında FIFO ile düşülür. Kolonu gizlemek, kullanıcının "bu fatura kapanmış"
// sanmasına yol açardı — oysa kapama kaydı YOKTUR.
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { INVOICE_TYPE_LABEL } from "@/pages/Finance/service";
import { fmtDate } from "../_components/formatters";
import { ReportErrorCard } from "./ReportErrorCard";
import { getAgingReport, isZeroAmount, moneyStr, type AgingCariRow, type AgingOpenItem } from "./service";

interface Props {
  row: AgingCariRow | null;
  /** Yaşlandırma kesiti — döküm AYNI kesitle çözülmeli, yoksa toplamlar tutmaz. */
  asOf: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DUE_SOURCE_NOTE: Record<AgingOpenItem["dueSource"], string> = {
  DOCUMENT: "",
  PAYMENT_TERM: "cari vade gününden",
  NONE: "vade bilgisi yok",
};

/**
 * Belge türü etiketi. `type` "ADJUSTMENT" de olabilir (faturası olmayan devir
 * satırı) — bu yüzden sözlük `string` anahtarla okunur; bilinmeyen değer HAM
 * basılır, sessizce boş bırakılmaz.
 */
function typeLabel(type: string): string {
  if (type === "ADJUSTMENT") return "Devir / düzeltme";
  // Devir stornosu (K-3, 2026-08-14). Aging'in DEVİR filtresi terslenmiş
  // devri normalde NETLER — bu satır dökümde beklenmez; ama bir gün görünürse
  // ham enum yerine adı basılsın.
  if (type === "ADJUSTMENT_CANCEL") return "Devir iptali";
  return (INVOICE_TYPE_LABEL as Record<string, string | undefined>)[type] ?? type;
}

export function AgingDetailDialog({ row, asOf, open, onOpenChange }: Props) {
  const q = useQuery({
    queryKey: ["reports", "finance", "aging-detail", row?.cariId, row?.currency, asOf],
    queryFn: () =>
      getAgingReport({
        asOf,
        cariId: row!.cariId,
        currency: row!.currency,
        detail: true,
      }),
    enabled: open && Boolean(row),
    staleTime: 30_000,
  });

  const currency = row?.currency ?? "TRY";
  const items = q.data?.blocks.find((b) => b.currency === currency)?.rows[0]?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{row ? `${row.name} — Açık Belgeler` : "Açık Belgeler"}</DialogTitle>
          <DialogDescription>
            {fmtDate(asOf)} kesiti · {currency}. “Sanal mahsup”, kapamaya bağlanmamış tahsilat/çek
            tutarının en eski vadeden başlayarak düşülmüş halidir — deftere hiçbir şey yazılmaz.
          </DialogDescription>
        </DialogHeader>

        {/* ⚠️ Hata dalı boş daldan ÖNCE: aksi halde istek düştüğünde diyalog
            "Bu kesitte açık belge yok" der ve kullanıcı faturanın kapandığını
            sanır. Liste satırında AÇIK bakiye görünürken dökümün boş çıkması
            zaten çelişkidir; sebebi söylemeyen bir boşluk onu gizler. */}
        {q.isError ? (
          <ReportErrorCard error={q.error} onRetry={() => void q.refetch()} />
        ) : q.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Bu kesitte açık belge yok. Bakiye yalnız kapatılmamış tahsilat/çekten geliyor olabilir —
            yaşlandırma listesindeki “Kapatılmamış tahsilat” kolonuna bakın.
          </div>
        ) : (
          <div className="max-h-[56vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 text-left">Belge No</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-left">Tarih</th>
                  <th className="px-3 py-2 text-left">Vade</th>
                  <th className="px-3 py-2 text-right">Gecikme</th>
                  <th className="px-3 py-2 text-right">Tutar</th>
                  <th className="px-3 py-2 text-right">Ödenen</th>
                  <th className="px-3 py-2 text-right">Sanal mahsup</th>
                  <th className="px-3 py-2 text-right">Net açık</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.invoiceId ?? `adj-${it.docNo}`} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{it.docNo}</td>
                    <td className="px-3 py-2 text-muted-foreground">{typeLabel(it.type)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{fmtDate(it.issueDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {it.effectiveDueDate ? fmtDate(it.effectiveDueDate) : "Vadesiz"}
                      {DUE_SOURCE_NOTE[it.dueSource] ? (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({DUE_SOURCE_NOTE[it.dueSource]})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {it.daysOverdue === null ? (
                        <span className="text-muted-foreground/50">—</span>
                      ) : it.daysOverdue > 0 ? (
                        <span className="font-medium text-destructive">{it.daysOverdue} gün</span>
                      ) : (
                        <span className="text-muted-foreground">vadesi gelmemiş</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{moneyStr(it.grandTotal, currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {isZeroAmount(it.paid) ? "—" : moneyStr(it.paid, currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {isZeroAmount(it.virtualOffset) ? "—" : moneyStr(it.virtualOffset, currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {moneyStr(it.netOpen, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
