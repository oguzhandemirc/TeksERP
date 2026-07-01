import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  featureFlagService,
  DEFAULT_TRAVELER_CARD_CONFIG,
  type TravelerCardConfig,
  type TravelerCardPageSize,
  type TravelerCardSpecFields,
} from "@/services/featureFlagService";
import { FlagToggle } from "./SettingRow";

const PAGE_SIZES: TravelerCardPageSize[] = ["A4", "A5"];
const MARGIN_SIDES: { key: keyof TravelerCardConfig["margins"]; label: string }[] = [
  { key: "top", label: "Üst" },
  { key: "right", label: "Sağ" },
  { key: "bottom", label: "Alt" },
  { key: "left", label: "Sol" },
];
const SPEC_FIELDS: { key: keyof TravelerCardSpecFields; label: string }[] = [
  { key: "color", label: "Renk" },
  { key: "width", label: "En" },
  { key: "targetQuantity", label: "Hedef Metraj" },
  { key: "targetWeight", label: "Hedef Ağırlık" },
  { key: "foldType", label: "Kat Tipi" },
  { key: "startDate", label: "Başlangıç" },
  { key: "endDate", label: "Bitiş" },
];
const clampMm = (v: string): number => Math.min(40, Math.max(0, Math.round(Number(v) || 0)));

/**
 * Refakat kartı marka/içerik ayarı paneli. Firma adı + künye + hangi bölümlerin
 * basılacağı (toggle) + alt not. Kaydedince yalnızca BUNDAN SONRA basılan kartlara
 * işler — mevcut kartlar basım anında dondurulduğu için (snapshot) değişmez.
 */
