import { AlertTriangle } from "lucide-react";
import { TraceLink } from "@/components/audit/TraceLink";
import { fmtDate } from "../_components/formatters";
import type { BatchTrace } from "./batchTrace";

/**
 * Parti kartı (kimlik şeridi). Numaranın benzersiz olmadığı ekranda da yazılı:
 * aksi halde kullanıcı seçtiği adayın "o parti" olduğundan emin olmadan rapor okur.
 * "İz sür" parti no ile aranamaz (benzersiz değil) — terbiye iş emri numarasıyla gider.
 */
export function BatchIdentityStrip({ batch }: { batch: BatchTrace["batch"] }) {
  const wo = batch.workOrderNumber;
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <strong>{batch.batchNumber}</strong> · {wo ? `Terbiye İş Emri ${wo}` : "terbiye iş emri bağı yok"} ·{" "}
        {fmtDate(batch.createdAt)}. Parti numarası benzersiz değildir; bu döküm{" "}
        <strong>seçtiğiniz partiye</strong> aittir.
      </span>
      <TraceLink
        className="ml-auto shrink-0"
        recordNo={wo}
        title={`Terbiye İş Emri ${wo ?? ""} için işlem geçmişi (Etkinlik → İşlemler)`}
      />
    </div>
  );
}
