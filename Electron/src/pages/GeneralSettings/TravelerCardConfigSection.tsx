import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PermissionGate } from "@/components/PermissionGate";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { DOCUMENT_DESIGN_READ, DOCUMENT_DESIGN_WRITE } from "@/lib/permissions";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import {
  featureFlagService,
  DEFAULT_TRAVELER_CARD_CONFIG,
  type TravelerCardConfig,
  type TravelerCardPageSize,
  type TravelerCardFontWeight,
  type TravelerCardSpecField,
  type TravelerCardSpecFields,
  type TravelerCardOrderFields,
  type TravelerCardBatchFields,
} from "@/services/featureFlagService";
import { TravelerCardFieldsPanel } from "./TravelerCardFieldsPanel";
// Boş tablo paneli — belgelerle ORTAK bileşen (bkz. BlankGridPanel notu).
import { BlankGridPanel } from "./DocumentAdvancedControls";

/**
 * Ham hücre değerini (boolean eski şekil | nesne | undefined) tam alana çözer.
 * Bayat cache / eski kayıt güvenli — backend `coerceSpecField` ile aynı kural.
 */
function coerceSpecField(v: unknown): TravelerCardSpecField {
  if (v === false) return { show: false, size: "md", weight: "normal" };
  if (v == null || v === true) return { show: true, size: "md", weight: "normal" };
  const f = v as Partial<TravelerCardSpecField>;
  return {
    show: f.show !== false,
    size: f.size === "sm" || f.size === "lg" ? f.size : "md",
    weight:
      f.weight === "light" || f.weight === "medium" || f.weight === "bold" || f.weight === "black"
        ? f.weight
        : "normal",
    ...(typeof f.px === "number" && Number.isFinite(f.px) ? { px: f.px } : {}),
  };
}
function coerceSpecFields<K extends string>(keys: K[], raw: unknown): Record<K, TravelerCardSpecField> {
  const r = (raw ?? {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, coerceSpecField(r[k])])) as Record<K, TravelerCardSpecField>;
}

const SPEC_KEYS: (keyof TravelerCardSpecFields)[] = [
  "color", "width", "targetQuantity", "targetWeight", "foldType", "startDate", "endDate",
];
const ORDER_KEYS: (keyof TravelerCardOrderFields)[] = [
  "orderNumber", "customer", "item", "color", "quantity",
];
const BATCH_KEYS: (keyof TravelerCardBatchFields)[] = [
  "batchNumber", "rollCount", "quantity", "dispatch",
];

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
const SPEC_COLUMN_OPTS = [1, 2, 3, 4];
const clampMm = (v: string): number => Math.min(40, Math.max(0, Math.round(Number(v) || 0)));
const INPUT_CLS =
  "mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function SegButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 text-sm transition-colors",
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Refakat kartı marka/içerik ayarı paneli. Kaydedince yalnızca BUNDAN SONRA
 * basılan kartlara işler — mevcut kartlar basım anında dondurulduğu için
 * (snapshot) değişmez.
 *
 * Alan bazlı ayarların tamamı `TravelerCardFieldsPanel`de: görünürlük + punto +
 * kalınlık TEK tabloda (2026-08-05 kullanıcı kararı; öncesinde üç ayrı tablo,
 * ayrı bir bölüm-anahtarı listesi ve ayrı bir punto bölümü vardı).
 */
