// =============================================================================
// clientToken YOLLARI — BEYAN (tek kaynak) · bekçi: `test_token_replay_bogaz`
// =============================================================================
// Token yazan (ya da `where: { clientToken }` ile okuyan) her fonksiyon birimi burada TEK satırdır:
//   giris  — boğazdan geçer (`tokenReplay`): anahtar kipi çağıran birim, değer kip (R · K · K′)
//   helper — tek yazar helper'ı; replay kararı çağıranındır (çağıran ayrıca beyanlı)
//   borc   — henüz boğazda değil; dilim adıyla (`docs/design/TOKEN-REPLAY-KILIDI.md` §4). CIRCIR: yalnız düşer.
//   muaf   — KAPALI sınıf kümesi (`MUAF_SINIFLARI`), gerekçeli
// `tokenReplay({ find })` politikası ve politikanın çağırdığı okuyucu kendiliğinden beyanlıdır.
// Kapalı kümenin dördüncü sınıfı ON_KONTROL_OKUYUCUSU (D5a, 4b onayı): token'ı yalnız bir HESAPTAN (aşım toplamı)
// tekrar satırını düşmek için okuyan, replay YANITI ÜRETMEYEN birim. Dar tanım bekçide ölçülür: okuma yalnız
// `clientToken`ı seçer (kayıt içeriği hiçbir yola akamaz) ve birim boğaz çağırmaz.
// =============================================================================

export const MUAF_SINIFLARI = {
  /** Token satırı tx'in İLK yazımı: kaybeden ilk ifadede P2002 alır, arada iş kuralı yok. */
  ILK_YAZIM_TOKEN: "token satırı tx'in ilk yazımı",
  /** Token koşumdan ÖNCE claim edilir (tek satır), iş ona bağlı yürür. */
  TOKEN_CLAIM_ONCE: "token işten önce claim edilir",
  /** Yalnız token'sız yolun dalı (token gelirse satır zaten vardır). */
  TOKENSIZ_DAL: "token'sız dal",
  /** Token'ı yalnız bir hesaptan tekrar satırını düşmek için okur; yanıt üretmez (okuma yalnız `clientToken`ı seçer). */
  ON_KONTROL_OKUYUCUSU: "yanıt üretmeyen ön kontrol okuyucusu",
} as const;

export type Kip = "R" | "K" | "K′";
export type TokenYolu =
  | { giris: Record<string, Kip> }
  | { helper: string }
  | { borc: "D3" | "D5"; not: string }
  | { muaf: keyof typeof MUAF_SINIFLARI; neden: string };

const S = "src/services/";

