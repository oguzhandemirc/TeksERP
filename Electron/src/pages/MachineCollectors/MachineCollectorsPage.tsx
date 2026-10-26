// =============================================================================
// MAKİNE KARTLARI — Tanımlar › Makine Kartları (`/definitions/machine-collectors`, makine duruşu D5)
// =============================================================================
// Tezgaha takılan kartın (toplayıcı) kaydı, düzenlemesi, sır yenilemesi, iptali. Kart kayıtla ONAYLI doğar
// (duyuru/onay akışı yok). Sır yalnız kayıt/yenileme anında bir kez gösterilir. K4: alarm ayarı kapalıysa şerit.
// Kapı: route `loom:spec-manage` + `ROUTE_MODULE` (tezgah); sunucu da aynı iki kapıyı uygular.
// =============================================================================
import { useState } from "react";
import { TERIM_AD } from "@/lib/terim";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { k4Warning } from "./collector-model";
import { CollectorFormDialog } from "./CollectorFormDialog";
import { CollectorTable } from "./CollectorTable";
import { RevokeCollectorDialog } from "./RevokeCollectorDialog";
import { SecretRevealDialog } from "./SecretRevealDialog";
import { machineCollectorService } from "./service";
import type { MachineCollector } from "./types";
import { MACHINE_COLLECTORS_QUERY_ROOT, useCollectorActions } from "./useCollectorActions";

type FormState = { mode: "create" } | { mode: "edit"; row: MachineCollector } | null;

export function MachineCollectorsPage() {
  const list = useQuery({ queryKey: [MACHINE_COLLECTORS_QUERY_ROOT, "list"], queryFn: () => machineCollectorService.list() });
  const warning = k4Warning(useFeatureFlags().data?.data);
  const actions = useCollectorActions();
  const [form, setForm] = useState<FormState>(null);
  const [rotating, setRotating] = useState<MachineCollector | null>(null);
  const [revoking, setRevoking] = useState<MachineCollector | null>(null);
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
      <PageBody className="space-y-4 p-4">
        {warning && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {warning}
          </p>
        )}
        {list.data ? (
          <CollectorTable rows={list.data} busy={actions.busy} onEdit={(row) => setForm({ mode: "edit", row })} onRotate={setRotating} onRevoke={setRevoking} />
        ) : (
          <p className="py-16 text-center text-muted-foreground">{list.isError ? "Okunamadı — bağlantıyı kontrol edip yenileyin." : "Yükleniyor…"}</p>
        )}
      </PageBody>
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
