## yari-mamul

| Dosya | Ne ölçüyor | DB | Negatif sonda | |
|---|---|---|---|---|
| `Teks-Erp/scripts/test_production_flow_columns.ts` | getProductionFlow'un tüm kolonlarının hatasız döndüğünü ve Ham Stok/Yarı Mamul kolonlarının Envanter sekmeleriyle AYNI SAYIYI (yalnız aynı anahtarı de | ✓ |  |  |
| `Teks-Erp/scripts/test_semi_finished_entry.ts` | Dışarıdan alınan yarı mamul girişinde statünün renkten türetilmeyip AÇIKÇA zorlandığını (`forcedStatus: STOCK`) ve kaynağın `entrySource=SEMI_FINISHED | ✓ |  |  |
| `Teks-Erp/scripts/test_semi_finished_surfaces.ts` | Yarı mamul ayrımının GÖSTERİMDE olup ARZDA olmadığını kilitler: Ürün Dengesi ayrı kova + `malzemeAcigi` ikisini birden düşer, sipariş karşılamada `fre | ✓ | ✓ |  |
