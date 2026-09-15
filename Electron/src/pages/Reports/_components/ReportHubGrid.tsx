import { type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { HubCard, HubGrid } from "@/components/hub/HubCard";
import { REPORT_BY_KEY } from "@/lib/report-catalog";

export interface HubTile {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
}

interface Props {
  title: string;
  description?: string;
  tiles: HubTile[];
}

/**
 * Karo → katalog sınıfı. Anahtar ADRESTEN türer (`/reports/<kategori>/<rapor>`),
 * karo tanımına yeni alan EKLENMEZ: sınıf tek kaynakta (`REPORT_CATALOG.sinif`)
 * yaşar ve iki yerde tutulursa hangisinin doğru olduğu ölçülemez.
 */
export function sinifOf(to: string): "basit" | "gelismis" | null {
  const parts = to.split("/").filter(Boolean);
  const i = parts.indexOf("reports");
  if (i < 0 || parts.length < i + 3) return null;
  return REPORT_BY_KEY.get(`${parts[i + 1]}/${parts[i + 2]}`)?.sinif ?? null;
}

const SECTION_LABELS: Record<"basit" | "gelismis", { baslik: string; aciklama: string }> = {
  basit: { baslik: "Hızlı bakış", aciklama: "Tek eksende sorulur, tek tabloda cevaplanır." },
  gelismis: { baslik: "Derin analiz", aciklama: "Çok eksenli süzgeç, oran ve dönem karşılaştırması taşır." },
};

/**
 * Karoları sınıfa böler. SAF ve dışa açık: kapı (`reportHubSections.test.ts`)
 * "hiçbir karo kaybolmaz" ve "tek sınıflı kategoride bölüm yok" iddialarını
 * ekranı render etmeden ölçer.
 */
export function groupBySinif(tiles: HubTile[]): {
  sections: Array<{ sinif: "basit" | "gelismis"; list: HubTile[] }>;
  unclassified: HubTile[];
  showSections: boolean;
} {
  const sections = (["basit", "gelismis"] as const).map((s) => ({ sinif: s, list: tiles.filter((t) => sinifOf(t.to) === s) }));
  const unclassified = tiles.filter((t) => sinifOf(t.to) === null);
  return { sections, unclassified, showSections: sections.every((b) => b.list.length > 0) };
}

/** Domain alt-rapor hub'ı — tile grid layout, izin filtresi parent'ta yapılır. */
export function ReportHubGrid({ title, description, tiles }: Props) {
  // ⚠️ BÖLÜMLEME KAROYU GİZLEMEZ, SIRALAR: sınıfı katalogda olmayan karo (kategori
  // karoları, `/reports/<kategori>` iki segmentli) "Diğer"e düşmez — bölümsüz
  // listede kalır. Bir karoyu bölüm uğruna kaybetmek, kapatmaktan farksız olurdu.
  const { sections, unclassified, showSections } = groupBySinif(tiles);
  if (!showSections) {
    // Kategoride tek sınıf varsa iki başlık göstermek gürültüdür: rapor sayısı
    // değişmediği hâlde ekran "iki grup" diye okunur.
    return (
      <PageShell>
        <PageHeader title={title} description={description} />
        <PageBody className="p-6">
          <HubGrid>
            {tiles.map((tile, i) => (
              <HubCard key={tile.key} to={tile.to} title={tile.title} description={tile.description} icon={tile.icon} index={i} />
            ))}
          </HubGrid>
        </PageBody>
      </PageShell>
    );
  }
  return (
    // TabHost sayfayı `absolute inset-0` sarar: `min-h-0` olmadan kap içeriğe
    // göre büyür ve BAŞLIK dahil tüm panel kayar. PageShell/PageBody bunu
    // kapatır — tek kaydırıcı gövdedir, başlık sabit kalır.
    <PageShell>
      <PageHeader title={title} description={description} />
      <PageBody className="p-6">
        <div className="flex flex-col gap-6">
          {sections.map((b) => (
            <section key={b.sinif} className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">{SECTION_LABELS[b.sinif].baslik}</h3>
                <p className="text-xs text-muted-foreground">{SECTION_LABELS[b.sinif].aciklama}</p>
              </div>
              <HubGrid>
                {b.list.map((tile, i) => (
                  <HubCard key={tile.key} to={tile.to} title={tile.title} description={tile.description} icon={tile.icon} index={i} />
                ))}
              </HubGrid>
            </section>
          ))}
          {unclassified.length > 0 ? (
            <section className="space-y-3">
              <HubGrid>
                {unclassified.map((tile, i) => (
                  <HubCard key={tile.key} to={tile.to} title={tile.title} description={tile.description} icon={tile.icon} index={i} />
                ))}
              </HubGrid>
            </section>
          ) : null}
        </div>
      </PageBody>
    </PageShell>
  );
}
