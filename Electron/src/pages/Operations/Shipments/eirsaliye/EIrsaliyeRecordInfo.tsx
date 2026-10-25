// Kaydın künyesi: numara/ETTN (kopyala), portal teyidi farklıysa ikisi, XML sürüm + sha,
// taşıma. TCKN kartta MASKELİ — tam değer yalnız düzenleme penceresinde.
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { EIrsaliyeRecordView } from "./types";

export function maskNationalId(v: string | null | undefined): string | null {
  if (!v) return null;
  return `${"•".repeat(Math.max(v.length - 2, 0))}${v.slice(-2)}`;
}

const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" ") || null;

export function EIrsaliyeRecordInfo({ r }: { r: EIrsaliyeRecordView }) {
  const xml = r.xmlSurumleri[r.xmlSurumleri.length - 1];
  const noDiffers = Boolean(r.confirmedNo && r.confirmedNo !== r.documentNo);
  const ettnDiffers = Boolean(r.confirmedEttn && r.confirmedEttn !== r.ettn);
  const tckn = maskNationalId(r.driverNationalId);
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs" data-testid="eirsaliye-info">
      <Row label="Belge no" value={r.documentNo} copy mono />
      <Row label="ETTN" value={r.ettn} copy mono />
      {noDiffers && <Row label="Portal belge no" value={r.confirmedNo} copy mono />}
      {ettnDiffers && <Row label="Portal ETTN" value={r.confirmedEttn} copy mono />}
      {xml && <Row label="XML" value={`v${xml.version} · sha ${xml.sha256.slice(0, 10)}`} mono />}
      {r.downloadCount > 0 && (
        <Row label="İndirme" value={`${r.downloadCount} kez · son ${fmtFactoryDateTime(r.lastDownloadedAt)}`} />
      )}
      <Row label="Araç" value={join(r.licensePlate, r.trailerPlate ? `· dorse ${r.trailerPlate}` : null)} />
      <Row label="Şoför" value={join(r.driverFirstName, r.driverFamilyName, tckn ? `· TCKN ${tckn}` : null)} />
      {r.carrierName && <Row label="Taşıyıcı" value={join(r.carrierName, r.carrierTaxId ? `· ${r.carrierTaxId}` : null)} />}
      {(r.recipientFirstName || r.recipientFamilyName) && (
        <Row label="Müşteri kişi" value={join(r.recipientFirstName, r.recipientFamilyName)} />
      )}
      {r.responseNote && <Row label="Yanıt notu" value={r.responseNote} />}
    </dl>
  );
}

function Row({ label, value, copy = false, mono = false }: { label: string; value: string | null; copy?: boolean; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`flex min-w-0 items-start gap-1 ${mono ? "font-mono" : ""}`}>
        <span className="min-w-0 break-all">{value || "—"}</span>
        {copy && value && (
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title={`${label} kopyala`}
            aria-label={`${label} kopyala`}
            onClick={() => void copyText(value).then(() => toast.success(`${label} kopyalandı.`))}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </dd>
    </>
  );
}
