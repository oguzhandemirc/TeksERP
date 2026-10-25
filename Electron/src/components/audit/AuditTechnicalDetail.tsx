import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { systemLogService } from "@/services/systemLogService";
import { AuditChangeList } from "@/components/AuditChangeList";
import { AuditNarrativeRow } from "@/components/audit/AuditNarrativeRow";
import { actionLabel } from "@/pages/System/Activity/labels";
import type { SystemLogIslemDetay, SystemLogTraceSummary } from "@/types/systemLog";

// =============================================================================
// TEKNİK AYRINTI (katlı) — "hangi uca ne gitti, DB'ye ne yazıldı" (izlenebilirlik B3)
// =============================================================================
// İz alanları TEK TEK seçilir (yayma yok): istek GÖVDESİ sunucuda saklanmaz ve
// burada da asla çizilmez (parola/PIN). Bekçi: audit-technical-detail.test.
// Eski backend (`/islem/:id` 404) ya da iz yoksa yalnız audit alanları (`fallback`).
// =============================================================================

interface Props {
  requestId: string | null;
  /** İz yokken basılacak audit alanları (kullanıcı, tarih, kayıt…). */
  fallback?: ReactNode;
  /** İşlem ucu yokken "Ham veri (adli inceleme)" içeriği. */
  rawFallback?: ReactNode;
  defaultOpen?: boolean;
}

const CLIENT_KIND: Record<string, string> = {
  desktop: "Masaüstü",
  panel: "Masaüstü",
  electron: "Masaüstü",
  web: "Web",
  tablet: "Tablet",
  phone: "Telefon",
  mobile: "Mobil",
};

export function clientKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return CLIENT_KIND[kind.toLowerCase()] ?? kind;
}

export function AuditTechnicalDetail({ requestId, fallback, rawFallback, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const q = useQuery({
    queryKey: ["system-log-islem", requestId],
    queryFn: () => systemLogService.getIslem(requestId!).then((r) => r.data),
    enabled: open && !!requestId,
    staleTime: 60_000,
    retry: false,
  });
  const islem = q.data ?? null;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-md border bg-card/20 p-2"
      data-testid="audit-technical-detail"
    >
      <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground">
        Teknik ayrıntı
      </summary>
      {open && (
        <div className="mt-2 space-y-3 text-sm">
          {q.isLoading && requestId ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> yükleniyor…
            </div>
          ) : islem?.iz ? (
            <TraceHeader iz={islem.iz} requestId={islem.requestId} />
          ) : (
            <>
              {fallback}
              <p className="text-xs text-muted-foreground">
                {requestId
                  ? "Bu işlemin istek izi yok (90 günden eski ya da sunucu sürümü izi tutmuyor)."
                  : "Bu kayıt bir istekten doğmamış (arka plan işi ya da eski kayıt)."}
              </p>
            </>
          )}
          {islem && islem.kayitlar.length > 0 && <AffectedRecords kayitlar={islem.kayitlar} />}
          {(islem ? islem.ham.length > 0 : !!rawFallback) && (
            <details className="rounded border bg-muted/20 p-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">Ham veri (adli inceleme)</summary>
              {islem ? (
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-[11px]">
                  {JSON.stringify(islem.ham, null, 2)}
                </pre>
              ) : (
                <div className="mt-2">{rawFallback}</div>
              )}
            </details>
          )}
        </div>
      )}
    </details>
  );
}

function TraceHeader({ iz, requestId }: { iz: SystemLogTraceSummary; requestId: string }) {
  const kind = clientKindLabel(iz.clientType);
  const device = [iz.cihazAdi ?? iz.deviceLocalId, kind ? `(${kind})` : null].filter(Boolean).join(" ");
  const app = iz.appVersion ? `Sürüm ${iz.appVersion}` : null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs">
        <span className="font-semibold">{iz.method}</span>
        <span className="break-all">{iz.routeKey}</span>
        <span className="text-muted-foreground">·</span>
        <span className={iz.status >= 400 ? "text-red-600 dark:text-red-400" : undefined}>
          {iz.status}
          {iz.errorCode ? ` ${iz.errorCode}` : ""}
        </span>
        {iz.durationMs != null && (
          <>
            <span className="text-muted-foreground">·</span>
            <span>{iz.durationMs} ms</span>
          </>
        )}
        <span className="text-muted-foreground">·</span>
        <span title={requestId}>İşlem no {requestId.slice(0, 8)}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={() => {
            void navigator.clipboard?.writeText(requestId).then(() => toast.success("İşlem no kopyalandı"));
          }}
          aria-label="İşlem numarasını kopyala"
        >
          <Copy className="h-3 w-3" /> kopyala
        </button>
      </div>
      <div className="text-xs text-muted-foreground">
        {[device || "Cihaz bilinmiyor", app, iz.ip ?? null].filter(Boolean).join(" · ")}
      </div>
    </div>
  );
}

function AffectedRecords({ kayitlar }: { kayitlar: SystemLogIslemDetay["kayitlar"] }) {
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">Modül</th>
            <th className="px-2 py-1 font-medium">Kayıt</th>
            <th className="px-2 py-1 font-medium">İşlem</th>
            <th className="px-2 py-1 font-medium">Değişenler</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {kayitlar.map((k) => {
            const recordPart = k.anlati?.parcalar.find((p) => p.t === "kayit");
            return (
              <tr key={k.id} className="align-top">
                <td className="px-2 py-1">{k.modul}</td>
                <td className="px-2 py-1">
                  <AuditNarrativeRow
                    anlati={recordPart ? { parcalar: [recordPart], metin: recordPart.text } : null}
                    fallback={<span className="font-mono text-[11px]">#{k.recordId.slice(0, 8)}</span>}
                    className="text-xs"
                  />
                </td>
                <td className="px-2 py-1">{actionLabel(k.action)}</td>
                <td className="px-2 py-1">
                  {k.changes && k.changes.length > 0 ? (
                    <div className="text-xs">
                      <AuditChangeList changes={k.changes} />
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
