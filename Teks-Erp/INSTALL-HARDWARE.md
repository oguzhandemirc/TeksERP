# Donanım Kurulum & Konfigürasyon (fabrika başına)

TeksERP **fabrika başına ayrı kurulur** (kendi sunucu + DB). Tüm saha donanımı —
yazıcılar, kantarlar, metre/sarım makineleri, sinyal kaynakları — **VERİdir**, kodda
gömülü değil. Yeni fabrikaya verirken veya donanım değişince **kod değişmez**, sadece
admin panelden (veya seed'den) yeniden yapılandırılır.

## Tek donanım kaynağı: `PeripheralDevice`

Eski `MachineHardware` emekliye ayrıldı. Tüm çevre cihazları tek normalize tabloda:

| Alan | Anlamı |
|---|---|
| `kind` | `LABEL_PRINTER` / `SCALE` / `METER` / `SIGNAL_SOURCE` |
| `connectionType` | `NETWORK_TCP` / `BLUETOOTH_SPP` / `BLE` / `USB` / `SERIAL_COM` |
| `address`, `port` | IP / MAC / COM yolu / BLE UUID (+ TCP portu) |
| sahiplik | `machineId` (makineye SABİT) **veya** `deviceId` (tablete BAĞLI — BT yazıcı tabletle gezer) |
| **yazıcı** | `languageOverride` (dil: PPLA/PPLB/ZPL/RASTER_HTML — yazıcıda ZORUNLU) + `formatProfileId` (geometri; boş → sistem-default profil) + per-kind şablon yönlendirme |
| **giriş cihazı** (SCALE/METER) | `pollCommand` (istek-cevap) + `terminator` + `identifyPattern`/`decimals`/`scale`/`unit` (codec) + `timeoutMs` + `role` (2-KAT/4-KAT/PRIMARY) + `simulate` |

Yönetim ekranı: **Electron → Tanımlar → Cihaz Kaydı** (`/api/peripherals`).

## Marka / protokol değişimi = sıfır kod

- **Yazıcı markası değişti** (Argox→Zebra): cihazın `languageOverride`'ını yeni dile
  çevir. Dört dil (PPLA/PPLB/ZPL/RASTER_HTML) gerçek generator'larıyla hazır
  (`helpers/label-renderer.registry.ts`). Render otomatik o dile gider.
- **Etiket boyutu/geometri**: yeni `LabelFormatProfile` (Tanımlar → Etiket Format Profilleri).
- **Metre/kantar markası/protokolü**: `pollCommand` / `identifyPattern` (parse regex) /
  `scale` (cm→m: 0.01) / `terminator` / `role`'ü güncelle.
- **Yeni dil/bağlantı türü** GEREKİRSE: registry/transport'a ~200 LOC adaptör (kapsam dışı).

## Okuma/yazma yolu (HAL)

Transport × codec soyutlaması iki tarafta:
- **Backend** `helpers/device-transport.ts` (NETWORK_TCP) + `helpers/codec/meter.codec.ts`.
- **Mobil** `services/hal/btClassic.transport.ts` (BT-Classic/HC-06) + `hal/meter.codec.ts`;
  `hooks/usePeripheralIO.ts` bir PeripheralDevice satırından IO kurar.

BT cihazlar **tablette** okunur/yazılır (Bluetooth tablete bonded); NETWORK_TCP sunucuda.
Tablet kendi cihazlarını **atandığı makineden** çözer: `GET /api/peripherals/for-device?kind=METER`
(machineId `req.device.machineId`'den; query'den değil).

## Tablet kimliği: allowlist + atama (eşleştirme kodu YOK)

1. Tablet ilk açılışta kendini bildirir (`POST /api/devices/announce`) → **PENDING**.
2. Admin **Cihazlar** ekranında onaylar + bir makineye atar → **APPROVED**.
3. Tablet otomatik devam eder; `req.device.machineId` üretim atfı + cihaz çözümü sağlar.

`device.pairingRequired` (Genel Ayarlar) **true** ise onaysız tablet 401 (atama bekler);
**false** (varsayılan) ise onaysız da çalışır (atıf null).

## Taze kurulum varsayılanları (tam simülasyon)

Yeni bir fabrikada `npm run seed` ile gelen güvenli defaultlar — gerçek I/O opt-in:

| Ayar | Default | Anlamı |
|---|---|---|
| `label.printerLanguage` | `PPLA` | Global yazıcı dili (model dili önceliklidir) |
| `label.nativeSendEnabled` | `false` | Yazıcıya gerçek TCP gönderim KAPALI (HTML+OS fallback) |
| `device.pairingRequired` | `false` | Onaysız tablet de çalışır |
| `PeripheralDevice.simulate` | seed'de METER/SCALE için `true` | Metre/kantar SAHTE okur (donanımsız test) |

Gerçek donanıma geçiş: ilgili `PeripheralDevice.simulate`'i kapat + `address`/protokolü gir
(+ yazıcı için `label.nativeSendEnabled` aç). HC-06'lar her tablette Android BT'den bond edilmeli.

## Yeni fabrika konfig yüzeyi (Electron Tanımlar)

PrinterModels · LabelFormatProfiles · Etiket Standartları (LabelTemplate) ·
**Cihaz Kaydı (PeripheralDevices — tek donanım sayfası)** · İstasyonlar · Makineler ·
**Cihazlar (tablet onay/atama)** + Genel Ayarlar bayrakları. Hepsi veri; kod dağıtımı gerekmez.
