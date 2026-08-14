// =============================================================================
// SEÇİLİ KAYNAĞIN MEVCUT KAPAMALARI — "bu paranın kalanı neden bu kadar?"
// =============================================================================
// Bu tablo olmadan ekran yarım kalırdı: kullanıcı 10.000 TL'lik tahsilatın
// yanında "kalan 2.000" yazdığını görür ama 8.000'in NEREYE gittiğini hiçbir
// yerde göremezdi — ve elle düzeltmenin (yanlış faturaya bağlama) tek çıkışı
// tam da burasıdır.
//
// ⚠️ ÇÖZMEK PARAYI GERİ ALMAZ. Tahsilat/çek kaydına dokunulmaz, para hâlâ
// kasadadır; çözülen yalnız EŞLEŞMEDİR ve fatura yeniden "açık" olur. Onay
// metni bunu açıkça söyler, yoksa kullanıcı düğmeye basmaktan çekinir (ya da
// daha kötüsü, "tahsilatı iptal ediyorum" sanır).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { PermissionGate } from "@/components/PermissionGate";
import { money } from "../service";
import { deallocate, listAllocations, type AllocationRow, type SourceKind } from "./service";

interface Props {
  sourceKind: SourceKind;
  sourceId: string;
  sourceDocNo: string;
}

// ⚠️ Para birimi PROP OLARAK ALINMAZ, satırın KENDİ faturasından okunur:
// kaynak ile fatura aynı para biriminde olmak zorunda (uçta kural), ama tutarı
// ekranın filtresinden basmak o kuralı ekranın DOĞRULAMASI değil VARSAYMASI
// olurdu — filtre değiştiğinde eski satırlar yanlış simgeyle basılırdı.
export function SourceAllocationsTable({ sourceKind, sourceId, sourceDocNo }: Props) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<AllocationRow | null>(null);

  const q = useQuery({
    queryKey: ["finance", "allocations", "of-source", sourceKind, sourceId],
    queryFn: () =>
      listAllocations(
        sourceKind === "PAYMENT" ? { paymentId: sourceId } : { chequeId: sourceId },
      ),
  });

  const releaseM = useMutation({
    mutationFn: (id: string) => deallocate(id),
    onSuccess: (r) => {
      toast.success(r.message ?? "Kapama çözüldü.");
      setTarget(null);
    },
    // Hata dalında da tazele: yarışta (başkası aynı satırı çözdüyse) uç 409
    // döner ve ekranda duran satır artık yoktur. `onError` YAZILMAZ — hata
    // toast'ı apiClient interceptor'undan gelir, ikinci kez basmak gürültüdür.
    onSettled: () => void qc.invalidateQueries({ queryKey: ["finance"] }),
  });

  const rows = q.data?.data ?? [];
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  // ⚠️ HATA DALI BOŞ DALDAN ÖNCE. Aksi halde istek düştüğünde ekran "tutarın
  // TAMAMI serbest" der — hem yanlış hem tehlikeli: kullanıcı zaten kapatılmış
  // parayı ikinci kez dağıtmaya çalışır ve uç haklı olarak 409 verir.
  if (q.isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-center text-sm text-destructive">
        Bu belgenin mevcut kapamaları alınamadı — "hiç kapama yok" ANLAMINA GELMEZ.
        Listeyi görmeden dağıtım yapmayın; sayfayı yenileyin.
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
        {sourceDocNo} henüz hiçbir faturaya bağlanmadı — tutarın tamamı serbest.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Fatura</th>
              <th className="px-3 py-2 text-left">Fatura Tarihi</th>
              <th className="px-3 py-2 text-left">Kapama Tarihi</th>
              <th className="px-3 py-2 text-left">Not</th>
              <th className="px-3 py-2 text-right">Kapatılan</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{a.invoice.docNo}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(a.invoice.issueDate).toLocaleDateString("tr-TR")}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {new Date(a.createdAt).toLocaleDateString("tr-TR")}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{a.notes ?? "—"}</td>
                <td className="px-3 py-2 text-right font-medium">
                  {money(a.amount, a.invoice.currency)}
                </td>
                <td className="px-3 py-2 text-right">
                  <PermissionGate permission="finance:payment">
                    <Button variant="outline" size="sm" onClick={() => setTarget(a)}>
                      <Link2Off className="mr-1 h-3.5 w-3.5" />
                      Kapamayı çöz
                    </Button>
                  </PermissionGate>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ⚠️ Onay SOMUT: hangi belge, hangi fatura, hangi tutar ve SONUÇ ne.
          "Emin misiniz?" tek başına, kullanıcının neyi geri aldığını söylemez. */}
      <ConfirmDialog
        open={Boolean(target)}
        onOpenChange={() => setTarget(null)}
        title="Kapamayı çöz"
        description={
          target
            ? `${sourceDocNo} → ${target.invoice.docNo} — ${money(target.amount, target.invoice.currency)}\n\nEşleşme kaldırılır: fatura yeniden AÇIK olur, tutar bu belgede serbest kalır ve başka bir faturaya bağlanabilir. Tahsilat/çek kaydına ve kasa bakiyesine DOKUNULMAZ — para yerinde durur.`
            : ""
        }
        confirmLabel="Kapamayı çöz"
        isPending={releaseM.isPending}
        onConfirm={() => {
          if (target) releaseM.mutate(target.id);
        }}
      />
    </>
  );
}
