import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CrudPage } from "@/components/layout/CrudPage";
import { routeColumns } from "./columns";
import { routeService } from "./service";
import { RouteFormDialog } from "./RouteFormDialog";
import { buildRoutePayload } from "./routePayload";
import type { ProductionRoute } from "./types";
import type { RoutesNavState } from "@/pages/Operations/WorkOrders/oie/nav";
import { TERIM } from "@/lib/terim";

export function RoutesPage() {
  // "Yeni özel iş emri" kartı (K20): diyalog açık + kısayol işaretli doğar; ilk kapanışta tohum söner (sonraki "Yeni" düz).
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as RoutesNavState | null;
  const [shortcutSeed, setShortcutSeed] = useState(navState?.newShortcut === true);
  // Tohum bir kez tüketilir: geçmiş girdisinde kalırsa geri dönüşte (yeniden bağlanınca) diyalog tekrar açılırdı.
  useEffect(() => {
    if (navState?.newShortcut) void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [navState, navigate, location.pathname, location.search]);
  return (
    <CrudPage<ProductionRoute>
      title="Üretim Rotaları"
      description={`${TERIM.terbiyeIsEmri.cumleBasi.yalin} şablonları — sık kullanılan istasyon sıralarını burada tanımla.`}
      entityName="Rota"
      importEntity="route"
      queryKey="routes"
      service={routeService}
      columns={routeColumns}
      writePermission="station:write"
      searchHint="Rota adı"
      openCreateOnMount={shortcutSeed}
      renderForm={({ open, onOpenChange, initial, onSubmit, isSubmitting }) => (
        <RouteFormDialog
          open={open}
          onOpenChange={(o) => {
            if (!o) setShortcutSeed(false);
            onOpenChange(o);
          }}
          initial={initial}
          newAsShortcut={shortcutSeed}
          isSubmitting={isSubmitting}
          onSubmit={(values) =>
            onSubmit(
              buildRoutePayload(values, Boolean(initial)) as unknown as Partial<ProductionRoute>,
            ).then(() => setShortcutSeed(false))
          }
        />
      )}
    />
  );
}
