import {
  PanelLeft,
  Search,
  LogOut,
  User as UserIcon,
  Sun,
  Moon,
  RotateCw,
} from "lucide-react";
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
      <div className="ml-auto flex items-center gap-1 app-no-drag">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Kenar çubuğu"
          title="Kenar çubuğunu aç/kapat"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Hızlı arama"
          title="Hızlı arama (⌘K)"
          onClick={onOpenCommand}
        >
          <Search className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          aria-label="Force reload"
          title="Sayfayı yeniden yükle (Ctrl+Shift+R)"
          onClick={() => window.location.reload()}
        >
          <RotateCw className="h-4 w-4" />
        </Button>

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
