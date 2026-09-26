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
  [`${S}order.service.ts::prepareOrderCreate`]: { giris: { [`${S}order.service.ts::create`]: "R", [`${S}order.service.ts::quickOrderTx`]: "K" } },
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

  // ── Borç: D5 (4. durum eksikleri · ham P2002 · predicate'siz retry · boğaza taşıma) ─────
  [`${S}warp-beam.service.ts::createWarpBeam`]: { borc: "D5", not: "yarışta ham P2002 (retry yalnız beamNo)" },
  [`${S}weaving-order.service.ts::createWeavingOrder`]: { borc: "D5", not: "yarışta ham P2002 (§5-1)" },
  [`${S}subcontractor-weaving.service.ts::receiveForWeaving`]: { borc: "D5", not: "yarışta ham P2002 (§5-1)" },
  [`${S}subcontractor-weaving.service.ts::findReceiptReplay`]: { borc: "D5", not: "fason dokuma kabul okuyucusu" },
  [`${S}machine-doff.service.ts::openDoff`]: { borc: "D5", not: "boğaza taşıma" },
  [`${S}machine-doff.service.ts::findByToken`]: { borc: "D5", not: "doff okuyucusu" },
  [`${S}inventory.service.ts::createInitialEntry`]: { borc: "D5", not: "sınıf dışı (ön-okuma yok, P2002 yeniden okur); boğaza taşıma" },
  [`${S}inventory.service.ts::createOpenFabric`]: { borc: "D5", not: "sınıf dışı; boğaza taşıma" },
  [`${S}tambur-manual.service.ts::createManualRoll`]: { borc: "D5", not: "ön-okuma yalnız 4. durum; createInitialEntry'ye iletir" },
  [`${S}tambur-manual.service.ts::produceFinishedRoll`]: { borc: "D5", not: "ön-okuma yalnız 4. durum; createInitialEntry'ye iletir" },
  [`${S}helpers/manifest-number.helper.ts::recordSackPickList`]: { borc: "D5", not: "toplama listesi günlüğü; boğaza taşıma" },

  // ── Muaf (kapalı küme) ──────────────────────────────────────────────────────
  [`${S}kartela.service.ts::reduceStock`]: { muaf: "ILK_YAZIM_TOKEN", neden: "SwatchStockReduction satırı tx'in ilk yazımı (plan §1 sınıf dışı)" },
  [`${S}helpers/goods-receipt-preflight.helper.ts::replayedTokens`]: { muaf: "ON_KONTROL_OKUYUCUSU", neden: "aşım toplamından tekrar edilen satırı düşer; satırın cevabı createInitialEntry'den" },
  [`${S}import/import.service.ts::apply`]: { muaf: "TOKEN_CLAIM_ONCE", neden: "ImportRun satırı koşumdan önce claim edilir (plan §1 sınıf dışı)" },
};
