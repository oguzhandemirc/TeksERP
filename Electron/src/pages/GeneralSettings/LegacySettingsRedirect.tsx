import { Navigate, useSearchParams } from "react-router-dom";
import { legacySettingsTarget } from "./legacy-settings";

/** Eski "Genel Ayarlar" adresi — yeni ekrana `replace` ile yönlendirir. */
export function LegacySettingsRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={legacySettingsTarget(params.get("tab"))} replace />;
}
