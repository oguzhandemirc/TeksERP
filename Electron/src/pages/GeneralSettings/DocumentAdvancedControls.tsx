import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentConfig, DocDef, DocTableDef } from "@/services/documentConfig";
import { FlagToggle } from "./SettingRow";

// =============================================================================
// Belge gelişmiş kontrolleri — kolon aç/kapa+sıra, damgalar/QR, metin blokları,
// dil seçimi. DocumentConfigSection'ın alt paneli; ham config'e patch atar.
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
      {def.tables?.map((t) => (
        <TableColumnsPanel
          key={t.key}
          table={t}
          cfg={cfg}
          disabled={disabled}
          patch={patch}
        />
      ))}
      {def.supportsBlankWidths && <WidthModePanel cfg={cfg} disabled={disabled} patch={patch} />}
      <StampsPanel cfg={cfg} disabled={disabled} patch={patch} />
      <BlocksPanel cfg={cfg} disabled={disabled} patch={patch} />
      {def.supportsLanguage && <LanguagePanel cfg={cfg} disabled={disabled} patch={patch} />}
    </>
  );
}

/** En (genişlik) kaynağı — iş emrinden çek (dolu) veya boş bırak (elle doldur). */
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
      <div className="pb-2 text-sm font-medium">En (genişlik) değerleri</div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ blankWidths: false })}
          className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${
            !blank ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70"
          }`}
        >
          İş emrinden çek (dolu)
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => patch({ blankWidths: true })}
          className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium ${
            blank ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70"
          }`}
        >
          Boş bırak (elle doldur)
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        "İş emrinden çek": en değerleri topların ölçüsünden gelir. "Boş bırak": en kolonları belgede
        yer alır ama boş basılır (fason/müşteri elle doldurur).
      </p>
    </div>
  );
}

/** Bir tablonun kolonlarını aç/kapa + ↑↓ sırala. Sıra = order dizisi (boş → varsayılan). */
function TableColumnsPanel({
  table,
  cfg,
  disabled,
  patch,
}: {
  table: DocTableDef;
  cfg: DocumentConfig | undefined;
  disabled: boolean;
  patch: (next: Partial<DocumentConfig>) => void;
}) {
  const colCfg = cfg?.columns?.[table.key] ?? {};
  const hidden = new Set(colCfg.hidden ?? []);
  // Görünen sıra: order verilmişse ona göre, bilinmeyenler kayıt sırasıyla sona.
  const orderPos = new Map((colCfg.order ?? []).map((k, i) => [k, i]));
  const ordered = [...table.columns].sort(
    (a, b) => (orderPos.get(a.key) ?? 999) - (orderPos.get(b.key) ?? 999),
  );

  const write = (nextHidden: Set<string>, nextOrder: string[]) =>
    patch({
      columns: {
        ...cfg?.columns,
        [table.key]: {
          ...(nextHidden.size ? { hidden: [...nextHidden] } : {}),
          ...(nextOrder.length ? { order: nextOrder } : {}),
        },
      },
    });

  const toggle = (key: string) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(next, colCfg.order ?? []);
  };

  const move = (index: number, dir: -1 | 1) => {
    const keys = ordered.map((c) => c.key);
    const j = index + dir;
    if (j < 0 || j >= keys.length) return;
    const a = keys[index];
    const b = keys[j];
    if (a === undefined || b === undefined) return;
    keys[index] = b;
    keys[j] = a;
    write(hidden, keys);
  };

  return (
    <div className="rounded-md border p-3">
      <div className="pb-2 text-sm font-medium">Kolonlar — {table.label}</div>
      <div className="space-y-1">
        {ordered.map((c, i) => (
          <div key={c.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              id={`col-${table.key}-${c.key}`}
              checked={!hidden.has(c.key)}
              disabled={disabled}
              onChange={() => toggle(c.key)}
              className="h-4 w-4"
            />
            <label htmlFor={`col-${table.key}-${c.key}`} className="flex-1">
              {c.label}
            </label>
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0"
              disabled={disabled || i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0"
              disabled={disabled || i === ordered.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
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
