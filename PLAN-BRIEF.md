# Denetim Planlama Görevi

Bu bir **PLANLAMA** görevidir. Denetimi henüz yapma. Çıktın bir plan dosyasıdır.
Kod değiştirme, salt okuma çalış.

---

## Bağlam

- Kod tabanı: ~200.000 satır, Node.js / Express API, production'da.
- Amaç: üstünkörü değil, derinlemesine mühendislik denetimi.
- Kısıt: context şişmesi. Plan, her adımı **ayrı oturumda** çalıştırılabilecek şekilde parçalanmış olmalı. Tek oturumda biten bir plan kabul edilemez.

---

## Kullanılacak Araçlar (SABİT)

Bu listeyi değiştirme, alternatif arama, yeni GitHub reposu önerme.

**Skill'ler**
- `~/.claude/skills/express-api-audit` — Node'a özgü eşzamanlılık + SOLID
- `~/.claude/skills/code-review-skill` — genel kalite, ikinci görüş

**Mekanik araçlar**
`madge`, `knip`, `jscpd`, `ts-prune`, `depcheck`, `semgrep`, `eslint`, `npm audit`

Bunların dışında bir araca ihtiyaç olduğuna kanaat getirirsen **önerme**; plan sonunda "Kapsanmayan Alan" başlığı altında gerekçesiyle listele. Kararı ben veririm.

---

## Adım 1 — Mekanik Taban (LLM'siz)

Aşağıdakileri çalıştır. Ham çıktıları `audit/raw/` altına yaz, **context'e taşıma**. Sadece sayısal özeti raporla.

```bash
npx madge --circular --extensions ts src/
npx knip
npx jscpd src/ --min-lines 20 --reporters json
npx ts-prune
npx depcheck
npm audit --json
npx semgrep --config=p/nodejs --config=p/owasp-top-ten --json src/
git log --format=%n --name-only --since="12 months" | sort | uniq -c | sort -rn | head -80
```

Kurulu olmayan aracı atla, hangisini atladığını belirt. Son komut kritik: **değişim sıklığı**, hata yoğunluğunun en güvenilir vekil göstergesi.

---

## Adım 2 — Yüzey Haritası

Explore subagent'larını **paralel** kullan. Dosya içeriğini ana oturuma taşıma; sadece özet döndürsünler.

Çıkar:

- Modül / bounded context listesi ve her birinin satır sayısı
- Route envanteri: `metod | path | auth | yan etki | idempotent mi`
- Middleware zinciri ve **sırası**
- Veri katmanı: ORM, şema büyüklüğü, transaction kullanım noktaları
- Async yüzey: queue, cron, worker, webhook alıcıları, dış API çağrıları
- Deploy topolojisi: instance sayısı, cluster/PM2, paylaşımlı Redis var mı
- Test durumu: hangi modülde test var, hangisinde yok

---

## Adım 3 — Risk Skorlaması

Her modüle 1-5 arası skor ver, **gerekçeli**:

| Boyut | Ne ölçüyor |
|---|---|
| Blast radius | Bozulursa ne kaybedilir: para, veri, erişim |
| Değişim sıklığı | Adım 1'deki git verisinden |
| Eşzamanlılık yüzeyi | Paylaşımlı durum, transaction, cache, queue teması |
| Mevcut savunma | Test kapsamı, validation, tip disiplini (ters etkili) |
| Mekanik sinyal | semgrep / madge / jscpd bulgu yoğunluğu |

---

## Adım 4 — Hücre Matrisi

Modül × kategori matrisi kur.

**Kategoriler:** eşzamanlılık · mimari/SOLID · güvenlik · veri/performans · doğruluk · API sözleşmesi · tip güvenliği · çok kiracılılık ve izolasyon · ops/gözlemlenebilirlik

Her hücreye `P0` / `P1` / `P2` / `atla` ata. Skorlamadan **türet**, sezgiyle değil.

Her hücre için belirt: hangi skill, tahmini dosya sayısı, tahmini oturum uzunluğu.

**Sert kurallar**
- P0 hücre sayısı 12'yi geçmesin. Geçiyorsa skorlamayı sıkılaştır.
- Her hücre **tek oturumda** bitmeli. Bitmiyorsa alt hücrelere böl.

---

## Adım 5 — Defter Şeması

`audit/FINDINGS.jsonl` için satır şeması tanımla ve **boş dosyayı oluştur**.

En az şu alanlar: `id`, `cell`, `severity`, `category`, `file`, `line`, `title`, `evidence`, `fix_sketch`, `verification`, `status`, `confidence`

Şemayı `audit/SCHEMA.md`'ye yaz. Bu defter, model belleğinin yerini tutacak — oturumlar arası tutarlılık buradan sağlanacak.

---

## Adım 6 — Yürütme Planı

`audit/PLAN.md` üret. Her P0 ve P1 hücresi için:

- Hücre kimliği ve kapsamı (dosya glob'ları + **açıkça kapsam dışı** olanlar)
- O oturumda yapıştırılacak **tam prompt metni**
- Hangi önceki çıktıların okunacağı
- Bitiş kriteri

Sırayı bağımlılığa göre kur: yüzey haritası → kritik yollar → çevre.

---

## Adım 7 — Rapor ve Dur

Bana göster:

1. Modül tablosu
2. Risk skorları ve gerekçeleri
3. Hücre matrisi
4. P0 listesi ve neden P0 oldukları
5. Toplam tahmini oturum sayısı
6. "Kapsanmayan Alan" listesi

Sonra **DUR**. Onayımı almadan denetime başlama.

---

## Kurallar

- Doğrulamadığın hiçbir şeyi iddia etme. Emin değilsen `ŞÜPHELİ` etiketle.
- Sayısal iddia (satır sayısı, modül sayısı) mutlaka komut çıktısına dayansın.
- Türkçe yaz, teknik terimler İngilizce orijinaliyle. Emoji ve LaTeX kullanma.
