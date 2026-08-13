// =============================================================================
// MAL KABUL SATIR EDİTÖRÜ
// =============================================================================
// Saha isteği (2026-08-13): "patos gri 250 cm 500 metre kumaştan 20 tane geldi"
// tek satırda yazılabilmeli; benzer bir satırdan yalnız bir alanı değiştirmek
// için KOPYALA olmalı.
//
// ⚠️ ADET bir TOP ÖZELLİĞİ DEĞİLDİR, bir GİRİŞ KOLAYLIĞIDIR: kaydederken N ayrı
// TOP doğar (her biri kendi barkodu + kendi metresiyle). Modelde "20 adetlik
// top" diye bir şey yok ve olmamalı — envanterin birimi TOPTUR; aksi halde
// kesim/sevk/iade gibi her akış "kaç adedi kaldı" sorusunu yeniden icat ederdi.
// Bu yüzden çarpan yalnız bu formda yaşar, backend'e N satır olarak gider.
// =============================================================================
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { itemService } from "@/pages/Items/service";
import { colorService } from "@/pages/Colors/service";
import { useFoldValues } from "@/hooks/useFoldValues";
import type { Item } from "@/pages/Items/types";
import type { Color } from "@/pages/Colors/types";
import { LinePropertiesButton } from "./LinePropertiesButton";

export interface DraftLine {
  key: string;
  itemId: string;
  colorId: string | null;
  /** TOP BAŞINA metre (adetle çarpılmaz — her top bu metrede doğar). */
  initialQty: number;
  width: number | null;
  weightKg: number | null;
  foldType: string | null;
  /** Üretim özellikleri (FabricProperty id'leri) — opsiyonel. */
  propertyIds: string[];
  /** Kaç TOP gelmiş — kaydederken bu sayıda ayrı top doğar. */
  count: number;
}

export function emptyLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
    itemId: "",
    colorId: null,
    initialQty: 0,
    width: null,
    weightKg: null,
    foldType: null,
    propertyIds: [],
    count: 1,
  };
}

/** Satırı kopyalar — YENİ anahtarla (idempotency token'ı da yeniden doğar). */
export function duplicateLine(l: DraftLine): DraftLine {
  return { ...l, key: crypto.randomUUID() };
}

interface Props {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
}

export function ReceiptLineRows({ lines, onChange }: Props) {
  const { values: foldValues } = useFoldValues();

  const patch = (key: string, p: Partial<DraftLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const cols = "grid-cols-[minmax(0,1fr)_140px_86px_74px_74px_104px_64px_66px_84px]";

  return (
    <div className="rounded-md border">
      <div className={`grid ${cols} gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground`}>
        <span>Kumaş</span>
        <span>Renk</span>
        <span>Metre</span>
        <span>En (cm)</span>
        <span>Kg</span>
        <span>Kat</span>
        <span className="text-center">Özellik</span>
        <span className="text-center">Adet</span>
        <span />
      </div>

      <div className="max-h-[38vh] space-y-2 overflow-auto p-3">
        {lines.map((l) => (
          <div key={l.key} className={`grid ${cols} items-center gap-2`}>
            <ReferenceSelect<Item>
              value={l.itemId || null}
              onChange={(v) => patch(l.key, { itemId: v ?? "" })}
              service={itemService}
              queryKey="items"
              getLabel={(it) => `${it.code} — ${it.name}`}
              placeholder="Kumaş ara..."
            />
            <ReferenceSelect<Color>
              value={l.colorId}
              onChange={(v) => patch(l.key, { colorId: v })}
              service={colorService}
              queryKey="colors"
              getLabel={(c) => c.name}
              placeholder="Renk..."
            />
            <Input
              type="number" min={0} step="0.01" placeholder="0"
              value={l.initialQty || ""}
              onChange={(e) => patch(l.key, { initialQty: Number(e.target.value) })}
            />
            <Input
              type="number" min={0} placeholder="—"
              value={l.width ?? ""}
              onChange={(e) => patch(l.key, { width: e.target.value ? Number(e.target.value) : null })}
            />
            <Input
              type="number" min={0} step="0.01" placeholder="—"
              value={l.weightKg ?? ""}
              onChange={(e) => patch(l.key, { weightKg: e.target.value ? Number(e.target.value) : null })}
            />
            {/* KAT opsiyonel ve KATALOGDAN gelir — sabit liste, panelden eklenen
                6-KAT'ı görünmez yapardı; boş katalogda seçici hiç çizilmez. */}
            {foldValues.length > 0 ? (
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={l.foldType ?? ""}
                onChange={(e) => patch(l.key, { foldType: e.target.value || null })}
              >
                <option value="">—</option>
                {foldValues.map((f) => (
                  <option key={f.code} value={f.code}>{f.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-center text-xs text-muted-foreground">—</span>
            )}
            <LinePropertiesButton
              itemId={l.itemId}
              value={l.propertyIds}
              onChange={(v) => patch(l.key, { propertyIds: v })}
            />
            <Input
              type="number" min={1} step="1"
              className="text-center font-medium"
              value={l.count}
              onChange={(e) => patch(l.key, { count: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            />
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost" size="icon" title="Satırı kopyala"
                onClick={() => onChange([...lines, duplicateLine(l)])}
              >
                <Copy className="h-4 w-4" />
              </Button>
              {/* Silme YIKICI bir eylem — kırmızı zemin + beyaz ikon (saha isteği:
                  "tehlikeli olduğu belli olsun"). Tek satır kalınca kapalı. */}
              <Button
                size="icon"
                title="Satırı sil"
                className="bg-destructive text-white hover:bg-destructive/90 disabled:opacity-40"
                disabled={lines.length === 1}
                onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Formun canlı özeti — kaç TOP doğacak ve toplam kaç metre. */
export function receiptTotals(lines: DraftLine[]): { rolls: number; meters: number } {
  const valid = lines.filter((l) => l.itemId && l.initialQty > 0 && l.count > 0);
  return {
    rolls: valid.reduce((s, l) => s + l.count, 0),
    meters: valid.reduce((s, l) => s + l.initialQty * l.count, 0),
  };
}

/** Taslak satırları backend sözleşmesine açar: 1 satır × adet = N top. */
export function expandLines(lines: DraftLine[]) {
  return lines
    .filter((l) => l.itemId && l.initialQty > 0 && l.count > 0)
    .flatMap((l) =>
      Array.from({ length: l.count }, () => ({
        itemId: l.itemId,
        colorId: l.colorId,
        initialQty: l.initialQty,
        width: l.width,
        weightKg: l.weightKg,
        foldType: l.foldType,
        propertyIds: l.propertyIds.length > 0 ? l.propertyIds : undefined,
        // Her TOP kendi idempotency anahtarını taşır (backend uuid bekler).
        // Asıl koruma FİŞ seviyesindedir — aynı `clientToken` ile ikinci POST
        // mevcut fişi döner ve satırları TEKRAR İŞLEMEZ; bu ikinci hattır.
        clientToken: crypto.randomUUID(),
      })),
    );
}
