// Terbiye iş emri türü seçici (K6): 1. satır Standart (Terbiye), 2. satır Özel terbiye iş emirleri (kısayol
// rotaları, `shortcutOrder` sırası + "Yeni özel terbiye iş emri" kartı, K20). Dokuma ayrı girişte (Dokuma ›
// "Dokuma İş Emri oluştur", İE ayrımı 2026-11-23). Atlanma kuralı `secici-kural.ts`.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Factory, Layers, MapPinned, Plus, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hubTone } from "@/components/hub/HubCard";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { TERIM } from "@/lib/terim";
import { useTabsStore } from "@/store/tabs";
import { listWorkOrderShortcuts, WORK_ORDER_SHORTCUTS_KEY, type WorkOrderShortcut } from "./service";
import { NEW_SHORTCUT_STATE, ROUTES_PATH, SCAN_ROUTE_HINT, SCAN_ROUTE_REF, WORK_ORDER_NEW_PATH, type OieStart } from "./nav";
import { useScanRouteOption } from "./useScanRouteOption";
import { SeciciKaro, PickerRow } from "./SeciciKaro";
import { terbiyeSeciciGosterilir } from "./secici-kural";

interface Props {
  /** Seçilecek özel seçenek yoksa doğrudan çizilen bugünkü form. */
  renderPlain: () => ReactNode;
}

/** Kısayol tanımı = rota şablonu: sayfa kapısı `station:read`, kayıt `station:write` (RoutesPage). */
export const NEW_SHORTCUT_PERMISSIONS = ["station:read", "station:write"] as const;

export function IsEmriSecici({ renderPlain }: Props) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { hasPermission } = useRoleAccess();
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
  // Liste okunamadıysa kısayol yok sayılır (giriş fabrikayı durdurmaz).
  const shortcuts = q.data ?? [];
  if (!terbiyeSeciciGosterilir({ shortcutCount: shortcuts.length, scanRoute, canNewShortcut })) return <>{renderPlain()}</>;
  const go = (start: OieStart) => navigateActive(WORK_ORDER_NEW_PATH, { state: { oie: start } });
  return (
    // PageBody kalıbı (Operasyon hub'ı): başlıkla aynı sol hiza, tek kaydırma bölgesi, tam genişlik ızgara.
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-6" data-testid="oie-picker">
      <PickerRow title="Standart" icon={Layers} testId="oie-row-standard">
        <SeciciKaro icon={Factory} tone={hubTone(0)} title={TERIM.terbiyeIsEmri.tekil} hint="Sipariş bağla ya da stoğa üret" testId="oie-terbiye" onClick={() => go({ kind: "terbiye" })} />
      </PickerRow>
      <PickerRow title={`Özel ${TERIM.terbiyeIsEmri.cogulKucuk}`} icon={Zap} testId="oie-row-shortcuts">
        {/* Okutmayla kipinde varsayılan yol: ilk karo. */}
        {scanRoute && (
          <SeciciKaro icon={MapPinned} tone={hubTone(1)} title={SCAN_ROUTE_REF.name} hint={SCAN_ROUTE_HINT} testId="oie-scan-route"
            onClick={() => go({ kind: "shortcut", route: SCAN_ROUTE_REF })} />
        )}
        {shortcuts.map((s, i) => (
          <SeciciKaro key={s.id} icon={Zap} tone={hubTone(i + 2)} title={s.name} hint={shortcutHint(s)} testId="oie-shortcut"
            onClick={() => go({ kind: "shortcut", route: { id: s.id, name: s.name, hasKursun: s.hasKursun } })} />
        ))}
        {canNewShortcut && (
          <SeciciKaro icon={Plus} tone="text-muted-foreground" dashed title={`Yeni özel ${TERIM.terbiyeIsEmri.tekilKucuk}`}
            hint="Rota şablonu tanımla — kısayol olarak burada çıkar" testId="oie-new-shortcut"
            onClick={() => navigateActive(ROUTES_PATH, { state: NEW_SHORTCUT_STATE })} />
        )}
      </PickerRow>
    </div>
  );
}

function shortcutHint(s: WorkOrderShortcut): string {
  return s.stepNames.join(" → ") || s.description || "Rota şablonu";
}
