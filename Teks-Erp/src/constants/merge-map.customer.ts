// =============================================================================
// BİRLEŞTİRME HARİTASI — Müşteri bacağı
// =============================================================================
// ⚠️ SÖZLEŞME DEĞİŞMEDİ: bu dosya yalnız SATIRLARI taşır. `MERGE_MAP` tek nesne
// olarak `merge-map.ts`ten çıkmaya devam eder ve `master-data-merge.service`in
// jenerik sürücüsü (`MERGE_MAP[entity]` döngüsü) hiçbir değişiklik görmez.
//
// NEDEN BÖLÜNDÜ (2026-09-13): dosya `max-lines` sınırına (300) dayandı ve içinde
// DÖRT AYRI İŞ vardı — dört birleştirilebilir varlığın kuralları. Tavan burada
// gerçek bir dikiş gösterdi; her yeni model haritayı büyüteceği için (dokuma P2/P3)
// tavanı yükseltmek sınırı anlamsızlaştırırdı.
// =============================================================================
import type { MoveRule } from "./merge-map";

export const CUSTOMER_MERGE_RULES: MoveRule[] = [
    { kind: "MOVE", model: "Order", table: "orders", column: "customerId", label: "Sipariş" },
    // MAL-4: teklif cariye bağlı belge — kimlik değişir, belge değişmez. Fiyat listesinde müşteri+döviz başına
    // TEK yayınlı liste (partial unique) olduğundan iki carinin yayınlı listesi aynı dövizde çakışabilir → BLOCK.
    { kind: "MOVE", model: "SalesQuote", table: "sales_quotes", column: "customerId", label: "Satış teklifi" },
    {
      kind: "CONFLICT",
      model: "PriceList",
      table: "price_lists",
      column: "customerId",
      label: "Fiyat listesi",
      uniqueOn: ["customerId", "currency"],
      policy: "BLOCK",
      why: "Cari+döviz başına tek YAYINLI liste; iki carinin yayınlı listesi tek cariye taşınamaz — hangisinin geçerli kalacağı satış kararıdır (MAL-4).",
    },
    { kind: "MOVE", model: "WarpBeam", table: "warp_beams", column: "supplierId", label: "Levent (hazır alım tedarikçisi)" },
    { kind: "MOVE", model: "YarnLot", table: "yarn_lots", column: "supplierId", label: "İplik lotu (tedarikçi)" },
    { kind: "MOVE", model: "Shipment", table: "shipments", column: "customerId", label: "Sevkiyat" },
    { kind: "MOVE", model: "DirectShipment", table: "direct_shipments", column: "customerId", label: "Doğrudan sevkiyat" },
    { kind: "MOVE", model: "RollReturn", table: "roll_returns", column: "customerId", label: "İade" },
    { kind: "MOVE", model: "Sack", table: "sacks", column: "customerId", label: "Çuval" },
    // Paketleme grubu (çalışma yaftası) da TAŞINIR: grup cariye özeldir ve
    // birleştirilen carinin açık hazırlıkları kaybolmamalı. Çuvallar `sacks`
    // satırıyla zaten taşınıyor; grup kaydı taşınmasaydı FK, birleştirmede
    // ölmüş bir cariye bakar kalırdı.
    { kind: "MOVE", model: "PackingGroup", table: "packing_groups", column: "customerId", label: "Paketleme grubu" },
    { kind: "MOVE", model: "Roll", table: "rolls", column: "labelCustomerId", label: "Top (etiket müşterisi)" },
    // 2026-09-15 (G3 emanet) — mülkiyet bağı üç modelde: referans bağ, tekillik yok; birleştirme kimliği değiştirir, sahipliği değil.
    { kind: "MOVE", model: "Roll", table: "rolls", column: "ownerCustomerId", label: "Top (emanet sahibi)" },
    { kind: "MOVE", model: "WarpBeam", table: "warp_beams", column: "ownerCustomerId", label: "Levent (emanet sahibi)" },
    { kind: "MOVE", model: "YarnLot", table: "yarn_lots", column: "ownerCustomerId", label: "İplik lotu (emanet sahibi)" },
    { kind: "MOVE", model: "Route", table: "routes", column: "customerId", label: "Rota şablonu" },
    {
      kind: "CONFLICT",
      model: "CustomerBranch",
      table: "customer_branches",
      column: "customerId",
      label: "Şube",
      uniqueOn: ["customerId", "code"],
      policy: "BLOCK",
      why:
        "Şube kodu gümrük belgesine basılan İHRACAT KODUDUR. NULL'lamak da son ek uydurmak da " +
        "basılan değeri değiştirir; doğru değeri yalnız operatör bilir. NULL kodlu şubeler " +
        "PG'de çakışmaz — onlar serbestçe taşınır, blok yalnız NOT NULL çakışmasında.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerItemAlias",
      table: "customer_item_aliases",
      column: "customerId",
      label: "Müşteri ürün adı",
      uniqueOn: ["customerId", "itemId"],
      policy: "SKIP",
      why:
        "Alias fiziksel ETİKETE basılıyor; survivor'ınki ŞU ANDA doğru basıyor. Kaynağınkini " +
        "üstüne yazmak, çalışan bir etiketi sessizce değiştirmek olurdu. Hedefte ad yoksa ve " +
        "birden çok kaynakta varsa sıradaki İLK kaynağınki kalır — önizleme sırayı adlarıyla " +
        "söyler. Atılan değer defterde fotoğraflıdır; geri alma onu geri yazar.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerColorAlias",
      table: "customer_color_aliases",
      column: "customerId",
      label: "Müşteri renk adı",
      uniqueOn: ["customerId", "colorId"],
      policy: "MERGE_FIELDS",
      why:
        "Düz SKIP burada YANLIŞ: `assigned` bayrağı 'bu renk bu müşteriye atanmış' demek. " +
        "Kaynağa atanmış bir renk survivor'da atanmamışsa, SKIP o rengi survivor'ın " +
        "'Müşteri Renkleri' listesinden DÜŞÜRÜR ve picker'da görünmez olur. " +
        "Doğrusu alan alan: assigned = OR, alias = COALESCE(survivor, kaynak).",
    },
    {
      kind: "CONFLICT",
      model: "CustomerItemColorAlias",
      table: "customer_item_color_aliases",
      column: "customerId",
      label: "Müşteri kumaşa özel renk adı",
      uniqueOn: ["customerId", "itemId", "colorId"],
      policy: "SKIP",
      why:
        "Ad etikete/irsaliyeye basılıyor; survivor'ınki ŞU ANDA doğru basıyor (CustomerItemAlias " +
        "emsali). ⚠️ GÖLGELEME: çakışmadan TAŞINAN satır survivor'ın GENEL renk adını o kumaşta " +
        "gölgeler ve çıktı sessizce değişir (A2'nin (X, Ekru)='P'si taşınınca A'nın X etiketi " +
        "genel addan 'P'ye döner) — önizleme bu satırları kayıt başına listeler. Hedefte yoksa " +
        "ve birden çok kaynakta varsa sıradaki İLK kaynağınki kalır.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerTemplateRoute",
      table: "customer_template_routes",
      column: "customerId",
      label: "Belge şablon yönlendirmesi",
      uniqueOn: ["customerId", "kind"],
      policy: "SKIP",
      why:
        "Hangi şablonun basılacağı — survivor'ın ayarı son bilinçli karardır. " +
        "⚠️ Anahtar `templateId` DEĞİL `kind` (LabelKind); iki müşteri aynı türü farklı " +
        "şablona yönlendirmiş olabilir.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerStandaloneLabel",
      table: "customer_standalone_labels",
      column: "customerId",
      label: "Serbest etiket bağı",
      uniqueOn: ["customerId", "templateId"],
      policy: "UNION",
      why: "Saf M:N kolaylık bağı — birleşim kayıpsız ve doğru anlam.",
    },
    // —— Ticaret / ön muhasebe bacağı ——————————————————————————————————————
    // Bu dört FK ana veri birleştirmesinden SONRA main'e girdi (finans + satın
    // alma paketleri) ve haritaya hiç yazılmamıştı: birleştirme onları sessizce
    // atlıyor, satırlar tombstone bir müşteriye bakmaya devam ediyordu.
    { kind: "MOVE", model: "GoodsReceipt", table: "goods_receipts", column: "supplierId", label: "Mal kabul fişi (tedarikçi)" },
    { kind: "MOVE", model: "PurchaseOrder", table: "purchase_orders", column: "supplierId", label: "Alış siparişi (tedarikçi)" },
    // Fason = carinin rolü (2026-09-17): profil kolonun kendisinde tekil (`Subcontractor.customerId @unique`).
    // Tek taraflıysa profil survivor'a TAŞINIR; iki kartın da profili varsa 409 — sessiz SetNull/sıfırlama YOK,
    // önce fason profilleri (Fason Firmalar → birleştir) birleştirilir.
    {
      kind: "CONFLICT",
      model: "Subcontractor",
      table: "subcontractors",
      column: "customerId",
      label: "Fason profili",
      uniqueOn: ["customerId"],
      policy: "BLOCK",
      why:
        "İki kartın da fason profili var — önce profilleri birleştirin. Fason profili sevk/kabul " +
        "tarihçesinin sahibidir; iki profili tek karta bağlamak kısıtla imkânsız, birini sessizce " +
        "koparmak ise tarihçeyi öksüz bırakır.",
    },
    {
      kind: "CONFLICT",
      model: "CariAccount",
      table: "cari_accounts",
      column: "customerId",
      label: "Cari hesap",
      uniqueOn: ["customerId"],
      policy: "BLOCK",
      why:
        "İki cari hesabın birleşmesi DEFTER kararıdır, taşıma değil: bakiye, para birimi ve " +
        "hareket geçmişi iki ayrı hesapta yaşıyor ve doğru kapanış yalnız muhasebenin bileceği " +
        "bir mahsup/virman belgesidir. Kısıt kolonun KENDİSİNDE (`customerId @unique`), yani " +
        "çakışma ancak İKİ tarafın da hesabı varsa doğar; tek taraflıysa satır serbestçe taşınır.",
    },
    {
      kind: "CONFLICT",
      model: "FourPointRuleSet",
      table: "four_point_rule_sets",
      column: "customerId",
      label: "4 puan müşteri kural seti",
      uniqueOn: ["customerId", "itemId"],
      crossSourceOn: { columns: ["itemId"], nullSafe: ["itemId"] },
      policy: "BLOCK",
      why:
        "Müşteri spesifikasyonu sevk muayene özetinin ve muayene raporunun kararını verir; iki " +
        "setten hangisinin geçerli olduğunu yalnız kalite sorumlusu bilir (K4P). Anahtar iki " +
        "partial UNIQUE'in (`customer_uq` itemId NULL · `customer_item_uq`) birleşimidir; pasif " +
        "setler de bloklar — bilinçli fail-closed.",
    },
    {
      kind: "CONFLICT",
      model: "CustomerLabSpec",
      table: "customer_lab_specs",
      column: "customerId",
      label: "Müşteri lab spesifikasyonu",
      uniqueOn: ["customerId", "itemId", "testTypeId"],
      crossSourceOn: { columns: ["itemId", "testTypeId"], nullSafe: ["itemId"] },
      policy: "BLOCK",
      why:
        "Aynı test türüne iki ayrı sınır yazılmışsa birleşmiş müşteride hangisinin geçerli olduğunu " +
        "yalnız kalite sorumlusu bilir (K4P-SERT); iki partial UNIQUE'in birleşimi, pasifler de bloklar.",
    },
    { kind: "MOVE", model: "LabTest", table: "lab_tests", column: "customerId", label: "Lab testi (müşteri)" },
    { kind: "MOVE", model: "Certificate", table: "certificates", column: "partnerId", label: "Sertifika (iş ortağı)" },
    // Gelen belge (D2): sahip/gönderen cari; partial unique (ownerCustomerId, senderDocNo) DRAFT dışı
    // belgede çakışabilir — "aynı belge no iki sahipten" nadir, BLOCK ile görünür kılınır.
    {
      kind: "CONFLICT",
      model: "CustomerDeliveryNote",
      table: "customer_delivery_notes",
      column: "ownerCustomerId",
      label: "Gelen belge (sahip)",
      uniqueOn: ["ownerCustomerId", "senderDocNo"],
      policy: "BLOCK",
      why: "Aynı gönderen belge numarası iki sahipte varsa birleştirme hangisinin gerçek olduğunu bilemez; kullanıcı önce birini iptal eder.",
    },
    { kind: "MOVE", model: "CustomerDeliveryNote", table: "customer_delivery_notes", column: "senderCustomerId", label: "Gelen belge (gönderen)" },
    { kind: "MOVE", model: "SenderTemplate", table: "sender_templates", column: "senderCustomerId", label: "Gönderen şablonu" },
    { kind: "MOVE", model: "SenderTemplate", table: "sender_templates", column: "defaultOwnerCustomerId", label: "Gönderen şablonu (varsayılan sahip)" },
    {
      kind: "CONFLICT",
      model: "DeliveryNoteAlias",
      table: "delivery_note_aliases",
      column: "senderCustomerId",
      label: "Gelen belge eşleme sözlüğü",
      uniqueOn: ["scope", "senderCustomerId", "rawKey"],
      policy: "SKIP",
      why: "Aynı ham metin iki gönderende de eşlenmişse survivor'daki eşleme kalır; kaynağınki düşer (sözlük yeniden öğrenir).",
    },
    {
      kind: "CONFLICT",
      model: "ItemPrice",
      table: "item_prices",
      column: "customerId",
      label: "Müşteri fiyat istisnası",
      uniqueOn: ["itemId", "customerId", "kind", "currency"],
      // Partial UNIQUE yalnız aktif satırda: damgalı fiyat geçmişi serbestçe taşınır (MAL-0b).
      activeWhenNull: ["revokedAt"],
      policy: "BLOCK",
      why:
        "Hangi fiyatın geçerli olduğunu yalnız operatör bilir — biri sessizce silinirse fatura " +
        "yanlış tutarla kesilir. Anahtar `item_price_customer_uq` ile birebir; kart varsayılanı " +
        "(customerId IS NULL) bu kolonun kaynak kümesine zaten girmez.",
    },
];
