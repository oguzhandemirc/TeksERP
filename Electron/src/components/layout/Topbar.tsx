import { PanelLeft, Search, LogOut, User as UserIcon, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/store/auth";
import { useRoleAccess } from "@/hooks/useRoleAccess";

interface Props {
  onToggleSidebar: () => void;
  onOpenCommand: () => void;
}

export function Topbar({ onToggleSidebar, onOpenCommand }: Props) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { isAdmin, permissions } = useRoleAccess();
  const { theme, setTheme } = useTheme();

  return (
    <header className="app-drag flex h-12 shrink-0 items-center gap-2 border-b bg-card/40 pr-3">
      <div className="topbar-leading flex items-center gap-2 pl-3 app-no-drag">
        <Button variant="ghost" size="icon" onClick={onToggleSidebar} aria-label="Kenar çubuğu">
          <PanelLeft className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs">
            AŞ
          </div>
          <span className="text-sm">Adnan Şahin ERP</span>
        </div>

        <button
          type="button"
          onClick={onOpenCommand}
          className="ml-3 flex h-8 w-72 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:border-foreground/30 transition-colors"
        >
          <Search className="h-4 w-4" />
          <span>Hızlı arama</span>
          <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
      </div>

      <div className="ml-auto flex items-center gap-1 app-no-drag">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Tema"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <UserIcon className="h-4 w-4" />
              <span className="text-sm">{user?.username ?? "—"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{user?.username}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {isAdmin ? "Admin" : `${permissions.length} yetki`}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void logout().then(() => (window.location.hash = "#/login"));
              }}
            >
              <LogOut className="mr-2 h-4 w-4" /> Çıkış
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
