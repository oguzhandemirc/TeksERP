// =============================================================================
// MAKİNE KARTLARI — Tanımlar › Makine Kartları (`/definitions/machine-collectors`, makine duruşu D5)
// =============================================================================
// Tezgaha takılan kartın (toplayıcı) kaydı, düzenlemesi, sır yenilemesi, iptali. Kart kayıtla ONAYLI doğar
// (duyuru/onay akışı yok). Sır yalnız kayıt/yenileme anında bir kez gösterilir. K4: alarm ayarı kapalıysa şerit.
// Kapı: route `loom:spec-manage` + `ROUTE_MODULE` (tezgah); sunucu da aynı iki kapıyı uygular.
// =============================================================================
import { useMemo, useState } from "react";
import { TERIM_AD } from "@/lib/terim";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { k4Warning } from "./collector-model";
import { CollectorFormDialog } from "./CollectorFormDialog";
import { collectorColumns } from "./collectorColumns";
import { RevokeCollectorDialog } from "./RevokeCollectorDialog";
import { SecretRevealDialog } from "./SecretRevealDialog";
import { machineCollectorService } from "./service";
import type { MachineCollector } from "./types";
import { MACHINE_COLLECTORS_QUERY_ROOT, useCollectorActions } from "./useCollectorActions";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useListSearch } from "@/hooks/useListSearch";

type FormState = { mode: "create" } | { mode: "edit"; row: MachineCollector } | null;

export function MachineCollectorsPage() {
  const { search, setSearch, term } = useListSearch();
  const list = useQuery({ queryKey: [MACHINE_COLLECTORS_QUERY_ROOT, "list", term ?? ""], queryFn: () => machineCollectorService.list(term) });
  const warning = k4Warning(useFeatureFlags().data?.data);
  const actions = useCollectorActions();
  const [form, setForm] = useState<FormState>(null);
  const [rotating, setRotating] = useState<MachineCollector | null>(null);
  const [revoking, setRevoking] = useState<MachineCollector | null>(null);
  const rows = list.data ?? [];
  const columns = useMemo(() => collectorColumns({ busy: actions.busy, onEdit: (row) => setForm({ mode: "edit", row }), onRotate: setRotating, onRevoke: setRevoking }), [actions.busy]);
  const table = useLocalTable({ tableKey: "machine-collectors", data: rows, columns });
  return (
    <PageShell>
      <PageHeader
        title={TERIM_AD.makineVeriToplayicilari}
        description="Tezgaha takılan kartların kaydı — bağlı tezgahlar, kart tipi, sır yenileme, iptal"
        actions={
          <div className="flex gap-2">
            <RefreshButton queryKey={[MACHINE_COLLECTORS_QUERY_ROOT]} />
            <PermissionGate permission="loom:spec-manage">
              <Button onClick={() => { actions.startCreate(); setForm({ mode: "create" }); }}><Plus className="mr-1 h-4 w-4" /> Yeni kart</Button>
            </PermissionGate>
          </div>
        }
      />
      <ListToolbar className="flex-row flex-wrap items-center">
        {warning && (
          <p role="alert" className="flex flex-1 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {warning}
          </p>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Kart adı ya da bağlı tezgah kodu/adı ara" />
          <DataTableTools table={table} compact exportName="Tezgah kartları" />
        </div>
      </ListToolbar>
      {rows.length > 0 ? (
        <DataTable table={table} exportName="Tezgah kartları" />
      ) : (
        <ListBody>
          <ListMessage className="py-16 text-center text-muted-foreground">
            {list.data && term ? "Aramaya uyan kart yok." : list.data ? "Kayıtlı kart yok. Yeni kart kaydıyla başlayın." : list.isError ? "Okunamadı — bağlantıyı kontrol edip yenileyin." : "Yükleniyor…"}
          </ListMessage>
        </ListBody>
      )}
      <ListFooter loaded={list.data?.length ?? 0} />
      <CollectorFormDialog
        open={form !== null}
        onOpenChange={(o) => !o && setForm(null)}
        initial={form?.mode === "edit" ? form.row : null}
        isSubmitting={actions.busy}
        onSubmit={async (v) => {
          const ok = form?.mode === "edit" ? await actions.update(form.row, v) : await actions.create(v, setRotating);
          if (ok) setForm(null);
        }}
      />
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(o) => !o && setRotating(null)}
        title="Kart sırrı yenilensin mi?"
        description={rotating ? `${rotating.name}: eski sır o an geçersiz olur; kart yeni sır girilene dek veri gönderemez. Yeni sır bir kez gösterilir.` : undefined}
        confirmLabel="Sırrı yenile"
        destructive
        isPending={actions.busy}
        onConfirm={async () => {
          if (rotating && (await actions.rotate(rotating))) setRotating(null);
        }}
      />
      <RevokeCollectorDialog
        target={revoking}
        busy={actions.busy}
        onCancel={() => setRevoking(null)}
        onConfirm={async (c) => {
          if (await actions.revoke(c)) setRevoking(null);
        }}
      />
      <SecretRevealDialog reveal={actions.reveal} onClose={actions.closeReveal} />
    </PageShell>
  );
}
