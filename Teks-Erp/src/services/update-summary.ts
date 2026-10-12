import type { UpdateStatus } from "./update-status.service";

// Panel ucu GET /api/guncelleme/ozet (oturumlu herkes) — izinsiz kullanıcının "Sunucu" satırı.

type Pending = NonNullable<UpdateStatus["bekleyen"]>;
type Decision = NonNullable<UpdateStatus["karar"]>;
type LastResult = NonNullable<UpdateStatus["son"]>;

/**
 * Kurulu sürüm + durum. Alan listesi OPT-IN — belirteç, politika, onaylayan, serbest ileti, geçmiş ve eylemler
 * bilerek yok; yeni alan buraya ancak açıkça eklenir.
 */
export interface UpdateSummary {
  readonly kuruluSurum: string;
  readonly donuk: boolean;
  readonly guncelleyici: { readonly durum: UpdateStatus["guncelleyici"]["durum"] };
  readonly bekleyen: { readonly surum: string; readonly karar: Pending["karar"]; readonly neden: string | null; readonly zorunlu: boolean } | null;
  readonly karar: { readonly karar: Decision["karar"]; readonly neden: string | null } | null;
  readonly yerel: { readonly durum: string; readonly hataKodu: string | null; readonly ilerleme: { readonly indirilen: number; readonly toplam: number } | null } | null;
  readonly son: { readonly sonuc: LastResult["sonuc"]; readonly hedefSurum: string; readonly bitis: string } | null;
}

/** Saf izdüşüm: tam görünüm → özet (alan alan kopya; yayma YOK ki yeni alan sızmasın). */
export function updateSummaryOf(s: UpdateStatus): UpdateSummary {
  const b = s.bekleyen;
  const y = s.yerel;
  return {
    kuruluSurum: s.kuruluSurum,
    donuk: s.donuk,
    guncelleyici: { durum: s.guncelleyici.durum },
    bekleyen: b ? { surum: b.surum, karar: b.karar, neden: b.neden, zorunlu: b.zorunlu } : null,
    karar: s.karar ? { karar: s.karar.karar, neden: s.karar.neden } : null,
    yerel: y ? { durum: y.durum, hataKodu: y.hataKodu, ilerleme: y.ilerleme ? { indirilen: y.ilerleme.indirilen, toplam: y.ilerleme.toplam } : null } : null,
    son: s.son ? { sonuc: s.son.sonuc, hedefSurum: s.son.hedefSurum, bitis: s.son.bitis } : null,
  };
}
