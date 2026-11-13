// Karekod okutma iletileri ve bileşen sözleşmesi: telefon (`KarekodOkut.native.tsx`, kameralı) ve web
// (`KarekodOkut.tsx`, kamerasız) sürümleri aynı tipi ve metni paylaşır. Burada kamera modülü içe alınmaz.
import type { PatronKarekodRet } from "../../lib/patron-karekod";

export const KAREKOD_ILETI: Record<PatronKarekodRet, string> = {
  yabanci: "Bu karekod TeksERP sunucu bağlantı kodu değil. Panelde Yetkilendirme → Patron Telefonu ekranındaki karekodu okutun.",
  "yeni-surum": "Bu karekod uygulamanın daha yeni bir sürümüyle üretilmiş; uygulamayı güncelleyin ya da adresi elle yazın.",
  sifresiz: "Karekoddaki adres şifresiz (http); uygulama yalnız https adresine bağlanır.",
  gecersiz: "Karekoddaki adres geçerli değil.",
  bos: "Karekoddaki adres geçerli değil.",
  yerel: "Karekoddaki adres yalnız fabrika ağından erişilen yerel bir adres; telefon dışarıdan ulaşamaz.",
};
export const KAMERA_IZNI_YOK = "Kamera izni verilmedi; sunucu adresini elle yazabilirsiniz.";
export const KAREKOD_YALNIZ_TELEFON = "Karekod okutma yalnız telefonda var; sunucu adresini elle yazabilirsiniz.";

export interface KarekodOkutProps {
  /** Adresi yoklar ve kaydeder; hata iletisi ya da null (başarı — ekranı çağıran kapatır). */
  readonly onAdres: (adres: string) => Promise<string | null>;
  /** Elle girişe dön (izin reddinde iletiyle). */
  readonly onElle: (ileti?: string) => void;
}
