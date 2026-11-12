import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { cn } from "@/lib/utils";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { documentTemplateService } from "@/services/documentTemplateService";
import type { TemplateAccess } from "../templates/useTemplateAccess";
import { docTypeLabel } from "../useDesignerDraft";
import { AssignDialog, type AssignTarget } from "./AssignDialog";
import { assignableTemplates, defaultOf, profilesShieldedFromDefault } from "./assignmentModel";
import { assignmentColumns } from "./assignmentColumns";

/** Atamalar (plan §3.7): solda tür listesi; sağda tür varsayılanı + profil × şablon ızgarası. */
export function AssignmentsView({ access }: { access: TemplateAccess }) {
  const contractsQ = useQuery({ queryKey: ["document-templates", "contracts"], queryFn: () => documentTemplateService.contracts() });
  // Profil/cari bağı başka ekranda değişir: sekme açılışında taze oku (önbellekte eksik profil kalmasın).
  const assignQ = useQuery({ queryKey: ["document-templates", "assignments"], staleTime: 0, queryFn: () => documentTemplateService.assignments() });
  const listQ = useQuery({ queryKey: ["document-templates", "list", "ACTIVE"], queryFn: () => documentTemplateService.listAll({ status: "ACTIVE" }) });
  const types = (contractsQ.data?.data ?? []).map((c) => c.docType);
  const [picked, setPicked] = useState<string | null>(null);
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const docType = picked ?? types[0] ?? null;
  const a = assignQ.data?.data;
  const catalog = a?.profileCatalog ?? [];
  const candidates = useMemo(() => (docType ? assignableTemplates(listQ.data?.data ?? [], docType) : []), [docType, listQ.data]);
  const block = access.designBlock;
  const def = docType ? defaultOf(a, docType) : null;
  const columns = useMemo(
    () => (docType ? assignmentColumns({ a, docType, def, candidates, block, onAssign: setTarget }) : []),
    [a, docType, def, candidates, block],
  );
  const table = useLocalTable({ tableKey: "document-templates:assignments", data: catalog, columns });

  if (contractsQ.isLoading || assignQ.isLoading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Atamalar yükleniyor…</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col border-t md:flex-row">
      <nav aria-label="Belge türleri" className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-56 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
        {types.map((t) => (
          <button key={t} type="button" aria-current={t === docType} onClick={() => setPicked(t)}
            className={cn("shrink-0 rounded px-2 py-1.5 text-left text-xs", t === docType ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {docTypeLabel(t)}
            {defaultOf(a, t) && <span className="ml-1 opacity-70">· {defaultOf(a, t)!.name}</span>}
          </button>
        ))}
      </nav>
      {docType && (
        // Liste standardı: sabit üst bant (not + tür varsayılanı) → kenardan kenara profil tablosu → alt şerit.
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="atama-paneli">
          <ListToolbar>
            {a?.note && <Callout tone="info" title="Profil ezmesi">{a.note}</Callout>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">Tür varsayılanı:</span>
              <span className="text-sm">{def?.name ?? "Sistem tasarımı"}</span>
              <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" disabled={!!block} title={block ?? undefined}
                onClick={() => setTarget({ docType, profile: null, current: def, candidates, shielded: profilesShieldedFromDefault(catalog, a, docType) })}>
                Değiştir
              </Button>
              <DataTableTools table={table} compact exportName="Şablon atamaları" />
            </div>
          </ListToolbar>
          {catalog.length > 0 ? (
            <DataTable table={table} exportName="Şablon atamaları" />
          ) : (
            <ListBody>
              <ListMessage className="text-center text-sm text-muted-foreground">Belge profili yok — müşteri/fasoncuya özel tasarım için önce profil tanımlayın.</ListMessage>
            </ListBody>
          )}
          <ListFooter loaded={catalog.length} label={`${catalog.length} belge profili`} />
        </div>
      )}
      {target && <AssignDialog target={target} note={a?.note} onClose={() => setTarget(null)} />}
    </div>
  );
}