export const TOKEN_YOLLARI: Record<string, TokenYolu> = {
  // ── Boğazda ─────────────────────────────────────────────────────────────────
  [`${S}warp-beam-consume.service.ts::consumeBeam`]: { giris: { [`${S}warp-beam-consume.service.ts::consumeBeam`]: "R" } },
  // Destek talebi (3d-2): talep kaydı panelden clientToken ile doğar; satıcıya giden kimlik talebin id'sidir.
  [`${S}support.service.ts::createSupportTicket`]: { giris: { [`${S}support.service.ts::createSupportTicket`]: "R" } },
  // Lisans sözleşmesi kabulü (Ek-7): kabul satırı panelden clientToken ile doğar; kimliği (kabulId) imzalı belgeye girer.
  [`${S}license-acceptance.service.ts::recordLicenseAcceptance`]: { giris: { [`${S}license-acceptance.service.ts::recordLicenseAcceptance`]: "R" } },
  // Backend güncelleme onayı (Dağıtım v2): karar satırı panelden clientToken ile doğar; kimliği (onayId) niyet dosyasına girer.
  [`${S}update-approval.service.ts::recordUpdateApproval`]: { giris: { [`${S}update-approval.service.ts::recordUpdateApproval`]: "R" } },
  // Patron bulutu gelen kutusu: clientToken = mesajId; 8036 mesajId üzerinde, makbuz replay'i tx'in ilk ifadesi (K).
  [`${S}order.service.ts::prepareOrderCreate`]: { giris: { [`${S}order.service.ts::create`]: "R", [`${S}order.service.ts::quickOrderTx`]: "K", [`${S}cloud-inbox.service.ts::createOrderFromMessage`]: "K" } },
  [`${S}order.service.ts::quickOrderFromRolls`]: { giris: { [`${S}order.service.ts::quickOrderTx`]: "K" } },
  [`${S}cheque-delivery-note.service.ts::createTx`]: { giris: { [`${S}cheque-delivery-note.service.ts::create`]: "K" } },
  [`${S}subcontractor.service.ts::receiveInner`]: { giris: { [`${S}subcontractor.service.ts::receive`]: "R" } },
  [`${S}tambur.service.ts::cutWarehouseRollInner`]: { giris: { [`${S}tambur.service.ts::cutWarehouseRoll`]: "R" } },
  [`${S}tambur.service.ts::cutOpenFabricInner`]: { giris: { [`${S}tambur.service.ts::cutOpenFabric`]: "R" } },
  [`${S}cash-transaction.service.ts::createFresh`]: { giris: { [`${S}cash-transaction.service.ts::create`]: "R" } },
  [`${S}cash-transaction.service.ts::transferFresh`]: { giris: { [`${S}cash-transaction.service.ts::transfer`]: "R" } },

  // ── Tek yazar helper'ları ───────────────────────────────────────────────────
  [`${S}helpers/cash-ledger.helper.ts::applyCashTxTx`]: { helper: "kasa/banka satırı + bakiye tek yazarı" },
  [`${S}helpers/warp-beam-wind-write.helper.ts::writeWoundTx`]: { helper: "sarım satırı yazarı (raşel kardeşleri token'sız)" },
  [`${S}shipping.service.ts::createShipmentCoreTx`]: { helper: "sevkiyat çekirdek yazarı" },
  [`${S}batch.service.ts::createBatchTx`]: { helper: "parti yazarı" },

  // ── Boğazda: D3 (plan §4 — kalan (a) yolları) ───────────────────────────────
  [`${S}shipping.service.ts::createShipmentInner`]: { giris: { [`${S}shipping.service.ts::createShipment`]: "R" } },
  [`${S}shipping.service.ts::createShipmentFromRollsInner`]: { giris: { [`${S}shipping.service.ts::createShipmentFromRolls`]: "R" } },
  // #15: 8033/8035 yalnız parti ya da "açılışta" modunda — koşullu kilide K′ kurulmaz, yalnız R (4b onayı).
  [`${S}shipping.service.ts::openSackFresh`]: { giris: { [`${S}shipping.service.ts::openSack`]: "R" } },
  [`${S}warp-beam-mount.service.ts::mountBeamFresh`]: { giris: { [`${S}warp-beam-mount.service.ts::mountBeam`]: "R" } },
  [`${S}warp-beam-wind.service.ts::windWarpBeamFresh`]: { giris: { [`${S}warp-beam-wind.service.ts::windWarpBeam`]: "R" } },
  [`${S}subcontractor-beam.service.ts::returnWarpBeamFresh`]: { giris: { [`${S}subcontractor-beam.service.ts::returnWarpBeam`]: "R" } },
  [`${S}machine-run.service.ts::openMachineRunFresh`]: { giris: { [`${S}machine-run.service.ts::openMachineRun`]: "R" } },
  // #12: quickStart create'i çağırır (iç boğaz) ve kendi boğazıyla sarar; kimlikte top kümesi YOK (kısmi bağlama).
  [`${S}workorder.service.ts::createFresh`]: { giris: { [`${S}workorder.service.ts::create`]: "R" } },
  // #13/#14 K′ HIZ YOLUDUR, kapı değil: kaldırılınca R yedeği aynı yarışı kapatır (sonda 2026-09-26) — kaybeden
  // kilitte bekleyip replay'i doğrudan alır, iş kuralını boşa koşmaz.
  [`${S}workorder-batch-add.service.ts::addBatch`]: { giris: { [`${S}workorder-batch-add.service.ts::addBatch`]: "K′" } },
  [`${S}workorder-batch-add.service.ts::addBatchToWorkOrderTx`]: { giris: { [`${S}workorder-batch-add.service.ts::addBatch`]: "K′" } },
  [`${S}packing-group.service.ts::createGroupFresh`]: { giris: { [`${S}packing-group.service.ts::createWithSacks`]: "R", [`${S}packing-group.service.ts::createGroupFresh`]: "K′" } },
  [`${S}warehouse-transfer.service.ts::createFresh`]: { giris: { [`${S}warehouse-transfer.service.ts::create`]: "R" } },
  [`${S}invoice.service.ts::createDraftFresh`]: { giris: { [`${S}invoice.service.ts::createDraft`]: "R" } },

  // ── Boğazda: D5a (finans) — ön-okuma iş kurallarından ÖNCE; taraf karta çözülmüş hâliyle ────────────────
  [`${S}payment.service.ts::createFresh`]: { giris: { [`${S}payment.service.ts::create`]: "R" } },
  [`${S}cheque.service.ts::createFresh`]: { giris: { [`${S}cheque.service.ts::create`]: "R" } },
  [`${S}purchase-order.service.ts::createFresh`]: { giris: { [`${S}purchase-order.service.ts::create`]: "R" } },
  [`${S}goods-receipt.service.ts::createFresh`]: { giris: { [`${S}goods-receipt.service.ts::create`]: "R" } },

  // ── Boğazda: D5b (üretim nesneleri) — ilk ifade kilidi olanlarda R + K′ (hız yolu) ─────────────────────
  // Levent planı yalnız R. Emanet kapısı 8029'dan önce koşar ama 8029'un koruduğu gün önekli numarayı OKUMAZ (yalnız
  // emanet ayarı + sahip müşteri) → TOCTOU yok, kilit sırası değişmedi (4b kararı; arşiv D5b).
  [`${S}warp-beam.service.ts::createWarpBeamFresh`]: { giris: { [`${S}warp-beam.service.ts::createWarpBeam`]: "R" } },
  [`${S}weaving-order.service.ts::createWeavingOrderFresh`]: { giris: { [`${S}weaving-order.service.ts::createWeavingOrder`]: "R", [`${S}weaving-order.service.ts::createWeavingOrderFresh`]: "K′" } },
  [`${S}subcontractor-weaving.service.ts::receiveForWeavingFresh`]: { giris: { [`${S}subcontractor-weaving.service.ts::receiveForWeaving`]: "R", [`${S}subcontractor-weaving.service.ts::receiveForWeavingFresh`]: "K′" } },
  [`${S}machine-doff.service.ts::openDoffFresh`]: { giris: { [`${S}machine-doff.service.ts::openDoff`]: "R", [`${S}machine-doff.service.ts::openDoffFresh`]: "K′" } },

  // ── Boğazda: D5c (top doğumu · çeki) ────────────────────────────────────────────────────────────────────
  // Top doğumunun 8021'i koşullu (yalnız mükerrer kapısı açıkken) → yalnız R. Tambur'un iki yolu token'ı faz 1'e iletir
  // (yazar/okuyucu değil): elle top (a′) bağlı-topta `replayIfAny` erken yolu, kartsız top tepede `run`.
  // D4c (ertelendi): hızlı iş emri telafisi `hardDelete(…, { releaseToken })` token'ı bırakır — D4b'li istemciler sahada
  // yaygınlaşınca kalkar (telafi token'ı tutar, 409 QUICK_START_ROLLED_BACK); plan §4.
  [`${S}inventory.service.ts::createInitialEntryFresh`]: { giris: { [`${S}inventory.service.ts::createInitialEntry`]: "R" } },
  [`${S}inventory.service.ts::createOpenFabricFresh`]: { giris: { [`${S}inventory.service.ts::createOpenFabric`]: "R", [`${S}inventory.service.ts::createOpenFabricFresh`]: "K′" } },
  [`${S}helpers/manifest-number.helper.ts::recordSackPickList`]: { helper: "çeki listesi yazarı (içerik tekilliği iş kuralı); replay printPickList'in boğazında" },

  // ── Borç: D5 (4. durum eksikleri · ham P2002 · predicate'siz retry · boğaza taşıma) ─────

  // ── Muaf (kapalı küme) ──────────────────────────────────────────────────────
  [`${S}kartela.service.ts::reduceStock`]: { muaf: "ILK_YAZIM_TOKEN", neden: "SwatchStockReduction satırı tx'in ilk yazımı (plan §1 sınıf dışı)" },
  [`${S}helpers/goods-receipt-preflight.helper.ts::replayedTokens`]: { muaf: "ON_KONTROL_OKUYUCUSU", neden: "aşım toplamından tekrar edilen satırı düşer; satırın cevabı createInitialEntry'den" },
  [`${S}import/import.service.ts::apply`]: { muaf: "TOKEN_CLAIM_ONCE", neden: "ImportRun satırı koşumdan önce claim edilir (plan §1 sınıf dışı)" },
};

