import { useMemo, useState } from "react";
import { foldedIncludes } from "@/lib/search-fold";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
        actions={
          <>
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
            <RefreshButton queryKey={QUERY_KEY} />
          </>
        }
      />

      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="İstasyon ara..."
          className="h-8 w-64 text-sm"
        />
        <div className="ml-auto text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{filtered.length}</span> istasyon
        </div>
      </div>

      <PageBody>
        <TooltipProvider delayDuration={150}>
          <Table containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>İstasyon</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead>
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Özellik
                  </span>
                </TableHead>
                {/* Kalite: SALT ROZET — atama listesi YOK (kalite kademesi
                    `QualityGrade` kataloğundan gelir, istasyona bağlı değil). */}
                <TableHead>Kalite</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    İstasyon bulunamadı.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((cap) => {
                  // Renk artık kısıt değil → düzenlenecek tek şey özellik listesi.
                  const editable = cap.canApplyProperty;
                  return (
                    <TableRow
                      key={cap.stationId}
                      className={editable ? undefined : "opacity-60"}
                    >
                      <TableCell className="font-mono text-xs">{cap.stationCode}</TableCell>
                      <TableCell className="font-medium">{cap.stationName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {stationKindLabels[cap.stationKind]}
                      </TableCell>
                      <TableCell>
                        {cap.canApplyProperty ? (
                          <Badge variant={cap.propertyCount === 0 ? "secondary" : "muted"}>
                            {cap.propertyCount}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {cap.canApplyQuality ? (
                          <Badge variant="muted">Evet</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Hayır</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {/* Rota yalnız `station:read` ister (liste okunabilir);
                              yazma yüzeyinin kapısı BURADA. `canApplyProperty`
                              bir VERİ koşuludur, izin yerine geçmez. */}
                          <PermissionGate
                            permission="station:write"
                            fallback={<DisabledEditButton hint={NO_WRITE_HINT} />}
                          >
                            {editable ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => setEditing(cap)}
                              >
                                <Settings2 className="h-3.5 w-3.5" /> Yetenekleri Düzenle
                              </Button>
                            ) : (
                              <DisabledEditButton hint={disabledHint(cap)} />
                            )}
                          </PermissionGate>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TooltipProvider>
      </PageBody>

      <CapabilitiesEditSheet
        station={editing}
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </PageShell>
  );
}
