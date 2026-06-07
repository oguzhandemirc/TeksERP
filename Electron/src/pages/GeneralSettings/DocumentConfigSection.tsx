import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { cn } from "@/lib/utils";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService } from "@/services/featureFlagService";
import {
  DOC_DEFS,
  DOC_DEF_MAP,
  resolveDocConfig,
  type DocumentsConfig,
  type DocumentConfig,
  type ResolvedDocConfig,
} from "@/services/documentConfig";
import { FlagToggle } from "./SettingRow";

/**
 * Belge Şablonları paneli — yazdırılan irsaliye/çeki listelerinin içerik ayarı.
 * Belge seç → başlık override + künye bas + bölüm görünürlükleri + imza etiketleri
 * + alt not. Ayar CANLI: kaydedince belge bir sonraki açılışta güncel düzeni yansıtır
 * (snapshot değil — refakat kartından farkı budur).
 */
export function DocumentConfigSection({
  onPreview,
}: {
  /** Seçili belge + çözülmüş taslak değiştikçe çağrılır (canlı önizleme için). */
  onPreview?: (docKey: string, cfg: ResolvedDocConfig) => void;
} = {}) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const current = useMemo<DocumentsConfig>(
    () => flagsQ.data?.data?.documentsConfig ?? {},
    [flagsQ.data?.data?.documentsConfig],
  );

  const [selected, setSelected] = useState(DOC_DEFS[0]?.key ?? "");
  const [draft, setDraft] = useState<DocumentsConfig>(current);
  useEffect(() => {
    setDraft(current);
  }, [current]);

  // Seçili belge / taslak değiştikçe önizlemeyi besle.
  useEffect(() => {
    onPreview?.(selected, resolveDocConfig(draft, selected));
  }, [selected, draft, onPreview]);

  const mut = useMutation({
    mutationFn: (documentsConfig: DocumentsConfig) =>
      featureFlagService.update({ documentsConfig }),
    onSuccess: () => {
      toast.success("Belge ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-64 w-full" />;

  const def = DOC_DEF_MAP[selected];
  const resolved = resolveDocConfig(draft, selected);
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

  // Seçili belgenin config'inde bir alanı güncelle (immutable).
  const patch = (next: Partial<DocumentConfig>) =>
    setDraft((d) => ({ ...d, [selected]: { ...d[selected], ...next } }));

  const setSection = (key: string, value: boolean) =>
    patch({ sections: { ...resolved.sections, [key]: value } });

  const setSignature = (index: number, value: string) => {
    if (!def) return;
    const labels = def.defaultSignatures.map(
      (_, i) => (i === index ? value : (draft[selected]?.signatureLabels?.[i] ?? "")),
    );
    patch({ signatureLabels: labels });
  };

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <div className="text-sm text-muted-foreground">
          Bu ayarı değiştirmek için yetkin yok.
        </div>
      }
    >
      <div className="space-y-5">
        {/* Belge seçici */}
        <div className="flex flex-wrap gap-1.5">
          {DOC_DEFS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setSelected(d.key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                selected === d.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>

        {def && (
          <>
            {/* Başlık override */}
            <div>
              <label htmlFor="doc-title" className="text-sm font-medium">
                Belge Başlığı
              </label>
              <p className="text-xs text-muted-foreground">
                Boş bırakılırsa varsayılan ("{def.defaultTitle}") basılır.
              </p>
              <input
                id="doc-title"
                value={draft[selected]?.titleOverride ?? ""}
                maxLength={80}
                placeholder={def.defaultTitle}
                onChange={(e) => patch({ titleOverride: e.target.value })}
                className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* Künye + bölüm görünürlükleri */}
            <div className="divide-y divide-border rounded-md border px-3">
              <div className="py-3">
                <FlagToggle
                  title="Firma künyesini bas"
                  desc="Belgenin üstüne firma adı + adres/telefon/vergi bloğu eklenir (Şirket Bilgileri sekmesinden girilir)."
                  checked={resolved.showLetterhead}
                  disabled={mut.isPending}
                  onChange={(v) => patch({ showLetterhead: v })}
                />
              </div>
              {def.sections.map((s) => (
                <div key={s.key} className="py-3">
                  <FlagToggle
                    title={s.label}
                    desc=""
                    checked={resolved.sections[s.key] ?? true}
                    disabled={mut.isPending}
                    onChange={(v) => setSection(s.key, v)}
                  />
                </div>
              ))}
            </div>

            {/* İmza kutuları */}
            <div className="rounded-md border p-3">
              <div className="pb-3">
                <FlagToggle
                  title="İmza kutuları"
                  desc="Belgenin altındaki imza alanları basılsın mı."
                  checked={resolved.showSignatures}
                  disabled={mut.isPending}
                  onChange={(v) => patch({ showSignatures: v })}
                />
              </div>
              {resolved.showSignatures && (
                <div className="grid gap-3 sm:grid-cols-3">
                  {def.defaultSignatures.map((dflt, i) => (
                    <div key={i}>
                      <label className="text-xs text-muted-foreground">İmza {i + 1}</label>
                      <input
                        value={draft[selected]?.signatureLabels?.[i] ?? ""}
                        maxLength={40}
                        placeholder={dflt}
                        onChange={(e) => setSignature(i, e.target.value)}
                        className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Alt not */}
            <div>
              <label htmlFor="doc-footer" className="text-sm font-medium">
                Alt Not
              </label>
              <p className="text-xs text-muted-foreground">
                Belgenin altına basılan serbest not (boş → basılmaz).
              </p>
              <textarea
                id="doc-footer"
                value={draft[selected]?.footerNote ?? ""}
                maxLength={500}
                rows={2}
                onChange={(e) => patch({ footerNote: e.target.value })}
                className="mt-2 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || mut.isPending}
            onClick={() => mut.mutate(draft)}
          >
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Ayar canlıdır — belge bir sonraki açılışında güncel düzeni yansıtır.
          </span>
        </div>
      </div>
    </PermissionGate>
  );
}
