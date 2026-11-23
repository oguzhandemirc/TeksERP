import { useMemo, useState } from "react";
import { foldedIncludes } from "@/lib/search-fold";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Sparkles, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshButton } from "@/components/RefreshButton";
import { PermissionGate } from "@/components/PermissionGate";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { stationKindLabels } from "@/types/enums";
import { stationCapabilityService } from "./service";
import { CapabilitiesEditSheet } from "./CapabilitiesEditSheet";
import {
  STATION_PROPERTY_MODE_LABELS,
  type StationCapabilityDetail,
  type StationCapabilitySummary,
} from "./types";

function disabledHint(cap: StationCapabilitySummary): string {
  // ⚠️ 2026-08-10: yetenek artık kategoriden TÜRETİLMİYOR, istasyonun kendi
  // alanında. Eski metin ("kategori atanmadan da atanabilir") yanlış yönlendirir:
  // düzeltme yeri artık Tanımlar → İstasyonlar → Yetenekler.
  const suffix = cap.hasDefaultCategory
    ? " (istasyonun kendi bayrağı kapalı; fason kategorisi de vermiyorsa hiç uygulanmaz)"
    : "";
  return `Bu istasyon "özellik uygular" olarak işaretli değil${suffix} — Tanımlar → İstasyonlar → Yetenekler'den açın.`;
}

/** Salt-okunur (`station:read`) kullanıcıya butonun neden kapalı olduğunu söyler. */
const NO_WRITE_HINT =
  "Yetenekleri değiştirmek için \"İstasyon tanımlama/düzenleme\" (station:write) yetkisi gerekir.";

const QUERY_KEY = "station-capabilities";

/** Kapalı buton + gerekçe balonu — hem yetki hem veri koşulu bu kabı kullanır. */
function DisabledEditButton({ hint }: { hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <Button size="sm" variant="outline" className="gap-1.5" disabled>
            <Settings2 className="h-3.5 w-3.5" /> Yetenekleri Düzenle
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function EditCell({ cap, onEdit }: { cap: StationCapabilitySummary; onEdit: (c: StationCapabilitySummary) => void }) {
  return (
    <div className="flex justify-end">
      {/* Rota yalnız `station:read` ister; yazma kapısı BURADA. `canApplyProperty` VERİ koşuludur, izin yerine geçmez. */}
      <PermissionGate permission="station:write" fallback={<DisabledEditButton hint={NO_WRITE_HINT} />}>
        {cap.canApplyProperty ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onEdit(cap)}>
            <Settings2 className="h-3.5 w-3.5" /> Yetenekleri Düzenle
          </Button>
        ) : (
          <DisabledEditButton hint={disabledHint(cap)} />
        )}
      </PermissionGate>
    </div>
  );
}

const MUTED = <span className="text-xs text-muted-foreground">—</span>;

function capabilityColumns(onEdit: (c: StationCapabilitySummary) => void): ColumnDef<StationCapabilitySummary>[] {
  return [
    { accessorKey: "stationCode", header: "Kod", meta: { label: "Kod" }, cell: ({ row }) => <span className="font-mono text-xs">{row.original.stationCode}</span> },
    { accessorKey: "stationName", header: "İstasyon", meta: { label: "İstasyon" }, cell: ({ row }) => <span className="font-medium">{row.original.stationName}</span> },
    {
      id: "stationKind",
      header: "Tür",
      meta: { label: "Tür", exportValue: (c) => stationKindLabels[c.stationKind] },
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{stationKindLabels[row.original.stationKind]}</span>,
    },
    {
      id: "propertyCount",
      header: () => (
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> Özellik
        </span>
      ),
      meta: { label: "Özellik", exportValue: (c) => (c.canApplyProperty ? String(c.propertyCount) : "") },
      cell: ({ row: { original: c } }) =>
        c.canApplyProperty ? <Badge variant={c.propertyCount === 0 ? "secondary" : "muted"}>{c.propertyCount}</Badge> : MUTED,
    },
    {
      // Kalite: SALT ROZET — kalite kademesi `QualityGrade` kataloğundan gelir, istasyona atanmaz.
      id: "canApplyQuality",
      header: "Kalite",
      meta: { label: "Kalite", exportValue: (c) => (c.canApplyQuality ? "Evet" : "Hayır") },
      cell: ({ row }) =>
        row.original.canApplyQuality ? <Badge variant="muted">Evet</Badge> : <span className="text-xs text-muted-foreground">Hayır</span>,
    },
    { id: "actions", header: "", size: 180, enableSorting: false, cell: ({ row }) => <EditCell cap={row.original} onEdit={onEdit} /> },
  ];
}

