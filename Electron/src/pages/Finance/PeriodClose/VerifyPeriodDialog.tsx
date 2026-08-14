// =============================================================================
// KAPANIŞ DOĞRULAMA — saklanan fotoğraf ↔ bugünkü defter
// =============================================================================
// Kapanış, defterin O ANDAKİ ölçümüdür. Kaynak defter append-only olduğu için
// aynı ölçüm her an yeniden türetilebilir; `txnCount` şemaya tam bunun için
// kondu (kontrol toplamı). Tutmuyorsa kapanıştan sonra o döneme yazılmış
// demektir — ya bir guard atlandı ya satır DB'ye elle girildi.
//
// ⚠️ BU EKRAN HİÇBİR ŞEYİ DÜZELTMEZ ve düzeltmeye ÇALIŞMAMALI. Kapanmış resmi
// rakamı sessizce tazelemek, bu modülün reddettiği tek şeydir: mühürlü rakam
// beyannameye/mutabakata gitmiştir. Ayrışma bulunduğunda doğru davranış onu
// GÖRÜNÜR kılmak ve kararı insana bırakmaktır (dönemi yeniden aç → düzelt →
// tekrar kapat). "Düzelt" butonu bilinçli olarak YOKTUR.
//
// ⚠️ Doğrulama YALNIZ aktif kapanışlar için anlamlıdır. Yeniden açılmış bir
// dönemde defterin değişmiş olması BEKLENEN durumdur; oraya alarm basmak
// gerçek ayrışmayı gürültüye boğardı (sayfa butonu o satırlarda çizmez).
// =============================================================================

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDayKey, moneyOf, verifyPeriodClose, type PeriodCloseRow } from "./service";

interface Props {
  row: PeriodCloseRow | null;
  onOpenChange: (open: boolean) => void;
}

export function VerifyPeriodDialog({ row, onOpenChange }: Props) {
  const q = useQuery({
    queryKey: ["finance", "period-verify", row?.id],
    queryFn: () => verifyPeriodClose(row?.id as string),
    enabled: Boolean(row?.id),
  });

  const v = q.data;

  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Kapanış doğrulama</DialogTitle>
          <DialogDescription>
            Mühürlenen rakam bugünkü defterden yeniden hesaplanır ve karşılaştırılır. Bu işlem hiçbir
            şeyi değiştirmez — yalnız okur.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <span className="font-medium">
              {row.cariCode} — {row.cariName}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {row.currency} · Dönem sonu {formatDayKey(row.periodEnd)}
            </span>
          </div>
        )}

        {/* `!row` ÖNCE elenir: diyalog kapanırken (row → null) Radix içeriği
            animasyon boyunca çizmeye devam eder; hata dalı önce gelseydi her
            kapanışta kırmızı kutu yanıp sönerdi. */}
        {!row ? null : q.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Defter yeniden hesaplanıyor…</p>
        ) : !v ? (
          /* Sessiz `null` YASAK: kullanıcı "karşılaştırılır" yazan bir diyalogda
             hiçbir şey görmeyip "demek ki sorun yok" diye çıkardı — oysa
             karşılaştırma HİÇ YAPILAMADI. Doğrulama ekranının tek işi ayrışmayı
             görünür kılmaksa, kendi başarısızlığını da görünür kılmalıdır. */
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Doğrulama yapılamadı.</p>
              <p className="mt-1 text-xs">
                Defter yeniden hesaplanamadı — bu, &quot;tutuyor&quot; demek DEĞİLDİR. Tekrar deneyin.
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Ölçüm</th>
                    <th className="px-3 py-2 text-right">Bakiye</th>
                    <th className="px-3 py-2 text-right">Hareket</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-3 py-2">Mühürlenen (kapanış anı)</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {moneyOf(v.stored.closingBalance, row.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{v.stored.txnCount}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-3 py-2">Bugünkü defterden yeniden hesaplanan</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {moneyOf(v.derived.closingBalance, row.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{v.derived.txnCount}</td>
                  </tr>
                  <tr className="border-t-2 bg-muted/40 font-semibold">
                    <td className="px-3 py-2">Fark</td>
                    <td className="px-3 py-2 text-right">{moneyOf(v.balanceDelta, row.currency)}</td>
                    <td className="px-3 py-2 text-right">{v.countDelta}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {v.drift ? (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Mühürlü rakam ile defter AYRIŞMIŞ.</p>
                  <p className="mt-1 text-xs">
                    Kapanıştan sonra bu döneme kayıt girmiş görünüyor. Bu ekran hiçbir şeyi düzeltmez;
                    rakam olduğu gibi bırakıldı. Yapılacak iş: farkın nereden geldiğini bulun, gerekiyorsa
                    dönemi yeniden açın, düzeltin ve tekrar kapatın. Muhasebe sorumlusuna bildirin.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md bg-emerald-100 px-3 py-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">Tutuyor.</p>
                  <p className="mt-1 text-xs">
                    Mühürlenen bakiye ve hareket sayısı, bugünkü defterden yeniden hesaplananla birebir
                    aynı. Kapanıştan sonra bu döneme kayıt girmemiş.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
