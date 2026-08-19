import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type FeatureFlags } from "@/services/featureFlagService";
import { systemSettingService, SETTING_KEYS } from "@/services/systemSettingService";
import type { FlagDef, NumberFlagKey } from "./settings-config";
import { FlagToggle, ReadOnlyRow } from "./SettingRow";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";

const DEADLINE_DEFAULT = 7;
const DEADLINE_META = {
  order: {
    key: SETTING_KEYS.ORDER_DEFAULT_DEADLINE_DAYS,
    heading: "Termin Varsayılanı",
    label: "Sipariş termini",
    blurb: "Sipariş açılırken termin boş bırakılırsa bu kadar gün otomatik eklenir.",
    savedDesc: "Sipariş termini varsayılan gün sayısı (boş bırakılırsa kullanılır)",
  },
  wo: {
    key: SETTING_KEYS.WORKORDER_DEFAULT_PLAN_DURATION_DAYS,
    heading: "Planlama Süresi Varsayılanı",
    label: "İş emri planlama süresi",
    blurb: "İş emri açılırken planlama bitiş tarihi boşsa bu kadar gün otomatik eklenir.",
    savedDesc: "İş emri planlama süresi varsayılan gün sayısı",
  },
} as const;

/**
 * Bir kategorinin özellik anahtarlarını config'ten render eder — TEK kaydetme
 * standardı: tüm toggle'lar TASLAK tutulur, alttaki "Kaydet" (SettingsSaveBar)
 * hepsini birden yazar (anında-kayıt YOK). `deadlineField` verilirse ilgili termin
 * varsayılanı da aynı sekmede aynı Kaydet altında toplanır (Siparişler / İş Emirleri).
 */
