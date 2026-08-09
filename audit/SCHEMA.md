# audit/FINDINGS.jsonl — Defter Şeması

Bu defter, model belleğinin yerini tutar. Oturumlar arası tutarlılık buradan sağlanır.
Her satır bağımsız ve tam bir JSON nesnesidir (JSON Lines). Dosya asla toptan yeniden yazılmaz,
yalnız **append** edilir; mevcut bir satır güncellenecekse aşağıdaki "Güncelleme" kuralına bak.

## Neden JSONL

- Paralel oturumlar aynı dosyaya çakışmadan ekleyebilir (satır atomik).
- `grep`/`jq` ile bir sonraki oturum defteri context'e almadan sorgulayabilir.
- Kısmi bozulma tek satırla sınırlı kalır.

## Satır şeması

```json
{
  "id":            "string  — ZORUNLU. Format: F-<HUCRE>-<3 hane>. Örn: F-URE-ESZ-001. Global benzersiz.",
  "cell":          "string  — ZORUNLU. Bulgunun üretildiği hücre kimliği. Örn: URE.eszamanlilik. PLAN.md ile birebir aynı olmalı.",
  "severity":      "enum    — ZORUNLU. kritik | yuksek | orta | dusuk | bilgi",
  "category":      "enum    — ZORUNLU. eszamanlilik | mimari | guvenlik | veri-performans | dogruluk | api-sozlesmesi | tip-guvenligi | izolasyon | ops",
  "file":          "string  — ZORUNLU. Repo köküne göre yol. Örn: Teks-Erp/src/services/shipping.service.ts",
  "line":          "number  — ZORUNLU. 1-indeksli satır. Tek satıra çıpalanamıyorsa bloğun ilk satırı.",
  "line_end":      "number  — opsiyonel. Blok bulgusunda son satır.",
  "symbol":        "string  — opsiyonel ama şiddetle tavsiye. Fonksiyon/metot/sınıf adı. Satır numaraları kayar, isim kalır.",
  "title":         "string  — ZORUNLU. Tek cümle, kusuru SÖYLER. 'X yanlış' değil, 'X şu koşulda Y üretir'. <=100 karakter.",
  "evidence":      "string  — ZORUNLU. Kusuru KANITLAYAN somut alıntı/akıl yürütme. Kod alıntısı kısa olsun. 'Bence' ile başlayamaz.",
  "failure_mode":  "string  — ZORUNLU. Somut girdi/durum -> somut yanlış çıktı veya çökme. Üretemiyorsan bulgu değildir, bilgi'dir.",
  "fix_sketch":    "string  — ZORUNLU. Düzeltmenin ŞEKLİ. Tam yama değil; hangi dosyada ne değişir, hangi sözleşme korunur.",
  "verification":  "string  — ZORUNLU. İKİ parça: (a) bulgunun gerçek olduğunu ispatlayan kontrol, (b) düzeltmenin işe yaradığını ispatlayan kontrol. Mümkünse çalıştırılabilir komut/script adı.",
  "status":        "enum    — ZORUNLU. acik | dogrulandi | reddedildi | mukerrer | ertelendi | duzeltildi",
  "confidence":    "enum    — ZORUNLU. kesin | yuksek | orta | supheli",
  "blast_radius":  "enum    — opsiyonel. para | veri-kaybi | veri-bozulmasi | erisim | uretim-durmasi | gorunum | yok",
  "prod_risk":     "enum    — opsiyonel. Düzeltmenin CANLI sistemde taşıdığı risk: dusuk | orta | yuksek. Migration/veri dokunuşu gerektiriyorsa daima yuksek.",
  "effort":        "enum    — opsiyonel. s | m | l  (saatlik / yarım gün / gün+)",
  "related":       "array   — opsiyonel. Bağlı bulgu id'leri. Örn: [\"F-SEV-ESZ-003\"]",
  "duplicate_of":  "string  — status=mukerrer ise ZORUNLU. Asıl bulgunun id'si.",
  "reject_reason": "string  — status=reddedildi ise ZORUNLU. Neden bulgu değilmiş.",
  "session":       "string  — ZORUNLU. Bulguyu üreten oturumun hücre kimliği + tarih. Örn: URE.eszamanlilik@2026-08-09",
  "found_at":      "string  — ZORUNLU. ISO tarih: YYYY-AA-GG",
  "tool":          "string  — opsiyonel. Mekanik araç bulduysa: madge | jscpd | semgrep | ts-prune | knip | npm-audit | eslint | manuel"
}
```

## Zorunlu alanlar (özet)

`id`, `cell`, `severity`, `category`, `file`, `line`, `title`, `evidence`, `failure_mode`,
`fix_sketch`, `verification`, `status`, `confidence`, `session`, `found_at`.

