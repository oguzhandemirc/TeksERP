// `rapor-dosya.ts` portlarının cihaz karşılığı: expo-file-system (önbellek `rapor-dosya/` dizini), expo-print (HTML → PDF,
// cihazda, ağsız) ve expo-sharing (paylaşım sayfası). Üçü yerel modüldür → yeni APK gerekir (OTA ile gelmez).
import { Directory, File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import type { DosyaPortlari } from "./rapor-dosya";

const dizin = () => new Directory(Paths.cache, "rapor-dosya");

function hazirDizin(): Directory {
  const d = dizin();
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

export const yerelDosyaPortlari: DosyaPortlari = {
  supur() {
    const d = dizin();
    if (d.exists) d.delete();
  },
  yaz(ad, veri) {
    const f = new File(hazirDizin(), ad);
    f.create({ overwrite: true });
    f.write(veri);
    return f.uri;
  },
  metinOku: (uri) => new File(uri).text(),
  async pdfYap(html, ad) {
    const { uri } = await Print.printToFileAsync({ html });
    const hedef = new File(hazirDizin(), ad);
    if (hedef.exists) hedef.delete();
    new File(uri).move(hedef);
    return hedef.uri;
  },
  sil(uri) {
    const f = new File(uri);
    if (f.exists) f.delete();
  },
  paylasimVar: () => Sharing.isAvailableAsync(),
  paylas: (uri, o) => Sharing.shareAsync(uri, { mimeType: o.mimeType, UTI: o.uti, dialogTitle: o.baslik }),
};
