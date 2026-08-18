import { Fragment, useMemo, useState } from "react";
import { Search, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import { categoryLabels, moduleLabels, isWildcard, type Permission } from "@/types/permissions";

import { scopeOf, splitScopeStats, SCOPE_LABEL, type PermScope } from "./permission-scope";

interface Props {
  permissions: Permission[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  emptyHint?: string;
  /** Süreli izin bitiş tarihleri: permissionId → "YYYY-MM-DD" (boş/verilmez = süresiz).
   *  `onDateChange` ile birlikte verilirse "Bitiş Tarihi" sütunu görünür
   *  (şablon düzenlemede verilmez → tarih sütunu hiç görünmez). */
  dates?: Record<string, string | null | undefined>;
  onDateChange?: (permissionId: string, value: string) => void;
}

export function PermissionGrid({
  permissions,
  value,
  onChange,
  disabled,
  emptyHint,
  dates,
  onDateChange,
}: Props) {
  const [search, setSearch] = useState("");
  /**
   * MOBİL / MASAÜSTÜ SEKMESİ (2026-08-19 saha isteği: "çok fazla yetki var,
   * karışıyor"). Ayrım yeni bir veri DEĞİL — `Permission.category` zaten
   * `mobile` | `web` | `admin` taşıyor; sekme yalnız onu görünür kılar.
   *
   * ⚠️ SEKME BİR KISIT DEĞİL, GÖRÜNÜM. Aynı kullanıcı iki sekmeden de yetki
   * alabilir ve seçim sekme değişince KORUNUR — saha personelinin bir kısmı
   * kilit rolde ve masaüstü yetkisi de taşıyor (kullanıcı kararı).
   */
  const [scope, setScope] = useState<PermScope>("mobile");

  const matchesSearch = (p: Permission): boolean => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.code.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      (moduleLabels[p.module] ?? p.module).toLowerCase().includes(q)
    );
  };

  /** Sekme başına toplam + seçili sayısı — rozetler ve "diğer sekme" ipucu için. */
  const scopeStats = useMemo(
    () => splitScopeStats(permissions, value, matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissions, search, value],
  );

  const grouped = useMemo(() => {
    const filtered = permissions.filter((p) => scopeOf(p) === scope && matchesSearch(p));

    const byCat = new Map<string, Map<string, Permission[]>>();
    for (const p of filtered) {
      const cat = byCat.get(p.category) ?? new Map<string, Permission[]>();
      const list = cat.get(p.module) ?? [];
      list.push(p);
      cat.set(p.module, list);
      byCat.set(p.category, cat);
    }
    return byCat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, search, scope]);

  const selected = useMemo(() => new Set(value), [value]);
  const toggle = (id: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };
  const setMany = (ids: string[], on: boolean) => {
    if (disabled) return;
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(Array.from(next));
  };

  const totalVisible = Array.from(grouped.values()).reduce(
    (acc, m) => acc + Array.from(m.values()).reduce((a, l) => a + l.length, 0),
    0,
  );
  const hasWildcard = permissions.some((p) => isWildcard(p.code) && selected.has(p.id));
  const columnCount = onDateChange ? 4 : 3;

  const other: PermScope = scope === "mobile" ? "desktop" : "mobile";
  // ARAMA + SEKME KLASİK TUZAĞI: aranan yetki diğer sekmedeyse ekran "sonuç yok"
  // der ve kullanıcı yetkinin var olmadığını sanır. Sayı hep gösterilir.
  const hiddenHits = search ? scopeStats[other].hits : 0;

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Sekmeler — seçim sekmeye bağlı DEĞİL; rozetler her iki taraftaki seçili
          sayısını gösterir ki "diğer tarafta ne verdim" sorusu ekranda cevaplansın. */}
      <div className="flex items-center gap-1 rounded-md bg-muted p-1">
        {(["mobile", "desktop"] as const).map((sc) => (
          <button
            key={sc}
            type="button"
            onClick={() => setScope(sc)}
            className={
              "flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors " +
              (scope === sc
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {SCOPE_LABEL[sc]}
            <span
              className={
                "ml-2 rounded-full px-1.5 py-0.5 text-[11px] " +
                (scopeStats[sc].selected > 0
                  ? "bg-primary/15 text-primary font-semibold"
                  : "bg-muted-foreground/15 text-muted-foreground")
              }
            >
              {scopeStats[sc].selected}/{scopeStats[sc].total}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Yetki kodu, açıklama veya modül ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {/* TOPLAM seçili — sekme değil. Kullanıcının aldığı yetki iki sekmeye
              yayılabilir; burada sekme sayısını göstermek eksik okuma üretirdi. */}
          <span className="text-foreground font-medium">{value.length}</span> / {permissions.length} seçili
        </div>
        {/* ⚠️ "Temizle" HER İKİ sekmedeki seçimi siler. Sekmeli ekranda bu sürpriz
            olabileceği için etiket kapsamı söylüyor — sessizce diğer sekmedeki
            yetkileri düşürmek, kullanıcının görmediği bir yan etkidir. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || value.length === 0}
          onClick={() => onChange([])}
          title="Mobil ve masaüstü dahil tüm seçimi kaldırır"
        >
          Tümünü Temizle
        </Button>
      </div>

      {hiddenHits > 0 && (
        <button
          type="button"
          onClick={() => setScope(other)}
          className="rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5 text-left text-xs text-primary hover:bg-primary/10"
        >
          “{search}” için <span className="font-semibold">{SCOPE_LABEL[other]}</span> sekmesinde{" "}
          <span className="font-semibold">{hiddenHits}</span> sonuç daha var — geçmek için tıklayın.
        </button>
      )}

      {hasWildcard && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-mono font-semibold">*</span> ile biten bir yetki seçili — bu yetki, ait olduğu kategorinin <span className="font-medium">tüm alt yetkilerini</span> kapsar.
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden rounded-md border">
        {totalVisible === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {emptyHint ?? "Eşleşen yetki bulunamadı."}
          </div>
        ) : (
          <Table containerClassName="overflow-visible" className="table-fixed">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-20"></TableHead>
                <TableHead className="w-64">Yetki</TableHead>
                <TableHead>Açıklama</TableHead>
                {onDateChange && <TableHead className="w-44">Bitiş Tarihi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(grouped.entries()).map(([category, modules]) => {
                const allIds = Array.from(modules.values()).flat().map((p) => p.id);
                const allChecked = allIds.every((id) => selected.has(id));
                const someChecked = allIds.some((id) => selected.has(id));

                return (
                  <Fragment key={category}>
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={columnCount} className="px-3 py-1.5">
                        <label className="flex items-center gap-2">
                          <Checkbox
                            checked={allChecked ? true : someChecked ? "indeterminate" : false}
                            onCheckedChange={(checked) => setMany(allIds, Boolean(checked))}
                            disabled={disabled}
                          />
                          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {categoryLabels[category] ?? category}
                          </span>
                          <Badge variant="muted" className="font-normal">
                            {allIds.length}
                          </Badge>
                        </label>
                      </TableCell>
                    </TableRow>
                    {Array.from(modules.entries()).map(([module, perms]) => (
                      <ModuleRows
                        key={module}
                        module={module}
                        perms={perms}
                        selected={selected}
                        toggle={toggle}
                        setMany={setMany}
                        disabled={disabled}
                        dates={dates}
                        onDateChange={onDateChange}
                        columnCount={columnCount}
                      />
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

interface ModuleRowsProps {
  module: string;
  perms: Permission[];
  selected: Set<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  disabled?: boolean;
  dates?: Record<string, string | null | undefined>;
  onDateChange?: (permissionId: string, value: string) => void;
  columnCount: number;
}

function ModuleRows({
  module,
  perms,
  selected,
  toggle,
  setMany,
  disabled,
  dates,
  onDateChange,
  columnCount,
}: ModuleRowsProps) {
  const ids = perms.map((p) => p.id);
  const allChecked = ids.every((id) => selected.has(id));
  const someChecked = ids.some((id) => selected.has(id));

  return (
    <Fragment>
      <TableRow className="bg-muted/10">
        <TableCell colSpan={columnCount} className="py-1.5 pl-7">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={allChecked ? true : someChecked ? "indeterminate" : false}
              onCheckedChange={(checked) => setMany(ids, Boolean(checked))}
              disabled={disabled}
            />
            <span className="text-sm font-medium">{moduleLabels[module] ?? module}</span>
          </label>
        </TableCell>
      </TableRow>
      {perms.map((p) => {
        const wild = isWildcard(p.code);
        const checked = selected.has(p.id);
        return (
          <TableRow key={p.id} className={cn(wild && "bg-destructive/5")}>
            <TableCell className="py-1.5 pl-10">
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(p.id)}
                disabled={disabled}
              />
            </TableCell>
            <TableCell className="py-1.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn("truncate font-mono text-xs", wild && "font-semibold text-destructive")}
                  title={p.code}
                >
                  {p.code}
                </span>
                {wild && (
                  <Badge variant="destructive" className="shrink-0 text-[10px]" title="Bu yetki, kategorideki tüm alt yetkileri otomatik kapsar.">
                    tüm yetkiler
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="break-words py-1.5 text-xs text-muted-foreground">
              {p.description}
              {/* "Normalde kim alır" ipucu — yetkiyi ikinci bir başlık altında
                  TEKRAR YAZMAK yerine (sektör pratiğinde anti-desen: iki kutu,
                  tek gerçek) rollerden TÜRETİLİR. Süzmez, kısıtlamaz; yalnız
                  yol gösterir. */}
              {p.roleNames && p.roleNames.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    roller
                  </span>
                  {p.roleNames.map((r) => (
                    <span
                      key={r}
                      className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                      title="Bu yetki bu rolün paketinde var — öneridir, zorunluluk değil."
                    >
                      {r.replace(/^Mobil — |^Web — /, "")}
                    </span>
                  ))}
                </div>
              )}
            </TableCell>
            {onDateChange && (
              <TableCell className="py-1.5">
                {checked ? (
                  <DatePickerInput
                    value={dates?.[p.id] ?? ""}
                    onChange={(v) => onDateChange(p.id, v)}
                    disabled={disabled}
                    placeholder="Süresiz"
                    className="h-8 w-40"
                  />
                ) : (
                  <div className="flex h-8 w-40 items-center text-xs text-muted-foreground">—</div>
                )}
              </TableCell>
            )}
          </TableRow>
        );
      })}
    </Fragment>
  );
}
