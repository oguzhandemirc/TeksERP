import type { ReactNode } from "react";
import { HintIcon, HintBody, InfoPopover, type HintVariant } from "./SettingHint";

/**
 * Satırın KÜNYESİ — varsayılan rozeti + "kimi etkiler".
 *
 * NEDEN AYRI BİR SATIR: ayar ekranında en sık sorulan iki soru "ben mi
 * değiştirdim, hep böyle miydi" ve "bunu açarsam kimin ekranı değişir"dir.
 * İkisi de uzun açıklamanın içine gömülüydü ve fiilen okunmuyordu.
 * ⚠️ Rozet BEYANDIR, ölçüm değil: doğruluğunu backend okuyucusuna karşı
 * `test_feature_flag_contract` §12 doğrular.
 */
export function SettingMeta({
  defaultLabel,
  audience,
}: {
  defaultLabel: string;
  audience: readonly string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="rounded border px-1.5 py-0.5 font-medium">{defaultLabel}</span>
      {audience.length > 0 && <span>· Etkilenen: {audience.join(", ")}</span>}
    </div>
  );
}

/**
 * Tek bir aç/kapa ayar satırı: sol tarafta başlık + (i) info balonu, sağda checkbox.
 * `admin:settings` yetkisi olmayan kullanıcıya `ReadOnlyRow` gösterilir.
 * Açıklama varsayılan olarak (i) info balonunda gösterilir (`hint="popover"`).
 *
 * `summary`/`defaultOn`/`audience` BİLEREK opsiyoneldir: Genel Ayarlar
 * katalogundan gelen satırlar (bkz. `FlagDef`) üçünü de ZORUNLU taşır, ama bu
 * bileşen belge/etiket/cihaz panellerinde de kullanılır ve oradaki yerel
 * toggle'ların bir "varsayılan rozeti" yoktur.
 */
export function FlagToggle({
  title,
  summary,
  desc,
  defaultOn,
  audience,
  checked,
  disabled = false,
  onChange,
  hint = "popover",
}: {
  title: string;
  /** Satırda basılan TEK cümle; verilmezse uzun açıklama `hint` kuralına düşer. */
  summary?: string;
  desc: ReactNode;
  /** Backend'in kayıt yokken döndüğü değer — AÇIK/KAPALI rozeti. */
  defaultOn?: boolean;
  audience?: readonly string[];
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  hint?: HintVariant;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-1.5 font-medium">
          <span>{title}</span>
          <HintIcon variant={hint} desc={desc} />
        </div>
        {summary && <p className="text-xs text-muted-foreground">{summary}</p>}
        {defaultOn !== undefined && (
          <SettingMeta
            defaultLabel={`Varsayılan: ${defaultOn ? "AÇIK" : "KAPALI"}`}
            audience={audience ?? []}
          />
        )}
        {!summary && <HintBody variant={hint} desc={desc} />}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-1 h-5 w-5 cursor-pointer"
      />
    </label>
  );
}

/**
 * Sayısal ayar alanı — başlık + açıklama + number input + hata satırı. Değer
 * string tutulur (geçici boş girişe izin); doğrulama/parse çağırana ait.
 */
export function NumberField({
  id,
  label,
  desc,
  value,
  min,
  max,
  onChange,
  error,
  hint = "popover",
}: {
  id: string;
  label: string;
  desc: string;
  value: string;
  min: number;
  max: number;
  onChange: (next: string) => void;
  error?: string;
  hint?: HintVariant;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <HintIcon variant={hint} desc={desc} />
      </div>
      <HintBody variant={hint} desc={desc} />
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 flex h-9 w-40 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Alan başlığı + (opsiyonel) (i) info balonu. Metin/sayı/seçim alanlarının
 * üstünde uzun açıklama paragrafı yerine kullanılır — açıklama balonda açılır.
 */
export function FieldLabel({
  htmlFor,
  label,
  desc,
}: {
  htmlFor?: string;
  label: string;
  desc?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {desc ? <InfoPopover desc={desc} /> : null}
    </div>
  );
}

/** Salt-okunur "etiket → değer rozeti" satırı (yetkisiz görünüm listelerinde). */
export function ReadOnlyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-medium">{label}</span>
      <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs">{value}</span>
    </div>
  );
}

/**
 * Salt-okunur durum satırı (Açık/Kapalı rozeti).
 *
 * ⚠️ SEBEP PROP'A ÇIKARILDI (2026-09-03). Metin sabit "admin:settings yetkisi
 * gerekir" idi ve artık ÜÇ farklı sebeple salt-okunur çizilebiliyoruz: izin
 * eksikliği · süperadmin kimliği · modül kapalı. Sabit metin, son ikisinde
 * satırın YANLIŞ TEŞHİS basması demekti — kullanıcı olmayan bir yetkiyi
 * aramaya gider (bant doğruyu söylerken satır başka bir şey der). Varsayılan
 * bugünkü cümledir: sebep verilmeyen çağrı yeri davranışını korur.
 */
export function ReadOnlyRow({
  title,
  enabled,
  reason,
  onLabel = "Açık",
  offLabel = "Kapalı",
}: {
  title: string;
  enabled: boolean;
  /** Neden düzenlenemiyor — verilmezse izin cümlesi (bugünkü davranış). */
  reason?: ReactNode;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">
          {reason ?? (
            <>
              Bu ayarı değiştirmek için <code>admin:settings</code> yetkisi gerekir.
            </>
          )}
        </p>
      </div>
      <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs">
        {enabled ? onLabel : offLabel}
      </span>
    </div>
  );
}
