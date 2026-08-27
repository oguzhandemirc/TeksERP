import { useEffect, useMemo, useState } from "react";
import {
  Keyboard,
  Loader2,
  LogOut,
  Moon,
  RotateCw,
  Rows3,
  Search,
  Star,
  type LucideIcon,
} from "lucide-react";
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
import { foldSearchText } from "@/lib/search-fold";
import { scoreCommandValue } from "./command-score";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { globalSearch } from "@/lib/search/globalSearch";
import {
  SEARCH_TARGETS,
  SERVER_ITEM_PREFIX,
  serverItemValue,
  type SearchRow,
} from "@/lib/search/search-targets";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShowHelp?: () => void;
}

export function CommandPalette({ open, onOpenChange, onShowHelp }: Props) {
  const openTab = useTabsStore((s) => s.openTab);
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

  // Komut paleti de ÜST DÜZEY hedef açar (menü ile aynı sözleşme, 2026-08-17):
  // sekmeyi yerinde ezmek yerine varsa odaklar, yoksa yeni sekme açar ve o
  // sayfanın son görünümünü (filtre/sıralama) geri getirir.
  const go = (to: string) => {
    onOpenChange(false);
    openTab(to);
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

  // ── GLOBAL ARAMA (sunucu) ───────────────────────────────────────────────────
  // ⚠️ `enabled: open` kritik: palet kapalıyken istek gitmez. Min 2 karakter —
  // trigram 3-gram üzerinden çalışır, tek harf her kovayı seq scan'e sokar.
  const debouncedSearch = useDebouncedValue(search, 250);
  const serverTerm = debouncedSearch.trim();
  const serverQuery = useQuery({
    queryKey: ["global-search", serverTerm],
    queryFn: () => globalSearch(serverTerm),
    enabled: open && serverTerm.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // ⚠️ Arama hatası TOAST BASMAZ: yardımcı bir yüzey, ana akışı bozmamalı.
    retry: false,
  });

  const goRow = (entity: string, row: SearchRow) => {
    const target = SEARCH_TARGETS[entity];
    if (!target) return;
    const { to, state } = target.to(row);
    onOpenChange(false);
    openTab(to, state ? { state } : undefined);
  };

  const exact = serverQuery.data?.exact ?? null;
  const exactTarget = exact ? SEARCH_TARGETS[exact.entity] : undefined;
  const exactRow =
    exact && exactTarget && hasAnyPermission(exactTarget.permissions) ? (
      <CommandGroup heading="Okutulan kod">
        <CommandItem
          key={serverItemValue(exact.entity, exact.row.id)}
          value={serverItemValue(exact.entity, exact.row.id)}
          onSelect={() => goRow(exact.entity, exact.row)}
        >
          <exactTarget.icon className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate font-medium">{exact.row.title}</span>
          {exact.row.subtitle && (
            <span className="ml-2 truncate text-xs text-muted-foreground">
              {exact.row.subtitle}
            </span>
          )}
        </CommandItem>
      </CommandGroup>
    ) : null;

  const groups = serverQuery.data?.groups ?? [];
  const recordGroups =
    serverTerm.length < 2 ? null : (
      <>
        {serverQuery.isFetching && groups.length === 0 && (
          <CommandGroup heading="Kayıtlar">
            <CommandItem value={`${SERVER_ITEM_PREFIX}loading`} disabled>
              <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" />
              <span className="text-muted-foreground">Kayıtlar aranıyor…</span>
            </CommandItem>
          </CommandGroup>
        )}
        {groups.map((g) => {
          const target = SEARCH_TARGETS[g.entity];
          // ⚠️ BİLİNMEYEN KOVA SESSİZCE DÜŞÜRÜLMEZ. Backend'e yeni varlık eklenip
          // panel katalogu güncellenmediyse (iki proje ayrı sürümleniyor) grup
          // yine çizilir, satırlar devre dışıdır ve sebebi yazar.
          if (!target) {
            return (
              <CommandGroup key={g.entity} heading={g.label}>
                <CommandItem value={`${SERVER_ITEM_PREFIX}unknown:${g.entity}`} disabled>
                  <span className="text-muted-foreground">
                    Bu sonuç türü için hedef tanımlı değil ({g.entity}) — panel güncellenmeli.
                  </span>
                </CommandItem>
              </CommandGroup>
            );
          }
          if (!hasAnyPermission(target.permissions)) return null;
          const Icon = target.icon;
          return (
            <CommandGroup key={g.entity} heading={g.label}>
              {g.rows.map((row) => (
                <CommandItem
                  key={serverItemValue(g.entity, row.id)}
                  value={serverItemValue(g.entity, row.id)}
                  onSelect={() => goRow(g.entity, row)}
                >
                  <Icon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{row.title}</span>
                  {row.subtitle && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">
                      {row.subtitle}
                    </span>
                  )}
                </CommandItem>
              ))}
              {g.hasMore && (
                <CommandItem
                  key={`${SERVER_ITEM_PREFIX}more:${g.entity}`}
                  value={`${SERVER_ITEM_PREFIX}more:${g.entity}`}
                  onSelect={() => {
                    onOpenChange(false);
                    openTab(target.listTo(serverTerm));
                  }}
                >
                  <Search className="mr-2 h-4 w-4 shrink-0 opacity-60" />
                  <span className="text-muted-foreground">
                    Tüm {g.label.toLocaleLowerCase("tr")} içinde ara…
                  </span>
                </CommandItem>
              )}
            </CommandGroup>
          );
        })}
      </>
    );

  /**
   * Bölümleri arama puanına göre sırala (cmdk yapmıyor — yukarıdaki nota bak).
   * Puan, bölümdeki EN İYİ girdinin puanıdır; eşitlikte bildirilen sıra korunur
   * (kararlı sıralama — aynı sorgu her seferinde aynı listeyi üretsin).
   */
  const sortedSections = useMemo(() => {
    if (!search.trim()) return commandSections;
    const scoreOf = (section: (typeof commandSections)[number]): number =>
      Math.max(
        0,
        ...section.entries.map((e) =>
          scoreCommandValue(
            [e.label, e.description, e.keywords, section.heading].filter(Boolean).join(" "),
            search,
          ),
        ),
      );
    return commandSections
      .map((section, i) => ({ section, i, score: scoreOf(section) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.section);
  }, [commandSections, search]);

  return (
    // ⚠️ `filter` VERİLMEZSE cmdk kendi `command-score`'unu kullanır ve o yalnız
    // ASCII katlar: "kursun" yazan operatör "Kurşun Sırası"nı BULAMAZDI (ölçüldü
    // 2026-08-19). Katlama sunucudakiyle aynı `foldSearchText`.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      // Puanlama SAF bir modülde (`command-score.ts`) — satır içi `filter`
      // prop'u test edilemez ve bu kural bir kez SESSİZCE bozuldu.
      filter={scoreCommandValue}
    >
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

        {/* ⚠️ BÖLÜM SIRASINI BİZ VERİYORUZ. cmdk grupları puana göre YENİDEN
            SIRALAMIYOR (1.1.1'de ölçüldü: grup `value`si verilse de değişmedi) —
            yani en iyi eşleşme başka bir bölümdeyse listenin ALTINDA kalıyor ve
            Enter yanlış sayfayı açıyordu ("Müşteri Karnesi" → "Sipariş İptal
            Karnesi"). Arama varken bölümler, İÇLERİNDEKİ EN YÜKSEK puana göre
            sıralanır; arama yokken bildirilen sıra korunur (boş palette katalog
            düzeni anlamlıdır). Puanlama tek kaynak: `command-score.ts`. */}
        {sortedSections.map((section) => {
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
        {/* ── KAYITLAR ────────────────────────────────────────────────────
            ⚠️ HER ZAMAN statik bölümlerin ALTINDA. Sunucu sonuçları ~150 ms
            sonra gelir; üste eklenselerdi ok tuşuyla gezen kullanıcının
            altından liste kayar ve yanlış satır seçilirdi. Tek istisna
            "Okutulan kod": deterministik ve niyeti tartışmasız. */}
        {exactRow}
        {recordGroups}
      </CommandList>
    </CommandDialog>
  );
}
