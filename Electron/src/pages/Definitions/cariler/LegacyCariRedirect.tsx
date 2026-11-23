import { Navigate, useSearchParams } from "react-router-dom";
import { legacyCariTarget, type LegacyCariScreen } from "./legacy-cari";

/** Eski Müşteriler / Fason Firmalar adresi — Cariler'e `replace` ile yönlendirir (geri tuşu döngüye girmesin). */
export function LegacyCariRedirect({ screen }: { screen: LegacyCariScreen }) {
  const [params] = useSearchParams();
  return <Navigate to={legacyCariTarget(screen, params)} replace />;
}
