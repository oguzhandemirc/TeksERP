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
import { commandSections, type CommandEntry } from "./command-entries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { isAdmin, hasPermission } = useRoleAccess();

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

  const isVisible = (entry: CommandEntry) => {
    if (entry.permission) return hasPermission(entry.permission);
    if (entry.adminOnly) return isAdmin;
    return true;
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Komut yaz veya ara..." />
      <CommandList>
        <CommandEmpty>Sonuç yok.</CommandEmpty>

        {commandSections.map((section) => {
          const entries = section.entries.filter(isVisible);
          if (entries.length === 0) return null;

          return (
            <CommandGroup key={section.heading} heading={section.heading}>
              {entries.map((entry) => {
                const Icon = entry.icon;
                const value = [entry.label, entry.description, section.heading]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <CommandItem
                    key={entry.key}
                    value={value}
                    onSelect={() => go(entry.to)}
                  >
                    <Icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">{entry.label}</span>
                    {entry.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {entry.description}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
