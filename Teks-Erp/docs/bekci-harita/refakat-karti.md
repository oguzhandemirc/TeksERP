## refakat-karti

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Electron/src/pages/GeneralSettings/travelerCardFields.test.ts` | Panelin TEK tablosu arkada İKİ AYRI DEPOYA yazar (`config.fields` ve `config.specFields/orderFields/batchFields/*Total`) — `readRow`/`writeRow` doğru  |  |  |  |
| `Electron/src/services/print-event-toast.test.ts` | 'Basildi' bildirimleri (print-event) GENEL hata toast'ini tetiklemez: iki istek de `suppressErrorToast` tasir; yoksa kagit elde dururken 'Sunucu hatas |  |  |  |
| `Teks-Erp/scripts/test_batch_drop.ts` | Parti düşürmeyi kilitler: WO devam eder, renge duyarlı geri çekme (renkli top depoya), STOCK/SCRAP koparılır CANCELLED partide kalır, izsiz parti sili | ✓ |  |  |
| `Teks-Erp/scripts/test_batch_redye_three_paths.ts` | REDYE_SAME_COLOR ayırmasını uçtan uca kilitler (aynı WO'da yeni partiye ayrılıp boyahane adımına geri sarma + renk sıfırlama); NEW_COLOR yalnız kapı-k | ✓ |  |  |
| `Teks-Erp/scripts/test_client_token_idempotency.ts` | clientToken sözleşmesi: replay aynı kaydı döner (tek sipariş / tek WO + TEK refakat kartı / N iptal), farklı payload 409, quickStart'ta isActive korun | ✓ |  |  |
| `Teks-Erp/scripts/test_consecutive_fason.ts` | Rotada ardışık iki fason adımı (Boyahane→Zımpara): ilkine sevk+kabul ikinci fason adımını 'geçmiş' saymaz, top ikincide bekler. | ✓ |  | ⚠️ Fixture hata mesajı yanlış komutu işaret ediyor (kapı değil, yön tarifi bayat). |
| `Teks-Erp/scripts/test_controller_binds.ts` | Bind desenini kullanan bir controller'da route'a çıplak referansla geçilen HER handler bağlanmış olmalı (this kaybı = her çağrıda sessiz 500). |  | ✓ |  |
| `Teks-Erp/scripts/test_direct_ship_fason.ts` | executeDirectShip ana akışı: toplar SUBCONTRACTOR_CONSUMED, fason adımı COMPLETED + sonraki SKIPPED, WO+kart COMPLETED, donmuş PrintedDocument, sipari | ✓ |  |  |
| `Teks-Erp/scripts/test_doc_render_html.ts` | Üç saf renderer'ın (kartela çeki, fasondan doğrudan sevk, refakat kartı) HTML format regresyonunu kilitler — bölüm aç/kapa, A5, kenar boşluğu, punto ö |  |  |  |
| `Teks-Erp/scripts/test_doc_sample_html.ts` | renderSampleHtml önizleme yolu: her belge tipi REGISTRY'de kayıtlı, örnek doc şekli renderer'la uyumlu, docConfig ezmesi akıyor, TASLAK filigranı ve r | ✓ |  |  |
| `Teks-Erp/scripts/test_document_template_permission.ts` | document-template:read/write kapsamı: PATCH /feature-flags anahtar-kapsamlı guard, admin:settings supabı, READ⊇WRITE, Electron izin aynası. |  |  |  |
| `Teks-Erp/scripts/test_fason_ceki_draft.ts` | previewDownstreamFasonCeki erken TASLAK boyahane çekisi üretir ve hiçbir durumu DEĞİŞTİRMEZ; önceki fasonda mal yoksa reddedilir. | ✓ |  |  |
| `Teks-Erp/scripts/test_fason_open_dispatch_semantics.ts` | 'Açık + outstanding fason sevk' koşulunun DAVRANIŞI: kabul iptali sonrası yeniden outstanding, tam ve alt küme doğrudan-sevk sonrası kapalı — üç yüzeyde (WO liste | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_input_rolls_directship.ts` | WO detayındaki 'Üretime Giren' (inputRolls) SAYIMININ fasondan-kısmi-sevk çocuk topuyla şişmediğini; ebeveynin `initialQty` giriş snapshot'ının DOKUNULMADIĞINI ve charge'ın kökte tam durduğunu | ✓ |  |  |
| `Teks-Erp/scripts/test_manual_move_fason_receive.ts` | Konumu Düzelt içindeki inline Fason Kabul: preview.openDispatches → receive ile orijinaller SUBCONTRACTOR_CONSUMED, dönen parçalar yeni açık-kumaş top | ✓ |  |  |
| `Teks-Erp/scripts/test_manual_move_field_continuity.ts` | Taşıma sonrası saha sürekliliği: fason dönüşü top geri boyahanede sevk/kabul edilebilir, Tambur→Kurşun geri taşıma PROCESS_QC panelinde görünür, iptal | ✓ |  |  |
| `Teks-Erp/scripts/test_order_cancel_card_dirty.ts` | Sipariş iptalinin refakat kartını contentDirty işaretlediği ve legacy softDelete yolunun da bağı koparıp WO tipini düzelttiği (CANCELLED/SUPERSEDED WO | ✓ |  | ⚠️ Dosyadaki 'route katmanındakiyle aynı satır' iddiası artık doğru değil — testin OrderServi |
| `Teks-Erp/scripts/test_phase2_broad_hardening.ts` | ColorService hex biçim guard'ı (geçersiz #RRGGBB reddi) + TravelerCardService.voidCard atomik claim'i (iki paralel çağrı → tam 1 başarı + 1×409). | ✓ |  |  |
| `Teks-Erp/scripts/test_race_conditions.ts` | Kilit yardımcılarının (touchOrderLinesTx sıralı+dedup, touchWorkOrderTx) sözleşmesini ve üç gerçek yarışı ölçer: fason directShip over-coverage, fason | ✓ |  |  |
| `Teks-Erp/scripts/test_route_skip_warning.ts` | Fason sevkte rota-atlama uyarısını (ROUTE_SKIP), allowRouteSkip onayıyla geçilebilmesini ve transferde yanlış pozitif üretmemesini. | ✓ |  |  |
| `Teks-Erp/scripts/test_split_card_lineage.ts` | Parti ayırmada soy bağını kilitler: eski refakat kartı okutulunca ayrılan partinin yeni WO'daki bekleyen grubu `splitFromId` üzerinden (isSplitChild)  | ✓ |  |  |
| `Teks-Erp/scripts/test_traveler_card_a5_batches.ts` | A4 ölçülerinin yoğunluk tablosuna taşınırken birebir korunduğunu, ayar varsayılanı A5 ↔ donmuş belge varsayılanı A4 asimetrisini ve parti bloğunun bas | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_traveler_card_fields.ts` | Kartın alan bazlı görünürlük/punto/kalınlık ayarını iki depoda (config.fields + specFields) kilitler: parmak izi, katalog↔CSS canlılığı, izolasyon, ön |  | ✓ |  |
| `Teks-Erp/scripts/test_traveler_card_stale.ts` | TravelerCard.contentDirty bayrağının doğru olaylarda kalkıp doğru yollarda temizlenmesini ve §6'da baskının GÜNCEL planı basıp içerik değiştiyse otoma | ✓ |  |  |
| `Teks-Erp/scripts/test_traveler_card_versions.ts` | Kart baskısının printed_documents defterine arşivlenmesini (upsert, SUPERSEDED, ?version=N eski içeriği basar) ve generic freeze/reissue/lazy-init yol | ✓ |  |  |
| `Teks-Erp/scripts/test_traveler_print_active_card.ts` | traveler_cards(workOrderId) WHERE status='ACTIVE' partial unique'ini kilitler: paralel iki print'te tam 1 başarı + 1×409 ve DB'de tek ACTIVE kart; rep | ✓ |  |  |
| `Teks-Erp/scripts/test_traveler_scan_dedup.ts` | Aynı kart+istasyon+scanType'ın 10 sn içindeki ikinci okutmasının yeni satır/audit üretmeyip cached dönmesini, farklı scanType'ın ise meşru yeni satır  | ✓ |  |  |
| `Teks-Erp/scripts/test_traveler_template.ts` | Şablonun üç kademesini (BUILTIN/SECTIONS/RAW_HTML) kilitler: şablonsuz kurulum bayt-bayt aynı, bölüm sırası + eksik bölüm sona eklenir, {{alan}} ikame | ✓ | ✓ | ⚠️ Başlık ve bölüm etiketi 2026-08-06'da tersine çevrilmiş 'şablon karta donar' kuralını hâlâ |
| `Teks-Erp/scripts/test_workorder_documents.ts` | GET /work-orders/:id/documents dört kaynağı da buluyor, listedeki her satır gerçekten basılabiliyor (liste↔baskı izin hizası) ve iptal edilmiş belge l | ✓ |  |  |
