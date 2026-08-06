import { useEffect, useState } from "react";
import { Keyboard, LogOut, Moon, RotateCw, Rows3, Star, type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { useOperationsVisibilityContext } from "@/pages/Operations/useOperationsVisibility";
import { useFavorites } from "@/hooks/useFavorites";
import { usePreferences } from "@/providers/PreferencesProvider";
import { useAuthStore } from "@/store/auth";
import { useTabsStore } from "@/store/tabs";
import { commandSections, findCommandEntry, type CommandEntry } from "./command-entries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowHelp?: () => void;
}

export function CommandPalette({ open, onOpenChange, onShowHelp }: Props) {
  const navigateActive = useTabsStore((s) => s.navigateActive);
  const { isAdmin, hasPermission, hasAnyPermission } = useRoleAccess();
  // Operasyon karolarının duruma bağlı görünürlüğü palette de geçerlidir — aksi
  // halde hub'da gizlenen ekran buradan hâlâ açılırdı. "Kurşun Sırası"nda bu
  // somut bir hataydı: route kapısı aynı koşulu uyguladığı için paletten seçen
  // kullanıcı sayfa yerine hub'a atılıyordu.
  const visibilityCtx = useOperationsVisibilityContext();
  const { favorites } = useFavorites();
  const { prefs, setPreference } = usePreferences();
  const { theme, setTheme } = useTheme();
  const logout = useAuthStore((s) => s.logout);
  // Arama metni bizde: "alt başlık" girişleri (sekmeler, tek tek ayarlar, hub
  // bölümleri) YALNIZ arama yapılırken listelenir — boş palet sayfa listesi
  // olarak sade kalsın, arama ise tam katalogda koşsun.
  const [search, setSearch] = useState("");
  const searching = search.trim().length > 0;

  // Palet kapanınca arama sıfırlanır: bir sonraki Ctrl+K önceki sorgunun
  // süzdüğü listeyle açılmamalı (cmdk kendi state'ini korur).
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

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
    navigateActive(to);
  };

  const runAction = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  /** Kullanıcı bu girişi AÇABİLİR mi (izin + duruma bağlı görünürlük). */
  const isAllowed = (entry: CommandEntry) => {
    // Durum süzgeci İZİNDEN ÖNCE: yüklem "bu ekranın şu an yapacağı iş var mı"
    // sorusunu yanıtlar, izinden bağımsızdır ve ikisi VE ile birleşir.
    if (entry.visibleWhen && !entry.visibleWhen(visibilityCtx)) return false;
    if (entry.permissionAny) return hasAnyPermission(entry.permissionAny);
    if (entry.permission) return hasPermission(entry.permission);
    if (entry.adminOnly) return isAdmin;
    return true;
  };

  /** Katalog listesinde ŞU AN çizilir mi — alt başlıklar yalnız arama sırasında. */
  const isVisible = (entry: CommandEntry) => isAllowed(entry) && (searching || !entry.deep);

  // Favoriler `deep` süzgecine TABİ DEĞİL: kullanıcı bir sayfayı bilerek
  // sabitlemişse, o sayfa alt başlık katalogundan gelse bile favorisi boş
  // palette görünmeli (aksi halde yıldızladığı satır kaybolur).
  const favEntries = favorites
    .map(findCommandEntry)
    .filter((e): e is CommandEntry => Boolean(e))
    .filter(isAllowed);

  const nextTheme = theme === "dark" ? "light" : "dark";
  const nextDensity = prefs.density === "compact" ? "comfortable" : "compact";
  const actions: { key: string; label: string; icon: LucideIcon; run: () => void }[] = [
    {
      key: "theme",
      label: theme === "dark" ? "Açık temaya geç" : "Koyu temaya geç",
      icon: Moon,
      run: () => {
        setTheme(nextTheme);
        setPreference({ theme: nextTheme });
      },
    },
    {
      key: "density",
      label: prefs.density === "compact" ? "Rahat moda geç" : "Sıkışık moda geç",
      icon: Rows3,
      run: () => setPreference({ density: nextDensity }),
    },
    { key: "reload", label: "Sayfayı yenile", icon: RotateCw, run: () => window.location.reload() },
    { key: "help", label: "Klavye kısayolları", icon: Keyboard, run: () => onShowHelp?.() },
    {
      key: "logout",
      label: "Çıkış yap",
      icon: LogOut,
      run: () => void logout().then(() => (window.location.hash = "#/login")),
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Sayfa, rapor, ayar ara..."
        value={search}
        onValueChange={setSearch}
      />
      {/* Katalog büyük (tüm sayfalar + raporlar + alt başlıklar) — liste
          yüksekliği primitifin 300px'ini aşar, ekrana göre büyür. */}
      <CommandList className="max-h-[min(60vh,32rem)]">
        <CommandEmpty>Sonuç yok.</CommandEmpty>

        {favEntries.length > 0 && (
          <CommandGroup heading="Favoriler">
            {favEntries.map((entry) => (
              <CommandItem
                key={`fav:${entry.to}`}
                value={`Favori ${entry.label}`}
                onSelect={() => go(entry.to)}
              >
                <Star className="mr-2 h-4 w-4 shrink-0 fill-primary text-primary" />
                <span className="truncate">{entry.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Eylemler">
          {actions.map((a) => {
            const Icon = a.icon;
            return (
              <CommandItem key={a.key} value={`Eylem ${a.label}`} onSelect={() => runAction(a.run)}>
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                <span>{a.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {commandSections.map((section) => {
          const entries = section.entries.filter(isVisible);
          if (entries.length === 0) return null;

          return (
            <CommandGroup key={section.heading} heading={section.heading}>
              {entries.map((entry) => {
                const Icon = entry.icon;
                const value = [entry.label, entry.description, entry.keywords, section.heading]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <CommandItem key={entry.key} value={value} onSelect={() => go(entry.to)}>
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
