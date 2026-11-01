import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { FEATURE_FLAGS_QUERY_KEY, useFeatureFlags } from "@/hooks/usePricingEnabled";
import { featureFlagService, type DefaultLabelMedia, type FeatureFlags } from "@/services/featureFlagService";
import { FieldLabel, FlagToggle } from "./SettingRow";
import { useHostedInstallation } from "@/hooks/useHostedInstallation";
import {
  DEFAULT_LABEL_COPIES,
  DEFAULT_LABEL_COPIES_SOURCE,
  LabelCopiesFields,
  isValidLabelCopies,
} from "./LabelCopiesFields";
import { DEFAULT_LABEL_CUSTOMER_CODE_MISSING, LabelCustomerCodeMissingField } from "./LabelCustomerCodeMissingField";
import { SettingsSaveBar } from "./SettingsSaveBar";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { SETTINGS_ADMIN_PERMISSION } from "./settings-config";

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
 * Etiket baskısı ayarları — TEK kaydetme standardı: kopya adedi + varsayılan medya
 * + doğrudan gönderim (native) hepsi TASLAK tutulur, alttaki tek "Kaydet" değişen
 * alanları TEK istekte yazar (eskiden 3 ayrı davranış vardı: Kaydet / Medyayı
 * Kaydet / anında toggle).
 */
