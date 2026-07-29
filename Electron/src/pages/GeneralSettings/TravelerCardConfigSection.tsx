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
  type TravelerCardFontWeight,
  type TravelerCardFieldSize,
  type TravelerCardSpecField,
  type TravelerCardSpecFields,
  type TravelerCardOrderFields,
} from "@/services/featureFlagService";
import { FlagToggle } from "./SettingRow";

const SIZE_OPTS: { value: TravelerCardFieldSize; label: string }[] = [
  { value: "sm", label: "Küçük (sm)" },
  { value: "md", label: "Orta (md)" },
  { value: "lg", label: "Büyük (lg)" },
];
const WEIGHT_OPTS: { value: TravelerCardFontWeight; label: string }[] = [
  { value: "light", label: "İnce" },
  { value: "normal", label: "Normal" },
  { value: "bold", label: "Kalın" },
];
const SELECT_CLS =
  "h-7 rounded-md border border-input bg-background px-1.5 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

/** Ham spec değeri (boolean eski şekil | nesne | undefined) → tam alan (bayat-cache güvenli). */
function coerceSpecField(v: unknown): TravelerCardSpecField {
  if (v === false) return { show: false, size: "md", weight: "normal" };
  if (v == null || v === true) return { show: true, size: "md", weight: "normal" };
  const f = v as Partial<TravelerCardSpecField>;
  return {
    show: f.show !== false,
    size: f.size === "sm" || f.size === "lg" ? f.size : "md",
    weight: f.weight === "light" || f.weight === "bold" ? f.weight : "normal",
  };
}

const FONT_SCALES: { value: number; label: string }[] = [
  { value: 0.85, label: "Küçük" },
  { value: 1, label: "Normal" },
  { value: 1.15, label: "Büyük" },
  { value: 1.3, label: "En Büyük" },
];
const FONT_WEIGHTS: { value: TravelerCardFontWeight; label: string }[] = [
  { value: "light", label: "İnce" },
  { value: "normal", label: "Normal" },
  { value: "bold", label: "Kalın" },
];

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
const ORDER_FIELDS: { key: keyof TravelerCardOrderFields; label: string }[] = [
  { key: "orderNumber", label: "Sipariş No" },
  { key: "customer", label: "Müşteri" },
  { key: "item", label: "Kumaş" },
  { key: "color", label: "Renk" },
  { key: "quantity", label: "Miktar" },
];
const SPEC_COLUMN_OPTS = [1, 2, 3, 4];
const clampMm = (v: string): number => Math.min(40, Math.max(0, Math.round(Number(v) || 0)));

function coerceSpecFields<K extends string>(keys: K[], raw: unknown): Record<K, TravelerCardSpecField> {
  const r = (raw ?? {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, coerceSpecField(r[k])])) as Record<K, TravelerCardSpecField>;
}

