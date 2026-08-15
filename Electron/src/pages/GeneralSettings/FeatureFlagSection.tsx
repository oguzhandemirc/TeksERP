import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type FeatureFlags } from "@/services/featureFlagService";
import { systemSettingService } from "@/services/systemSettingService";
import type { FlagDef, NumberFlagDef, SettingFieldDef } from "./settings-config";
import { FlagToggle, ReadOnlyRow, SettingMeta } from "./SettingRow";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { isSettingRowVisible, type SettingsSearchHit } from "./settings-groups";

/**
 * Bir kategorinin özellik anahtarlarını config'ten render eder — TEK kaydetme
 * standardı: tüm toggle'lar TASLAK tutulur, alttaki "Kaydet" (SettingsSaveBar)
 * hepsini birden yazar (anında-kayıt YOK).
 *
 * ÜÇ ayrı yazma yolu tek Kaydet altında toplanır ve bu bilinçlidir — ayrı
 * "Kaydet" düğmeleri "hangisi neyi yazdı" karışıklığıydı:
 *   1) boolean feature-flag'ler  → PATCH /api/feature-flags
 *   2) sayısal feature-flag'ler  → aynı PATCH (tek istek)
 *   3) `settingFields`           → PUT /api/admin/settings/:key (feature-flag
 *      sözleşmesinin DIŞINDAKİ ham system-setting satırları; bkz.
 *      `SettingFieldDef` gerekçesi)
 */