export function FeatureFlagSection({
  flags,
  deadlineField,
}: {
  flags: FlagDef[];
  deadlineField?: "order" | "wo";
}) {
  const qc = useQueryClient();
  const { hasPermission } = useRoleAccess();
  const canEdit = hasPermission("admin:settings");

  const flagsQ = useFeatureFlags();
  const server = flagsQ.data?.data;

  // Termin (system-setting) — yalnız deadlineField verilen sekmelerde çekilir.
  const meta = deadlineField ? DEADLINE_META[deadlineField] : null;
  const sysQ = useQuery({
    queryKey: ["system-settings"],
    queryFn: systemSettingService.list,
    staleTime: 60_000,
    enabled: Boolean(meta),
  });
  const serverDeadline = useMemo(() => {
    if (!meta) return DEADLINE_DEFAULT;
    const raw = (sysQ.data?.data ?? []).find((s) => s.key === meta.key)?.value;
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : DEADLINE_DEFAULT;
  }, [meta, sysQ.data]);

  // Taslak: bu bölümdeki flag'ler + (varsa) termin. Sunucu değeri değişince eşitle
  // (kaydetme sonrası invalidate → taslak yeni değere döner, dirty sıfırlanır).
  const flagKeys = flags.map((f) => f.key);
  const serverFlagStr = JSON.stringify(flagKeys.map((k) => server?.[k] ?? false));
  const [flagDraft, setFlagDraft] = useState<Record<string, boolean>>({});
  const [deadlineDraft, setDeadlineDraft] = useState(serverDeadline);
  // `numberField` taşıyan flag'lerin sayısal taslağı — METİN olarak tutulur:
  // kullanıcı alanı boşaltırken ara durumda sayıya zorlamak imleci zıplatır.
  // Boş metin = "eşik girilmemiş" (null) demektir ve backend'e null gider.
  const numberKeys = flags.map((f) => f.numberField?.numberKey).filter(Boolean) as NumberFlagKey[];
  const serverNumberStr = JSON.stringify(numberKeys.map((k) => server?.[k] ?? null));
  const [numberDraft, setNumberDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const k of numberKeys) {
      const v = server?.[k] ?? null;
      next[k] = v == null ? "" : String(v);
    }
    setNumberDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverNumberStr]);
  /** Taslak metni sunucu sözleşmesine çevirir: boş/geçersiz → null (kural inert). */
  const parseNumberDraft = (raw: string | undefined): number | null => {
    const n = parseFloat((raw ?? "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const k of flagKeys) next[k] = server?.[k] ?? false;
    setFlagDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFlagStr]);
  useEffect(() => setDeadlineDraft(serverDeadline), [serverDeadline]);

  const flagsDirty = flagKeys.some((k) => (flagDraft[k] ?? false) !== (server?.[k] ?? false));
  const numbersDirty = numberKeys.some(
    (k) => parseNumberDraft(numberDraft[k]) !== (server?.[k] ?? null),
  );
  // Sayısal alan aralık DIŞINDAysa kaydetme kapanır (backend zaten 400 verir —
  // kullanıcıyı sunucuya kadar götürmeden söyle).
  const numbersValid = flags.every((f) => {
    if (!f.numberField) return true;
    const v = parseNumberDraft(numberDraft[f.numberField.numberKey]);
    return v === null || (v >= f.numberField.min && v <= f.numberField.max);
  });
  const deadlineDirty = Boolean(meta) && deadlineDraft !== serverDeadline;
  const dirty = flagsDirty || deadlineDirty || numbersDirty;
  const deadlineValid = !meta || (Number.isInteger(deadlineDraft) && deadlineDraft >= 1 && deadlineDraft <= 365);
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: async () => {
      const patch: Partial<FeatureFlags> = {};
      for (const k of flagKeys) {
        const v = flagDraft[k] ?? false;
        if (v !== (server?.[k] ?? false)) (patch as Record<string, boolean>)[k] = v;
      }
      // Sayısal alanlar AYNI PATCH'e girer (ayrı istek değil): tek Kaydet, tek
      // yazım — bayrak yazılıp eşik yazılamazsa "açık ama etkisiz" ara durum
      // kalıcı olurdu.
      for (const k of numberKeys) {
        const v = parseNumberDraft(numberDraft[k]);
        if (v !== (server?.[k] ?? null)) (patch as Record<string, number | null>)[k] = v;
      }
      if (Object.keys(patch).length > 0) await featureFlagService.update(patch);
      if (meta && deadlineDirty) {
        await systemSettingService.upsert(meta.key, String(deadlineDraft), meta.savedDesc);
      }
    },
    onSuccess: () => {
      toast.success("Ayarlar kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
      if (meta) void qc.invalidateQueries({ queryKey: ["system-settings"] });
    },
  });

  const reset = () => {
    const next: Record<string, boolean> = {};
    for (const k of flagKeys) next[k] = server?.[k] ?? false;
    setFlagDraft(next);
    setDeadlineDraft(serverDeadline);
    const nextNums: Record<string, string> = {};
    for (const k of numberKeys) {
      const v = server?.[k] ?? null;
      nextNums[k] = v == null ? "" : String(v);
    }
    setNumberDraft(nextNums);
  };

  if (flagsQ.isLoading || (meta && sysQ.isLoading)) {
    return <Skeleton className="h-12 w-full" />;
  }

  // Ardışık aynı `group` flag'leri tek bloğa topla (sıra korunur).
  const groups: { name?: string; items: FlagDef[] }[] = [];
  for (const f of flags) {
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
            desc={flag.desc}
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
        {/* Sayısal eşik — TASLAK toggle'a bakar (sunucuya değil): kullanıcı
            anahtarı açar açmaz eşiği girebilmeli, önce kaydetmek zorunda
            kalmamalı. Kapalıyken çizilmez (kullanılmayan alan gürültüdür). */}
        {flag.numberField && checked ? (
          canEdit ? (
            <div className="mt-3 space-y-1.5 pl-1">
              <label className="text-xs font-medium">{flag.numberField.label}</label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={flag.numberField.min}
                  max={flag.numberField.max}
                  value={numberDraft[flag.numberField.numberKey] ?? ""}
                  disabled={mut.isPending}
                  onChange={(e) =>
                    setNumberDraft((d) => ({
                      ...d,
                      [flag.numberField!.numberKey]: e.target.value,
                    }))
                  }
                  className="w-28 text-center tabular-nums"
                />
                <span className="text-xs text-muted-foreground">{flag.numberField.unit}</span>
              </div>
              {parseNumberDraft(numberDraft[flag.numberField.numberKey]) === null ? (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {flag.numberField.emptyWarning}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 pl-1 text-sm">
              <span className="text-xs text-muted-foreground">{flag.numberField.label}: </span>
              <span className="font-semibold">
                {server?.[flag.numberField.numberKey] ?? "—"} {flag.numberField.unit}
              </span>
            </div>
          )
        ) : null}
      </div>
    );
  };

  return (
    <div>
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

      {meta && (
        <div className="mt-6 space-y-3 border-t pt-5">
          <div className="flex items-start gap-2">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{meta.heading}</p>
              <p className="text-xs text-muted-foreground">{meta.blurb}</p>
            </div>
          </div>
          {canEdit ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{meta.label}</label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={deadlineDraft}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) setDeadlineDraft(Math.min(365, Math.max(1, n)));
                  }}
                  className="w-24 text-center tabular-nums"
                />
                <span className="text-xs text-muted-foreground">gün</span>
              </div>
            </div>
          ) : (
            <div className="text-sm">
              <div className="text-xs text-muted-foreground">{meta.label}</div>
              <div className="font-semibold">{serverDeadline} gün</div>
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <SettingsSaveBar
          dirty={dirty}
          saving={mut.isPending}
          canSave={deadlineValid && numbersValid}
          onSave={() => mut.mutate()}
          onReset={reset}
        />
      )}
    </div>
  );
}
