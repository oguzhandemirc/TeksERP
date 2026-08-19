import { useMemo, useState } from "react";
import { Search, Monitor, Smartphone, AlertTriangle, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { foldSearchText } from "@/lib/search-fold";
import type { Permission } from "@/types/permissions";
import type { ScreenEntry } from "@/services/screenCatalogService";
import {
  screenAccess,
  screensUsing,
  filterScreens,
  screenCodes,
} from "@/components/admin/screen-view";

// =============================================================================
// "EKRANA GÖRE" YETKİ GÖRÜNÜMÜ (2026-08-19) — yetki mimarisi Katman 2, adım 2
// =============================================================================
// Yönetici artık 68 kutuluk modül listesine girmeden çalışabilir: ekranı seçer,
// o ekranın AÇILMASI için gerekeni ve İÇİNDE ne yapılabileceğini insan diliyle
// görür. Veri kaynağı ekran manifestosu (`GET /api/admin/screens`) — SAP `SU24`
// karşılığı. Karar belgesi: docs/design/YETKI-MIMARISI.md
//
// ⚠️ SEÇİM ORTAK: bu görünüm ile modül gridi AYNI `value` dizisini paylaşır.
// Görünüm değiştirmek seçimi sıfırlamaz; ikisi tek gerçeğin iki penceresidir.
//
// ⚠️ ORTAK YETKİLER GÖRÜNÜR OLMAK ZORUNDA. Yetkiyi ekran başına ÇOĞALTMADIK
// (bkz. karar belgesi) — bedeli, aynı yetkinin birden çok ekranda görünmesi.
// Bunu söylemezsek "KK1'den kaldırdım, Hızlı İş Emri bozuldu" sürprizi olur.
// =============================================================================

interface Props {
  screens: ScreenEntry[];
  permissions: Permission[];
  /** Seçili permission ID'leri — modül gridiyle ORTAK. */
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function ByScreenView({ screens, permissions, value, onChange, disabled }: Props) {
  const [search, setSearch] = useState("");

  // Manifesto KOD taşır, seçim ID taşır — köprü burada.
  const byCode = useMemo(() => {
    const m = new Map<string, Permission>();
    for (const p of permissions) m.set(p.code, p);
    return m;
  }, [permissions]);

  const selectedCodes = useMemo(() => {
    const ids = new Set(value);
    return new Set(permissions.filter((p) => ids.has(p.id)).map((p) => p.code));
  }, [permissions, value]);

  const shown = useMemo(
    () => filterScreens(screens, search, foldSearchText),
    [screens, search],
  );
  const mobile = shown.filter((s) => s.app === "mobile");
  const desktop = shown.filter((s) => s.app === "desktop");

  const toggleCode = (code: string) => {
    if (disabled) return;
    const perm = byCode.get(code);
    // Manifestoda olup katalogda olmayan kod → bekçi bunu kırmızı verir; burada
    // sessizce yok sayılır (arayüz çökmesin).
    if (!perm) return;
    const next = new Set(value);
    if (next.has(perm.id)) next.delete(perm.id);
    else next.add(perm.id);
    onChange([...next]);
  };

  const setScreen = (screen: ScreenEntry, on: boolean) => {
    if (disabled) return;
    const next = new Set(value);
    for (const code of screenCodes(screen)) {
      const perm = byCode.get(code);
      if (!perm) continue;
      if (on) next.add(perm.id);
      else next.delete(perm.id);
    }
    onChange([...next]);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Ekran adı ya da yetki kodu ara (örn. Tambur, label:edit)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 pl-8 text-sm"
        />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-md border p-3">
        {shown.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Eşleşen ekran bulunamadı.
          </div>
        )}
        {mobile.length > 0 && (
          <Group icon={<Smartphone className="h-3.5 w-3.5" />} title="Mobil (saha)" count={mobile.length}>
            {mobile.map((s) => (
              <ScreenCard
                key={`${s.app}:${s.key}`}
                screen={s}
                screens={screens}
                byCode={byCode}
                selectedCodes={selectedCodes}
                onToggle={toggleCode}
                onSetAll={setScreen}
                disabled={disabled}
              />
            ))}
          </Group>
        )}
        {desktop.length > 0 && (
          <Group icon={<Monitor className="h-3.5 w-3.5" />} title="Masaüstü (büro)" count={desktop.length}>
            {desktop.map((s) => (
              <ScreenCard
                key={`${s.app}:${s.key}`}
                screen={s}
                screens={screens}
                byCode={byCode}
                selectedCodes={selectedCodes}
                onToggle={toggleCode}
                onSetAll={setScreen}
                disabled={disabled}
              />
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {icon} {title}
        <Badge variant="muted" className="font-normal">
          {count}
        </Badge>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ScreenCard({
  screen,
  screens,
  byCode,
  selectedCodes,
  onToggle,
  onSetAll,
  disabled,
}: {
  screen: ScreenEntry;
  screens: ScreenEntry[];
  byCode: Map<string, Permission>;
  selectedCodes: Set<string>;
  onToggle: (code: string) => void;
  onSetAll: (screen: ScreenEntry, on: boolean) => void;
  disabled?: boolean;
}) {
  const access = screenAccess(screen, selectedCodes);
  const allCodes = screenCodes(screen);
  const allOn = allCodes.every((c) => selectedCodes.has(c));

  return (
    <div
      className={cn(
        "rounded-md border p-2.5",
        access === "open" && "border-primary/40 bg-primary/5",
        access === "capability-only" && "border-amber-500/50 bg-amber-500/5",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{screen.title}</span>
            {access === "open" && (
              <Badge variant="default" className="text-[10px]">
                açık
              </Badge>
            )}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground">{screen.key}</div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSetAll(screen, !allOn)}
          className="shrink-0 rounded border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {allOn ? "Hepsini kaldır" : "Hepsini ver"}
        </button>
      </div>

      {/* GİRİŞ İZNİ YOKKEN yetenek işaretlemek ETKİSİZDİR — sessizce bırakmak,
          yöneticiye yetki verdiğini sandırır. */}
      {access === "capability-only" && (
        <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/50 bg-amber-500/10 p-1.5 text-[11px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Bu ekranı açan yetki seçili değil — aşağıdaki yetenekler <b>etkisiz</b> kalır.
          </span>
        </div>
      )}

      <div className="mt-2 space-y-1">
        <Row
          label="Ekranı açar"
          codes={screen.requires}
          hint={screen.requires.length > 1 ? "herhangi biri yeterli" : undefined}
          screens={screens}
          byCode={byCode}
          selectedCodes={selectedCodes}
          onToggle={onToggle}
          disabled={disabled}
        />
        {screen.capabilities.length > 0 && (
          <Row
            label="Ekranda yapabilecekleri"
            codes={screen.capabilities.map((c) => c.code)}
            labels={Object.fromEntries(screen.capabilities.map((c) => [c.code, c.label]))}
            screens={screens}
            byCode={byCode}
            selectedCodes={selectedCodes}
            onToggle={onToggle}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  codes,
  labels,
  screens,
  byCode,
  selectedCodes,
  onToggle,
  disabled,
}: {
  label: string;
  hint?: string;
  codes: string[];
  labels?: Record<string, string>;
  screens: ScreenEntry[];
  byCode: Map<string, Permission>;
  selectedCodes: Set<string>;
  onToggle: (code: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {label}
        {hint && <span className="ml-1 normal-case opacity-80">({hint})</span>}
      </div>
      <div className="mt-0.5 space-y-0.5">
        {codes.map((code) => {
          const perm = byCode.get(code);
          const others = screensUsing(screens, code).length - 1;
          return (
            <label
              key={code}
              className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-muted/60"
            >
              <Checkbox
                checked={selectedCodes.has(code)}
                onCheckedChange={() => onToggle(code)}
                disabled={disabled || !perm}
                className="mt-0.5"
              />
              <span className="min-w-0 text-xs">
                <span className="font-medium">{labels?.[code] ?? perm?.description ?? code}</span>
                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">{code}</span>
                {/* Ortak yetki uyarısı — yetkiyi çoğaltmamanın bedeli görünür olsun. */}
                {others > 0 && (
                  <span
                    className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
                    title={screensUsing(screens, code)
                      .map((s) => s.title)
                      .join(" · ")}
                  >
                    <Link2 className="h-2.5 w-2.5" />
                    {others} ekranda daha
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
