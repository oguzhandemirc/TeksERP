import { useRouteError, isRouteErrorResponse } from "react-router-dom";
import { ErrorFallbackUI } from "@/components/ErrorBoundary";

/** React Router errorElement — route içi hataları custom sayfamızla gösterir. */
export function RouteErrorFallback() {
  const routeError = useRouteError();
  const errorTime = new Date().toLocaleTimeString("tr-TR");

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
