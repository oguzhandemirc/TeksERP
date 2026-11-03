// İş emri türü seçici (K6): 1. satır Standart (Terbiye · Dokuma — modül/izin yoksa gizli), 2. satır Özel iş emirleri
// (kısayol rotaları, `shortcutOrder` sırası + "Yeni özel iş emri" kartı, K20). Tek tür kalırsa seçici atlanır = bugünkü form.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, Factory, Layers, MapPinned, Plus, Spool, Zap, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HubGrid, hubTone } from "@/components/hub/HubCard";
import { useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { cn } from "@/lib/utils";
import { springSnappy, staggerItem } from "@/lib/motion";
import { TERIM } from "@/lib/terim";
import { useTabsStore } from "@/store/tabs";
import { listWorkOrderShortcuts, WORK_ORDER_SHORTCUTS_KEY, type WorkOrderShortcut } from "./service";
import {
  NEW_SHORTCUT_STATE, ROUTES_PATH, SCAN_ROUTE_HINT, SCAN_ROUTE_REF, WEAVING_ORDERS_PATH, WORK_ORDER_NEW_PATH, type OieStart, type WeavingNavState,
} from "./nav";
import { useScanRouteOption } from "./useScanRouteOption";

interface Props {
  /** Yalnız Terbiye seçilebiliyorsa doğrudan çizilen bugünkü form. */
  renderPlain: () => ReactNode;
}

/** Kısayol tanımı = rota şablonu: sayfa kapısı `station:read`, kayıt `station:write` (RoutesPage). */
export const NEW_SHORTCUT_PERMISSIONS = ["station:read", "station:write"] as const;

export function IsEmriSecici({ renderPlain }: Props) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { hasPermission } = useRoleAccess();
  const dokumaOn = useDokumaEnabled();
  const canWeaving = dokumaOn && hasPermission("weavingorder:write");
  const canNewShortcut = NEW_SHORTCUT_PERMISSIONS.every((p) => hasPermission(p));
  const scanRoute = useScanRouteOption();
  const q = useQuery({ queryKey: WORK_ORDER_SHORTCUTS_KEY, queryFn: listWorkOrderShortcuts, staleTime: 60_000 });
  if (q.isLoading) {
    return (
      <div className="grid gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" />
      </div>
    );
  }
  // Liste okunamadıysa kısayol yok sayılır (giriş fabrikayı durdurmaz). "Yeni özel" kartı bir iş emri TÜRÜ değildir:
  // seçicinin atlanma kuralına girmez (kısayolsuz + dokumasız kurulumda bugünkü doğrudan form).
  const shortcuts = q.data ?? [];
  if (shortcuts.length === 0 && !canWeaving && !scanRoute) return <>{renderPlain()}</>;
  const go = (start: OieStart) => navigateActive(WORK_ORDER_NEW_PATH, { state: { oie: start } });
  const weavingState: WeavingNavState = { openNew: true };
  const showShortcutRow = shortcuts.length > 0 || canNewShortcut || scanRoute;
  return (
    // PageBody kalıbı (Operasyon hub'ı): başlıkla aynı sol hiza, tek kaydırma bölgesi, tam genişlik ızgara.
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6" data-testid="oie-picker">
      <Row title="Standart" icon={Layers} testId="oie-row-standard">
        <Tile icon={Factory} tone={hubTone(0)} title={TERIM.terbiyeIsEmri.tekil} hint="Sipariş bağla ya da stoğa üret" testId="oie-terbiye" onClick={() => go({ kind: "terbiye" })} />
        {canWeaving && (
          <Tile icon={Spool} tone={hubTone(1)} title={TERIM.dokumaIsEmri.tekil} hint="Ne dokunacak, ne kadar, kimde" testId="oie-dokuma"
            onClick={() => navigateActive(WEAVING_ORDERS_PATH, { state: weavingState })} />
        )}
      </Row>
      {showShortcutRow && (
        <Row title={`Özel ${TERIM.terbiyeIsEmri.cogulKucuk}`} icon={Zap} testId="oie-row-shortcuts">
          {/* Okutmayla kipinde varsayılan yol: ilk karo. */}
          {scanRoute && (
            <Tile icon={MapPinned} tone={hubTone(1)} title={SCAN_ROUTE_REF.name} hint={SCAN_ROUTE_HINT} testId="oie-scan-route"
              onClick={() => go({ kind: "shortcut", route: SCAN_ROUTE_REF })} />
          )}
          {shortcuts.map((s, i) => (
            <Tile key={s.id} icon={Zap} tone={hubTone(i + 2)} title={s.name} hint={shortcutHint(s)} testId="oie-shortcut"
              onClick={() => go({ kind: "shortcut", route: { id: s.id, name: s.name, hasKursun: s.hasKursun } })} />
          ))}
          {canNewShortcut && (
            <Tile icon={Plus} tone="text-muted-foreground" dashed title={`Yeni özel ${TERIM.terbiyeIsEmri.tekilKucuk}`}
              hint="Rota şablonu tanımla — kısayol olarak burada çıkar" testId="oie-new-shortcut"
              onClick={() => navigateActive(ROUTES_PATH, { state: NEW_SHORTCUT_STATE })} />
          )}
        </Row>
      )}
    </div>
  );
}

function shortcutHint(s: WorkOrderShortcut): string {
  return s.stepNames.join(" → ") || s.description || "Rota şablonu";
}

function Row({ title, icon: Icon, testId, children }: { title: string; icon: LucideIcon; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId}>
      <div className="mb-3 flex items-baseline gap-2">
        <Icon className="h-4 w-4 self-center text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <HubGrid className="2xl:grid-cols-4">{children}</HubGrid>
    </section>
  );
}

interface TileProps {
  icon: LucideIcon;
  tone: string;
  title: string;
  hint: string;
  testId: string;
  dashed?: boolean;
  onClick: () => void;
}

/** HubCard görünümü; fark: gezinme `state` taşır (HubCard yalnız adres alır). */
function Tile({ icon: Icon, tone, title, hint, testId, dashed, onClick }: TileProps) {
  return (
    <motion.div variants={staggerItem} whileHover={{ y: -3 }} transition={springSnappy} className="relative h-full">
      <button type="button" onClick={onClick} data-testid={testId} className="group block h-full w-full text-left">
        <Card className={cn("card-glow relative h-full overflow-hidden bg-gradient-to-br from-primary/5 to-transparent p-4", dashed && "border-dashed bg-none")}>
          <div className="relative flex items-start justify-between">
            <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-current/10", tone)}>
              <Icon className="h-5 w-5" />
            </div>
            <ArrowRight className={cn("h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100", tone)} />
          </div>
          <div className="relative mt-4 font-medium">{title}</div>
          <p className="relative mt-1 text-xs text-muted-foreground">{hint}</p>
        </Card>
      </button>
    </motion.div>
  );
}