export function FeatureFlagSection({
  flags,
  numberFlags = [],
  settingFields = [],
  searchHit,
}: {
  flags: FlagDef[];
  /** Sekmeye gömülü SAYISAL feature-flag alanları — toggle'larla AYNI taslak +
   *  AYNI PATCH'te yazılır. */
  numberFlags?: NumberFlagDef[];
  /** Ham system-setting sayısal alanları — aynı Kaydet, ayrı uç. */
  settingFields?: SettingFieldDef[];
  /** Arama açıksa bu kategorinin eşleşme fotoğrafı; yoksa tüm satırlar çizilir. */
  searchHit?: SettingsSearchHit;
}) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canEdit = hasPermission("admin:settings");

  const flagsQ = useFeatureFlags();
  const server = flagsQ.data?.data;

  // Ham system-setting alanları — yalnız bu kategoride varsa çekilir.
  const sysQ = useQuery({
    queryKey: ["system-settings"],
    queryFn: systemSettingService.list,
    staleTime: 60_000,
    enabled: settingFields.length > 0,
  });
  const serverFieldFor = useMemo(() => {
    const rows = sysQ.data?.data ?? [];
    return (f: SettingFieldDef): number => {
      const raw = rows.find((s) => s.key === f.key)?.value;
      const n = raw != null ? Number(raw) : NaN;
      // ÜST SINIR bilerek SORULMAZ: input `max` ile kırpar ama GÖSTERİM kırpmaz.
      // Sunucuda paneldeki tavanın üstünde bir değer varsa (ham uçtan yazılmış
      // olabilir) onu `fallback`e düşürmek, ekranda YANLIŞ bir sayı basmak olurdu
      // — "500 kayıtlı, ekran 5 diyor" sınıfı sessiz yalan. Aynı yazım, taşınan
      // termin alanlarının 2026-08-15 öncesindeki davranışıyla birebir.
      return Number.isFinite(n) && n >= f.min ? n : f.fallback;
    };
  }, [sysQ.data]);

  // Taslak: bu bölümdeki flag'ler + sayısal flag'ler + ham ayarlar. Sunucu değeri
  // değişince eşitlenir (kaydetme sonrası invalidate → taslak yeni değere döner).
  const flagKeys = flags.map((f) => f.key);
  const serverFlagStr = JSON.stringify(flagKeys.map((k) => server?.[k] ?? false));
  const [flagDraft, setFlagDraft] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const k of flagKeys) next[k] = server?.[k] ?? false;
    setFlagDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFlagStr]);

  const serverNumFor = (f: NumberFlagDef): number => {
    const v = server?.[f.key];
    return typeof v === "number" && Number.isFinite(v) ? v : f.fallback;
  };
  const serverNumStr = JSON.stringify(numberFlags.map((f) => serverNumFor(f)));
  const [numDraft, setNumDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const f of numberFlags) next[f.key] = serverNumFor(f);
    setNumDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverNumStr]);

  const serverFieldStr = JSON.stringify(settingFields.map((f) => serverFieldFor(f)));
  const [fieldDraft, setFieldDraft] = useState<Record<string, number>>({});
  useEffect(() => {
    const next: Record<string, number> = {};
    for (const f of settingFields) next[f.key] = serverFieldFor(f);
    setFieldDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFieldStr]);

  const flagsDirty = flagKeys.some((k) => (flagDraft[k] ?? false) !== (server?.[k] ?? false));
  const numDirty = numberFlags.some((f) => (numDraft[f.key] ?? serverNumFor(f)) !== serverNumFor(f));
  const fieldDirty = settingFields.some(
    (f) => (fieldDraft[f.key] ?? serverFieldFor(f)) !== serverFieldFor(f),
  );
  const dirty = flagsDirty || numDirty || fieldDirty;
  const numValid = numberFlags.every((f) => {
    const v = numDraft[f.key];
    return v === undefined || (Number.isFinite(v) && v >= f.min && v <= f.max);
  });
  const fieldValid = settingFields.every((f) => {
    const v = fieldDraft[f.key];
    return v === undefined || (Number.isFinite(v) && v >= f.min && v <= f.max);
  });
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: async () => {
      const patch: Partial<FeatureFlags> = {};
      for (const k of flagKeys) {
        const v = flagDraft[k] ?? false;
        if (v !== (server?.[k] ?? false)) (patch as Record<string, boolean>)[k] = v;
      }
      // Sayısal feature-flag'ler AYNI patch'e girer — tek PATCH, tek "kaydedildi".
      for (const f of numberFlags) {
        const v = numDraft[f.key];
        if (v !== undefined && v !== serverNumFor(f)) {
          (patch as Record<string, number>)[f.key] = v;
        }
      }
      if (Object.keys(patch).length > 0) await featureFlagService.update(patch);
      for (const f of settingFields) {
        const v = fieldDraft[f.key];
        if (v !== undefined && v !== serverFieldFor(f)) {
          await systemSettingService.upsert(f.key, String(v), f.savedDesc);
        }
      }
    },
    onSuccess: () => {
      toast.success("Ayarlar kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      if (settingFields.length > 0) void qc.invalidateQueries({ queryKey: ["system-settings"] });
    },
  });

  const reset = () => {
    const next: Record<string, boolean> = {};
    for (const k of flagKeys) next[k] = server?.[k] ?? false;
    setFlagDraft(next);
    const nextNum: Record<string, number> = {};
    for (const f of numberFlags) nextNum[f.key] = serverNumFor(f);
    setNumDraft(nextNum);
    const nextField: Record<string, number> = {};
    for (const f of settingFields) nextField[f.key] = serverFieldFor(f);
    setFieldDraft(nextField);
  };

  if (flagsQ.isLoading || (settingFields.length > 0 && sysQ.isLoading)) {
    return <Skeleton className="h-12 w-full" />;
  }

  // Arama açıkken yalnız eşleşen satırlar çizilir; kategori kimliği eşleştiyse
  // (`wholeCategory`) hepsi görünür — yüklem saf katmanda, bkz. settings-groups.
  const shownFlags = flags.filter((f) => isSettingRowVisible(searchHit, f.key));
  const shownNumberFlags = numberFlags.filter((f) => isSettingRowVisible(searchHit, f.key));
  const shownSettingFields = settingFields.filter((f) => isSettingRowVisible(searchHit, f.key));

  // Ardışık aynı `group` flag'leri tek bloğa topla (sıra korunur).
  const groups: { name?: string; items: FlagDef[] }[] = [];
  for (const f of shownFlags) {
    const last = groups[groups.length - 1];
    if (last && last.name === f.group) last.items.push(f);
    else groups.push({ name: f.group, items: [f] });
  }

  const renderRow = (flag: FlagDef) => {
    const checked = flagDraft[flag.key] ?? server?.[flag.key] ?? false;
    return (
      <div key={flag.key} className="py-4 first:pt-0 last:pb-0">
        {canEdit ? (
          <FlagToggle
            title={flag.title}
            summary={flag.summary}
            desc={flag.desc}
            defaultOn={flag.defaultOn}
            audience={flag.audience}
            checked={checked}
            disabled={mut.isPending}
            onChange={(v) => setFlagDraft((d) => ({ ...d, [flag.key]: v }))}
          />
        ) : (
          <ReadOnlyRow title={flag.title} enabled={server?.[flag.key] ?? false} />
        )}
        {/* Canlı bilgi bloğu (opsiyonel) — statik `desc`'ten farkı sunucudan okunan
            bir DEĞERİ göstermesi. Bileşen gösterecek şey yoksa kendisi null döner.
            TASLAK değil SUNUCU değerine bakar: gösterge kaydedilmiş durumu anlatır,
            kaydedilmemiş bir toggle'ın vaadini değil. */}
        {flag.hint && (server?.[flag.key] ?? false) ? <flag.hint /> : null}
      </div>
    );
  };

  const renderNumber = (
    f: NumberFlagDef | SettingFieldDef,
    value: number,
    serverValue: number,
    onChange: (n: number) => void,
  ) => (
    <div key={f.key} className="space-y-1.5">
      <p className="text-sm font-medium">{f.title}</p>
      <SettingMeta
        defaultLabel={`Varsayılan: ${f.fallback}${f.unit ? ` ${f.unit}` : ""}`}
        audience={f.audience}
      />
      <p className="text-xs text-muted-foreground">{f.desc}</p>
      {canEdit ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={f.min}
            max={f.max}
            step={"step" in f ? (f.step ?? 1) : 1}
            value={value}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(f.max, Math.max(f.min, n)));
            }}
            className="w-24 text-center tabular-nums"
          />
          {f.unit && <span className="text-xs text-muted-foreground">{f.unit}</span>}
        </div>
      ) : (
        <div className="text-sm font-semibold">
          {serverValue}
          {f.unit ? ` ${f.unit}` : ""}
        </div>
      )}
    </div>
  );

  const nothingShown =
    shownFlags.length === 0 && shownNumberFlags.length === 0 && shownSettingFields.length === 0;

  return (
    <div>
      {nothingShown && (
        <p className="text-sm text-muted-foreground">Bu bölümde arama ile eşleşen ayar yok.</p>
      )}

      <div className="space-y-6">
        {groups.map((g, gi) => (
          <div key={g.name ?? gi}>
            {g.name && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.name}
              </p>
            )}
            <div className="divide-y divide-border">{g.items.map(renderRow)}</div>
          </div>
        ))}
      </div>

      {shownNumberFlags.length > 0 && (
        <div className="mt-6 space-y-5 border-t pt-5">
          {shownNumberFlags.map((f) =>
            renderNumber(f, numDraft[f.key] ?? serverNumFor(f), serverNumFor(f), (n) =>
              setNumDraft((d) => ({ ...d, [f.key]: n })),
            ),
          )}
        </div>
      )}

      {shownSettingFields.length > 0 && (
        <div className="mt-6 space-y-5 border-t pt-5">
          {shownSettingFields.map((f) =>
            renderNumber(f, fieldDraft[f.key] ?? serverFieldFor(f), serverFieldFor(f), (n) =>
              setFieldDraft((d) => ({ ...d, [f.key]: n })),
            ),
          )}
        </div>
      )}

      {/* Arama tüm satırları gizlese bile KAYDEDİLMEMİŞ taslak varsa bar durur:
          aksi halde kullanıcı bir ayarı değiştirip arama yazınca Kaydet düğmesi
          kaybolur ve değişiklik sessizce çöpe giderdi. */}
      {canEdit && (!nothingShown || dirty) && (
        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          canSave={numValid && fieldValid}
          onSave={() => mut.mutate()}
          onReset={reset}
        />
      )}
    </div>
  );
}
