import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type DefaultLabelMedia } from "@/services/featureFlagService";
import { formatRollName } from "@/lib/roll-name";
import { FieldLabel, FlagToggle } from "./SettingRow";

const DEFAULT_COPIES = 2;
const MAX_COPIES = 5;
const DEFAULT_TEMPLATE = "{item} {color} {width}";
const TOKEN_RE = /\{(item|color|width|quality)\}/;

const FALLBACK_MEDIA: DefaultLabelMedia = { widthMm: 100, heightMm: 148, dpi: 203, gapMm: 2, marginMm: 3 };
/** Varsayılan medya alanları: anahtar + etiket + [min,max] + tam sayı mı. */
const MEDIA_FIELDS: { key: keyof DefaultLabelMedia; label: string; min: number; max: number; int?: boolean }[] = [
  { key: "widthMm", label: "Etiket eni (mm)", min: 10, max: 500 },
  { key: "heightMm", label: "Etiket boyu (mm)", min: 10, max: 500 },
  { key: "dpi", label: "DPI", min: 50, max: 1200, int: true },
  { key: "gapMm", label: "Boşluk (mm)", min: 0, max: 50 },
  { key: "marginMm", label: "Pay (mm)", min: 0, max: 50 },
];

const mediaToStr = (m: DefaultLabelMedia): Record<keyof DefaultLabelMedia, string> => ({
  widthMm: String(m.widthMm),
  heightMm: String(m.heightMm),
  dpi: String(m.dpi),
  gapMm: String(m.gapMm),
  marginMm: String(m.marginMm),
});

/**
 * Saha #6: Etiket baskı ayarı — top etiketi bir baskıda kaç kopya çıksın.
 * Default 2 (etiket topun bir üstüne bir altına yapıştırılıyor). Tambur kesimi
 * ve tartı/paket/sevkiyat baskıları bu ayarı kullanır; tek seferlik istisna
 * gerektiğinde baskı ekranları ?copies= ile override edebilir.
 */
