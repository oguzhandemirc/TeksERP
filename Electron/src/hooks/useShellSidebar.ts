import { useCallback, useState } from "react";
import { NARROW_SHELL_QUERY, useMediaQuery } from "./useMediaQuery";

/**
 * Kabuk kenar çubuğu durumu. Geniş ekranda ikon rayı tercihi (localStorage, bugünkü
 * davranış); dar ekranda (≤1024 px) hamburgerle açılan çekmece — tercih ezilmez.
 */
export function useShellSidebar() {
  const narrow = useMediaQuery(NARROW_SHELL_QUERY);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    if (narrow) {
      setDrawerOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* sessiz geç */
      }
      return next;
    });
  };

  return { narrow, collapsed, drawerOpen, closeDrawer, toggleSidebar };
}
