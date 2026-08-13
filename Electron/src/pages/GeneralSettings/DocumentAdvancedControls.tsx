import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BlankGridConfig, DocumentConfig, DocDef } from "@/services/documentConfig";
import { FlagToggle } from "./SettingRow";

// =============================================================================
// Belge gelişmiş kontrolleri — EN kaynağı, grid düzeni, konum, damgalar/QR,
// metin blokları, dil. DocumentConfigSection'ın alt paneli; ham config'e patch atar.
//
// Burada kalanların ortak özelliği: hepsi BELGE GENELİ kararlardır. Alan bazlı
// olan her şey (bölüm görünürlüğü, punto/kalınlık, kolonlar ve kolon sırası)
// 2026-08-06'da tek tabloya taşındı → `DocumentFieldsPanel`.
// =============================================================================

export function DocumentAdvancedControls({
  def,
  cfg,
  disabled,
  patch,
}: {
  def: DocDef;
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  return (
    <>
      {/* Kolon görünürlüğü + sırası 2026-08-06'da "Belge Alanları" tek tablosuna
          taşındı (`DocumentFieldsPanel`) — kolonlar da belgenin alanlarıdır ve
          ayrı bir panelde durmaları, aynı belgeyi iki listede aratıyordu.
          Buradaki paneller belge GENELİ kararlardır (damga, QR, dil, blok). */}
      {def.supportsBlankWidths && <WidthModePanel cfg={cfg} disabled={disabled} patch={patch} />}
      {def.supportsGridGroups && <GridGroupsPanel cfg={cfg} disabled={disabled} patch={patch} />}
      {def.supportsPlacements?.length ? (
        <PlacementsPanel def={def} cfg={cfg} disabled={disabled} patch={patch} />
      ) : null}
      <StampsPanel cfg={cfg} disabled={disabled} patch={patch} />
      {/* BOŞ GRID — TÜM belgelerde var ama OPT-IN (varsayılan kapalı). `def`
          süzgeci YOK: kullanıcı isteği "belgede istediğim gibi grid
          ayarlayabileyim" idi, belge listesi değil. Kapalıyken belgeye tek bayt
          eklenmez, yani her belgede göstermek çıktıyı riske atmaz. */}
      <BlankGridPanel
        value={cfg?.blankGrid}
        disabled={disabled}
        onChange={(next) => patch({ blankGrid: next })}
      />
      <BlocksPanel cfg={cfg} disabled={disabled} patch={patch} />
      {def.supportsLanguage && <LanguagePanel cfg={cfg} disabled={disabled} patch={patch} />}
    </>
  );
}

/** EN (genişlik) kaynağı — sistemden mi gelsin, elle mi yazılsın (saha sorusu). */
function WidthModePanel({
  cfg,
  disabled,
  patch,
}: {
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const blank = cfg?.blankWidths === true;
  return (
    <div className="rounded-md border p-3">
      <div className="pb-1 text-sm font-medium">EN değeri nereden gelsin?</div>
      <p className="pb-2 text-xs text-muted-foreground">
        Bu bir şablon ayarıdır — baskı sırasında ayrıca sorulmaz.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ blankWidths: false })}
          className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${
            !blank ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70"
          }`}
        >
          Sistemden al
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ blankWidths: true })}
          className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${
            blank ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70"
          }`}
        >
          Elle yazılacak (boş bas)
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <b>Sistemden al:</b> EN değerleri topların kayıtlı ölçüsünden basılır.{" "}
        <b>Elle yazılacak:</b> EN kolonları belgede yer alır ama boş çıkar — fason firma
        kendi ölçüp doldurur. Kolonu tamamen kaldırmak için “Grid'de En (Cm) kolonu”
        bölümünü kapatın.
      </p>
    </div>
  );
}

