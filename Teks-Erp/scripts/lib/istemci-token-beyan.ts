// =============================================================================
// İSTEMCİ TOKEN BEYANI — panel + tablet token üretiminin muafları ve P3 borcu
// =============================================================================
// Okuyucu: `test_istemci_token_uretimi`. Kural: kk1.md "İstemci token'ı" (mantıksal deneme başına bir kez; yalnız
// belirsiz hatada yapışır, kesin 4xx ve başarıda yenilenir). Tek yardımcı: panel `Electron/src/lib/attemptToken.ts`,
// tablet `mobil/src/offline/entryAttempt.ts` + modül yardımcıları. Anahtar biçimi `dosya::birim` (en dıştaki adlı
// fonksiyon — bileşen, hook ya da modül fonksiyonu).
// =============================================================================

/** Politika kökleri: bu adlar bu dosyalardan dışa açılır; türetilen politika adları bunlardan büyür. */
export const KOK_POLITIKA: Readonly<Record<string, readonly string[]>> = {
  "Electron/src/lib/attemptToken.ts": ["isAmbiguousFailure", "useAttemptToken"],
  "mobil/src/offline/entryAttempt.ts": ["isAmbiguousFailure"],
};

/** Muaf sınıfları KAPALI küme — yeni sınıf bekçide ve burada birlikte açılır. */
export const MUAF_SINIFLARI = {
  TOKEN_DEGIL: "üretilen değer idempotency anahtarı değil (cihaz/sekme kimliği)",
  EZILEN_VARSAYILAN: "yük kurucusunun varsayılanı; çağıran politika fonksiyonuyla ezer (`ezen` ölçülür)",
  MUTASYON_DEGISKENI: "kimlik mutate değişkenine gömülür; askıdaki mutasyon aynı değişkenle sürdürülür, her tıklama yeni kayıttır",
} as const;

export interface MuafSatiri {
  sinif: keyof typeof MUAF_SINIFLARI;
  /** Satırın örttüğü üretim biçimi ve adedi — fazlası beyansız, eksiği ölü satırdır. */
  bicim: "DONUS" | "SATIR_ICI" | "SINIFLANAMADI";
  adet: number;
  not: string;
  /** EZILEN_VARSAYILAN: başka bir dosyada kurucuyla aynı birimde çağrılan politika fonksiyonu. */
  ezen?: string;
}

export const ISTEMCI_MUAF: Readonly<Record<string, MuafSatiri>> = {
  "Electron/src/lib/deviceId.ts::genUuid": { sinif: "TOKEN_DEGIL", bicim: "DONUS", adet: 1, not: "cihaz kimliği" },
  "Electron/src/store/tabs.ts::newId": { sinif: "TOKEN_DEGIL", bicim: "DONUS", adet: 1, not: "sekme kimliği" },
  "mobil/src/screens/Modules/FasonKabul/receivePayload.helper.ts::buildReceivePayload": {
    sinif: "EZILEN_VARSAYILAN",
    bicim: "SATIR_ICI",
    adet: 1,
    not: "ekran yükün parmak izinden tokenForReceive ile ezer",
    ezen: "tokenForReceive",
  },
  "mobil/src/screens/Modules/KursunQc/KursunQcScreen.tsx::KursunQcScreen": {
    sinif: "MUTASYON_DEGISKENI",
    bicim: "SINIFLANAMADI",
    adet: 1,
    not: "clientErrorId = RollError.id; aynı metre + tip ikinci eklemeyi ekran durdurur",
  },
};

/**
 * P3 BORCU — token'ı deneme başına tutan (useState/useRef/tembel ref) ama politika yardımcısına bağlı olmayan
 * birimler: kesin 4xx'te token'ı yenilemez ya da kuralı elle kopyalar. Sunucu boğazı mükerrer kaydı önler; borcun
 * bedeli istemci akışıdır: belirsiz hatadan sonra form değişirse 409 çakışma gelir ve yenilenmeyen token'la her yeni
 * basış aynı 409'u alır (form yeniden açılana kadar). Liste YALNIZ KISALIR: birim yardımcıya taşınınca satır
 * silinir, tabanı entegratör trende düşürür (bekçide `P3_TABANI`).
 */
export const P3_BORC: readonly string[] = [
  "Electron/src/components/import/ImportDialog.tsx::ImportDialog",
  "Electron/src/pages/Finance/CashTransactions/CashTransferDialog.tsx::CashTransferDialog",
  "Electron/src/pages/Finance/CashTransactions/CashTxnFormDialog.tsx::CashTxnFormDialog",
  "Electron/src/pages/Finance/Cheques/ChequeFormDialog.tsx::ChequeFormDialog",
  "Electron/src/pages/Operations/MachineStops/StopEntryDialog.tsx::StopEntryDialog",
  "Electron/src/pages/Operations/Orders/OrdersPage.tsx::OrdersPage",
  "Electron/src/pages/Operations/PurchaseOrders/PurchaseOrderFormDialog.tsx::PurchaseOrderFormDialog",
  "Electron/src/pages/Operations/Rolls/ManualEntryDialog.tsx::ManualEntryDialog",
  "Electron/src/pages/Operations/Rolls/ReduceKartelaStockDialog.tsx::ReduceKartelaStockDialog",
  "Electron/src/pages/Operations/Rolls/ReworkRollsDialog.tsx::ReworkRollsDialog",
  "Electron/src/pages/Operations/SackContentEdit/AssignPackingGroupDialog.tsx::useAssignGroup",
  "Electron/src/pages/Operations/SackContentEdit/CreateShipmentDialog.tsx::CreateShipmentDialog",
  "Electron/src/pages/Operations/SackContentEdit/NewSackDialog.tsx::NewSackDialog",
  "Electron/src/pages/Operations/SackContentEdit/NewSackDialog.tsx::useOpenSackInLot",
  "Electron/src/pages/Operations/SackContentEdit/SackEditorView.tsx::SackEditorView",
  "Electron/src/pages/Operations/WarpBeams/WarpBeamFormDialog.tsx::WarpBeamFormDialog",
  "Electron/src/pages/Operations/WarpBeams/WindDialog.tsx::WindDialog",
  "Electron/src/pages/Operations/WarpBeams/tezgah/DismountConsumeDialogs.tsx::ConsumeDialog",
  "Electron/src/pages/Operations/WarpBeams/tezgah/MountDialog.tsx::MountDialog",
  "Electron/src/pages/Operations/WeavingOrders/WeavingOrderFormDialog.tsx::WeavingOrderFormDialog",
  "Electron/src/pages/Operations/WeavingOrders/fason/FasonBeamReturnDialog.tsx::FasonBeamReturnDialog",
  "Electron/src/pages/Operations/WeavingOrders/fason/FasonReceiptDialog.tsx::FasonReceiptDialog",
  "Electron/src/pages/Operations/WorkOrders/WorkOrderFormPage.tsx::WorkOrderFormPage",
  "mobil/src/screens/Modules/Depo/KartelaStockReduceModal.tsx::KartelaStockReduceModal",
  "mobil/src/screens/Modules/HizliIsEmri/useQuickWorkOrder.ts::useQuickWorkOrder",
  "mobil/src/screens/Modules/Tambur/TamburManualRollModal.tsx::TamburManualRollModal",
  "mobil/src/screens/Modules/Tambur/TamburScreen.tsx::TamburScreen",
  "mobil/src/screens/Modules/TartiPaket/HizliSiparisScreen.tsx::HizliSiparisScreen",
  "mobil/src/screens/Modules/TartiPaket/PaketlemeScreen.tsx::PaketlemeScreen",
];
