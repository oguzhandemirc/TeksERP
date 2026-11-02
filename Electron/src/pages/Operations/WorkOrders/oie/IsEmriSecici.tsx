// İş emri türü seçici (K6): 1. satır Standart (Terbiye · Dokuma — modül/izin yoksa gizli), 2. satır Özel iş emirleri
// (kısayol rotaları, `shortcutOrder` sırası; yoksa satır yok). Tek seçenek kalırsa seçici atlanır = bugünkü form.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory, Spool, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { TERIM } from "@/lib/terim";
import { useTabsStore } from "@/store/tabs";
import { listWorkOrderShortcuts, WORK_ORDER_SHORTCUTS_KEY, type WorkOrderShortcut } from "./service";
import { WEAVING_ORDERS_PATH, WORK_ORDER_NEW_PATH, type OieStart, type WeavingNavState } from "./nav";

interface Props {
  /** Yalnız Terbiye seçilebiliyorsa doğrudan çizilen bugünkü form. */
  renderPlain: () => ReactNode;
}

export function IsEmriSecici({ renderPlain }: Props) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { hasPermission } = useRoleAccess();
  const dokumaOn = useDokumaEnabled();
  const canWeaving = dokumaOn && hasPermission("weavingorder:write");
  const q = useQuery({ queryKey: WORK_ORDER_SHORTCUTS_KEY, queryFn: listWorkOrderShortcuts, staleTime: 60_000 });
  if (q.isLoading) {
    return <div className="mx-auto w-full max-w-4xl space-y-3 p-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>;
  }
  // Liste okunamadıysa kısayol yok sayılır (giriş fabrikayı durdurmaz).
  const shortcuts = q.data ?? [];
  if (shortcuts.length === 0 && !canWeaving) return <>{renderPlain()}</>;
  const go = (start: OieStart) => navigateActive(WORK_ORDER_NEW_PATH, { state: { oie: start } });
  const weavingState: WeavingNavState = { openNew: true };
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 overflow-y-auto p-6" data-testid="oie-picker">
      <Row title="Standart" testId="oie-row-standard">
        <Tile icon={<Factory className="h-5 w-5" />} title={TERIM.terbiyeIsEmri.tekil} hint="Sipariş bağla ya da stoğa üret" testId="oie-terbiye" onClick={() => go({ kind: "terbiye" })} />
        {canWeaving && (
          <Tile icon={<Spool className="h-5 w-5" />} title={TERIM.dokumaIsEmri.tekil} hint="Ne dokunacak, ne kadar, kimde" testId="oie-dokuma"
            onClick={() => navigateActive(WEAVING_ORDERS_PATH, { state: weavingState })} />
        )}
      </Row>
      {shortcuts.length > 0 && (
        <Row title="Özel iş emirleri" testId="oie-row-shortcuts">
          {shortcuts.map((s) => (
            <Tile key={s.id} icon={<Zap className="h-5 w-5" />} title={s.name} hint={shortcutHint(s)} testId="oie-shortcut"
              onClick={() => go({ kind: "shortcut", route: { id: s.id, name: s.name } })} />
          ))}
        </Row>
      )}
    </div>
  );
}

function shortcutHint(s: WorkOrderShortcut): string {
  return s.stepNames.join(" → ") || s.description || "Rota şablonu";
}

function Row({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

interface TileProps {
  icon: ReactNode;
  title: string;
  hint: string;
  testId: string;
  onClick: () => void;
}

function Tile({ icon, title, hint, testId, onClick }: TileProps) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary hover:bg-primary/5">
      <span className="mt-0.5 text-primary">{icon}</span>
      <span className="flex flex-col gap-1">
        <span className="text-base font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
