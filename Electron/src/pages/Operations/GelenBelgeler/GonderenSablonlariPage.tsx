// GÖNDEREN ŞABLONLARI (Gülkesim OCR E2) — motorun tanıdığı belge yerleşimleri + fabrikaya özgü bağ.
// Şablonun gönderen carisi taslakta gönderen önerisinin EN ÖNCESİDİR; varsayılan sahip yalnız belgedeki sahip
// adı bir öneriye varmazsa önerilir. Pasif şablon öneri vermez (okuma yine sürer). İzin `gelen-belge:template`.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { INCOMING_DOCUMENT_QUERY_KEY, listSenderTemplates, updateSenderTemplate } from "./service";
import type { SenderTemplatePatch, SenderTemplateView } from "./types";

export const SENDER_TEMPLATES_PATH = "/operations/gelen-belgeler/sablonlar";
const QUERY_KEY = [INCOMING_DOCUMENT_QUERY_KEY, "sablonlar"] as const;

function TemplateCard({ row, onPatch, busy }: { row: SenderTemplateView; onPatch: (p: SenderTemplatePatch) => void; busy: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4" data-testid={`template-${row.code}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.code} · sürüm {row.version} · {row.hitCount} okuma
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={row.isActive} disabled={busy || !row.inEngine} onCheckedChange={(v) => onPatch({ isActive: v })} aria-label={`${row.name} aktif`} />
          {row.isActive ? "Aktif" : "Pasif"}
        </label>
      </div>
      {!row.inEngine && (
        <Badge variant="outline" className="mt-2">
          Okuma motorunda artık yok
        </Badge>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Gönderen cari</div>
          <CustomerPickerField
            value={row.senderCustomer?.id ?? null}
            onChange={(id) => onPatch({ senderCustomerId: id })}
            disabled={busy}
            variant="cari"
            clearable
            placeholder="Gönderen seç"
          />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Varsayılan sahip (belgede sahip okunamazsa)</div>
          <CustomerPickerField
            value={row.defaultOwnerCustomer?.id ?? null}
            onChange={(id) => onPatch({ defaultOwnerCustomerId: id })}
            disabled={busy}
            clearable
            placeholder="Varsayılan sahip seç"
          />
        </div>
      </div>
    </div>
  );
}

export function SenderTemplatesPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: QUERY_KEY, queryFn: listSenderTemplates });
  const update = useMutation({
    mutationFn: ({ code, patch }: { code: string; patch: SenderTemplatePatch }) => updateSenderTemplate(code, patch),
    // Hata toast'u apiClient'ta; liste her durumda sunucudan tazelenir (409 sonrası güncel hâl görünsün).
    onSettled: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
  const rows = list.data ?? [];

  return (
    <PageShell>
      <PageHeader
        title="Gönderen Şablonları"
        description="Okuma motorunun tanıdığı belge yerleşimleri. Şablona bağlanan cari, o yerleşimde okunan taslakta gönderen önerisi olur."
        actions={
          <Button variant="outline" asChild>
            <Link to="/operations/gelen-belgeler">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Gelen Belgeler
            </Link>
          </Button>
        }
      />
      <PageBody className="min-h-0 space-y-3 p-4 sm:p-6">
        {list.isLoading ? (
          <div className="text-sm text-muted-foreground">Yükleniyor…</div>
        ) : list.isError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
            <p className="font-medium text-destructive">Şablonlar yüklenemedi.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Okuma motorunda gönderen şablonu yok.</div>
        ) : (
          rows.map((row) => (
            <TemplateCard
              key={row.code}
              row={row}
              busy={update.isPending && update.variables?.code === row.code}
              onPatch={(patch) => update.mutate({ code: row.code, patch })}
            />
          ))
        )}
      </PageBody>
    </PageShell>
  );
}