Brief'in istediği asgari küme (`id, cell, severity, category, file, line, title, evidence,
fix_sketch, verification, status, confidence`) bunun içinde. `failure_mode`, `session`, `found_at`
eklendi: birincisi "plausible ama yanlış" bulguları eler, diğer ikisi oturumlar arası izi kurar.

## Kalite kuralları — bir satır yazmadan önce

1. **`failure_mode` üretemiyorsan bu bir bulgu değildir.** Somut girdi -> somut yanlış sonuç
   yazamıyorsan `severity: bilgi` ver veya hiç yazma. "Bu kod karışık" bulgu değildir.
2. **`confidence: supheli` meşrudur, uydurmak değildir.** Emin değilsen şüpheli işaretle ve
   `verification` alanına "nasıl kesinleşir" yaz. Sonraki oturum onu doğrular.
3. **`evidence` kod alıntısı içermeli**, dosya adı tekrarı değil. 1-8 satır yeter.
4. **Aynı kök nedenin N tezahürü tek bulgudur.** N ayrı satır değil; `related` ile bağla veya
   `failure_mode` içinde "aynı desen şu 6 dosyada" de.
5. **`severity` blast radius'tan türetilir, estetikten değil.** Para/veri kaybı -> kritik.
   Yalnız okunabilirlik -> dusuk veya bilgi.
6. **Canlı sistem kuralı:** `fix_sketch` migration veya toplu veri dokunuşu öneriyorsa
   `prod_risk: yuksek` zorunlu ve `fix_sketch` içinde geri alma yolu yazılmalı.
   Bu repoda `migrate reset` / reseed / toplu DELETE yasaktır (CLAUDE.md).

## Güncelleme kuralı (append-only'de nasıl)

Satır değiştirilmez. Durum değişince **aynı `id` ile yeni satır** eklenir ve `found_at` güncellenir.
Okuyucu için geçerli olan, bir `id`'nin **en son** satırıdır. Böylece paralel oturumlar
birbirinin satırını ezmez ve karar geçmişi korunur.

Geçerli durumu almak için:

```bash
# Her id'nin GEÇERLİ (en son) hali
jq -s 'group_by(.id) | map(last)' audit/FINDINGS.jsonl
```

## Oturum başında / sonunda çalıştırılacak sorgular

```bash
cd /Users/oad/Documents/projeler/AdnanSahin

# Defterde kaç bulgu, hangi durumda
jq -r '.status' audit/FINDINGS.jsonl | sort | uniq -c

# Bu hücrede daha önce ne bulunmuş (oturum başında ZORUNLU — mükerrer üretmemek için)
jq -r 'select(.cell=="SEV.eszamanlilik") | "\(.id) [\(.severity)] \(.title)"' audit/FINDINGS.jsonl

# Bu dosyaya daha önce dokunulmuş mu
jq -r 'select(.file|test("shipping.service")) | "\(.id) \(.line) \(.title)"' audit/FINDINGS.jsonl

# Sonraki id numarasını bul
jq -r 'select(.cell=="SEV.eszamanlilik") | .id' audit/FINDINGS.jsonl | sort | tail -1

# Kritik + yüksek, açık olanlar
jq -r 'select((.severity=="kritik" or .severity=="yuksek") and .status!="reddedildi" and .status!="mukerrer")
       | "\(.id) \(.severity) \(.file):\(.line) — \(.title)"' audit/FINDINGS.jsonl
```

`jq` kurulu değilse `node -e` ile aynısı yapılabilir; defter satır bazlı JSON olduğu için
`readFileSync().split("\n").filter(Boolean).map(JSON.parse)` yeterlidir.

## Örnek satırlar

Gerçek bulgu değildir, format örneğidir. Bu satırlar `FINDINGS.jsonl`'e YAZILMAZ.

```json
{"id":"F-SEV-ESZ-001","cell":"SEV.eszamanlilik","severity":"yuksek","category":"eszamanlilik","file":"Teks-Erp/src/services/shipping.service.ts","line":1420,"symbol":"performDispatchTx","title":"Sevk tx'i ile iade sorgusu ayrı tx'lerde koştuğu için aynı top iki kez sayılabiliyor","evidence":"`shipment.findUnique(...)` ile `rollReturn.findMany(...)` ardışık ama tek transaction içinde değil; aradaki pencerede commit olan bir iade her iki kümede de görünür.","failure_mode":"Sevk anında paralel bir iade commit olursa detay ekranı 2 top yerine 3 top gösterir; irsaliye ile ekran ayrışır.","fix_sketch":"İki sorguyu tek `$transaction` callback'ine al veya mevcut canlı id kümesiyle dedup et (getShipmentById'de uygulanan desenin aynısı).","verification":"(a) İki sorgu arasına yapay gecikme koyup paralel iade ile tekrarla. (b) scripts/test_shipment_detail_gross.ts yeşil kalmalı + yeni eşzamanlılık sondası eklenmeli.","status":"acik","confidence":"orta","blast_radius":"veri-bozulmasi","prod_risk":"dusuk","effort":"m","session":"SEV.eszamanlilik@2026-08-09","found_at":"2026-08-09","tool":"manuel"}
{"id":"F-SEV-ESZ-001","cell":"SEV.eszamanlilik","severity":"yuksek","category":"eszamanlilik","file":"Teks-Erp/src/services/shipping.service.ts","line":1420,"symbol":"performDispatchTx","title":"Sevk tx'i ile iade sorgusu ayrı tx'lerde koştuğu için aynı top iki kez sayılabiliyor","evidence":"Doğrulandı: yapay gecikme ile çift sayım üretildi.","failure_mode":"Sevk anında paralel bir iade commit olursa detay ekranı 2 top yerine 3 top gösterir.","fix_sketch":"Dedup uygulandı.","verification":"scripts/test_shipment_detail_gross.ts + yeni sonda yeşil.","status":"dogrulandi","confidence":"kesin","blast_radius":"veri-bozulmasi","prod_risk":"dusuk","effort":"m","session":"SEV.eszamanlilik@2026-08-09","found_at":"2026-08-09","tool":"manuel"}
```

## Hücre kimlikleri

`cell` alanı `<MODUL>.<kategori>` biçimindedir ve `audit/PLAN.md`'deki hücre matrisiyle
**birebir** aynı olmak zorundadır. Modül kısaltmaları PLAN.md'de tanımlıdır.
Kategori kısaltmaları: `eszamanlilik`, `mimari`, `guvenlik`, `veri-performans`, `dogruluk`,
`api-sozlesmesi`, `tip-guvenligi`, `izolasyon`, `ops`.