/**
 * Dışa aktarım satırı — ekran MATRİS, dosya UZUN BİÇİM: bir satır = AÇIK olan tek
 * (istasyon × yetenek) eşleşmesi.
 *
 * ⚠️ Geniş matris (istasyon satır / yetenek sütun) Excel-CSV turunu atlatamaz:
 * yeni bir yetenek tanımlanınca sütun sayısı değişir, eski dosya okunamaz hâle
 * gelir ve hiçbir içe aktarıcı geri okuyamaz. Uzun biçim sektör normudur ve
 * pivotlanabilir.
 */
interface CapabilityExportRow {
  stationCode: string;
  stationName: string;
  stationKind: string;
  /** "Renk" | "Özellik" */
  capabilityType: string;
  capabilityCode: string;
  capabilityName: string;
  /** Yalnız özellikte: Otomatik / Opsiyonel / Zorunlu. Renkte boş. */
  mode: string;
  /** Yalnız özellikte: Bayrak / Seçim. Renkte boş. */
  valueType: string;
  /** SEÇİM tipli özellikte izin verilen değerler. */
  values: string;
}

const CAPABILITY_EXPORT_COLUMNS: ExportColumn<CapabilityExportRow>[] = [
  { label: "İstasyon Kodu", value: (r) => r.stationCode },
  { label: "İstasyon", value: (r) => r.stationName },
  { label: "İstasyon Türü", value: (r) => r.stationKind },
  { label: "Yetenek Türü", value: (r) => r.capabilityType },
  { label: "Yetenek Kodu", value: (r) => r.capabilityCode },
  { label: "Yetenek Adı", value: (r) => r.capabilityName },
  { label: "Mod", value: (r) => r.mode },
  { label: "Değer Tipi", value: (r) => r.valueType },
  { label: "İzinli Değerler", value: (r) => r.values },
];

