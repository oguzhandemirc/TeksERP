import type { CommandEntry, CommandSection } from "./command-entries.types";
import { reportTiles, reportCategoryTiles } from "@/pages/Reports/tile-config";
import { regimePredicate } from "@/lib/regime-predicate";

/**
 * Raporlar bölümleri — kategori hub'ı + o kategorinin TÜM alt raporları.
 *
 * NEDEN AYRI DOSYA: `reportCategoryTiles` yedi alt-config'i toplar; palet
 * onları burada tek yerde açar. Elle liste tutulmaz — yeni bir rapor
 * `Reports/<Domain>/tile-config.ts`e eklendiği an palette de çıkar.
 *
 * ⚠️ MODÜL BAYRAĞI DA KATEGORİDEN TAŞINIR (2026-09-03). Eskiden taşınmıyordu ve
 * "Ön Muhasebe" rapor kategorisi hub'da gizliyken palette DURUYORDU; yalnız
 * izin süzgeci sayesinde görünmüyordu (bayrak kapalı bir kurulumda finans izni
 * de atanmamış olur). Üretim raporları bağlandığı an bu tesadüf biter: üretim
 * izni HER kurulumda atanmıştır, yani modül kapalıyken palet gizli kategoriye
 * derin bağlantı verirdi ("Kurşun Sırası" dersi). Kategori hub'ı ve ALT
 * raporları AYNI yüklemi taşır — alt rapor route'u da kategori kapısındadır.
 *
 * ⚠️ İZİN, KATEGORİNİN İZNİDİR. Alt rapor karoları (`HubTile`) izin alanı
 * taşımaz çünkü hub zaten kategori iznine göre süzülür; route ise her alt
 * sayfada `report:<domain>` ister. Palet girişine kategori iznini KOPYALAMAK
 * zorunlu: aksi halde giriş izinsiz kullanıcıya görünür, tıklayınca
 * `/forbidden`'a düşer ("kart/route hizası" kuralı).
 */
export const reportCommandSections: CommandSection[] = reportTiles.map((cat) => {
  const hub: CommandEntry = {
    key: `report:${cat.key}`,
    label: cat.title,
    description: cat.description,
    icon: cat.icon,
    to: cat.to,
    permission: cat.permission,
    visibleWhen: cat.featureFlag ? regimePredicate(cat.featureFlag) : undefined,
    keywords: "rapor raporlar analiz",
  };

  const subs: CommandEntry[] = (reportCategoryTiles[cat.key] ?? []).map((tile) => ({
    key: `report:${cat.key}:${tile.key}`,
    label: tile.title,
    description: tile.description,
    icon: tile.icon,
    to: tile.to,
    permission: cat.permission,
    visibleWhen: cat.featureFlag ? regimePredicate(cat.featureFlag) : undefined,
    keywords: `rapor ${cat.title}`,
  }));

  return {
    heading: `Raporlar · ${cat.title}`,
    // Alt raporun breadcrumb'ı kategori hub'ına çıkar (eskiden hiç yoktu —
    // rapor sayfasından geri dönüş yalnız sekme/geçmiş ile mümkündü).
    parent: { label: cat.title, to: cat.to },
    entries: [hub, ...subs],
  };
});
