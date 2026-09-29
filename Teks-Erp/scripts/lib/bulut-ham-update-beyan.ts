// PATRON BULUTU — HAM UPDATE BEYANI: katalog tablolarında `updatedAt` YAZMAYAN ham UPDATE'lerin
// gerekçesi. Prisma kancasını atlayan yazım filigrana görünmez; burada her biri ya birleştirme
// defterinden (`merge_operations` createdAt/revertedAt taraması, tasarım §4.5) okunur ya da
// hiçbir projeksiyonun/türetmenin okumadığı kolona yazar. Beyansız olan KIRMIZIDIR
// (`test_bulut_ham_update`), ölü beyan da. `payment-allocation` sayaçları `updatedAt`i açıkça
// yazar ve bu yüzden burada YOKTUR — yazmayı bırakırsa beyansız düşer (§4.2 S2).
// `test_` öneki yok → koşucu bunu bekçi saymaz.

export type HamUpdateSinifi =
  /** Birleştirme / geri alma: FK taşıma ve kart diriltme — eşitleme bunu birleştirme defterinden görür. */
  | "BIRLESTIRME_DEFTERI"
  /** Yazılan kolonların HİÇBİRİ bir projeksiyonun tel kolonu ya da türetmenin okuduğu kolon değil. */
  | "TURETIM_DISI_KOLON";

export interface HamUpdateBeyani {
  /** `Teks-Erp/` köküne göreli dosya. */
  readonly dosya: string;
  /** Tablo adı; `*` YALNIZ dinamik tablolu SQL (`"${table}"`) ile eşleşir. */
  readonly tablo: string;
  /** İzin verilen SET kolonları (`*` = hepsi — yalnız birleştirme defteri sınıfında). */
  readonly kolonlar: readonly string[] | "*";
  readonly sinif: HamUpdateSinifi;
  readonly gerekce: string;
}

const HAREKET_CIKISI = ["qtyOut", "weightOut", "exitedAt", "notes", "machineId"] as const;
const hareket = (dosya: string): HamUpdateBeyani => ({
  dosya,
  tablo: "roll_movements",
  kolonlar: HAREKET_CIKISI,
  sinif: "TURETIM_DISI_KOLON",
  gerekce: "hareket çıkış ölçüsü — iş emri girişi (`computeWoInput`) yalnız rollId + workOrderStepId + revokedAt okur; iptal Prisma ile yazılır (updatedAt var)",
});

export const HAM_UPDATE_BEYANI: readonly HamUpdateBeyani[] = [
  { dosya: "src/services/helpers/merge-ledger.helper.ts", tablo: "*", kolonlar: "*", sinif: "BIRLESTIRME_DEFTERI",
    gerekce: "birleştirmenin FK taşıması ve geri alması — taşınan satırlar merge_operation_refs.rowIds'te, tarama merge_operations.createdAt/revertedAt ile kökleri kirletir" },
  { dosya: "src/services/master-data-merge.service.ts", tablo: "*", kolonlar: "*", sinif: "BIRLESTIRME_DEFTERI",
    gerekce: "alias tablosu atamaları — birleştirme defteri refs'leri" },
  { dosya: "src/services/master-data-merge.service.ts", tablo: "rolls", kolonlar: ["labelDirty"], sinif: "TURETIM_DISI_KOLON",
    gerekce: "etiket kirlilik işareti — hiçbir projeksiyon ya da türetme okumaz" },
  { dosya: "src/services/master-data-merge.service.ts", tablo: "sacks", kolonlar: ["labelDirty"], sinif: "TURETIM_DISI_KOLON",
    gerekce: "etiket kirlilik işareti — hiçbir projeksiyon ya da türetme okumaz" },
  { dosya: "src/services/master-data-unmerge.service.ts", tablo: "*", kolonlar: "*", sinif: "BIRLESTIRME_DEFTERI",
    gerekce: "geri alma kaynak kartı diriltir (mergedIntoId/isActive/name) — merge_operations.revertedAt taraması survivor + kaynakları kirletir" },
  hareket("src/services/subcontractor.service.ts"),
  hareket("src/services/workorder-manual-move.service.ts"),
  hareket("src/services/helpers/roll-disposition.helper.ts"),
  hareket("src/services/workorder-batch-drop.service.ts"),
  hareket("src/services/kursun-bypass.service.ts"),
  hareket("src/services/kursun-qc.service.ts"),
];