export function StationCapabilitiesPage() {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StationCapabilitySummary | null>(null);

  const query = useQuery({
    queryKey: [QUERY_KEY],
    queryFn: stationCapabilityService.list,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    const list = query.data?.data ?? [];
    if (!search) return list;
    // ⚠️ Terime ÖN İŞLEM UYGULAMA: `search.toLowerCase()` Türkçede BOZUKTUR
    // ("ŞAHİN" → "şahi̇n", i + U+0307) ve katlamadan sonra da nokta kalır →
    // büyük İ içeren her arama 0 satır dönerdi. Ham terimi ver.
    const q = search;
    return list.filter(
      (s) => foldedIncludes(s.stationName, q) || foldedIncludes(s.stationCode, q),
    );
  }, [query.data, search]);

  const columns = useMemo(() => capabilityColumns(setEditing), []);
  const table = useLocalTable({
    tableKey: "station-capabilities",
    data: filtered,
    columns,
    getRowId: (cap) => cap.stationId,
  });

  // Uzun-biçim dışa aktarım için istasyon başına yetenek LİSTESİ gerekir; özet uç
  // yalnız SAYI döner. Tek istekle hepsi (`?detailed=true`) — istasyon başına
  // `getByStation` çağırmak N istek olurdu.
  const detailedQuery = useQuery({
    queryKey: [QUERY_KEY, "detailed"],
    queryFn: stationCapabilityService.listDetailed,
    staleTime: 60_000,
  });

  const detailByStation = useMemo(
    () => new Map((detailedQuery.data?.data ?? []).map((d) => [d.stationId, d])),
    [detailedQuery.data],
  );

  // EKRANDAKİ (aramayla süzülmüş) istasyon sırasını korur; yalnız AÇIK eşleşmeler.
  const exportRows = useMemo<CapabilityExportRow[]>(() => {
    const rows: CapabilityExportRow[] = [];
    for (const cap of filtered) {
      const detail: StationCapabilityDetail | undefined = detailByStation.get(cap.stationId);
      if (!detail) continue;
      const head = {
        stationCode: cap.stationCode,
        stationName: cap.stationName,
        stationKind: stationKindLabels[cap.stationKind],
      };
      for (const c of detail.colors) {
        rows.push({
          ...head,
          capabilityType: "Renk",
          capabilityCode: c.code,
          capabilityName: c.name,
          mode: "",
          valueType: "",
          values: "",
        });
      }
      for (const p of detail.properties) {
        rows.push({
          ...head,
          capabilityType: "Özellik",
          capabilityCode: p.code,
          capabilityName: p.name,
          mode: STATION_PROPERTY_MODE_LABELS[p.mode],
          valueType: p.valueType === "CHOICE" ? "Seçim" : "Bayrak",
          values: p.values.filter((v) => v.isActive).map((v) => v.name).join(", "),
        });
      }
    }
    return rows;
  }, [filtered, detailByStation]);

  // Yeteneği hiç olmayan istasyon uzun biçimde satır ÜRETMEZ — kaç tanesinin
  // dosyada olmadığını notta açıkça söyle (sessiz eksik dosya olmasın).
  const stationsWithRows = useMemo(
    () => new Set(exportRows.map((r) => r.stationCode)).size,
    [exportRows],
  );

  return (
    <PageShell>
      <PageHeader
        title="İstasyon Yetenekleri"
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />

      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="İstasyon ara" />
        <div className="ml-auto flex items-center gap-1.5">
            {/* Dosya uzun biçimde (istasyon × yetenek) iner — tablo menüsünde ikinci indirme yok. */}
            <DataTableTools table={table} compact hideExport />
            <ListExportMenu
              name="İstasyon Yetenekleri"
              rows={exportRows}
              columns={CAPABILITY_EXPORT_COLUMNS}
              disabled={detailedQuery.isLoading}
              // undefined → ListExportMenu kendi "İndirilecek kayıt yok" ipucunu verir.
              title={
                detailedQuery.isLoading
                  ? "Yetenek listesi hazırlanıyor…"
                  : exportRows.length > 0
                    ? "İstasyon × yetenek eşleşmelerini indir"
                    : undefined
              }
              notes={[
                `Ekranda görünen ${filtered.length} istasyondan ${stationsWithRows} tanesinin yeteneği var; kalan ${filtered.length - stationsWithRows} istasyon dosyada YOKTUR (uzun biçim yalnız AÇIK eşleşmeleri taşır).`,
                "Bir satır = bir (istasyon × yetenek) eşleşmesi. Matris değil uzun biçimdir: yeni yetenek eklendiğinde sütun düzeni değişmez, dosya pivotlanabilir.",
                "Liste yalnız AKTİF istasyonları ve AKTİF yetenek tanımlarını içerir.",
                "Mod yalnız ÖZELLİK satırlarında anlamlıdır: Otomatik (operatöre sorulmaz) · Opsiyonel (tabletde tuş) · Zorunlu (işaretlenmeden adım kapanmaz).",
                "\"Renk\" satırları eski istasyon-renk kayıtlarıdır — renk 2026-08-02'den beri istasyon bazlı kısıt DEĞİLDİR (bilgi amaçlı; boyahane her rengi boyar).",
              ]}
            />
        </div>
      </ListToolbar>

      <TooltipProvider delayDuration={150}>
        <DataTable
          table={table}
          exportName="İstasyon Yetenekleri"
          // Renk artık kısıt değil → düzenlenecek tek şey özellik listesi; uygulamayan istasyon soluk.
          rowClassName={(cap) => (cap.canApplyProperty ? undefined : "opacity-60")}
          isLoading={query.isLoading}
          isError={query.isError}
          onRetry={() => void query.refetch()}
          emptyText={search ? "Aramaya uyan istasyon yok." : "İstasyon bulunamadı."}
        />
      </TooltipProvider>
      <ListFooter loaded={filtered.length} label={`${filtered.length} istasyon`} />

      <CapabilitiesEditSheet
        station={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </PageShell>
  );
}
