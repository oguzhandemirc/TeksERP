// =============================================================================
// Tek seferlik kâğıt boyu seçici — A4 / A5 (TEK KAYNAK)
// =============================================================================
// Seçim YALNIZ bu baskıyı etkiler: kalıcı Belge Kişiselleştirme ayarına da,
// belgenin donmuş snapshot'ına da yazılmaz, yeni sürüm doğurmaz (backend
// `?pageSize=` ezmesi — printed-document.controller + traveler-card.controller).
//
// ⚠️ Belgenin KENDİ boyutu HTML'in `@page` kuralından okunur (`readDocPageSize`),
// ayrı bir istek açılmaz. Seçili düğme "şu an ne basılacak"tır: kullanıcı
// belgenin kendi boyutuna geri basınca ezme KALKAR (`undefined`), yani "A4'ü
// seçtim ama ayar zaten A4'tü" durumu URL'e gereksiz parametre eklemez.
// =============================================================================

const SIZES = ["A5", "A4"] as const;

export type DocPageSize = (typeof SIZES)[number];

/** Belgenin kendi (donmuş/ayarlı) boyutu — üretilmiş HTML'in `@page` kuralından. */
export function readDocPageSize(html: string | null | undefined): DocPageSize | undefined {
  return /@page \{ size: (A4|A5)/.exec(html ?? "")?.[1] as DocPageSize | undefined;
}

interface Props {
  /** Ezme değeri; `undefined` = belgenin kendi boyutu. */
  value: DocPageSize | undefined;
  onChange: (next: DocPageSize | undefined) => void;
  /** Belgenin kendi boyutu — hangi düğmenin "ezmesiz" olduğunu belirler. */
  docPageSize: DocPageSize | undefined;
  disabled?: boolean;
  label?: string;
}

export function PrintPageSizeToggle({
  value,
  onChange,
  docPageSize,
  disabled = false,
  label = "Bu baskı için:",
}: Props) {
  const effective = value ?? docPageSize;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="inline-flex overflow-hidden rounded-md border">
        {SIZES.map((sz) => (
          <button
            key={sz}
            type="button"
            onClick={() => onChange(sz === docPageSize ? undefined : sz)}
            disabled={disabled}
            className={
              "px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 " +
              (effective === sz
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted")
            }
          >
            {sz}
          </button>
        ))}
      </div>
    </div>
  );
}
