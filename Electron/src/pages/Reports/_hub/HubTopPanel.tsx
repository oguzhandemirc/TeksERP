import { Link } from "react-router-dom";
import { FileBarChart, Plus } from "lucide-react";
import { CategoryCard, CategoryCardGrid } from "@/components/insight/CategoryCard";
import { FilterChip, FilterChipBar } from "@/components/insight/FilterChipBar";
import { Button } from "@/components/ui/button";
import type { ReportKategoriV2, ReportPersona } from "@/lib/report-catalog";
import type { PanoDonem } from "@/pages/Dashboard/pano/types";
import type { CenterGroup } from "../_v2/center-model";
import { CATEGORY_LOOK, PERSONA_LABEL } from "./hub-meta";
import { isFilterActive, type HubFilter } from "./hub-model";
import { PeriodChip } from "./HubInsights";

interface Props {
  /** Persona + arama süzülmüş, kategori süzülmemiş gruplar (boş olanlar dahil — sayacı 0 kart çizilmez). */
  groups: readonly CenterGroup[];
  personas: readonly ReportPersona[];
  filter: HubFilter;
  onFilter: (f: HubFilter) => void;
  onReset: () => void;
  /** Dönem çipi yalnız analiz kutuları varken (pano izni) çizilir. */
  period: PanoDonem | null;
  onPeriod: (d: PanoDonem) => void;
  canBuild: boolean;
  /** Özel rapor sayısı (kendi + paylaşılan); `null` = kart yok (görecek/kuracak rapor yok). */
  customCount: number | null;
  /** Kart tıklaması SÜZMEZ: liste o kategoriye kayar ve bölüm spot ışığıyla vurgulanır (süzgeç yalnız açılır çipte). */
  onCategoryPicked: (key: ReportKategoriV2, title: string) => void;
  /** Spot ışığı yanan kategori — kart vurgu süresince seçili görünür. */
  spotKey: string | null;
  onShowCustom: () => void;
}

/** Üst panel (hedef görsel): süzgeç çipleri + Sıfırla + "Özel rapor", altında kategori kartları. */
export function HubTopPanel({ groups, personas, filter, onFilter, onReset, period, onPeriod, canBuild, customCount, onCategoryPicked, spotKey, onShowCustom }: Props) {
  const categoryOptions = groups.map((g) => ({ value: g.key, label: g.title }));
  const personaOptions = personas.map((p) => ({ value: p, label: PERSONA_LABEL[p] }));
  return (
    <section aria-label="Rapor kategorileri" className="flex flex-col gap-4 rounded-xl border border-card-border bg-card p-4 shadow-card">
      <FilterChipBar
        onReset={onReset}
        canReset={isFilterActive(filter)}
        end={canBuild ? (
          <Button asChild size="sm" className="gap-1.5">
            <Link to="/reports/ozel/yeni"><Plus className="h-4 w-4" /> Özel rapor</Link>
          </Button>
        ) : undefined}
      >
        <FilterChip label="Kategori" value={filter.category} allLabel="Tüm kategoriler" options={categoryOptions}
          onChange={(v) => onFilter({ ...filter, category: v as ReportKategoriV2 | null })} />
        {personaOptions.length > 0 && (
          <FilterChip label="Kimin için" value={filter.persona} allLabel="Herkes için" options={personaOptions}
            onChange={(v) => onFilter({ ...filter, persona: v as ReportPersona | null })} />
        )}
        {period && <PeriodChip value={period} onChange={onPeriod} />}
      </FilterChipBar>
      <CategoryCardGrid label="Kategoriler">
        {groups.map((g) => {
          const look = CATEGORY_LOOK[g.key];
          return (
            <CategoryCard key={g.key} icon={look.icon} tone={look.tone} title={g.title} description={look.description}
              countText={`${g.entries.length} rapor`} active={spotKey === g.key} onClick={() => onCategoryPicked(g.key, g.title)} />
          );
        })}
        {customCount !== null && (
          <CategoryCard icon={FileBarChart} tone="sky" title="Özel raporlar" description="Kendi kurduğunuz ve sizinle paylaşılan raporlar"
            countText={`${customCount} rapor`} onClick={onShowCustom} />
        )}
      </CategoryCardGrid>
    </section>
  );
}
