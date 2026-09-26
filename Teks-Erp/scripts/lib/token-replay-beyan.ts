// =============================================================================
// clientToken YOLLARI — BEYAN (tek kaynak) · bekçi: `test_token_replay_bogaz`
// =============================================================================
// Token yazan (ya da `where: { clientToken }` ile okuyan) her fonksiyon birimi burada TEK satırdır:
//   giris  — boğazdan geçer (`tokenReplay`): anahtar kipi çağıran birim, değer kip (R · K · K′)
//   helper — tek yazar helper'ı; replay kararı çağıranındır (çağıran ayrıca beyanlı)
//   borc   — henüz boğazda değil; dilim adıyla (`docs/design/TOKEN-REPLAY-KILIDI.md` §4). CIRCIR: yalnız düşer.
//   muaf   — KAPALI sınıf kümesi (`MUAF_SINIFLARI`), gerekçeli
// `tokenReplay({ find })` politikası ve politikanın çağırdığı okuyucu kendiliğinden beyanlıdır.
// =============================================================================

export const MUAF_SINIFLARI = {
  /** Token satırı tx'in İLK yazımı: kaybeden ilk ifadede P2002 alır, arada iş kuralı yok. */
  ILK_YAZIM_TOKEN: "token satırı tx'in ilk yazımı",
  /** Token koşumdan ÖNCE claim edilir (tek satır), iş ona bağlı yürür. */
  TOKEN_CLAIM_ONCE: "token işten önce claim edilir",
  /** Yalnız token'sız yolun dalı (token gelirse satır zaten vardır). */
  TOKENSIZ_DAL: "token'sız dal",
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

  // ── Borç: D3 (plan §4 — kalan (a) yolları) ──────────────────────────────────
  [`${S}shipping.service.ts::createShipment`]: { borc: "D3", not: "#1" },
  [`${S}shipping.service.ts::readCreateShipmentReplay`]: { borc: "D3", not: "#1/#2 okuyucu" },
  [`${S}shipping.service.ts::createShipmentFromRolls`]: { borc: "D3", not: "#2" },
  [`${S}warp-beam-mount.service.ts::mountBeam`]: { borc: "D3", not: "#3" },
  [`${S}warp-beam-wind.service.ts::windWarpBeam`]: { borc: "D3", not: "#4" },
  [`${S}subcontractor-beam.service.ts::returnWarpBeam`]: { borc: "D3", not: "#5" },
  [`${S}machine-run.service.ts::openMachineRun`]: { borc: "D3", not: "#7" },
  [`${S}machine-run.service.ts::findByToken`]: { borc: "D3", not: "#7 okuyucu" },
  [`${S}workorder.service.ts::create`]: { borc: "D3", not: "#12 (quickStart iş emri doğumu)" },
  [`${S}workorder.service.ts::quickStart`]: { borc: "D3", not: "#12" },
  [`${S}workorder.service.ts::resolveCreateTokenReplay`]: { borc: "D3", not: "#12 okuyucu; 4. durum yalnız isActive" },
  [`${S}workorder-batch-add.service.ts::addBatch`]: { borc: "D3", not: "#13" },
  [`${S}workorder-batch-add.service.ts::addBatchToWorkOrderTx`]: { borc: "D3", not: "#13 yazar" },
  [`${S}packing-group.service.ts::createWithSacks`]: { borc: "D3", not: "#14" },
  [`${S}packing-group.service.ts::replayCreateWithSacks`]: { borc: "D3", not: "#14 okuyucu" },
  [`${S}shipping.service.ts::openSack`]: { borc: "D3", not: "#15" },
  [`${S}shipping.service.ts::readOpenSackReplay`]: { borc: "D3", not: "#15 okuyucu" },
  [`${S}warehouse-transfer.service.ts::create`]: { borc: "D3", not: "#16; predicate'siz retry (§5-2)" },
  [`${S}invoice.service.ts::createDraft`]: { borc: "D3", not: "#17; 4. durum yok" },

  // ── Borç: D5 (4. durum eksikleri · ham P2002 · predicate'siz retry · boğaza taşıma) ─────
  [`${S}payment.service.ts::create`]: { borc: "D5", not: "4. durum yok (CANCELLED)" },
  [`${S}cheque.service.ts::create`]: { borc: "D5", not: "4. durum yok" },
  [`${S}purchase-order.service.ts::create`]: { borc: "D5", not: "4. durum yok" },
  [`${S}goods-receipt.service.ts::create`]: { borc: "D5", not: "4. durum yok; predicate'siz retry (§5-2)" },
  [`${S}helpers/goods-receipt-preflight.helper.ts::replayedTokens`]: { borc: "D5", not: "mal kabul ön kontrol okuyucusu" },
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
  [`${S}import/import.service.ts::apply`]: { muaf: "TOKEN_CLAIM_ONCE", neden: "ImportRun satırı koşumdan önce claim edilir (plan §1 sınıf dışı)" },
};