export function LabelSettingsSection() {
  const qc = useQueryClient();
  const flagsQ = useFeatureFlags();
  const current = flagsQ.data?.data?.labelCopies ?? DEFAULT_COPIES;
  const currentTemplate = flagsQ.data?.data?.rollNameTemplate?.trim() || DEFAULT_TEMPLATE;

  const [copies, setCopies] = useState(String(current));
  const [template, setTemplate] = useState(currentTemplate);
  useEffect(() => {
    setCopies(String(current));
  }, [current]);
  useEffect(() => {
    setTemplate(currentTemplate);
  }, [currentTemplate]);

  const mut = useMutation({
    mutationFn: (payload: { labelCopies: number }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Etiket ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const templateMut = useMutation({
    mutationFn: (payload: { rollNameTemplate: string }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Top adı şablonu kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const nativeOn = flagsQ.data?.data?.nativeSendEnabled ?? false;
  const nativeMut = useMutation({
    mutationFn: (payload: { nativeSendEnabled: boolean }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Doğrudan gönderim ayarı kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const currentMedia = flagsQ.data?.data?.defaultLabelMedia ?? FALLBACK_MEDIA;
  const [media, setMedia] = useState<Record<keyof DefaultLabelMedia, string>>(() => mediaToStr(currentMedia));
  useEffect(() => {
    setMedia(mediaToStr(currentMedia));
    // currentMedia her alanı ayrı bağımlılık; obje referansı her render değişebilir.
  }, [currentMedia.widthMm, currentMedia.heightMm, currentMedia.dpi, currentMedia.gapMm, currentMedia.marginMm]);
  const mediaMut = useMutation({
    mutationFn: (payload: { defaultLabelMedia: DefaultLabelMedia }) => featureFlagService.update(payload),
    onSuccess: () => {
      toast.success("Varsayılan etiket medyası kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  if (flagsQ.isLoading) return <Skeleton className="h-24 w-full" />;

  const mediaErrors = MEDIA_FIELDS.filter((f) => {
    const n = Number(media[f.key]);
    return !Number.isFinite(n) || n < f.min || n > f.max || (f.int && !Number.isInteger(n));
  });
  const mediaValid = mediaErrors.length === 0;
  const mediaDirty = MEDIA_FIELDS.some((f) => Number(media[f.key]) !== currentMedia[f.key]);
  const saveMedia = () => {
    const payload = MEDIA_FIELDS.reduce(
      (acc, f) => ({ ...acc, [f.key]: f.int ? Math.floor(Number(media[f.key])) : Number(media[f.key]) }),
      {} as DefaultLabelMedia,
    );
    mediaMut.mutate({ defaultLabelMedia: payload });
  };

  const num = Number(copies);
  const valid = Number.isInteger(num) && num >= 1 && num <= MAX_COPIES;
  const dirty = num !== current;

  const tplTrimmed = template.trim();
  const tplValid = tplTrimmed.length > 0 && tplTrimmed.length <= 100 && TOKEN_RE.test(tplTrimmed);
  const tplDirty = tplTrimmed !== currentTemplate;
  const tplPreview = formatRollName(tplTrimmed || DEFAULT_TEMPLATE, {
    item: "PATOS",
    color: "055-BEYAZ",
    width: 150,
    quality: "A",
  });

  return (
    <PermissionGate
      permission="admin:settings"
      fallback={
        <p className="text-sm">
          Etiket kopya adedi: <span className="rounded-md border px-2 py-0.5 text-xs">{current}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            (değiştirmek için <code>admin:settings</code> gerekir)
          </span>
        </p>
      }
    >
      <div className="space-y-4">
        <div>
          <FieldLabel
            htmlFor="label-copies"
            label="Etiket kopya adedi"
            desc="Bir top etiketi baskısında kaç kopya çıkar. 2 = etiket topun bir üstüne, bir altına yapıştırılır (varsayılan). Tambur kesimi ve tartı/paket baskılarında geçerlidir."
          />
          <input
            id="label-copies"
            type="number"
            inputMode="numeric"
            value={copies}
            min={1}
            max={MAX_COPIES}
            step={1}
            onChange={(e) => setCopies(e.target.value)}
            className="mt-2 flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {!valid && (
            <p className="mt-1 text-xs text-destructive">1–{MAX_COPIES} arası bir sayı girin.</p>
          )}
        </div>
        <Button
          type="button"
          disabled={!dirty || !valid || mut.isPending}
          onClick={() => mut.mutate({ labelCopies: num })}
        >
          {mut.isPending ? "Kaydediliyor…" : "Kaydet"}
        </Button>

        {/* Saha #20: top adı format şablonu */}
        <div className="border-t pt-4">
          <FieldLabel
            htmlFor="roll-name-template"
            label="Top adı format şablonu"
            desc={
              <>
                Listelerde ve aramalarda gösterilen birleşik ürün adının düzeni. Token'lar:{" "}
                <code>{"{item}"}</code> <code>{"{color}"}</code> <code>{"{width}"}</code>{" "}
                <code>{"{quality}"}</code>. Boş alanlar (renksiz vb.) otomatik atlanır.
              </>
            }
          />
          <input
            id="roll-name-template"
            type="text"
            value={template}
            maxLength={100}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder={DEFAULT_TEMPLATE}
            className="mt-2 flex h-9 w-full max-w-md rounded-md border border-input bg-background px-3 py-1 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {!tplValid && (
            <p className="mt-1 text-xs text-destructive">
              En az bir token içermeli ve 100 karakteri aşmamalı.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Önizleme: <span className="font-medium text-foreground">{tplPreview || "—"}</span>
          </p>
          <Button
            type="button"
            className="mt-2"
            disabled={!tplDirty || !tplValid || templateMut.isPending}
            onClick={() => templateMut.mutate({ rollNameTemplate: tplTrimmed })}
          >
            {templateMut.isPending ? "Kaydediliyor…" : "Şablonu Kaydet"}
          </Button>
        </div>

        {/* Etiket Stüdyosu v2: cihazsız baskı/önizleme için varsayılan medya */}
        <div className="border-t pt-4">
          <FieldLabel
            label="Varsayılan etiket medyası"
            desc="Yazıcı cihazı seçili değilken (önizleme, kartela vb.) kullanılan etiket ölçüsü. Bir yazıcı cihazı seçildiğinde onun kendi medyası (Tanımlar → Cihazlar) önceliklidir; bu yalnızca yedek ölçüdür."
          />
          <div className="mt-2 flex flex-wrap gap-3">
            {MEDIA_FIELDS.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <label htmlFor={`media-${f.key}`} className="text-xs text-muted-foreground">
                  {f.label}
                </label>
                <input
                  id={`media-${f.key}`}
                  type="number"
                  inputMode="decimal"
                  value={media[f.key]}
                  min={f.min}
                  max={f.max}
                  step={f.int ? 1 : "any"}
                  onChange={(e) => setMedia((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="flex h-9 w-24 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            ))}
          </div>
          {!mediaValid && (
            <p className="mt-1 text-xs text-destructive">
              Eni/Boyu 10–500 mm, DPI 50–1200, Boşluk/Pay 0–50 mm aralığında olmalı.
            </p>
          )}
          <Button
            type="button"
            className="mt-3"
            disabled={!mediaDirty || !mediaValid || mediaMut.isPending}
            onClick={saveMedia}
          >
            {mediaMut.isPending ? "Kaydediliyor…" : "Medyayı Kaydet"}
          </Button>
        </div>

        {/* Faz-2: doğrudan yazıcıya gönderim (opt-in) */}
        <div className="border-t pt-4">
          <FlagToggle
            title="Doğrudan yazıcıya gönder (native)"
            desc={
              <>
                Açıkken etiket komutları (PPLA/ZPL) backend'den yazıcıya doğrudan (TCP 9100)
                gönderilir — OS yazıcı diyaloğu çıkmaz. <strong>Kapalıyken (varsayılan)</strong>{" "}
                simüle edilir; fiziksel baskı HTML + OS sürücüyle yapılır. Açmadan önce makinelerin
                <em> Yazıcı IP</em>'si tanımlı olmalı (Tanımlar → Donanım) ve bir test baskısıyla
                doğrulanmalı.
              </>
            }
            checked={nativeOn}
            disabled={nativeMut.isPending}
            onChange={(v) => nativeMut.mutate({ nativeSendEnabled: v })}
          />
        </div>
      </div>
    </PermissionGate>
  );
}
