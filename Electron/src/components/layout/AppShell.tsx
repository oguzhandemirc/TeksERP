import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { TabHost } from "./tabs";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useTabShortcuts } from "@/hooks/useTabShortcuts";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useGlobalShortcuts({
    onOpenCommand: () => setPaletteOpen(true),
    onOpenHelp: () => setHelpOpen(true),
  });
  useTabShortcuts();

  const toggleSidebar = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sidebar.collapsed", next ? "1" : "0");
      } catch {
        /* sessiz geç */
      }
      return next;
    });

  return (
    <div className="app-bg flex h-screen w-screen flex-col overflow-hidden text-foreground">
      <Topbar
        onToggleSidebar={toggleSidebar}
        onOpenCommand={() => setPaletteOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <TabHost />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowHelp={() => setHelpOpen(true)}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