// =============================================================================
// TOKEN'SIZ KAYIT YARATAN UÇLAR — beyanlı istisna (kk1.md "Kayıt-yaratan uçlar clientToken taşır")
// =============================================================================
// Token'ı hiç görmeyen birim yukarıdaki taramaya girmez; bu yüzden token'sız doğan her kayıt-yaratan uç burada TEK
// satırdır ve satırın iddiası `test_token_replay_bogaz` §7'de ölçülür: uç var ve gövdesi strict (clientToken 400),
// servis birimi token'a dokunmaz, tx'in İLK await'i beyanlı kilit, tekillik kodu serviste ve istemcide.
// =============================================================================

/** KAPALI sınıf kümesi — yeni sınıf bekçide ve burada birlikte açılır. */
export const TOKENSIZ_UC_SINIFLARI = {
  /** Başarı cevabı o an üretilen ve saklanmayan bir sır taşır → replay 201'i yeniden üretemez; aynı denemenin ikinci
   *  kopyası kilitli tekillik yükleminden 409 alır, istemci sırrı ayrı uçtan yeniden verdirmeye yönlendirir. */
  SIR_DONEN_TEKIL: "cevap tekrar üretilemeyen sır taşır; kilitli tekillik yüklemi ikinci kaydı keser",
} as const;