/** Grid'de satır başına grup sayısı — az grup = geniş hücre (punto büyütülebilir). */
function GridGroupsPanel({
  cfg,
  disabled,
  patch,
}: {
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const groups = cfg?.gridGroups ?? 5;
  const rows = cfg?.gridRows ?? 10;
  const slots = groups * rows;
  return (
    <div className="rounded-md border p-3">
      <div className="pb-1 text-sm font-medium">Top listesi (grid)</div>
      <p className="pb-2 text-xs text-muted-foreground">
        Sayfada kaç top satırı basılacağını siz belirlersiniz.
      </p>

      <label className="text-xs text-muted-foreground">Bir satırdaki grup sayısı</label>
      <div className="mt-1 flex gap-2">
        {[3, 4, 5].map((g) => (
          <button
            key={g}
            type="button"
            disabled={disabled}
            onClick={() => patch({ gridGroups: g })}
            className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${
              groups === g
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {g} grup{g === 5 ? " (varsayılan)" : ""}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-end gap-3">
        <div className="w-32">
          <label htmlFor="grid-rows" className="text-xs text-muted-foreground">
            Grup başına satır
          </label>
          <input
            id="grid-rows"
            type="number"
            min={1}
            max={40}
            value={rows}
            disabled={disabled}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") return;
              patch({ gridRows: Math.min(40, Math.max(1, Math.round(Number(raw)))) });
            }}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        {/* Kullanıcının gerçekten önemsediği sayı bu — grup × satır kafadan
            hesaplatılmamalı. */}
        <div className="pb-1 text-sm">
          = sayfa başına <b>{slots} top</b>
          <span className="ml-1 text-xs text-muted-foreground">
            ({groups} grup × {rows} satır)
          </span>
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Hücreler elle doldurulan boş kutulardır — sevkte 8 top varsa kalan kutular boş basılır.
        Varsayılan <b>50</b>; eski form 100'dü ve çoğu kutu boş kalıyordu. Sevkte bu sayıdan
        fazla top varsa liste kendiliğinden ikinci sayfaya devam eder. A5'te yazıyı
        büyütecekseniz grubu 3–4'e düşürün: 15 kolon dar sayfaya sığmaz ve metin kırpılır.
      </p>
    </div>
  );
}

/** Konumlandırılabilir bölümler (bugün: parti no sol/sağ). */
function PlacementsPanel({
  def,
  cfg,
  disabled,
  patch,
}: {
  def: DocDef;
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const placements = cfg?.placements ?? {};
  return (
    <div className="rounded-md border p-3">
      <div className="pb-2 text-sm font-medium">Konum</div>
      <div className="space-y-2">
        {def.supportsPlacements?.map((p) => {
          const value = placements[p.key] === "left" ? "left" : "right";
          return (
            <div key={p.key} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">{p.label}</span>
              {(["left", "right"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ placements: { ...placements, [p.key]: side } })}
                  className={`w-20 shrink-0 rounded-md border px-2 py-1.5 text-xs font-medium ${
                    value === side
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {side === "left" ? "Sol" : "Sağ"}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Başlığın sol bloğu firma/alıcı bilgisini, sağ bloğu belge no ve tarihi taşır.
      </p>
    </div>
  );
}

/** Damga çubuğu + doğrulama QR'ı + nüsha etiketi. */
function StampsPanel({
  cfg,
  disabled,
  patch,
}: {
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const stamps = cfg?.stamps ?? {};
  const patchStamps = (next: Partial<NonNullable<DocumentConfig["stamps"]>>) =>
    patch({ stamps: { ...stamps, ...next } });

  return (
    <div className="divide-y divide-border rounded-md border px-3">
      <div className="py-3">
        <FlagToggle
          title="Doğrulama karekodu"
          desc="Belge no + versiyon QR'ı sayfa altına basılır."
          checked={cfg?.qr === true}
          disabled={disabled}
          onChange={(v) => patch({ qr: v })}
        />
      </div>
      <div className="py-3">
        <FlagToggle
          title="Basım zamanı damgası"
          desc="Sayfa altına baskının alındığı tarih-saat yazılır."
          checked={stamps.printedAt === true}
          disabled={disabled}
          onChange={(v) => patchStamps({ printedAt: v })}
        />
      </div>
      <div className="py-3">
        <FlagToggle
          title="Basan kullanıcı damgası"
          desc="Sayfa altına baskıyı alan kullanıcı adı yazılır."
          checked={stamps.printedBy === true}
          disabled={disabled}
          onChange={(v) => patchStamps({ printedBy: v })}
        />
      </div>
      <div className="py-3">
        <label className="text-sm font-medium" htmlFor="copy-label">Nüsha etiketi</label>
        <p className="text-xs text-muted-foreground">
          Başlığın altına rozet olarak basılır (örn. ASIL, KOPYA, MUHASEBE NÜSHASI). Boş → basılmaz.
        </p>
        <input
          id="copy-label"
          value={stamps.copyLabel ?? ""}
          maxLength={20}
          disabled={disabled}
          onChange={(e) => patchStamps({ copyLabel: e.target.value })}
          className="mt-2 flex h-9 w-full max-w-[220px] rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
    </div>
  );
}

const BLOCK_POSITIONS = [
  { value: "afterHeader", label: "Başlık altı" },
  { value: "beforeSignatures", label: "İmza öncesi" },
] as const;

/** Konumlu serbest metin blokları (yasal ibare vb.) — max 4. */
function BlocksPanel({
  cfg,
  disabled,
  patch,
}: {
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const blocks = cfg?.blocks ?? [];
  const write = (next: NonNullable<DocumentConfig["blocks"]>) => patch({ blocks: next });

  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between pb-2">
        <div>
          <div className="text-sm font-medium">Metin blokları</div>
          <p className="text-xs text-muted-foreground">
            Yasal ibare, iade koşulu vb. — konum seçilir, her baskıda basılır (en fazla 4).
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={disabled || blocks.length >= 4}
          onClick={() => write([...blocks, { position: "beforeSignatures", text: "" }])}
        >
          <Plus className="h-3.5 w-3.5" /> Blok
        </Button>
      </div>
      <div className="space-y-2">
        {blocks.map((b, i) => (
          <div key={i} className="flex items-start gap-2">
            <select
              value={b.position}
              disabled={disabled}
              onChange={(e) =>
                write(blocks.map((x, j) => (j === i
                  ? { ...x, position: e.target.value as "afterHeader" | "beforeSignatures" }
                  : x)))
              }
              className="mt-0.5 h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {BLOCK_POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <textarea
              value={b.text}
              rows={2}
              maxLength={500}
              disabled={disabled}
              onChange={(e) => write(blocks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button type="button" size="sm" variant="ghost"
              className="mt-0.5 h-8 w-8 p-0 text-destructive hover:text-destructive"
              disabled={disabled}
              onClick={() => write(blocks.filter((_x, j) => j !== i))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {!blocks.length && (
          <p className="text-xs text-muted-foreground">Tanımlı blok yok.</p>
        )}
      </div>
    </div>
  );
}

/** Belge dili (yalnız dil destekli belgelerde). */
function LanguagePanel({
  cfg,
  disabled,
  patch,
}: {
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-sm font-medium">Belge dili</div>
      <p className="text-xs text-muted-foreground">
        "Otomatik": ihracat (yurtdışı) sevkiyatlarda İngilizce, diğerlerinde Türkçe.
      </p>
      <select
        value={cfg?.language ?? "tr"}
        disabled={disabled}
        onChange={(e) => patch({ language: e.target.value as "tr" | "en" | "auto" })}
        className="mt-2 h-9 w-full max-w-[260px] rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="tr">Türkçe</option>
        <option value="en">İngilizce</option>
        <option value="auto">Otomatik (ihracatta İngilizce)</option>
      </select>
    </div>
  );
}

// =============================================================================
// BOŞ GRID — elle doldurulan kutular (2026-08-09)
// =============================================================================
// Saha isteği "kurşuncular için tablo" diye başladı ama istenen GENEL bir
// yapıydı: *"satır, sütun sayısını ben belirleyeceğim; ilk satırda tanım
// sütunları olmayacak yani hepsi boş olacak; sütun genişliklerini de ben
// belirleyeceğim."*
//
// ⚠️ OPT-IN. Kapalıyken belgeye TEK BAYT eklenmez (ne HTML ne CSS) — ayarına
// dokunulmamış ve donmuş belgelerin çıktısı bayt-bayt korunur.
// Bekçi: `Teks-Erp/scripts/test_blank_grid.ts`.
// =============================================================================
/**
 * ⚠️ REFAKAT KARTI DA BUNU KULLANIR (2026-08-13). Bu yüzden props artık
 * `DocumentConfig`e değil YALNIZ grid değerine bağlı: aynı ayarın iki ekranda
 * iki farklı yüzeyle sorulması, kullanıcıya iki farklı davranış öğretirdi
 * (backend'de de tip/sanitize/renderer zaten ortak).
 * `hidePosition`: kartta konum çıpası YOK — orada yeri bölüm sırası belirler.
 */
export function BlankGridPanel({
  value,
  disabled,
  onChange,
  hidePosition = false,
}: {
  value: BlankGridConfig | undefined;
  disabled: boolean;
  onChange: (next: BlankGridConfig | undefined) => void;
}  & { hidePosition?: boolean }) {
  const g = value;
  const patch = (next: Partial<DocumentConfig>) =>
    onChange(next.blankGrid as BlankGridConfig | undefined);
  const on = g?.enabled === true;
  const rows = g?.rows ?? 10;
  const cols = g?.columns ?? 5;
  const widths = g?.columnWidths ?? [];
  const headers = g?.headers ?? [];

  const set = (next: Partial<NonNullable<DocumentConfig["blankGrid"]>>) =>
    patch({ blankGrid: { ...(g ?? {}), enabled: true, ...next } });

  return (
    <div className="rounded-md border p-3">
      <FlagToggle
        title="Boş grid (elle doldurulan kutular)"
        desc="Belgeye tamamen boş bir tablo ekler — hücreler sahada elle doldurulur (kurşun kaydı, imza listesi vb.). Kapalıyken belgeye hiçbir şey eklenmez."
        checked={on}
        disabled={disabled}
        // Kapatınca ayar TAMAMEN silinir (undefined) — `enabled:false` saklamak
        // ayar dosyasını anlamsız satırlarla şişirir ve backend kayıt kapısı da
        // onu zaten atar.
        onChange={(v) => patch({ blankGrid: v ? { enabled: true } : undefined })}
      />

      {on && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-28">
              <label className="text-xs text-muted-foreground">Satır</label>
              <input
                type="number"
                min={1}
                max={40}
                value={rows}
                disabled={disabled}
                onChange={(e) =>
                  e.target.value !== "" &&
                  set({ rows: Math.min(40, Math.max(1, Math.round(Number(e.target.value)))) })
                }
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="w-28">
              <label className="text-xs text-muted-foreground">Sütun</label>
              <input
                type="number"
                min={1}
                max={12}
                value={cols}
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.value === "") return;
                  const c = Math.min(12, Math.max(1, Math.round(Number(e.target.value))));
                  // Sütun sayısı değişince genişlik/başlık listeleri UZUNLUĞA
                  // uydurulur; uydurulmazsa backend "sayı uyuşmuyor" diye
                  // genişlikleri tamamen atar ve kullanıcı sebebini göremez.
                  set({
                    columns: c,
                    columnWidths: widths.length ? Array.from({ length: c }, (_, i) => widths[i] ?? 0).filter((w) => w > 0).length === c ? Array.from({ length: c }, (_, i) => widths[i] ?? Math.round(100 / c)) : undefined : undefined,
                    headers: headers.length ? Array.from({ length: c }, (_, i) => headers[i] ?? "") : undefined,
                  });
                }}
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              = {rows * cols} boş hücre
            </p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Başlık (boş bırakılabilir)</label>
            <input
              type="text"
              maxLength={100}
              value={g?.title ?? ""}
              disabled={disabled}
              placeholder="örn. KURŞUN KAYDI"
              onChange={(e) => set({ title: e.target.value })}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">
              Sütun başlıkları ve genişlikleri (%) — hepsini boş bırakırsanız tablo tamamen boş basılır
            </label>
            <div className="mt-1 space-y-1.5">
              {Array.from({ length: cols }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-xs text-muted-foreground">{i + 1}.</span>
                  <input
                    type="text"
                    maxLength={40}
                    value={headers[i] ?? ""}
                    disabled={disabled}
                    placeholder="başlık (opsiyonel)"
                    onChange={(e) => {
                      const next = Array.from({ length: cols }, (_, k) => headers[k] ?? "");
                      next[i] = e.target.value;
                      set({ headers: next });
                    }}
                    className="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={widths[i] ?? ""}
                    disabled={disabled}
                    placeholder="%"
                    onChange={(e) => {
                      const next = Array.from({ length: cols }, (_, k) => widths[k] ?? Math.round(100 / cols));
                      next[i] = Math.min(100, Math.max(1, Math.round(Number(e.target.value) || 1)));
                      set({ columnWidths: next });
                    }}
                    className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              ))}
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              Genişliklerin toplamı 100 olmak zorunda değil — oranlanır. Bir sütunun
              genişliğini boş bırakırsanız tümü eşit bölünür.
            </p>
          </div>

          {/* Konum yalnız BELGELERDE sorulur — refakat kartında grid'in yeri
              bölüm sırasıyla (Şablon Stüdyosu) belirlenir; ikinci bir konum
              ayarı orada iki farklı doğru üretirdi. */}
          <div className={hidePosition ? "hidden" : undefined}>
            <label className="text-xs text-muted-foreground">Konum</label>
            <div className="mt-1 flex gap-2">
              {(
                [
                  ["beforeSignatures", "İmzalardan önce (varsayılan)"],
                  ["afterHeader", "Başlıktan hemen sonra"],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  disabled={disabled}
                  onClick={() => set({ position: val })}
                  className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${
                    (g?.position ?? "beforeSignatures") === val
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
