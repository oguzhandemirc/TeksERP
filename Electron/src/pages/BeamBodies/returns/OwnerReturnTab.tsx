// "Sahibine iade" sekmesi — bizim olmayan, boş ve bizde duran gövdeler sahiplerine göre gruplu (sunucu yüklemi
// `BEAM_BODY_OWNER_RETURN_DUE_WHERE`, özet şeridiyle aynı). Bir sahibin gövdeleri seçilir → iade belgesi.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileOutput } from "lucide-react";
import { PageBody } from "@/components/layout/PageShell";
import { PermissionGate } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Callout } from "@/components/ui/callout";
import { apiErrorMessage } from "@/services/apiClient";
import { dimsText, placeText } from "../model";
import { BEAM_BODIES_QUERY_KEY, beamBodyReturnService } from "../service";
import type { OwnerReturnCandidateGroup } from "../types";
import { ReturnCreateDialog } from "./ReturnCreateDialog";

export function OwnerReturnTab({ onCreated }: { onCreated: () => void }) {
  const q = useQuery({ queryKey: [BEAM_BODIES_QUERY_KEY, "owner-return-candidates"], queryFn: () => beamBodyReturnService.candidates() });
  const [creating, setCreating] = useState<{ group: OwnerReturnCandidateGroup; ids: string[] } | null>(null);
  return (
    <PageBody className="space-y-4 p-4 sm:p-6">
      <p className="text-sm text-muted-foreground">Deverecinin, müşterinin ya da başka firmanın boşalmış ve bizde duran gövdeleri. İade belgesi kesilince gövde “Sahibine iade edildi” olur; belge iptal edilirse geri döner.</p>
      {q.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {q.isError && <Callout tone="danger">{apiErrorMessage(q.error)}</Callout>}
      {q.data && q.data.length === 0 && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Sahibine iade edilecek gövde yok.</p>}
      {q.data?.map((g) => <OwnerGroup key={g.owner.id} group={g} onCreate={(ids) => setCreating({ group: g, ids })} />)}
      {creating && (
        <ReturnCreateDialog
          owner={creating.group.owner}
          bodies={creating.group.bodies.filter((b) => creating.ids.includes(b.id))}
          onClose={() => setCreating(null)}
          onDone={() => {
            setCreating(null);
            onCreated();
          }}
        />
      )}
    </PageBody>
  );
}

function OwnerGroup({ group, onCreate }: { group: OwnerReturnCandidateGroup; onCreate: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(group.bodies.map((b) => b.id));
  const all = sel.length === group.bodies.length;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <section className="rounded-xl border border-card-border bg-card shadow-card" aria-label={group.owner.name}>
      <header className="flex flex-wrap items-center gap-3 border-b px-5 py-2.5">
        <Checkbox checked={all ? true : sel.length > 0 ? "indeterminate" : false} onCheckedChange={() => setSel(all ? [] : group.bodies.map((b) => b.id))} aria-label="Hepsini seç" />
        <h3 className="font-semibold">{group.owner.name}</h3>
        <span className="text-xs text-muted-foreground">{group.owner.code} · {group.bodies.length} gövde</span>
        <PermissionGate permission="beam-body:write">
          <Button size="sm" className="ml-auto" disabled={sel.length === 0} onClick={() => onCreate(sel)}>
            <FileOutput className="mr-1 h-4 w-4" /> İade belgesi oluştur ({sel.length})
          </Button>
        </PermissionGate>
      </header>
      <ul className="divide-y">
        {group.bodies.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-5 py-2 text-sm">
            <Checkbox checked={sel.includes(b.id)} onCheckedChange={() => toggle(b.id)} aria-label={`${b.bodyNo} seç`} />
            <span className="w-32 font-mono font-medium">{b.bodyNo}</span>
            <span className="w-40 text-muted-foreground">{b.owner.label}</span>
            <span className="flex-1 tabular-nums">{dimsText(b)}</span>
            <span className="text-muted-foreground">{placeText(b.place)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