export function TravelerCardConfigSection({
  onPreview,
}: {
  /** Taslak değiştikçe (debounce'lu) çağrılır — canlı PDF önizlemesi için. */
  onPreview?: (cfg: TravelerCardConfig) => void;
} = {}) {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  // Salt-okunur mod: ekran açılır (READ), Kaydet kapalıdır — DocumentConfigSection
  // ile aynı desen (girdiler açık kalır, canlı önizleme çalışır, hiçbir şey gitmez).
  const canWrite = useRoleAccess().hasAnyPermission(DOCUMENT_DESIGN_WRITE);
  const rawCfg = flagsQ.data?.data?.travelerCardConfig;
  const current: TravelerCardConfig = {
    ...DEFAULT_TRAVELER_CARD_CONFIG,
    ...(rawCfg ?? {}),
    // Alan sözlükleri spread'DEN SONRA gelir: backend'e sonradan eklenen alanlar
    // kayıtlı ayarda yok ve `undefined` yazılmamalı.
    specFields: coerceSpecFields(SPEC_KEYS, rawCfg?.specFields) as TravelerCardSpecFields,
    orderFields: coerceSpecFields(ORDER_KEYS, rawCfg?.orderFields) as TravelerCardOrderFields,
    batchFields: coerceSpecFields(BATCH_KEYS, rawCfg?.batchFields) as TravelerCardBatchFields,
    orderTotal: coerceSpecField(rawCfg?.orderTotal ?? DEFAULT_TRAVELER_CARD_CONFIG.orderTotal),
    batchTotal: coerceSpecField(rawCfg?.batchTotal ?? DEFAULT_TRAVELER_CARD_CONFIG.batchTotal),
    specColumns: Math.min(4, Math.max(1, Math.round(rawCfg?.specColumns ?? 3) || 3)),
    showBatches: rawCfg?.showBatches !== false,
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
    mutationFn: (cfg: TravelerCardConfig) => featureFlagService.update({ travelerCardConfig: cfg }),
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
      anyOf={DOCUMENT_DESIGN_READ}
      fallback={<div className="text-sm text-muted-foreground">Bu ayarı görüntülemek için yetkin yok.</div>}
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="tc-company" className="text-sm font-medium">Firma Adı</label>
          <p className="text-xs text-muted-foreground">Refakat kartının üst başlığında basılır.</p>
          <input
            id="tc-company"
            value={draft.companyName}
            maxLength={120}
            onChange={(e) => setDraft((d) => ({ ...d, companyName: e.target.value }))}
            placeholder={DEFAULT_TRAVELER_CARD_CONFIG.companyName}
            className={INPUT_CLS}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tc-address" className="text-sm font-medium">Adres</label>
            <p className="text-xs text-muted-foreground">Firma adının altında (boş → basılmaz).</p>
            <input
              id="tc-address"
              value={draft.addressLine}
              maxLength={200}
              onChange={(e) => setDraft((d) => ({ ...d, addressLine: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label htmlFor="tc-phone" className="text-sm font-medium">Telefon</label>
            <p className="text-xs text-muted-foreground">Firma adının altında (boş → basılmaz).</p>
            <input
              id="tc-phone"
              value={draft.phone}
              maxLength={60}
              onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">Sayfa Boyutu &amp; Kenar Payı</div>
          <p className="text-xs text-muted-foreground">
            Kart boyutu ve hangi kenardan ne kadar pay (mm) bırakılacağı — ciltleme/delik zımbası için boşluk.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <div className="inline-flex overflow-hidden rounded-md border">
              {PAGE_SIZES.map((sz) => (
                <SegButton key={sz} active={draft.pageSize === sz} onClick={() => setDraft((d) => ({ ...d, pageSize: sz }))}>
                  {sz}
                </SegButton>
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
          <div className="text-sm font-medium">Yazı — Genel</div>
          <p className="text-xs text-muted-foreground">
            Kartın <strong>tüm</strong> yazılarını birlikte ölçekler (oranlar korunur). Alan bazlı
            ayarların <strong>üstüne</strong> biner.
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <div className="text-[11px] text-muted-foreground">Boyut</div>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {FONT_SCALES.map((s) => (
                  <SegButton
                    key={s.value}
                    active={Math.abs(draft.fontScale - s.value) < 0.001}
                    onClick={() => setDraft((d) => ({ ...d, fontScale: s.value }))}
                  >
                    {s.label}
                  </SegButton>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Kalınlık</div>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {FONT_WEIGHTS.map((w) => (
                  <SegButton
                    key={w.value}
                    active={draft.fontWeight === w.value}
                    onClick={() => setDraft((d) => ({ ...d, fontWeight: w.value }))}
                  >
                    {w.label}
                  </SegButton>
                ))}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground">Özet tablo — satır başına sütun</div>
              <div className="mt-1 inline-flex overflow-hidden rounded-md border">
                {SPEC_COLUMN_OPTS.map((n) => (
                  <SegButton
                    key={n}
                    active={draft.specColumns === n}
                    onClick={() => setDraft((d) => ({ ...d, specColumns: n }))}
                  >
                    {n}
                  </SegButton>
                ))}
              </div>
            </div>
          </div>
        </div>

        <TravelerCardFieldsPanel cfg={draft} disabled={mut.isPending} onChange={setDraft} />

        {/* BOŞ TABLO (2026-08-13 saha isteği: "kartın alt boşluğuna istediğimiz
            ölçüde grid, sütun genişlikleri de ayarlanabilsin"). Panel BELGELERLE
            ORTAK — aynı ayarın iki ekranda iki farklı yüzeyi olmasın. Konum
            seçici gizli: kartta grid'in yerini Şablon Stüdyosu'ndaki bölüm
            sırası belirler. */}
        <BlankGridPanel
          value={draft.blankGrid}
          disabled={mut.isPending}
          hidePosition
          onChange={(next) => setDraft((d) => ({ ...d, blankGrid: next }))}
        />

        <div>
          <label htmlFor="tc-footer" className="text-sm font-medium">Alt Not</label>
          <p className="text-xs text-muted-foreground">
            Kartın altına basılan serbest not (boş → basılmaz). Görünürlüğü “Alt Bant → Alt not”tan.
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
            disabled={!canWrite || !dirty || !trimmed || mut.isPending}
            onClick={() =>
              mut.mutate({ ...draft, companyName: trimmed || DEFAULT_TRAVELER_CARD_CONFIG.companyName })
            }
          >
            {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {!canWrite
              ? "Salt-okunur — düzenlemek için 'belge şablonu düzenleme' yetkisi gerekli."
              : "Değişiklik yalnızca bundan sonra basılan kartlara işler — mevcut kartlar basım anında dondurulmuştur."}
          </span>
        </div>
      </div>
    </PermissionGate>
  );
}
