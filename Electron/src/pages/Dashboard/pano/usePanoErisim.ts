// Pano erişimi — ortak `useRouteAccess` (ProtectedRoute'un üç kapısı) üstünde ince ad.
import { useRouteAccess, type RouteAccess } from "@/hooks/useRouteAccess";

export type PanoErisim = RouteAccess;

export function usePanoErisim(): PanoErisim {
  return useRouteAccess();
}
