import { RouterProvider } from "react-router-dom";
import { getTabRouter } from "./tab-routers";

/**
 * Tek bir sekmenin izole memory router'ını mount eder. Router örneği store'da
 * (openTab) kurulduğu için burada aynı önbelleğe alınmış örnek alınır — sekme
 * gizliyken bile mount kalır, böylece konum/scroll/sayfa durumu korunur.
 */
export function TabRouter({ id, path }: { id: string; path: string }) {
  const router = getTabRouter(id, path);
  return <RouterProvider router={router} />;
}
