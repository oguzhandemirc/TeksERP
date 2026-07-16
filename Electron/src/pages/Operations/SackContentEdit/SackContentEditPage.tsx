import { useState } from "react";
import { PackagePlus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { SacksListView } from "./SacksListView";
import { SackEditorView } from "./SackEditorView";
import { NewSackDialog } from "./NewSackDialog";
import type { EditorTarget, SackSearchRow } from "./types";

/** Arama satırından editör hedefi türet (müşteri/şube bilgisini taşır). */
function rowToTarget(s: SackSearchRow): EditorTarget {
  return {
    sackId: s.id,
    sackNo: s.sackNo,
    customerId: s.customer?.id ?? null,
    customerName: s.customer?.name ?? null,
    branchId: s.branch?.id ?? null,
    branchName: s.branch?.name ?? null,
    branchCode: s.branch?.code ?? null,
  };
}

/**
 * Çuval Deposu / Paketleme hub — TEK ekran, iki mod:
 *  1) Liste (varsayılan): filtrele/ara, çoklu seç → sevkiyat kur.
 *  2) Editör: "Yeni Çuval" veya depodaki bir çuvala tıkla → içerik düzenle.
 * Eski ayrı "Çuval & Top Arama" ekranı bu hub'a taşındı.
 */
export function SackContentEditPage() {
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  if (target) {
    return (
      <SackEditorView
        target={target}
        onExit={() => setTarget(null)}
        onReassigned={(patch) => setTarget((t) => (t ? { ...t, ...patch } : t))}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Çuval Deposu / Paketleme"
        description="Çuvalları filtrele/ara, tıkla → içeriğini düzenle; depodaki çuvalları seç → havuzdan sevkiyat kur."
        actions={
          <>
            <Button size="sm" onClick={() => setNewOpen(true)} className="gap-1.5">
              <PackagePlus className="h-4 w-4" /> Yeni Çuval
            </Button>
            <RefreshButton
              queryKey="sack-search"
              extraKeys={[["packing"]]}
              successMessage="Çuval listesi yenilendi"
            />
          </>
        }
      />
      <SacksListView onEditSack={(s) => setTarget(rowToTarget(s))} />
      <NewSackDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(t) => setTarget(t)} />
    </div>
  );
}
