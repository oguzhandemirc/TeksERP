import { Boxes, ClipboardList, PackageOpen, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sackHubService } from "./service";
import { fromDumpRows } from "./sackDump";
import { SackContentDumpMenu } from "./SackContentDumpMenu";
import { SackTagsBulkMenu } from "./SackTagsBulkMenu";
import { PackingLotBarActions } from "./PackingLotHeader";
import { hasSackContents, type SackSearchRow } from "./types";

/**
 * ALT ŞERİT toplu eylemler (seçili çuvallar): Sevk Et · Çeki Listesi · İz · Partiye Al ·
 * Dağıt · Sil · İçerik/Parti Dökümü · Hepsini Sevk Et. Boş çuval sevk edilemez ve
 * dağıtılamaz (sunucu 400) — o düğmeler DOLU seçime bakar; boş çuvalın tek yolu "Sil"
 * (saha 2026-09-22). Ayrı dosya: liste görünümü satır tavanının altında kalsın.
 */
interface BulkProps {
  rows: SackSearchRow[];
  lotMode: boolean;
  groupsEnabled: boolean;
  /** Parti içi (partisiz değil) → parti id; döküm/hepsini sevk kapsamı bu. */
  lotParti: string | null;
  groupFilter: string;
  shipping: boolean;
  onShip: (rows: SackSearchRow[]) => void;
  onPickList: (ids: string[]) => void;
  onGroup: (rows: SackSearchRow[]) => void;
  onDistribute: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onShipAll: () => void;
  onTagsDone: () => void;
}

export function SackBulkActions(p: BulkProps) {
  const { rows } = p;
  const dolu = rows.filter(hasSackContents);
  const bos = rows.filter((r) => !hasSackContents(r));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* ① SEÇİMİ HAREKET ETTİR: sevk · partiye al */}
      <Button
        size="sm"
        className="gap-1.5 font-semibold"
        disabled={dolu.length === 0}
        title={
          dolu.length === 0
            ? "Boş çuval sevk edilemez — önce içine top okutun"
            : bos.length > 0
              ? `${bos.length} boş çuval sevke girmez`
              : undefined
        }
        onClick={() => p.onShip(dolu)}
      >
        <Truck className="h-4 w-4" /> Sevk Et ({dolu.length})
      </Button>
      {/* PARTİ ATA — grup bir yaftadır, sevk akışına kural EKLEMEZ. Bayrak kapalıyken çizilmez. */}
      {p.groupsEnabled && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={rows.length === 0}
          title={
            p.lotMode
              ? "Seçili çuvalları bir sevk partisine al / başka partiye taşı (yeni ambalaj no alır)"
              : "Seçili çuvalları bir hazırlık grubuna al (rezervasyon değil)"
          }
          onClick={() => p.onGroup(rows)}
        >
          <Boxes className="h-4 w-4" /> {p.lotMode ? "Partiye Al" : "Parti Ata"} ({rows.length})
        </Button>
      )}
      <Ayrac />
      {/* ② ÇIKTI / İŞARET: çeki listesi · içerik dökümü · iz */}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={rows.length === 0}
        title="Sahada çuval aramak için gruplu özet (ürün·renk·en) — top barkodu içermez"
        onClick={() => p.onPickList(rows.map((r) => r.id))}
      >
        <ClipboardList className="h-4 w-4" /> Çeki Listesi
      </Button>
      <DumpMenu rows={rows} lotParti={p.lotParti} />
      {/* İZ — tek popover; sonuç PARÇALI olabilir, atlananlar uyarıyla söylenir. */}
      <SackTagsBulkMenu rows={rows} onDone={p.onTagsDone} />
      <Ayrac />
      {/* ③ YIKICI: dağıt · sil */}
      <DistributeAndDelete
        dolu={dolu}
        bos={bos}
        rows={rows}
        onDistribute={p.onDistribute}
        onDelete={p.onDelete}
      />
      {/* ④ PARTİNİN TAMAMI — seçimden bağımsız, en sağda ve ayrık */}
      {p.lotMode && p.groupFilter && (
        <>
          <Ayrac />
          <PackingLotBarActions groupFilter={p.groupFilter} shipping={p.shipping} onShipAll={p.onShipAll} />
        </>
      )}
    </div>
  );
}

/** Grup ayracı — düğme kümeleri arasındaki ince dikey çizgi. */
function Ayrac() {
  return <span className="mx-1 h-6 w-px bg-border" aria-hidden />;
}

/** Döküm: seçim varsa seçili çuvallar; parti içinde seçim yoksa PARTİNİN TAMAMI (kapsam sunucuda). */
function DumpMenu({ rows, lotParti }: { rows: SackSearchRow[]; lotParti: string | null }) {
  if (lotParti) {
    return (
      <SackContentDumpMenu
        label={rows.length > 0 ? `İçerik Dökümü (${rows.length})` : "Parti Dökümü"}
        scopeLabel={rows.length > 0 ? undefined : lotParti}
        hasNotes={rows.length > 0 ? rows.some((r) => r.hasNote) : true}
        load={async () =>
          fromDumpRows(
            (rows.length > 0
              ? await sackHubService.contentDump(rows.map((r) => r.id))
              : await sackHubService.contentDump([], lotParti)
            ).data,
          )
        }
      />
    );
  }
  return (
    <SackContentDumpMenu
      label={`İçerik Dökümü (${rows.length})`}
      disabled={rows.length === 0}
      hasNotes={rows.some((r) => r.hasNote)}
      load={async () => fromDumpRows((await sackHubService.contentDump(rows.map((r) => r.id))).data)}
    />
  );
}

/** Dağıt (yalnız DOLU seçim) · Sil (boş çuvalın tek yolu; dolu seçilirse boşaltıp siler, önizlemeli). */
function DistributeAndDelete(p: {
  rows: SackSearchRow[];
  dolu: SackSearchRow[];
  bos: SackSearchRow[];
  onDistribute: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
}) {
  const { rows, dolu, bos } = p;
  return (
    <>
      {/* DAĞIT — kullanıcının kafasındaki "listeden çuval sil" işi. Gerçekte
              çuval SİLİNMEZ, içeriği depoya çıkar; diyalog bunu söyler ve
              etkilenen HER topu listeler (yıkıcı işlem kuralı). */}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={dolu.length === 0}
        title="Seçili DOLU çuvalların içindeki topları serbest depoya çıkarır — çuval kaydı silinmez"
        onClick={() => p.onDistribute(dolu.map((r) => r.id))}
      >
        <PackageOpen className="h-4 w-4" /> Dağıt ({dolu.length})
      </Button>
      {/* SİL — boş çuval için tek yol; dolu seçilirse önce boşaltır (önizleme + teyit). */}
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-destructive"
        disabled={rows.length === 0}
        title={
          bos.length === rows.length
            ? "Seçili boş çuvalları sil"
            : "Seçili çuvalları boşaltıp sil (önizleme gösterilir)"
        }
        onClick={() => p.onDelete(rows.map((r) => r.id))}
      >
        <Trash2 className="h-4 w-4" /> Sil ({rows.length})
      </Button>
    </>
  );
}
