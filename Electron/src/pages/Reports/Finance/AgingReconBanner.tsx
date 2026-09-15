// =============================================================================
// MUTABAKAT BANDI — "bu rapor şu an yalan söylüyor olabilir"
// =============================================================================
// Yaşlandırmanın büyük mutabakatı: Σ(kovalar) − kapanmamış kredi = cari defteri.
// Sol taraf BELGE tablolarından (`invoices`/`payments`), sağ taraf DEFTERDEN
// (`cari_transactions`) gelir. İkisi ayrışırsa raporlardan biri yanlıştır.
//
// ⚠️ SAPMA GİZLENEMEZ ve "küçük fark" diye yuvarlanamaz. Kullanıcı bu ekrandaki
// rakama dayanarak müşteri arıyor / ödeme planlıyor; sessiz bir sapma, yanlış
// rakamla yapılmış bir tahsilat görüşmesi demektir. Bant en büyük beş sapmayı
// ADIYLA sayar — "N satır uyuşmuyor" tek başına aramaya başlanacak yeri
// söylemez.
//
// ⚠️ Kapama sayacı sapması (`Invoice.paidTotal` ↔ Σ`PaymentAllocation`) AYRI
// satırda söylenir: o, mutabakat farkının en sık KAYNAĞIDIR ve düzeltmesi de
// farklı bir iştir.
// =============================================================================

import { AlertTriangle, Info } from "lucide-react";
import { fmtInt } from "../_components/formatters";
import type { AgingReport } from "./service";

interface Props {
  recon: AgingReport["reconciliation"] | undefined;
}

export function AgingReconBanner({ recon }: Props) {
  if (!recon) return null;
  const driftCounters = recon.allocationDriftInvoices + recon.allocationDriftPayments;
  if (recon.mismatchedRows === 0 && driftCounters === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">Mutabakat bozuk — bu rakamlara dayanarak işlem yapmayın.</p>
        {recon.mismatchedRows > 0 ? (
          <p className="mt-0.5">
            {fmtInt(recon.mismatchedRows)} satırda yaşlandırma ile cari defteri uyuşmuyor. En büyük
            sapmalar:{" "}
            {recon.samples
              .slice(0, 5)
              .map((s) => `${s.name} (${s.diff} ${s.currency})`)
              .join(" · ")}
          </p>
        ) : null}
        {driftCounters > 0 ? (
          <p className="mt-0.5">
            Kapama sayaçları sapmış: {fmtInt(recon.allocationDriftInvoices)} fatura,{" "}
            {fmtInt(recon.allocationDriftPayments)} tahsilat. Açık tutar bu yüzden yanlış hesaplanmış
            olabilir.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Kapsam bandı: yaşlandırmanın KESİT olduğunu ve işaret sözleşmesini söyler.
 * Sayfadan ayrı bileşen — metin uzun, sayfa gövdesi okunurluk sınırındaydı.
 */
export function AgingScopeNote() {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Bu rapor bir <strong>kesittir</strong>: seçilen günün sonu itibarıyla birikmiş açık bakiyeyi
        gösterir, tarih aralığı almaz. Tutarlar cari bakiyesiyle aynı işaret sözleşmesini taşır:{" "}
        <strong>pozitif = cari bize borçlu</strong>, negatif = biz ona borçluyuz.
      </span>
    </div>
  );
}