export function LabelSettingsSection({
  writePermissions = [SETTINGS_ADMIN_PERMISSION],
}: {
  writePermissions?: string[];
}) {
  const qc = useQueryClient();
  const { hasAnyPermission } = useRoleAccess();
  const canEdit = hasAnyPermission(writePermissions);
  const flagsQ = useFeatureFlags();
  const hosted = useHostedInstallation();

  const currentCopies = flagsQ.data?.data?.labelCopies ?? DEFAULT_LABEL_COPIES;
  const currentSource = flagsQ.data?.data?.labelCopiesSource ?? DEFAULT_LABEL_COPIES_SOURCE;
  const currentNative = flagsQ.data?.data?.nativeSendEnabled ?? false;
  const currentMobileRaster = flagsQ.data?.data?.mobileRasterEnabled ?? false;
  const currentScrapLabel = flagsQ.data?.data?.scrapGradeLabelEnabled ?? false;
  const currentMedia = flagsQ.data?.data?.defaultLabelMedia ?? FALLBACK_MEDIA;
  const currentCodeMissing = flagsQ.data?.data?.labelCustomerCodeMissing ?? DEFAULT_LABEL_CUSTOMER_CODE_MISSING;

  const [copies, setCopies] = useState(String(currentCopies));
  const [source, setSource] = useState(currentSource);
  const [native, setNative] = useState(currentNative);
  const [mobileRaster, setMobileRaster] = useState(currentMobileRaster);
  const [scrapLabel, setScrapLabel] = useState(currentScrapLabel);
  const [codeMissing, setCodeMissing] = useState(currentCodeMissing);
  useEffect(() => setCodeMissing(currentCodeMissing), [currentCodeMissing]);
  const [media, setMedia] = useState<Record<keyof DefaultLabelMedia, string>>(() => mediaToStr(currentMedia));
  useEffect(() => setCopies(String(currentCopies)), [currentCopies]);
  useEffect(() => setSource(currentSource), [currentSource]);
  useEffect(() => setNative(currentNative), [currentNative]);
  useEffect(() => setMobileRaster(currentMobileRaster), [currentMobileRaster]);
  useEffect(() => setScrapLabel(currentScrapLabel), [currentScrapLabel]);
  useEffect(() => {
    setMedia(mediaToStr(currentMedia));
    // currentMedia obje referansı her render değişebilir → alan-bazlı bağımlılık.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMedia.widthMm, currentMedia.heightMm, currentMedia.dpi, currentMedia.gapMm, currentMedia.marginMm]);

  const copiesNum = Number(copies);
  const copiesValid = isValidLabelCopies(copies);
  const mediaErrors = MEDIA_FIELDS.filter((f) => {
    const n = Number(media[f.key]);
    return !Number.isFinite(n) || n < f.min || n > f.max || (f.int && !Number.isInteger(n));
  });
  const mediaValid = mediaErrors.length === 0;

  const copiesDirty = copiesNum !== currentCopies;
  const sourceDirty = source !== currentSource;
  const nativeDirty = native !== currentNative;
  const mobileRasterDirty = mobileRaster !== currentMobileRaster;
  const scrapLabelDirty = scrapLabel !== currentScrapLabel;
  const mediaDirty = MEDIA_FIELDS.some((f) => Number(media[f.key]) !== currentMedia[f.key]);
  const codeMissingDirty = codeMissing !== currentCodeMissing;
  const dirty = copiesDirty || sourceDirty || nativeDirty || mobileRasterDirty || scrapLabelDirty || mediaDirty || codeMissingDirty;
  useRegisterSettingsDirty(dirty);

  const mut = useMutation({
    mutationFn: () => {
      const patch: Partial<FeatureFlags> = {};
      if (copiesDirty) patch.labelCopies = copiesNum;
      if (sourceDirty) patch.labelCopiesSource = source;
      if (nativeDirty) patch.nativeSendEnabled = native;
      if (mobileRasterDirty) patch.mobileRasterEnabled = mobileRaster;
      if (scrapLabelDirty) patch.scrapGradeLabelEnabled = scrapLabel;
      if (codeMissingDirty) patch.labelCustomerCodeMissing = codeMissing;
      if (mediaDirty) {
        patch.defaultLabelMedia = MEDIA_FIELDS.reduce(
          (acc, f) => ({ ...acc, [f.key]: f.int ? Math.floor(Number(media[f.key])) : Number(media[f.key]) }),
          {} as DefaultLabelMedia,
        );
      }
      return featureFlagService.update(patch);
    },
    onSuccess: () => {
      toast.success("Etiket ayarları kaydedildi.");
      void qc.invalidateQueries({ queryKey: FEATURE_FLAGS_QUERY_KEY });
    },
  });

  const reset = () => {
    setCopies(String(currentCopies));
    setSource(currentSource);
    setNative(currentNative);
    setMobileRaster(currentMobileRaster);
    setScrapLabel(currentScrapLabel);
    setCodeMissing(currentCodeMissing);
    setMedia(mediaToStr(currentMedia));
  };

  if (flagsQ.isLoading) return <Skeleton className="h-24 w-full" />;

  if (!canEdit) {
    return (
      <p className="text-sm">
        Etiket adedi: <span className="rounded-md border px-2 py-0.5 text-xs">{currentCopies}</span>{" "}
        <span className="text-xs text-muted-foreground">
          ({currentSource === "STATION" ? "istasyon belirler; bu genel adettir" : "sistem geneli"})
        </span>
        <span className="ml-2 text-xs text-muted-foreground">
          (değiştirmek için <code>admin:settings</code> gerekir)
        </span>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <LabelCopiesFields
        source={source}
        onSourceChange={setSource}
        copies={copies}
        onCopiesChange={setCopies}
        disabled={mut.isPending}
      />

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
          checked={native && !hosted}
          disabled={mut.isPending || hosted}
          onChange={setNative}
        />
        {hosted && (
          <p className="mt-1 text-xs text-muted-foreground" data-testid="hosted-native-lock">
            Bulut kurulumu: sunucu fabrikadaki yazıcıya ulaşamaz, doğrudan gönderim kapalıdır.
          </p>
        )}
      </div>

      {/* Mobil raster (BT/HC-06) — Electron raster'ından (cihaz kaydı) BAĞIMSIZ toggle */}
      <div className="border-t pt-4">
        <FlagToggle
          title="Mobilde raster baskı (Bluetooth / HC-06)"
          desc={
            <>
              Açıkken saha tabletleri de etiketi <strong>raster (1bpp bitmap)</strong> basar —
              Electron'daki gibi önizleme=baskı (WYSIWYG) + gerçek Türkçe glifler.{" "}
              <strong>Kapalıyken (varsayılan)</strong> mobil hızlı <em>komut yolunu</em> kullanır
              (yazıcının dahili fontu; Türkçe karakterler sadeleşir). ⚠ Raster ~40&nbsp;KB'lık
              veriyi HC-06 Bluetooth üzerinden gönderir → <strong>baskı yavaşlayabilir</strong>;
              sahada çok yavaşsa buradan kapatın. Electron (USB) raster'ını ve cihaz kaydındaki
              raster ayarını etkilemez.
            </>
          }
          checked={mobileRaster}
          disabled={mut.isPending}
          onChange={setMobileRaster}
        />
      </div>

      {/* Fire kalitede etiket — 2026-08-20 saha isteği */}
      <div className="border-t pt-4">
        <FlagToggle
          title="Fire kalitede etiket bas"
          desc={
            <>
              <strong>Kapalıyken (varsayılan)</strong> fire kalitede üretilen topa{" "}
              <strong>otomatik etiket basılmaz</strong> — kesimden sonra kâğıt çıkmaz ve
              operatöre nedeni bildirilir. Gerekçe: etiket bir <em>satılabilirlik</em>{" "}
              işaretidir; fire mala bitmiş-ürün etiketi basmak onun akışa geri girmesini
              kolaylaştırır. Operatör yine de <em>Etiket</em> düğmesiyle onay vererek elle
              basabilir. Açıkken fire toplar da diğerleri gibi otomatik etiket alır.
              <br />
              Hangi kalitenin “fire” sayıldığı kalite kataloğundan gelir (Tanımlar → Kalite
              Sınıfları); bu ayar yalnız kuralı açıp kapar.
            </>
          }
          checked={scrapLabel}
          disabled={mut.isPending}
          onChange={setScrapLabel}
        />
      </div>

      <div className="border-t pt-4">
        <LabelCustomerCodeMissingField value={codeMissing} onChange={setCodeMissing} disabled={mut.isPending} />
      </div>

      <SettingsSaveBar
        dirty={dirty}
        saving={mut.isPending}
        canSave={copiesValid && mediaValid}
        onSave={() => mut.mutate()}
        onReset={reset}
      />
    </div>
  );
}
