// =============================================================================
// TeksERP - System Setting / keys (devere bloğu; arasındaki emanet + kalite güvence dahil)
// =============================================================================
// `keys.ts` 300 satır tavanını aştığı için devere anahtarları buraya ayrıldı (davranış aynı);
// SETTING_KEYS bu nesneyi yayar, dışa açık ad yine yalnız cepheden okunur.
// =============================================================================

export const DEVERE_SETTING_KEYS = {
  /** Devere / levent modülü: çözgü kartı · levent stoğu · levent olay defteri.
   *  ⚠️ İPLİĞE BAĞIMLI (`MODULE_DEPENDENCIES`), o da ticarete: levent doğarken
   *  iplik kg defterine çıkış yazılır (`WARP_ISSUE`). Zincir OKUMA kapısında
   *  ELLE ölçülür (`requireDevereEnabled`), tablo geçişli kapanış üretmez. */
  DEVERE_ENABLED: "devere.enabled",
  /** G3 EMANET (konsinye mülkiyet): `ownerCustomerId` yazılabilir mi (top · levent · iplik lotu). Bağımlılık YOK
   *  (Customer çekirdek). Ekransız modül: kapı owner YAZAN uçların gövdesinde (403); sevk sahiplik kapısı veri varsa
   *  bayraktan bağımsız çalışır. Varsayılan KAPALI = dünkü davranış (sahiplik alanı yoktu). */
  EMANET_ENABLED: "emanet.enabled",
  /** F1b emanet varsayılan deposu (Warehouse.id): sahipli (emanet) top depo söylenmeden doğunca buraya girer. Boş = bugünkü
   *  davranış (varsayılan depo); emanet kapalıyken etkisiz. Feature-flag yükünde DÖNMEZ; tek yazar
   *  `PUT /api/feature-flags/emanet-default-warehouse` (pasif/olmayan depo 400), ham ayar ucu reddeder. */
  EMANET_DEFAULT_WAREHOUSE_ID: "emanet.defaultWarehouseId",
  /** K4P Kalite Güvence (4 puan muayene · lab testi · sertifika). Bağımlılık YOK: muayene KK1'de doğar ve KK1
   *  üretim kapalıyken de açıktır. Varsayılan KAPALI = dünkü davranış (yüzey yoktu). */
  KALITE_GUVENCE_ENABLED: "kaliteGuvence.enabled",
  /** [PROFİL] Devere Faz 2: içeride sarımda iplik çıkış satırı ve mal kabul iplik satırı LOT
   *  ZORUNLU mu. DEFAULT false = bugünkü davranış (lot kaydı bayraksız her kurulumda mümkün,
   *  lotsuz satır yalnız UYARI). Davranış bayrağı — profile/modül tablosuna GİRMEZ. */
  DEVERE_LOT_REQUIRED: "devere.lotRequired",
  /** [PROFİL] Devere Faz 3: levent TEZGAH BAĞI defteri (tak · sök · tüket · düzelt · bitir · hurda).
   *  DEFAULT false = bugünkü davranış: levent READY'de kalır, tezgah bağı yok; uçlar 409
   *  `WARP_MOUNT_TRACKING_OFF` (durum, yetki değil). Davranış bayrağı — profile/modül tablosuna GİRMEZ. */
  DEVERE_MOUNT_TRACKING: "devere.mountTracking",
  /** [PROFİL] Devere Faz 3 (#16): bağlamada yöntem + başlangıç saati ZORUNLU mu. DEFAULT false. */
  DEVERE_MOUNT_TRACKING_REQUIRED: "devere.mountTrackingRequired",
  /** [PROFİL] Devere Faz 4: tezgahtan doğan top (KK1 WEAVING + doff bağı) bağlı leventlerden OTOMATİK
   *  tüketim düşer mi (`CONSUMED.rollId`). DEFAULT false = bugünkü davranış: tüketim elle yazılır, KK1
   *  yanıtı bayt bayt aynı. Davranış bayrağı — profile/modül tablosuna GİRMEZ. */
  DEVERE_AUTO_CONSUME: "devere.autoConsume",
  /** [PROFİL] Fason devere D1: çözgü hesabında sipariş başına SABİT fire metresi (baş/son/düğüm). DEFAULT 0 =
   *  müşterinin kâğıttaki formülü (firesiz); yalnız öneriyi büyütür, hiçbir defteri değiştirmez. */
  DEVERE_WARP_FIXED_WASTE_M: "devere.warpFixedWasteM",
  /** [PROFİL] Devere-levent S1: devere geçmişi olmayan çözgü kartı için yedek teslim süresi (gün). DEFAULT 0 = yok →
   *  "devereye ver" günü ölçülemedi (bugünkü yanıt: alan yok). Yalnız rapor tahminini besler, hiçbir şeyi engellemez. */
  DEVERE_DEFAULT_LEAD_DAYS: "devere.defaultLeadDays",
  /** [PROFİL] Devere-levent S4: "N+ gündür dolu bekliyor" levent eşiği (gün). DEFAULT 14 = bugünkü sabit; yalnız
   *  özet şeridi + hücre rengi, hiçbir şeyi engellemez. */
  DEVERE_STALE_FULL_BEAM_DAYS: "devere.staleFullBeamDays",
  /** [PROFİL] Devere-levent S4: "N+ gündür dışarıda" gövde eşiği (gün). DEFAULT 30 = bugünkü sabit; yalnız bilgi. */
  DEVERE_STALE_OUT_BODY_DAYS: "devere.staleOutBodyDays",
  /** [PROFİL] Fason devere D4: kapamada fire % toleransı — sipariş açılırken DONAR. DEFAULT 0 = denetim yok
   *  (bugünkü davranış); aşım yalnız UYARIR, hiçbir işlemi engellemez. */
  DEVERE_FASON_WASTE_TOLERANCE_PCT: "devere.fasonWasteTolerancePct",
  /** [PROFİL] Fason devere D4b (K4): siparişte iplik başına lot karışımı — `FREE` serbest · `WARN` uyarı (VARSAYILAN,
   *  kullanıcı kararı 2026-11-17) · `SINGLE_LOT` ikinci lot 409. Enum; kalıp `DEVERE_FASON_LOT_POLICIES`. */
  DEVERE_FASON_LOT_POLICY: "devere.fasonLotPolicy",
  /** [PROFİL] Devere ek B1: levent gövdesi envanteri — `OFF` (VARSAYILAN, bugünkü davranış) · `OPTIONAL` · `REQUIRED`.
   *  Enum; kalıp `DEVERE_BEAM_BODY_MODES`; OFF'ta gövde uçları 403 `BEAM_BODY_MODE_OFF`. */
  DEVERE_BEAM_BODY_MODE: "devere.beamBodyMode",
  /** [PROFİL] Devere ek B1: gövde–tezgâh uyumsuzluğu — `WARN` (VARSAYILAN) · `BLOCK`. Enum; kalıp `DEVERE_BEAM_BODY_MACHINE_FITS`. */
  DEVERE_BEAM_BODY_MACHINE_FIT: "devere.beamBodyMachineFit",
  /** [PROFİL] Devere H1: kapanış önizlemesinde kalan ipliğin varsayılan önerisi — `WASTE_UP_TO_PLAN` (VARSAYILAN, A1-a) ·
   *  `KEEP` · `RETURN` · `WASTE_ALL`. Enum; kalıp `DEVERE_SETTLE_DEFAULTS` (`devere-settle.ts`). */
  DEVERE_SETTLE_DEFAULT: "devere.settleDefault",
  /** [PROFİL] Devere-levent S5: panelde kabul kaydedilince A6 levent kartları — `OFF` (VARSAYILAN, bugün) · `ASK` öner ·
   *  `ALWAYS` doğrudan toplu basım. Enum; kalıp `DEVERE_BEAM_CARD_AUTO_PRINTS` (`devere-beam-card.ts`). Yalnız panel okur. */
  DEVERE_BEAM_CARD_AUTO_PRINT: "devere.beamCardAutoPrint",
  /** [PROFİL] Devere A1: deverecinin kendi kusuruyla yeniden sardığı levent beklenen ücrete girer mi. DEFAULT true
   *  (kullanıcı kararı 2026-11-20; bugün yeniden sarım işareti yok → beklenen bayt-aynı). Yalnız UYARI hesabını etkiler. */
  DEVERE_REWORK_BILLABLE: "devere.reworkBillable",
  /** [PROFİL] Devere ek C1: kusurlu levent reddinde fotoğraf zorunlu mu (DEFAULT false = bugün: ret fotoğrafsız da
   *  yazılır). Açıkken fotoğrafsız ret 400 `WARPING_REJECT_PHOTO_REQUIRED`; okuma aksiyon anında. */
  DEVERE_REJECT_PHOTO_REQUIRED: "devere.rejectPhotoRequired",
  /** [PROFİL] Devere S3: gövde no esnek eşleşme (DEFAULT false = bugün: büyük/küçük harf duyarsız birebir). Açıkken
   *  birebir yoksa `beamBodyNoKey` (ayraç at, baştaki sıfırları at) ile eşleşir; tek kaynak `utils/beam-body-no.ts`. */
  DEVERE_BODY_NO_LOOSE_MATCH: "devere.bodyNoLooseMatch",
  /** [PROFİL] Devere S3: tartılı levent bitişinde dara boşsa gövde darası kullanılır (DEFAULT false = bugün: dara yoksa
   *  artık ESTIMATED 0). Okuma aksiyon anında (`exhaustBeam`). */
  DEVERE_RESIDUAL_TARE_FROM_BODY: "devere.residualTareFromBody",
  /** [PROFİL] Devere ek E1: aynı deverecide kullanılmış irsaliye no ile yeni kabul — `ALLOW` · `WARN` (VARSAYILAN, KARAR 5)
   *  · `BLOCK` 409 `WARPING_DELIVERY_NOTE_USED`. Enum; kalıp `DEVERE_DUPLICATE_DELIVERY_NOTE_MODES` (`devere-receive.ts`). */
  DEVERE_DUPLICATE_DELIVERY_NOTE: "devere.duplicateDeliveryNote",
  /** [PROFİL] Devere ek E1: dönüş kabulünde tartı — `OFF` · `OPTIONAL` (VARSAYILAN, bugün) · `REQUIRED` (brütsüz satır 400).
   *  Enum; kalıp `DEVERE_RECEIVE_WEIGHING_MODES` (`devere-receive.ts`). */
  DEVERE_RECEIVE_WEIGHING: "devere.receiveWeighing",
  /** [PROFİL] Devere F1: denye sapma raporunda öneri için iplik başına en az tek iplikli tartılı levent (DEFAULT 3,
   *  kullanıcı kararı 2026-11-20). Yalnız raporun öneri sütununu etkiler; kartı hiçbir şey otomatik değiştirmez. */
  DEVERE_DENIER_SUGGEST_MIN_BEAMS: "devere.denierSuggestMinBeams",
  /** [PROFİL] Devere F1: denye önerisi sapma eşiği % (DEFAULT 2; eşiği AŞAN sapma öneri doğurur). Yalnız rapor. */
  DEVERE_DENIER_SUGGEST_THRESHOLD_PCT: "devere.denierSuggestThresholdPct",
} as const;
