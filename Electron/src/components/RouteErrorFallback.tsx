import { useEffect } from "react";
import { useRouteError, isRouteErrorResponse } from "react-router-dom";
import { reportClientError } from "@/lib/error-report";
import { ErrorFallbackUI } from "@/components/ErrorBoundary";
import { factoryLocaleTimeString } from "@/lib/factory-time";

/** React Router errorElement — route içi hataları custom sayfamızla gösterir. */
export function RouteErrorFallback() {
  const routeError = useRouteError();
  const errorTime = factoryLocaleTimeString(new Date(), "tr-TR");
  // 404 gibi yönlendirici yanıtı hata değildir; yalnız gerçek istisna bildirilir.
  useEffect(() => {
    if (routeError instanceof Error) reportClientError(routeError, "ekran");
  }, [routeError]);

  let error: Error;
  if (routeError instanceof Error) {
    error = routeError;
  } else if (isRouteErrorResponse(routeError)) {
    error = new Error(`${routeError.status} ${routeError.statusText}`);
  } else {
    error = new Error(String(routeError ?? "Bilinmeyen hata"));
  }

  return <ErrorFallbackUI error={error} errorTime={errorTime} />;
}
