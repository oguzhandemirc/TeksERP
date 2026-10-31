// Sunucunun eksik/uyarı/kaynak/bileşen kodlarının Türkçe karşılığı (plan §2.2). Kod listesi backend
// `fabric-cost.helper.ts` COST_MISSING_CODES / COST_WARNING_CODES aynası; tanınmayan kod ham gösterilir.

export const MISSING_LABEL: Record<string, string> = {
  WARP_SPEC_MISSING: "Çözgü kartı bağlı değil — ürün kartında çözgü kartını seçin.",
  DENIER_MISSING: "İpliğin denyesi bilinmiyor — iplik kartına numara (denye) girin.",
  TAKEUP_MISSING: "Çözgü çekmesi yok — çözgü kartına çekme girin ya da parametre setine varsayılan çekme yazın.",
  WEFT_SPEC_MISSING: "Atkı kartı bağlı değil — ürün kartında atkı kartını seçin.",
  PICKS_MISSING: "Atkı sıklığı (atkı/cm) yok — atkı kartına sıklık girin.",
  WEFT_LENGTH_MISSING: "Atkı boyu bulunamadı — yapıya atkı boyu ya da kartlara tarak/ham en girin.",
  YARN_PRICE_MISSING: "İplik maliyet fiyatı yok — İplik Maliyet Fiyatları'ndan fiyat girin.",
  FX_RATE_MISSING: "Döviz kuru yok — kuru elle girin ya da Muhasebe → Kurlar'a günün kurunu ekleyin. Kur 1 varsayılmaz.",
  RPM_MISSING: "Tezgah devri yok — yapıya devir girin ya da parametre setine varsayılan devir yazın.",
  PARAMETER_SET_MISSING: "Yürürlükte parametre seti yok — önce Maliyet Parametreleri'nden bir set yürürlüğe alın.",
  FINISHING_RATE_MISSING: "Yapıdaki terbiye tarifesi kodu aktif bir tarifeye çözülmüyor — Fason Tarifeleri'ni kontrol edin.",
};

export const WARNING_LABEL: Record<string, string> = {
  TAKEUP_DEFAULTED: "Çözgü çekmesi kartta yok — parametre setinin varsayılanı kullanıldı.",
  WARP_WASTE_DEFAULTED: "Çözgü firesi yapıda yok — parametre varsayılanı kullanıldı.",
  WARP_WASTE_MEASURED: "Çözgü firesi ölçülmüş levent sonuçlarından uygulandı.",
  WEFT_LENGTH_FROM_WIDTH: "Atkı boyu ham enden + kenar payından türetildi (tarak eni yok).",
  SHRINK_UNKNOWN: "Boy çekmesi bilinmiyor — 0 kabul edildi.",
  RPM_DEFAULTED: "Tezgah devri yapıda yok — parametre varsayılanı kullanıldı.",
  PRICE_STALE: "Kullanılan bir fiyat 90 günden eski.",
};

export const SOURCE_LABEL: Record<string, string> = {
  KART: "Kart", YAPI: "Yapı", PARAMETRE: "Parametre", OLCULMUS: "Ölçülmüş", ELLE: "Elle",
};

export const COMPONENT_LABEL: Record<string, string> = {
  WARP_YARN: "Çözgü ipliği", WEFT_YARN: "Atkı ipliği", LOOM_MACHINE: "Makine", LOOM_LABOR: "İşçilik", ENERGY: "Enerji",
  BEAM_PREP: "Levent hazırlık", FINISHING: "Terbiye", LENGTH_SHRINK: "Boy çekmesi", FABRIC_WASTE: "Kalite firesi",
  OVERHEAD: "Genel gider", EXTRA: "Ek kalem", PROCESS: "Ek işlem",
};

export const STRUCTURE_STATUS_LABEL: Record<string, string> = { TAM: "Güncel yapı", VARSAYILAN: "Varsayılanla", YAPI_EKSIK: "Yapı eksik" };

export const missingText = (code: string): string => MISSING_LABEL[code] ?? code;
export const warningText = (code: string): string => WARNING_LABEL[code] ?? code;
