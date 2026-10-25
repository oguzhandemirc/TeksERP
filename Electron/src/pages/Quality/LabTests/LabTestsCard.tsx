// Top / parti detayındaki salt-okunur "Lab testleri" kartı. Modül kapalıysa ya da izin yoksa HİÇ çizilmez
// (istek de atılmaz) — bayrak kapalı kurulumda detay ekranı bugünküyle aynı kalır.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { fmtCalendarDay } from "@/lib/factory-time";
import { labTestService } from "./service";
import { STATUS_BADGE, STATUS_LABEL } from "./labTestRules";
import { LabTestDetailDialog } from "./LabTestDetailDialog";
import { NewLabTestDialog } from "./NewLabTestDialog";

type Subject = { rollId: string; batchId?: never; batchLabel?: never } | { batchId: string; batchLabel: string; rollId?: never };

export function LabTestsCard(props: Subject) {
  const { kaliteGuvenceEnabled } = useOperationsVisibilityContext();
  const { hasPermission } = useRoleAccess();
  const enabled = kaliteGuvenceEnabled && hasPermission("labtest:read");
  const [openId, setOpenId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const params = props.rollId ? { forRollId: props.rollId } : { batchId: props.batchId };
  const q = useQuery({ queryKey: ["lab-tests", "card", params], queryFn: () => labTestService.list({ ...params, limit: 20 }), enabled });
  if (!enabled) return null;
  const rows = q.data?.items ?? [];
  return (
    <section className="rounded-md border p-3 text-sm" aria-label="Lab testleri">
      <div className="mb-2 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium">Lab testleri</h3>
        {props.batchId && hasPermission("labtest:write") && (
          <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setFormOpen(true)}>Parti testi aç</Button>
        )}
      </div>
      {q.isLoading ? <p className="text-xs text-muted-foreground">Yükleniyor…</p>
        : q.isError ? <p className="text-xs text-destructive">Lab testleri okunamadı.</p>
        : rows.length === 0 ? <p className="text-xs text-muted-foreground">Bu {props.rollId ? "top ve partisi" : "parti"} için lab testi yok.</p>
        : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full flex-wrap items-center gap-2 py-1.5 text-left hover:bg-muted/40" onClick={() => setOpenId(r.id)}>
                  <span className="font-mono text-xs">{r.testNo}</span>
                  <span className="text-xs text-muted-foreground">{fmtCalendarDay(r.testedOn)}{!r.roll ? " · parti testi" : ""}</span>
                  <span className="ml-auto flex gap-1">
                    {r.hasFail && <Badge variant="destructive">Kalan var</Badge>}
                    <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      {openId && <LabTestDetailDialog testId={openId} onClose={() => setOpenId(null)} />}
      {formOpen && props.batchId && <NewLabTestDialog open onOpenChange={setFormOpen} onCreated={setOpenId} presetBatch={{ batchId: props.batchId, batchLabel: props.batchLabel }} />}
    </section>
  );
}
