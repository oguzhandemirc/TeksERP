import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { navGroups } from "./nav-config";
import { definitionTiles } from "@/pages/Definitions/tile-config";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { isAdmin, hasPermission } = useRoleAccess();
  void isAdmin;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Komut yaz veya ara..." />
      <CommandList>
        <CommandEmpty>Sonuç yok.</CommandEmpty>

        {navGroups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item) => {
              if (item.adminOnly && !hasPermission("admin:users") && !hasPermission("admin:settings") && !hasPermission("admin:*")) return null;
              if (item.permission && !hasPermission(item.permission)) return null;
              const Icon = item.icon;
              return (
                <CommandItem key={item.to} onSelect={() => go(item.to)}>
                  <Icon className="mr-2 h-4 w-4" />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}

        <CommandGroup heading="Tanımlar">
          {definitionTiles.map((tile) => (
            <CommandItem key={tile.to} onSelect={() => go(tile.to)}>
              <tile.icon className="mr-2 h-4 w-4" />
              {tile.title}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