export interface TokensizUc {
  sinif: keyof typeof TOKENSIZ_UC_SINIFLARI;
  /** `src/routes/…` (Teks-Erp köküne göre) ve `router.post` yolu. */
  rota: string;
  yol: string;
  /** `dosya::birim` — `$transaction` geri çağrısının ilk await'i `kilit` çağrısı, `tekillikKodu` birimde atılır. */
  servis: string;
  kilit: string;
  tekillikKodu: string;
  /** Tekillik kodunu ele alan istemci dosyası (repo köküne göre) — cevabı kaybeden kullanıcıya yolu gösterir. */
  istemci: string;
  neden: string;
}

export const TOKENSIZ_UCLAR: Record<string, TokensizUc> = {
  "POST /api/admin/factory-admin": {
    sinif: "SIR_DONEN_TEKIL",
    rota: "src/routes/admin.routes.ts",
    yol: "/factory-admin",
    servis: `${S}permission-management.service.ts::createFactoryAdmin`,
    kilit: "acquireAdminGuardLock",
    tekillikKodu: "FACTORY_ADMIN_EXISTS",
    istemci: "Electron/src/components/layout/FactoryAdminDialog.tsx",
    neden: "geçici parola yalnız 201'de döner, saklanmaz; cevap kaybolursa 409 → Kullanıcılar › Şifre Sıfırla",
  },
};

/**
 * KİMLİK BEYANI — her `tokenReplay` politikasının gövde kapısındaki alanlar (`identity`in `ad`leri), politikayı kuran
 * birimin adıyla. `test_token_replay_bogaz` §4b iki kümeyi BİREBİR kıyaslar: koddan alan silinir ya da beyansız eklenirse
 * kırmızı. ⚠️ Kimlik beyanından alan ÇIKARMAK 1e onayı ister ve gerekçesi commit mesajında yazılır (muaf listesiyle aynı
 * kural): alanı hem koddan hem beyandan silen değişiklik kapıdan geçer, gözden geçirmede görünür olmalıdır.
 */