export function TravelerCardConfigSection({
  onPreview,
}: {
  /** Taslak değiştikçe (debounce'lu) çağrılır — canlı PDF önizlemesi için. */
  onPreview?: (cfg: TravelerCardConfig) => void;
} = {}) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  // Eksik/bayat-cache üst-düzey alanlara karşı default'la birleştir (margins/specFields hep dolu).
  const current: TravelerCardConfig = {
    ...DEFAULT_TRAVELER_CARD_CONFIG,
    ...(flagsQ.data?.data?.travelerCardConfig ?? {}),
  };

  const [draft, setDraft] = useState<TravelerCardConfig>(current);
  const currentKey = JSON.stringify(current);
  useEffect(() => {
    setDraft(current);
    // Sunucudan gelen değer değişince formu eşitle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  // Taslağı önizlemeye bildir — PDF render pahalı olduğu için 300ms debounce.
  useEffect(() => {
    const t = setTimeout(() => onPreview?.(draft), 300);
    return () => clearTimeout(t);
  }, [draft, onPreview]);

  const mut = useMutation({
    mutationFn: (cfg: TravelerCardConfig) =>
      featureFlagService.update({ travelerCardConfig: cfg }),
    onSuccess: () => {
      toast.success("Refakat kartı ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-40 w-full" />;

  const trimmed = draft.companyName.trim();
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);

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
        <div>
          <label htmlFor="tc-company" className="text-sm font-medium">
            Firma Adı
          </label>
          <p className="text-xs text-muted-foreground">
            Refakat kartının üst başlığında basılır.
          </p>
          <input
            id="tc-company"
            value={draft.companyName}
            maxLength={120}
            onChange={(e) => setDraft((d) => ({ ...d, companyName: e.target.value }))}
            placeholder={DEFAULT_TRAVELER_CARD_CONFIG.companyName}
            className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tc-address" className="text-sm font-medium">
              Adres
            </label>
            <p className="text-xs text-muted-foreground">Firma adının altında (boş → basılmaz).</p>
            <input
              id="tc-address"
              value={draft.addressLine}
              maxLength={200}
              onChange={(e) => setDraft((d) => ({ ...d, addressLine: e.target.value }))}
              className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="tc-phone" className="text-sm font-medium">
              Telefon
            </label>
            <p className="text-xs text-muted-foreground">Firma adının altında (boş → basılmaz).</p>
            <input
              id="tc-phone"
              value={draft.phone}
              maxLength={60}
              onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
              className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Sayfa Boyutu & Kenar Payı</div>
          <p className="text-xs text-muted-foreground">
            Kart boyutu (A4 standart) ve hangi kenardan ne kadar pay (mm) bırakılacağı —
            ciltleme/delik zımbası için boşluk.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <div className="inline-flex overflow-hidden rounded-md border">
              {PAGE_SIZES.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, pageSize: sz }))}
                  className={cn(
                    "px-4 py-1.5 text-sm font-medium transition-colors",
                    draft.pageSize === sz
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  {sz}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {MARGIN_SIDES.map(({ key, label }) => (
                <div key={key}>
                  <label className="text-[11px] text-muted-foreground">{label} (mm)</label>
                  <input
                    type="number"
                    min={0}
                    max={40}
                    value={draft.margins[key]}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, margins: { ...d.margins, [key]: clampMm(e.target.value) } }))
                    }
                    className="mt-1 flex h-8 w-16 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="divide-y divide-border rounded-md border px-3">
          <div className="py-3">
            <FlagToggle
              title="Operasyon kaydı (imza grid'i)"
              desc="İstasyon başına operatör/tarih/metraj/fire/imza tablosu — elle doldurulur."
              checked={draft.showOperationGrid}
              disabled={mut.isPending}
              onChange={(v) => setDraft((d) => ({ ...d, showOperationGrid: v }))}
            />
          </div>
          <div className="py-3">
            <FlagToggle
              title="Talimatlar / Fason notu"
              desc="Adım talimatları (fason adımlarının notu) kutusu kartta basılsın mı."
              checked={draft.showNotes}
              disabled={mut.isPending}
              onChange={(v) => setDraft((d) => ({ ...d, showNotes: v }))}
            />
          </div>
          <div className="py-3">
            <FlagToggle
              title="Bağlı siparişler"
              desc="Sipariş no / müşteri / ürün / miktar tablosu kartta basılsın mı."
              checked={draft.showOrders}
              disabled={mut.isPending}
              onChange={(v) => setDraft((d) => ({ ...d, showOrders: v }))}
            />
          </div>
          <div className="py-3">
            <FlagToggle
              title="Özellikler satırı"
              desc="ÖZELLİKLER (kumaş özellikleri) satırı kartta basılsın mı."
              checked={draft.showProperties}
              disabled={mut.isPending}
              onChange={(v) => setDraft((d) => ({ ...d, showProperties: v }))}
            />
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Kart Alanları (Spec Kutusu)</div>
          <p className="text-xs text-muted-foreground">
            Renk/en/hedef metraj… kutusunda hangi alanlar basılsın. Kapatılan alan karttan gizlenir.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {SPEC_FIELDS.map(({ key, label }) => (
              <label
                key={key}
                className="flex cursor-pointer select-none items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={draft.specFields[key] !== false}
                  disabled={mut.isPending}
                  onCheckedChange={(v) =>
                    setDraft((d) => ({ ...d, specFields: { ...d.specFields, [key]: v === true } }))
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="tc-footer" className="text-sm font-medium">
            Alt Not
          </label>
          <p className="text-xs text-muted-foreground">
            Kartın altına basılan serbest not (boş → basılmaz).
          </p>
          <textarea
            id="tc-footer"
            value={draft.footerNote}
            maxLength={500}
            rows={2}
            onChange={(e) => setDraft((d) => ({ ...d, footerNote: e.target.value }))}
            className="mt-2 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || !trimmed || mut.isPending}
            onClick={() =>
              mut.mutate({
                ...draft,
                companyName: trimmed || DEFAULT_TRAVELER_CARD_CONFIG.companyName,
              })
            }
          >
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Değişiklik yalnızca bundan sonra basılan kartlara işler — mevcut kartlar
            basım anında dondurulmuştur.
          </span>
        </div>
      </div>
    </PermissionGate>
  );
}