/** Alan-başına göster/boyut/kalınlık tablosu — spec kutusu + sipariş sütunları paylaşır. */
function FieldTable<K extends string>({
  rows,
  values,
  disabled,
  onChange,
}: {
  rows: { key: K; label: string }[];
  values: Record<K, TravelerCardSpecField>;
  disabled: boolean;
  onChange: (key: K, patch: Partial<TravelerCardSpecField>) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="grid grid-cols-[1fr_auto_7rem_6rem] items-center gap-x-3 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Alan</span>
        <span>Göster</span>
        <span>Boyut</span>
        <span>Kalınlık</span>
      </div>
      {rows.map(({ key, label }) => {
        const f = values[key];
        return (
          <div
            key={key}
            className="grid grid-cols-[1fr_auto_7rem_6rem] items-center gap-x-3 border-b px-3 py-1.5 last:border-b-0"
          >
            <span className="text-sm">{label}</span>
            <Checkbox
              checked={f.show}
              disabled={disabled}
              onCheckedChange={(v) => onChange(key, { show: v === true })}
            />
            <select
              value={f.size}
              disabled={disabled || !f.show}
              onChange={(e) => onChange(key, { size: e.target.value as TravelerCardFieldSize })}
              className={SELECT_CLS}
            >
              {SIZE_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={f.weight}
              disabled={disabled || !f.show}
              onChange={(e) => onChange(key, { weight: e.target.value as TravelerCardFontWeight })}
              className={SELECT_CLS}
            >
              {WEIGHT_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

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
  // Eksik/bayat-cache üst-düzey alanlara karşı default'la birleştir; spec/sipariş alanlarını
  // coerce et (eski boolean şekli de → {show,size,weight}).
  const rawCfg = flagsQ.data?.data?.travelerCardConfig;
  const specFields = coerceSpecFields(
    SPEC_FIELDS.map((s) => s.key),
    rawCfg?.specFields,
  ) as unknown as TravelerCardSpecFields;
  const orderFields = coerceSpecFields(
    ORDER_FIELDS.map((o) => o.key),
    rawCfg?.orderFields,
  ) as unknown as TravelerCardOrderFields;
  const current: TravelerCardConfig = {
    ...DEFAULT_TRAVELER_CARD_CONFIG,
    ...(rawCfg ?? {}),
    specFields,
    orderFields,
    orderTotal: coerceSpecField(rawCfg?.orderTotal ?? DEFAULT_TRAVELER_CARD_CONFIG.orderTotal),
    specColumns: Math.min(4, Math.max(1, Math.round(rawCfg?.specColumns ?? 3) || 3)),
  };

  const [draft, setDraft] = useState<TravelerCardConfig>(current);
  const updateSpec = (key: keyof TravelerCardSpecFields, patch: Partial<TravelerCardSpecField>) =>
    setDraft((d) => ({
      ...d,
      specFields: { ...d.specFields, [key]: { ...d.specFields[key], ...patch } },
    }));
  const updateOrder = (key: keyof TravelerCardOrderFields, patch: Partial<TravelerCardSpecField>) =>
    setDraft((d) => ({
      ...d,
      orderFields: { ...d.orderFields, [key]: { ...d.orderFields[key], ...patch } },
    }));
  const updateTotal = (patch: Partial<TravelerCardSpecField>) =>
    setDraft((d) => ({ ...d, orderTotal: { ...d.orderTotal, ...patch } }));
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

        <div>
          <div className="text-sm font-medium">Yazı</div>
          <p className="text-xs text-muted-foreground">
            Kartın tüm yazılarının boyutu ve kalınlığı (oranlar korunur, sadece yazı değişir).
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <div className="text-[11px] text-muted-foreground">Boyut</div>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {FONT_SCALES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, fontScale: s.value }))}
                    className={cn(
                      "px-3 py-1.5 text-sm transition-colors",
                      Math.abs(draft.fontScale - s.value) < 0.001
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Kalınlık</div>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {FONT_WEIGHTS.map((w) => (
                  <button
                    key={w.value}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, fontWeight: w.value }))}
                    className={cn(
                      "px-3 py-1.5 text-sm transition-colors",
                      draft.fontWeight === w.value
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
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
              desc="Sipariş no / müşteri / kumaş / miktar tablosu kartta basılsın mı."
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">Kart Alanları (Spec Kutusu)</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Satır başına sütun:
              <div className="inline-flex overflow-hidden rounded-md border">
                {SPEC_COLUMN_OPTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, specColumns: n }))}
                    className={cn(
                      "px-2.5 py-1 text-sm transition-colors",
                      draft.specColumns === n
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Her alan tek tek: göster/gizle, boyut (sm/md/lg) ve kalınlık. Genel "Yazı" ayarı üstüne biner.
          </p>
          <div className="mt-2">
            <FieldTable
              rows={SPEC_FIELDS}
              values={draft.specFields}
              disabled={mut.isPending}
              onChange={updateSpec}
            />
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Bağlı Siparişler — Sütunlar</div>
          <p className="text-xs text-muted-foreground">
            "Bağlı siparişler" açıkken tablonun sütunları: her biri göster/boyut/kalınlık.
          </p>
          <div className="mt-2">
            <FieldTable
              rows={ORDER_FIELDS}
              values={draft.orderFields}
              disabled={mut.isPending}
              onChange={updateOrder}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
              <Checkbox
                checked={draft.orderTotal.show}
                disabled={mut.isPending}
                onCheckedChange={(v) => updateTotal({ show: v === true })}
              />
              Alt toplam satırı (miktar toplamı)
            </label>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Boyut
              <select
                value={draft.orderTotal.size}
                disabled={mut.isPending || !draft.orderTotal.show}
                onChange={(e) => updateTotal({ size: e.target.value as TravelerCardFieldSize })}
                className={SELECT_CLS}
              >
                {SIZE_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              Kalınlık
              <select
                value={draft.orderTotal.weight}
                disabled={mut.isPending || !draft.orderTotal.show}
                onChange={(e) => updateTotal({ weight: e.target.value as TravelerCardFontWeight })}
                className={SELECT_CLS}
              >
                {WEIGHT_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
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
