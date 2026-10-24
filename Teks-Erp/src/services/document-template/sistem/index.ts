// =============================================================================
// Sistem şablonu Liquid eşleniği KAYDI — docType başına TEK satır, ALFABETİK.
// =============================================================================
// T1B dizini açtı; eşlenikleri port dilimleri ekler (T6: sevk irsaliyesi). Okuma `kayit.ts` üzerinden yapılır.
// Satır biçimi: `export { shipmentDispatchSystem } from "./shipment-dispatch"; // SHIPMENT_DISPATCH`
// Port kalıbı: sözleşme (`sozlesme/<doc>.ts`) + `sistem/<doc>.ts` (Liquid `html`, `css(ayar)` ve
// `pageSettings(ayar)` — Liquid'de aritmetik yok, stil ayardan üretilir — + `variants`) + iki
// index satırı (burası + `scripts/test_belge_sistem_esdegeri.ts` RENDERERS); eşitlik yeşil olmalı.
// =============================================================================

export { shipmentDispatchSystem } from "./shipment-dispatch"; // SHIPMENT_DISPATCH
