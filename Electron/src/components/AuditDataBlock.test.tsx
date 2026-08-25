import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditDataBlock } from "./AuditDataBlock";

// "Ham veri (teknik)" bloğu KATLI durur ama açıldığında da Türkçe olmalı.
// Ölçüm (2026-08-25): 10.172 audit kaydının 2.676'sında en az bir iç içe
// nesne/dizi var; eskiden orası `JSON.stringify` ile ham İngilizce basılıyordu.

describe("ham veri bloğu", () => {
  it("üst düzey alan adını ve enum değerini Türkçe basar", () => {
    render(<AuditDataBlock title="Yeni Değer" data={{ currentQty: 200, status: "WAREHOUSE" }} />);
    expect(screen.getByText("Metraj")).toBeTruthy();
    expect(screen.getByText("Depoda")).toBeTruthy();
  });

  it("İÇ İÇE nesnenin alan adlarını da çevirir", () => {
    render(
      <AuditDataBlock
        title="Yeni Değer"
        data={{ lines: [{ itemId: "abc", quantity: 5, destination: "EXPORT" }] }}
      />,
    );
    expect(screen.getByText("Kalemler")).toBeTruthy();
    expect(screen.getByText("Kumaş")).toBeTruthy();
    expect(screen.getByText("Miktar")).toBeTruthy();
    expect(screen.getByText("İhracat")).toBeTruthy();
  });

  it("skaler diziyi tek satırda özetler, uzun diziyi kırpar", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `R${i}`);
    render(<AuditDataBlock title="Yeni Değer" data={{ rollIds: ids }} />);
    expect(screen.getByText("Toplar")).toBeTruthy();
    // İlk 12 gösterilir, gerisi "+8" olarak özetlenir — 200 toplu işlemde
    // çekmece kullanılmaz hâle gelmesin.
    expect(screen.getByText(/\+8$/)).toBeTruthy();
  });

  it("boş dizi 'ham JSON' değil '(boş)' basar", () => {
    render(<AuditDataBlock title="Yeni Değer" data={{ propertyIds: [] }} />);
    expect(screen.getByText("Özellikler")).toBeTruthy();
    expect(screen.getByText("(boş)")).toBeTruthy();
  });

  it("çok derin yükte HAM JSON'a düşer (adli inceleme kaybolmasın)", () => {
    render(<AuditDataBlock title="Yeni Değer" data={{ config: { a: { b: { c: 1 } } } }} />);
    expect(screen.getByText("Ayarlar")).toBeTruthy();
    expect(screen.getByText(/\{"c":1\}/)).toBeTruthy();
  });
});
