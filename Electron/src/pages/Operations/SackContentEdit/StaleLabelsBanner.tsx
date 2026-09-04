import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, TagIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { PermissionGate } from "@/components/PermissionGate";
import { useLabelPrinter } from "@/hooks/useLabelPrinter";
import { labelService } from "@/services/labelService";
import { invalidateSackHub } from "./useSackData";
import type { SackContentRoll } from "./types";

/**
 * "Bu topların etiketi yeni müşterinin şablonuyla yeniden basılmalı" uyarısı +
 * tek tuşla toplu yeniden basma.
 *
 * `labelDirty` bayrağını backend `reassignSackCustomer` kurar — AMA yalnız etkin
 * şablon gerçekten değiştiyse (`CustomerTemplateRoute` farkı). Etikete müşteri adı
 * basılmadığı için "müşteri değişti" tek başına etiketi geçersiz kılmaz; gereksiz
 * uyarı operatörü körleştirir.
 *
 * ⚠️ Baskıda `customerId` GEÇİLİR — geçilmezse her top kendi son baskı bağlamıyla
 * (eski müşteri) basılır ve baskı `labelDirty`'yi temizlediği için hata kendi
 * kanıtını siler. Backend tarafı `test_sack_split_and_relabel.ts` C2 ile kilitli.
 */
export function StaleLabelsBanner({
  rolls,
  customerId,
  customerName,
}: {
  rolls: SackContentRoll[];
  /** Çuvalın GÜNCEL müşterisi — baskı bağlamı. Müşterisiz çuvalda banner çıkmaz. */
  customerId: string | null;
  customerName: string | null;
}) {
  const qc = useQueryClient();
  const { directEnabled, printRollsBulk } = useLabelPrinter();
  const [sending, setSending] = useState(false);

  const stale = rolls.filter((r) => r.labelDirty);

  // ⚠️ HOOK'LAR ERKEN RETURN'DEN ÖNCE. `stale.length` 0↔>0 geçişinde hook sayısı
  // değişirse React "Rendered more hooks than during the previous render" ile ağacı
  // çökertir (react-hooks/rules-of-hooks). Erken return AŞAĞIDA.
  const auditMut = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(ids.map((id) => labelService.printRollLabel(id, { customerId: customerId! }))),
    onSuccess: () => invalidateSackHub(qc),
  });

  const handlePrint = async () => {
    if (sending) return;
    setSending(true);
    try {
      const ids = stale.map((r) => r.id);
      if (!directEnabled) {
        toast.error("Bu bilgisayarda etiket yazıcısı yapılandırılmamış", {
          description: "Genel Ayarlar → Bu Bilgisayar → Yazıcı'dan seçin.",
        });
        return;
      }
      // customerId ŞART — yoksa eski müşterinin şablonuyla basar (bkz. başlık notu).
      const r = await printRollsBulk(ids, undefined, customerId);
      if (!r.ok) {
        toast.error(r.error ?? "Yazıcıya gönderilemedi");
        return;
      }
      // Baskı gerçekleşti → audit + labelDirty temizliği (per-roll print event).
      await auditMut.mutateAsync(ids);
      toast.success(`${ids.length} etiket ${customerName ?? "yeni müşteri"} için yeniden basıldı`);
    } finally {
      setSending(false);
    }
  };

  // Bayat top yok VEYA müşterisiz çuval ("yeni müşteri için bas" bağlamsız) → gizle.
  // Erken return TÜM hook'lardan SONRA (yukarıdaki nota bakın).
  if (stale.length === 0 || !customerId) return null;

  return (
    <div className="px-6 py-2.5">
      <Callout
        tone="warning"
        icon={TagIcon}
        title={`${stale.length} topun etiketi yeniden basılmalı`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs">
            {customerName ?? "Yeni müşteri"} için özel etiket şablonu tanımlı — bu topların
            üstündeki etiket artık geçerli değil.
          </span>
          <PermissionGate permission="label:print">
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={sending || auditMut.isPending}
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5" />
              {sending ? "Basılıyor…" : `Hepsini bas (${stale.length})`}
            </Button>
          </PermissionGate>
        </div>
      </Callout>
    </div>
  );
}
