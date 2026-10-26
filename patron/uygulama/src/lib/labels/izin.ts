// İzin sözlüğü: bulut izin kodu → Türkçe ad + açıklama + grup. Sunucu kataloğu (`GET /izinler`, `PermissionCatalog`)
// yalnız kod listesi taşır, açıklama taşımaz → tek kaynak bu dosya. Ekranda ham kod gösterilmez; katalogdaki her kodun
// burada olduğunu `__tests__/labels.test.ts` §1 ölçer (yeni izin eklenince sözlük eksikse kırmızı).
import { TERIM } from "../terim";

export type PermissionGroup = "siparis" | "cari" | "finans" | "rapor" | "hesap";

export interface PermissionLabel {
  readonly ad: string;
  readonly aciklama: string;
  readonly grup: PermissionGroup;
}

export const PERMISSION_GROUPS: readonly { readonly key: PermissionGroup; readonly ad: string }[] = [
  { key: "siparis", ad: "Sipariş" },
  { key: "cari", ad: "Cari" },
  { key: "finans", ad: "Finans" },
  { key: "rapor", ad: "Rapor" },
  { key: "hesap", ad: "Hesap yönetimi" },
];

export const PERMISSION_LABEL: Readonly<Record<string, PermissionLabel>> = {
  "bulut:oturum": { ad: "Oturum", aciklama: "Her etkin hesapta vardır; ürün, renk ve depo adlarını okur", grup: "hesap" },
  "bulut:ozet:oku": { ad: "Pano özeti", aciklama: "Panodaki günlük sayıları ve özet kartlarını görür", grup: "rapor" },
  "bulut:siparis:oku": { ad: "Siparişleri görme", aciklama: "Sipariş listesini, kalemleri ve terminleri görür", grup: "siparis" },
  "bulut:siparis:yaz": { ad: "Sipariş talebi gönderme", aciklama: "Fabrikaya yeni sipariş talebi gönderir (gelen kutusu)", grup: "siparis" },
  "bulut:sevkiyat:oku": { ad: "Sevkiyatı görme", aciklama: "Sevk edilen ve bekleyen sevkiyatları görür", grup: "siparis" },
  "bulut:uretim:oku": { ad: "Üretimi görme", aciklama: `Üretim akışını, ${TERIM.terbiyeIsEmri.cogulCekimKucuk.belirtme} ve fasonu görür`, grup: "siparis" },
  "bulut:stok:oku": { ad: "Stoku görme", aciklama: "Ham ve bitmiş stok miktarlarını görür", grup: "siparis" },
  "bulut:cari:oku": { ad: "Carileri görme", aciklama: "Müşteri ve tedarikçi kartlarını görür", grup: "cari" },
  "bulut:cari:yaz": { ad: "Cari talebi gönderme", aciklama: "Fabrikaya yeni cari açma talebi gönderir (gelen kutusu)", grup: "cari" },
  "bulut:cari-bakiye:oku": { ad: "Cari bakiyeleri", aciklama: "Carilerin alacak/borç bakiyesini ve yaşlandırmayı görür", grup: "cari" },
  "bulut:kasa:oku": { ad: "Kasa", aciklama: "Kasa hareketlerini ve bakiyesini görür", grup: "finans" },
  "bulut:cek:oku": { ad: "Çek ve senet", aciklama: "Çek/senet portföyünü ve vadeleri görür", grup: "finans" },
  "bulut:fatura:oku": { ad: "Faturalar", aciklama: "Kesilen ve alınan faturaları görür", grup: "finans" },
  "bulut:tahsilat:oku": { ad: "Tahsilat ve ödeme", aciklama: "Tahsilat ve ödeme kayıtlarını görür", grup: "finans" },
  "bulut:fiyat:oku": { ad: "Fiyatlar", aciklama: "Birim fiyatları ve tutarları görür", grup: "finans" },
  "bulut:teklif:oku": { ad: "Teklifleri görme", aciklama: "Müşteriye gönderilmiş teklifleri ve kalemlerini görür", grup: "siparis" },
  "bulut:maliyet:oku": { ad: "Maliyet ve marj", aciklama: "Teklif tutarlarını, maliyeti, kârlılığı ve standart maliyetleri görür", grup: "finans" },
  "bulut:rapor:oku": { ad: "Raporlar", aciklama: "Fabrikadan rapor ister ve sonuçlarını görür", grup: "rapor" },
  "bulut:hesap:yonet": { ad: "Hesap yönetimi", aciklama: "Hesap davet eder, izin verir, kilitler; verileri dışa aktarır", grup: "hesap" },
};

/** Bilinmeyen kod (yeni sunucu, eski uygulama) ham adla "Hesap yönetimi" dışı bir grupta görünür; sözlük bekçisi eksikleri yakalar. */
export function permissionLabel(code: string): PermissionLabel {
  return PERMISSION_LABEL[code] ?? { ad: code, aciklama: "", grup: "rapor" };
}

/** Kodları sözlük gruplarına ayırır (grup sırası `PERMISSION_GROUPS`; boş grup düşer, grup içi sıra korunur). */
export function groupPermissions(codes: readonly string[]): { readonly key: PermissionGroup; readonly ad: string; readonly codes: readonly string[] }[] {
  return PERMISSION_GROUPS.map((g) => ({ ...g, codes: codes.filter((c) => permissionLabel(c).grup === g.key) })).filter((g) => g.codes.length > 0);
}
