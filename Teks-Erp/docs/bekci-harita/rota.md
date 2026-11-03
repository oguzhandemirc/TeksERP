## rota

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Electron/src/pages/Operations/WorkOrders/subcontractorDefault.test.ts` | Rota tasariminda fason firma VARSAYILANI kisisel tercihtir: varsayilan 'favorite' (bugunku davranis) ve 'lastUsed' secildiginde gecmis yoksa favoriye  |  |  |  |
| `Electron/src/pages/Operations/WorkOrders/workOrderPrefill.test.ts` | Rota sablonu kaydetme payload'i: fason adiminin plannedSubcontractorId + kategorisi KORUNUR, 'fasona renksiz git' isareti sablona TASINIR, sequence 1- |  |  |  |
| `Teks-Erp/scripts/test_consecutive_fason.ts` | Rotada ardışık iki fason adımı (Boyahane→Zımpara): ilkine sevk+kabul ikinci fason adımını 'geçmiş' saymaz, top ikincide bekler. | ✓ |  | ⚠️ Fixture hata mesajı yanlış komutu işaret ediyor (kapı değil, yön tarifi bayat). |
| `Teks-Erp/scripts/test_data_integrity_gaps.ts` | Sekiz veri-bütünlüğü açığının kapalı kaldığını ölçer: VKN mükerrer (müşteri+fason), tr-fold rol/kullanıcı adı, şube kodu, sipariş en>0, reçete izinli  | ✓ |  |  |
| `Teks-Erp/scripts/test_dispatch_without_color.ts` | dispatchWithoutColor'ın yedi katmanda da taşındığını ölçer: dört Zod bloğu + üç Prisma yazımı + RouteService allowlist'i (§1 bilerek METİN taraması) + | ✓ |  |  |
| `Teks-Erp/scripts/test_guarded_hard_remove.ts` | guarded-hard-remove helper'ının üç dalını ölçer: olmayan kayıt 404, bağımlılık guard'ı 409 (rotadan üretilmiş WO varsa rota silinemez), temiz kayıt 20 | ✓ |  |  |
| `Teks-Erp/scripts/test_manual_move.ts` | Manuel Konum Düzeltme ana sözleşmesi: rotada ileri-geri taşıma, parti kararı (keep/new/join), fason/çuval/downstream guard'ları, WAREHOUSE reopen ve ö | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_manual_move_backflush.ts` | İleri-atlamada backflush: hedef renk uygulanır, kalite Belirsiz'e düşer, erişilemez ara adımlar SKIPPED olur; hedef-renk yoksa HARD ERROR. | ✓ |  |  |
| `Teks-Erp/scripts/test_phase7_route_validation.ts` | RouteService'in nested adım referanslarını (stationId isActive + sequence) doğruladığını, yani pasif istasyonun rota şablonuna sızamadığını kilitler. | ✓ |  |  |
| `Teks-Erp/scripts/test_property_station_binding.ts` | Kumaş özelliğinin bağsız DOĞAMAYACAĞINI kilitler: stationIds zorunlu (yok/boş → 400), pasif istasyon/uygunsuz kategori reddi, update'te replace ↔ doku | ✓ |  |  |
| `Teks-Erp/scripts/test_property_targetable.ts` | SEÇİM (CHOICE) tipli özelliğin hedef listelerine sızamayacağını (9 hedef kapısının hepsi assertTargetablePropertyIds çağırır) ve FLAG↔CHOICE tip geçiş | ✓ |  |  |
| `Teks-Erp/scripts/test_recipe.ts` | ProductRecipeService'in BaseService üzerinden CRUD'unu ve M:N özellik replace davranışını kilitler: nested create, properties[] verilince tam yeniden  | ✓ |  |  |
| `Teks-Erp/scripts/test_route_firm_roundtrip.ts` | Rota şablonundaki plannedSubcontractorId'nin create→findById round-trip'inde hem scalar hem nested (plannedSubcontractor.name) döndüğünü. | ✓ |  |  |
| `Teks-Erp/scripts/test_route_skip_warning.ts` | Fason sevkte rota-atlama uyarısını (ROUTE_SKIP), allowRouteSkip onayıyla geçilebilmesini ve transferde yanlış pozitif üretmemesini. | ✓ |  |  |
| `Teks-Erp/scripts/test_route_step_targets.ts` | Rota adımının hedef renk/özellik saklamasını: düz id dizisi sözleşmesi (nested write reddi), istasyon yeteneği sınırı, pasif kayıt guard'ı, pivot casc | ✓ |  |  |
| `Teks-Erp/scripts/test_route_template_fason.ts` | RouteStep'in requiredCategoryId+plannedSubcontractorId saklamasını, WO'ya klonlanmasını ve stepPlanning overlay'inin şablon varsayılanını ezmesini. | ✓ |  |  |
| `Teks-Erp/scripts/test_station_capability_flags.ts` | İstasyon yeteneğinin kategoriden ayrılmasını çift yönlü kilitler: kategorisiz iç istasyona renk hâlâ atanamaz, 'renk uygular' işaretli iç istasyon rot | ✓ |  |  |
| `Teks-Erp/scripts/test_wo_route_coverage_goods.ts` | Rota kapsaması REDDETMEZ UYARIR: siparişten türeyen hedef rengi rotada karşılanmasa da iş emri açılır, nitelik topların hepsinde varsa uyarı da çıkmaz | ✓ |  |  |
| `Teks-Erp/scripts/test_wo_target_color_guard.ts` | Üretim rengi değişikliğinin TEK bekçisi: COMPLETED kilidi, izinli renk listesi, kısmi-boya onayı (409 COLOR_PARTIAL_CONFIRM), COLOR_DYED_BLOCKED, faso | ✓ | ✓ |  |
