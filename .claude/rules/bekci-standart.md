---
paths:
  - "Teks-Erp/scripts/{test_,fixture-}*.ts"
  - "{Electron,mobil}/src/**/*.test.{ts,tsx}"
---

**Bekçi (test)** — öz. Yalnız ilgili bölümü oku:
- `docs/standart/TEST-VE-DERLEME-BEKCI.md § 5` yazım kuralları
- `docs/RECETELER.md § "Yeni bekçi"` prosedür
- `docs/standart/ELECTRON.md § 11` · `docs/standart/MOBIL.md § 13` istemci testleri

- Negatif sonda zorunlu: korunan davranışı boz, KIRMIZI gör, geri al; cırcır İKİ sondayla.
- Fixture `TEST-`/`TST-` damgalı, `finally`de FK sırasıyla silinir.
- Özet satırı `=== Sonuç: N geçti, M başarısız ===`; atlanan kontrol aynı satırda.
- `findFirst` "herhangi bir kayıt"a ve ham `username: "admin"`e yaslanma.
- Yalnız `_test` DB'ye karşı koş.
