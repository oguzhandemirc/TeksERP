// Kumaş Stoğu şeridi: durum grubu → tek ince ayraç → yer grubu; tabs-config tek kaynak.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReorderableTabBar } from "@/components/layout/ReorderableTabBar";
import { ROLL_TABS, orderRollTabsByGroup } from "./tabs-config";
import { resolveRollTabs } from "./tabs-regime";

const keysOf = (g: string) => ROLL_TABS.filter((t) => t.group === g).map((t) => t.key);

describe("Kumaş Stoğu sekme grupları", () => {
  it("durum grubu: Ham Stok · Yarı Mamul · Bitmiş Depo; yer grubu geri kalan altı sekme, bu sırayla", () => {
    expect(keysOf("durum")).toEqual(["RAW_STOCK", "SEMI_FINISHED", "FINISHED_STOCK"]);
    expect(keysOf("yer")).toEqual(["IN_SACK", "PRODUCTION", "KANBAN", "SUBCONTRACTOR", "KURSUN_PENDING", "TAMBUR_PENDING"]);
    expect(orderRollTabsByGroup(ROLL_TABS)).toEqual(ROLL_TABS);
  });

  it("kayıtlı sıra grupları karıştırsa da grup sırası korunur, grup içi sıra kullanıcınındır", () => {
    const byKey = (k: string) => ROLL_TABS.find((t) => t.key === k)!;
    const saved = ["IN_SACK", "FINISHED_STOCK", "KANBAN", "RAW_STOCK"].map(byKey);
    expect(orderRollTabsByGroup(saved).map((t) => t.key)).toEqual(["FINISHED_STOCK", "RAW_STOCK", "IN_SACK", "KANBAN"]);
  });

  it("şerit gruplar arasına tam bir dikey ayraç çizer, yazı eklemez", () => {
    render(<ReorderableTabBar tabs={ROLL_TABS} activeKey="RAW_STOCK" onSelect={vi.fn()} onReorder={vi.fn()} />);
    const seps = screen.getAllByRole("separator");
    expect(seps).toHaveLength(1);
    expect(seps[0]).toHaveAttribute("aria-orientation", "vertical");
    expect(seps[0]).toHaveTextContent("");
    expect(seps[0]!.previousElementSibling).toHaveTextContent("Bitmiş Depo");
    expect(seps[0]!.nextElementSibling).toHaveTextContent("Çuvalda");
  });

  it("grupsuz sekmelerde ayraç yok", () => {
    const plain = ROLL_TABS.map(({ group: _g, ...t }) => t);
    render(<ReorderableTabBar tabs={plain} activeKey="RAW_STOCK" onSelect={vi.fn()} onReorder={vi.fn()} />);
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
  });

  it("ticaret rejiminde de (yer grubunda yalnız Çuvalda) grup bilgisi taşınır", () => {
    expect(resolveRollTabs(false, true).map((t) => t.group)).toEqual(["durum", "durum", "durum", "yer"]);
  });
});
