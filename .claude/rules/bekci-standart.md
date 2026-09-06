---
paths:
  - "Teks-Erp/scripts/test_*.ts"
  - "Teks-Erp/scripts/fixture-*.ts"
  - "Electron/src/**/*.test.ts"
  - "Electron/src/**/*.test.tsx"
  - "mobil/**/*.test.ts"
  - "mobil/**/*.test.tsx"
---

Dokunduğun dosya bir **bekçi (test)**. Yazmadan/değiştirmeden ÖNCE oku: kadans ve kural listesi `docs/standart/TEST-VE-DERLEME.md`; backend bekçisi yazıyorsan ayrıca `Teks-Erp/CLAUDE.md` § "Bekçi (test) yazma sözleşmesi" ve prosedür `docs/RECETELER.md` § "Yeni bekçi"; Electron için `docs/standart/ELECTRON.md` §11, mobil için `docs/standart/MOBIL.md` § test.

Değişmezler: **negatif sonda zorunlu** — korunan davranışı bilerek boz, KIRMIZI verdiğini gör, geri al; sonda yapılmamış bekçi bir NİYETTİR. Bekçi kendi fixture'ını `TEST-`/`TST-` damgasıyla kurar (ad alanları da damgalanır — canlı `nameFold` sedleri var) ve `finally`de FK sırasına göre siler. Özet satırı koşucunun tanıdığı formatta basılır (`=== Sonuç: N geçti, M başarısız ===`); kontrol atlanıyorsa sayısı AYNI satırda beyan edilir, yoksa kapsam kaybı görünmez. Ortamdaki "herhangi bir kayıt"a (`findFirst`) ve ham `username: "admin"`e yaslanma — fixture'dan çöz. Bitince o alanın bekçilerini koş (`/bekci-kos`).
