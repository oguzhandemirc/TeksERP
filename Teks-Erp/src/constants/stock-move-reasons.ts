// =============================================================================
// STOK HAREKETİ SEBEP KATALOĞU
// =============================================================================
// Defterin `reasonCode` kolonu ENUM DEĞİL: yeni bir sebep bir katalog satırıdır,
// migration değil. (PostgreSQL enum değeri geri alınamaz; ayrıntı boyutu enum'a
// konursa her yeni akış geri alınamaz bir şema kararına dönüşür.)
// Tasarım: `docs/design/DEPO-STOK-DEFTERI-TASARIM.md` §D2.
// =============================================================================

export const STOCK_MOVE_REASON = {
  /** Depodan üretime çıkış (iş emrine alma, elle taşıma, redye). */
  PRODUCTION_ISSUE: "PRODUCTION_ISSUE",
  /** Üretimden depoya dönüş (son adım finalize). */
  PRODUCTION_RECEIPT: "PRODUCTION_RECEIPT",
  /** Tambur finalize çocuğunun doğumu. */
  TAMBUR_FINALIZE: "TAMBUR_FINALIZE",
  /** Tambur geri alma — finalize çocuğunun giriş satırının TERSİ. */
  TAMBUR_UNDO: "TAMBUR_UNDO",
  /** Kurşun/KK2 adımının yeniden açılması — son adım girişinin TERSİ. */
  KURSUN_REOPEN: "KURSUN_REOPEN",
  /** İş emrinden çıkarma — üretimden stoğa geri dönüş. */
  WO_DETACH: "WO_DETACH",
  /** Topun kayıttan düşmesi (iptal) — stoktan çıkış. */
  ROLL_CANCEL: "ROLL_CANCEL",
  /** İptalin geri alınması — `ROLL_CANCEL` satırının TERSİ. */
  CANCEL_RESTORE: "CANCEL_RESTORE",
  /** İş emri kapanış/iptal dispozisyonu. */
  DISPOSITION: "DISPOSITION",
  /** Depo topunun kesimi (ebeveyn çıkışı + çocuk girişi, net sıfır). */
  CUT_SPLIT: "CUT_SPLIT",
  /** Fason firmasına çıkış / dönüş. */
  FASON_DISPATCH: "FASON_DISPATCH",
  FASON_RECEIPT: "FASON_RECEIPT",
  /** Kartela firmasına çıkış. */
  KARTELA_DISPATCH: "KARTELA_DISPATCH",
  /** Gerçek fire. */
  SCRAP: "SCRAP",
  /** Sayım farkı. */
  STOCK_COUNT: "STOCK_COUNT",
  /** Çekme (fason dönüşünde ölçülen eksik). */
  SHRINK: "SHRINK",
  /** Kesimde aşım. */
  OVERAGE: "OVERAGE",
  /** Elle metraj düzeltmesi. */
  MANUAL_ADJUST: "MANUAL_ADJUST",
  /** Kesme anı açılış fotoğrafı. */
  OPENING: "OPENING",
} as const;

export type StockMoveReason = (typeof STOCK_MOVE_REASON)[keyof typeof STOCK_MOVE_REASON];
