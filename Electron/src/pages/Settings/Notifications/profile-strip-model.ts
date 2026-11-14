// Profil şeridinin saf modeli (React'siz; testler aynı kodu koşar). Etkin profil SUNUCUDA hesaplanır
// (`etkin` anahtarları); istemci yalnız anahtarı çipe eşler ve "Özel" der.
import type { NotificationProfilesView } from "@/lib/bildirim/types";

export interface ProfileChip {
  /** `hazir:KOD` | `kisisel:<id>` — sunucu `etkin` anahtarıyla aynı biçim. */
  key: string;
  ad: string;
  kisisel: boolean;
  id?: string;
  kod?: string;
  /** İpucu: açıklama + açık tür sayısı. */
  ipucu: string;
}

export function profileChips(v: NotificationProfilesView): ProfileChip[] {
  return [
    ...v.hazir.map((p) => ({ key: `hazir:${p.kod}`, ad: p.ad, kisisel: false, kod: p.kod, ipucu: `${p.aciklama} (${p.acik.length}/${v.turSayisi} tür açık)` })),
    ...v.kisisel.map((p) => ({ key: `kisisel:${p.id}`, ad: p.ad, kisisel: true, id: p.id, ipucu: `Kaydettiğiniz profil (${p.acik.length} tür açık)` })),
  ];
}

/** Etkin profilin adı; birden çok eşleşirse kişisel olan öne geçer (kullanıcının kendi adı daha anlamlı). */
export function activeLabel(v: NotificationProfilesView): string {
  const chips = profileChips(v).filter((c) => v.etkin.includes(c.key));
  if (chips.length === 0) return "Özel";
  return (chips.find((c) => c.kisisel) ?? chips[0]!).ad;
}

/** Uygula gövdesi (sunucu `ApplyBody`). */
export function applyBody(c: ProfileChip, kanal: NotificationProfilesView["kanal"]): { kanal: NotificationProfilesView["kanal"]; hazir?: string; kisisel?: string } {
  return c.kisisel ? { kanal, kisisel: c.id } : { kanal, hazir: c.kod };
}
