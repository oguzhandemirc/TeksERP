// =============================================================================
// Serbest Baskı — bağlama atanmamış "serbest etiket" (bakım/statik) şablonlarını
// örnek veriyle bastırma yüzeyi. Sol tarafta seçici liste (ad + boyut rozetleri);
// bir şablona tıklayınca kanıtlanmış TemplatePrintDialog açılır (varyant seç +
// kopya + hedef). Rulo/kartela bağı yok — gerçek top gerekmez. Opsiyonel müşteri
// filtresi: seçilince o müşteriye bağlı ∪ genel (bağsız) serbest etiketler.
// =============================================================================

import { useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { loadAllForPicker } from "@/lib/picker-loader";
import { customerService } from "@/pages/Customers/service";
import { labelTemplateService, type LabelTemplate } from "@/services/labelTemplateService";
import { TemplatePrintDialog } from "@/pages/LabelTemplates/TemplatePrintDialog";

// RefreshButton prefix'i — müşteriye özel varyantların hepsini tazeler.
const QUERY_KEY: [string, string] = ["label-templates", "standalone"];
const ALL = "__all__";

export function StandalonePrintPage({
  hideHeader,
  actionsPortal,
}: { hideHeader?: boolean; actionsPortal?: HTMLElement | null } = {}) {
  const [printing, setPrinting] = useState<LabelTemplate | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [...QUERY_KEY, customerId ?? ALL],
    queryFn: () => labelTemplateService.standalonePrintList(customerId ?? undefined),
  });

  const actions = <RefreshButton queryKey={QUERY_KEY} />;

  return (
    <PageShell>
      {!hideHeader && (
        <PageHeader
          title="Serbest Baskı"
          actions={actions}
        />
      )}
      <PageBody className="p-4">
        {hideHeader && !actionsPortal && (
          <div className="mb-3 flex items-center justify-end gap-2">{actions}</div>
        )}
        {hideHeader && actionsPortal && createPortal(actions, actionsPortal)}

        <PermissionGate
          permission="label-template:read"
          fallback={
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Bu bölümü görüntüleme yetkiniz yok.
            </div>
          }
        >
          <div className="mx-auto w-full max-w-2xl">
            <CustomerFilter value={customerId} onChange={setCustomerId} />
            <TemplateList isLoading={query.isLoading} rows={query.data?.data ?? []} onPick={setPrinting} />
          </div>
        </PermissionGate>
      </PageBody>

      {printing && (
        <TemplatePrintDialog
          template={printing}
          standalone
          open
          onOpenChange={(o) => {
            if (!o) setPrinting(null);
          }}
        />
      )}
    </PageShell>
  );
}

/** Opsiyonel müşteri filtresi — seçilince liste o müşteriye bağlı ∪ genel etiketler. */
function CustomerFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const customersQ = useQuery({
    queryKey: ["customers", "picker"],
    queryFn: () => loadAllForPicker(customerService),
    staleTime: 60_000,
  });
  const customers = customersQ.data?.data ?? [];

  return (
    <div className="mb-3 space-y-1">
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger className="w-full sm:w-80">
          <SelectValue placeholder="Tüm serbest etiketler" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tüm serbest etiketler</SelectItem>
          {customers.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        Müşteri seçilince o müşteriye bağlı etiketler + genel (bağsız) etiketler
        listelenir. Genel etiketler her müşteride görünür.
      </p>
    </div>
  );
}

function TemplateList({
  isLoading,
  rows,
  onPick,
}: {
  isLoading: boolean;
  rows: LabelTemplate[];
  onPick: (t: LabelTemplate) => void;
}) {
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Henüz serbest etiket yok — Düzenler sekmesinden "Serbest etiket" oluşturun.
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {rows.map((t) => (
        <TemplateRow key={t.id} template={t} onPick={() => onPick(t)} />
      ))}
    </ul>
  );
}

function TemplateRow({ template: t, onPick }: { template: LabelTemplate; onPick: () => void }) {
  const variants = t.variants ?? [];
  return (
    <li className="flex flex-wrap items-center gap-2 p-3 text-sm">
      <div className="min-w-0 flex-1">
        <span className="font-medium">{t.name}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
          {variants.length === 0 ? (
            <span title="Kanvas varyantı yok — baskı için Stüdyoda bir boyut ekleyin">
              boyut yok
            </span>
          ) : (
            variants.map((v) => (
              <span key={v.id} className="rounded border px-1 font-mono text-[10px]" title={v.name}>
                {v.isPrimary && "★"}
                {Number(v.widthMm)}×{Number(v.heightMm)}
              </span>
            ))
          )}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onPick}
        className="gap-1"
        title="Bu serbest etiketi örnek veriyle yazdır"
      >
        <Printer className="h-3.5 w-3.5" /> Yazdır
      </Button>
    </li>
  );
}
