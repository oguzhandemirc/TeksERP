## ozellik

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Teks-Erp/scripts/test_fold_catalog.ts` | Kat değer listesinin KODDAN değil katalogdan geldiğini kilitler: panelden eklenen yeni değer anında kabul edilir, katalog dışı reddedilir, katalog boş | ✓ | ✓ |  |
| `Teks-Erp/scripts/test_fold_edit_and_label.ts` | applyManualProperties'in kat yazması + kanonikleştirmesi, üçlü sözleşme (undefined dokunma / null temizle / kod yaz), katalog dışı red, labelDirty işa | ✓ |  |  |
| `Teks-Erp/scripts/test_fold_type.ts` | Yalnız SENKRON biçim işini ölçer: normalizeFoldType kanonikleştirmesi (4 kat→4-KAT, boş→null, tanınmayan değer korunur) ve foldTypeSchema Zod sözleşme |  |  |  |
| `Teks-Erp/scripts/test_helpers.ts` | Saf/karar-mantığı helper'larını in-memory sahte Prisma ile sürer: kalite grade resolve (lenient+strict), müşteri adı cascade, sipariş statü recompute, |  |  |  |
| `Teks-Erp/scripts/test_masterdata_guards.ts` | Tek konu kaldı: applyManualProperties'te item.allowedProperties listesi doluysa liste-dışı özellik 400, izinli özellik uygulanır (dosyada yalnız 2 che | ✓ |  |  |
| `Teks-Erp/scripts/test_property_station_binding.ts` | Kumaş özelliğinin bağsız DOĞAMAYACAĞINI kilitler: stationIds zorunlu (yok/boş → 400), pasif istasyon/uygunsuz kategori reddi, update'te replace ↔ doku | ✓ |  |  |
| `Teks-Erp/scripts/test_property_targetable.ts` | SEÇİM (CHOICE) tipli özelliğin hedef listelerine sızamayacağını (9 hedef kapısının hepsi assertTargetablePropertyIds çağırır) ve FLAG↔CHOICE tip geçiş | ✓ |  |  |
| `Teks-Erp/scripts/test_property_value_selection.ts` | Değer taşıyan SEÇİM özelliğinin RollProperty.valueId sözleşmesini kilitler: üstüne yazma, değersiz/katalogdışı 400, AUTO yasağı, Düzelt ve hedef repla | ✓ |  |  |
| `Teks-Erp/scripts/test_recipe.ts` | ProductRecipeService'in BaseService üzerinden CRUD'unu ve M:N özellik replace davranışını kilitler: nested create, properties[] verilince tam yeniden  | ✓ |  |  |
| `Teks-Erp/scripts/test_recipe_property_validation.ts` | ProductRecipe properties[] giriş guard'ını kilitler: propertyId varlık + isActive doğrulaması (soft-delete giriş guard'ı) ve create/update'te dedup il | ✓ |  |  |
| `Teks-Erp/scripts/test_roll_fold_and_reason.ts` | Roll.foldType + entryReason kalıcı kolon sözleşmesini kilitler: kat MİRAS ALINMAZ, alan hiç gönderilmezse parent→plan fallback'i, filtre kanonikleştir; §5 geriye doldurma betiğinin `--apply --onay=<N> --hedef=<db>` kapısı (çıplak/yanlış hedef/yanlış onay yazmaz) | ✓ | ✓B1 — (`4ed128f5`) kapısız eski betik geri konunca §5a/§5b ❌ (çıplak --apply yazdı), geri alınınca 19/19 |  |
| `Teks-Erp/scripts/test_route_step_targets.ts` | Rota adımının hedef renk/özellik saklamasını: düz id dizisi sözleşmesi (nested write reddi), istasyon yeteneği sınırı, pasif kayıt guard'ı, pivot casc | ✓ |  |  |
| `Teks-Erp/scripts/test_station_capability.ts` | StationCapabilityService'in renk/özellik yetkinlik yönetimi: replace semantiği, pasif/olmayan id reddi ve kategori kapısı. | ✓ |  |  |
| `Teks-Erp/scripts/test_station_capability_flags.ts` | İstasyon yeteneğinin kategoriden ayrılmasını çift yönlü kilitler: kategorisiz iç istasyona renk hâlâ atanamaz, 'renk uygular' işaretli iç istasyon rot | ✓ |  |  |
| `Teks-Erp/scripts/test_station_property_mode.ts` | StationProperty davranış modunu (AUTO/OPTIONAL/REQUIRED) ve varsayılanın OPTIONAL kaldığını, mod korunumunu, kurşun bypass AUTO süzgecini kilitler. | ✓ |  |  |
| `Teks-Erp/scripts/test_workorder_order_link.ts` | Sipariş bağlama MİRAS ALMAZ (hedef renk/en siparişten yazılmaz), uyuşmazsa bağlanmaz; renk/en değişimi izli, applyAttributeToRolls BAYRAK özelliklerin | ✓ | ✓ |  |
