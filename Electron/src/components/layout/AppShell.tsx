import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "./CommandPalette";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Topbar
        onToggleSidebar={() => setCollapsed((c) => !c)}
        onOpenCommand={() => setPaletteOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} />
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
