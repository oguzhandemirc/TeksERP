// =============================================================================
// Bekçi: ONARIM EKRANINDA NUMARALAR TIKLANABİLİR (2026-09-07 saha isteği)
//   §1 Sevkiyat no her zaman tıklanabilir (id listede zaten var).
//   §2 Sipariş no YALNIZ id geldiyse tıklanabilir; eski sunucuda düz metin.
//   §3 İki panel AYNI ANDA açık kalabilsin diye karartma çizilmez.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-07 — üçü de KIRMIZI verdi, geri alındı):
//   ① `SiparisNolari` id varken de düz metin basınca §2'nin ilk vakası düştü
//      (§1 ve eski-sunucu vakası YEŞİL kaldı — sonda dar, kapsam ayrışık).
//   ② `hideOverlay` `RepairCompareSheets`ten düşünce §3 düştü.
//   ③ `side="left"` düşünce §3'ün ikinci vakası düştü.
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { SevkiyatTablosu } from "./RepairTable";
import type { RepairableShipment } from "./service";

const TEMEL: RepairableShipment = {
  shipmentId: "sh-1",
  shipmentNo: "TEST-SVK-1",
  dispatchedAt: "2026-07-20T00:00:00Z",
  customer: { id: "c1", name: "TEST MUSTERI" },
  orderNumbers: ["TEST-SIP-1", "TEST-SIP-2"],
  orders: [
    { id: "o1", orderNumber: "TEST-SIP-1" },
    { id: "o2", orderNumber: "TEST-SIP-2" },
  ],
  icerikMetraj: 500,
  yazilanMetraj: 100,
  bosluk: 400,
  onarilabilirMetraj: 400,
};

const onSec = vi.fn();
const onSiparis = vi.fn();
const onSevkiyat = vi.fn();

function ciz(satir: RepairableShipment) {
  renderWithProviders(
    <SevkiyatTablosu satirlar={[satir]} onSec={onSec} onSiparis={onSiparis} onSevkiyat={onSevkiyat} />,
  );
}

describe("onarım tablosu — tıklanabilir numaralar", () => {
  beforeEach(() => {
    onSec.mockReset();
    onSiparis.mockReset();
    onSevkiyat.mockReset();
  });

  it("⭐ §1 sevkiyat numarasına tıklayınca sevkiyat paneli id ile istenir", async () => {
    ciz(TEMEL);
    await userEvent.click(screen.getByRole("button", { name: "TEST-SVK-1" }));
    expect(onSevkiyat).toHaveBeenCalledWith("sh-1");
  });

  it("⭐ §2 id gelen sipariş numarası TIKLANABİLİR ve KENDİ id'sini gönderir", async () => {
    ciz(TEMEL);
    await userEvent.click(screen.getByRole("button", { name: "TEST-SIP-2" }));
    // İkinci numara ikinci id'yi açmalı — sıra kayması sessizce yanlış siparişi açardı.
    expect(onSiparis).toHaveBeenCalledWith("o2");
  });

  it("⭐ §2 ESKİ SUNUCU (orders yok) → numara okunur ama tıklanamaz", () => {
    ciz({ ...TEMEL, orders: undefined });
    expect(screen.getByText("TEST-SIP-1, TEST-SIP-2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "TEST-SIP-1" })).toBeNull();
    // Sevkiyat numarası ETKİLENMEZ — onun id'si eski sunucuda da vardı.
    expect(screen.getByRole("button", { name: "TEST-SVK-1" })).toBeInTheDocument();
  });

  it("İncele düğmesi numaralardan bağımsız çalışır (onarım yolu bozulmadı)", async () => {
    ciz(TEMEL);
    await userEvent.click(screen.getByRole("button", { name: /İncele/ }));
    expect(onSec).toHaveBeenCalledTimes(1);
    expect(onSiparis).not.toHaveBeenCalled();
  });
});

// §3 KAYNAK SONDASI: "iki panel aynı anda" kuralı render edilmiş DOM'da değil
// prop geçişinde yaşıyor — `hideOverlay` düşerse ekran çalışmaya devam eder,
// yalnız aradaki şerit çift kararır ve karşılaştırma imkânsızlaşır. Sessiz
// gerileme; adıyla yakalanır.
describe("yan yana karşılaştırma sözleşmesi — §3", () => {
  const src = readFileSync(resolvePath(__dirname, "./RepairCompareSheets.tsx"), "utf-8");

  it("⭐ iki panel de karartmasız açılır", () => {
    expect(src.match(/hideOverlay/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("⭐ sipariş SOLDAN açılır (sevkiyat sağda kalsın)", () => {
    expect(src).toMatch(/side="left"/);
  });

  it("sipariş paneli SALT OKUNUR — düzenleme/iş emri yolu buradan açılmaz", () => {
    expect(src).not.toMatch(/onEdit=/);
    expect(src).not.toMatch(/onCreateWorkOrder=/);
  });
});