export const KIMLIK_BEYANI: Record<string, readonly string[]> = {
  [`${S}cash-transaction.service.ts::cashTxnReplay`]: ["kind", "amount", "cashBoxId", "bankAccountId"],
  [`${S}cash-transaction.service.ts::transferReplay`]: ["fromCashBoxId", "fromBankAccountId", "toCashBoxId", "toBankAccountId", "amount"],
  [`${S}cheque-delivery-note.service.ts::noteReplay`]: ["chequeIds", "bankAccountId", "cariId", "targetLabel", "notes", "deliveryDate"],
  [`${S}cheque.service.ts::chequeReplay`]: ["kind", "amount", "dueDate", "taraf", "docType", "currency", "serialNo", "exchangeRate", "issueDate", "postingDate"],
  [`${S}goods-receipt.service.ts::receiptReplay`]: ["warehouseId", "purchaseOrderId", "deliveryNoteNo", "rawStockEntry", "currency", "taraf"],
  [`${S}inventory.service.ts::initialEntryReplay`]: ["itemId", "colorId", "initialQty"],
  [`${S}inventory.service.ts::openFabricReplay`]: ["parentReceiptId", "producedInStepId"],
  [`${S}invoice.service.ts::invoiceReplay`]: ["type", "taraf", "currency", "satırlar"],
  [`${S}machine-doff.service.ts::doffReplay`]: ["machineId", "productionLineNo", "pieceCount"],
  [`${S}machine-run.service.ts::runReplay`]: ["machineId", "productionLineNo", "weavingOrderId"],
  [`${S}order.service.ts::orderReplay`]: ["customerId", "branchId", "satırlar", "orderNumber"],
  [`${S}cloud-inbox.service.ts::inboxReceiptReplay`]: ["tur", "govdeOzeti"],
  [`${S}order.service.ts::quickOrderReplay`]: ["customerId", "branchId", "lines"],
  [`${S}packing-group.service.ts::groupReplay`]: ["customerId", "sackIds"],
  [`${S}payment.service.ts::paymentReplay`]: ["direction", "method", "amount", "cashBoxId", "bankAccountId", "taraf", "currency", "exchangeRate", "paymentDate"],
  [`${S}purchase-order.service.ts::poReplay`]: ["taraf", "satırlar", "currency", "orderDate", "expectedDate"],
  [`${S}sack-search.service.ts::pickListReplay`]: ["çuvallar"],
  [`${S}shipping.service.ts::sackReplay`]: ["customerId", "branchId", "packingGroupId", "packageNo"],
  [`${S}shipping.service.ts::shipmentReplay`]: ["customerId", "branchId", "toplar", "cuvallar"],
  [`${S}subcontractor-beam.service.ts::returnReplay`]: ["kind", "dispatchId", "warpBeamId", "lengthM"],
  [`${S}subcontractor-weaving.service.ts::weavingReceiptReplay`]: ["weavingOrderId", "manifestNo"],
  [`${S}subcontractor.service.ts::receiptReplay`]: ["workOrderId", "stepId", "subcontractorId", "toplar", "metrajlar", "yeniToplar"],
  [`${S}tambur-manual.service.ts::finishedRollReplay`]: ["itemId", "colorId", "initialQty"],
  [`${S}tambur-manual.service.ts::manualRollAttachedReplay`]: ["initialQty", "itemId", "colorId"],
  [`${S}tambur.service.ts::cutReplay`]: ["parentRollId", "cutLength"],
  [`${S}warehouse-transfer.service.ts::transferReplay`]: ["fromWarehouseId", "toWarehouseId", "toplar"],
  [`${S}warp-beam-consume.service.ts::consumeReplay`]: ["beamId", "kind", "lengthM"],
  [`${S}support.service.ts::replayFor`]: ["konu", "aciklama"],
  [`${S}license-acceptance.service.ts::replayFor`]: ["adSoyad", "unvan", "metinOzeti"],
  [`${S}update-approval.service.ts::replayFor`]: ["surum", "zamanlama", "onaylayan"],
  [`${S}warp-beam-mount.service.ts::mountReplay`]: ["beamId", "kind", "machineId", "mountPosition"],
  [`${S}warp-beam-wind.service.ts::windReplay`]: ["beamId", "kind", "lengthM"],
  [`${S}warp-beam.service.ts::warpBeamReplay`]: ["warpSpecId", "originKind", "plannedLengthM", "subcontractorId", "supplierId", "ownerCustomerId", "weavingOrderId", "physicalBeamNo"],
  [`${S}weaving-order.service.ts::weavingOrderReplay`]: ["itemId", "executionKind", "subcontractorId", "plannedM", "colorId", "sipariş satırları", "warpSpecId"],
  [`${S}workorder-batch-add.service.ts::batchReplay`]: ["workOrderId", "missingRolls"],
  [`${S}workorder.service.ts::quickStartReplay`]: ["targetItemId", "orderLines"],
  [`${S}workorder.service.ts::woReplay`]: ["orderLines", "targetItemId", "type"],
};
