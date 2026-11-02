// Gelen belge OCR seçenekleri (2026-11-02): S4 "yalnız şüpheli değeri engelle" (precheck + 409 metni), kılavuzlu girişte
// şüpheli satır önce, aynı müşteri partisi bilgi bandı, okuma seçenekleri ayarları (S5 metre kaynağı · S3b şablondan gönderen · belge geneli beyan kipi).
// Eski backend yeni alanları göndermez → alan/bant çizilmez, gövdeye girmez.
// Negatif sonda: `suspectRank` sıralamadan çıkarılınca "şüpheli önce" kırmızı; precheck BLOCK_SUSPECT dalı kapatılınca
// "BLOCK_SUSPECT engeller" kırmızı; `useReadOptionsDraft` gövdesi koşulsuz kurulunca "eski backend … yalnız o gider" kırmızı.
// Kayıt kipi (Gülkesim parti/metre P1): `useEntryModeDraft` gövdesinden `entryMode` çıkarılınca "yalnız değişen üç alan" kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentSettingsSection } from "@/pages/GeneralSettings/GelenBelgeSettingsSection";
import { buildReviewQueue } from "../review-queue";
import { approveErrorText, approvePrecheck } from "../approveFlow";
import { SameBatchStrip } from "../SameBatchStrip";
import type { DeliveryNoteLine } from "../types";

const getSettings = vi.fn();
const updateSettings = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => getSettings(),
  updateIncomingDocumentSettings: (b: unknown) => updateSettings(b),
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ isLoading: false, data: { data: { gelenBelgeEnabled: true } } }),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({ EntityPickerModal: () => null }));

type Q = Parameters<typeof buildReviewQueue>[0][number];
const ql = (o: Partial<Q>): Q => ({ id: "l", lineNo: 1, blockNo: 1, needsReview: true, status: "PENDING", rollId: null, sourceRects: null, ...o });

describe("kılavuzlu giriş kuyruğu", () => {
  it("⭐ şüpheli değerli satır EN ÖNCE, sonra blok → satır; problems yoksa (eski backend) bugünkü sıra", () => {
    const q = buildReviewQueue([
      ql({ id: "a1", blockNo: 1, lineNo: 1 }),
      ql({ id: "b3", blockNo: 2, lineNo: 3, problems: ["SUSPECT_VALUE"] }),
      ql({ id: "a2", blockNo: 1, lineNo: 2, problems: ["SUSPECT_VALUE"] }),
      ql({ id: "b1", blockNo: 2, lineNo: 1 }),
    ]);
    expect(q.map((i) => i.lineId)).toEqual(["a2", "b3", "a1", "b1"]);
    expect(buildReviewQueue([ql({ id: "y", lineNo: 2 }), ql({ id: "x", lineNo: 1 })]).map((i) => i.lineId)).toEqual(["x", "y"]);
  });
});

describe("onay ön kontrolü — BLOCK_SUSPECT", () => {
  type P = Parameters<typeof approvePrecheck>[0][number];
  const pl = (o: Partial<P>): P => ({ status: "PENDING", rollId: null, itemId: "i", needsReview: true, ...o });
  const set = (mode: "WARN" | "BLOCK_SUSPECT" | "BLOCK") => ({ defaultItem: null, unreviewedApproval: mode, defaultUnreviewedApproval: "WARN" as const });
  const suspect: DeliveryNoteLine["problems"] = ["SUSPECT_VALUE"];

  it("⭐ BLOCK_SUSPECT: açık şüpheli satır engeller; şüphesiz gözden geçirilmemiş uyarıyla geçer", () => {
    const r = approvePrecheck([pl({ problems: suspect }), pl({})], set("BLOCK_SUSPECT"), undefined);
    expect(r).toMatchObject({ unreviewed: 2, suspect: 1, blocked: true });
    expect(r.messages).toEqual([{ tone: "block", text: "1 şüpheli değerli satır gözden geçirilmeli — onay engellenir." }]);
    const ok = approvePrecheck([pl({})], set("BLOCK_SUSPECT"), undefined);
    expect(ok).toMatchObject({ suspect: 0, blocked: false });
    expect(ok.messages[0]!.tone).toBe("warn");
  });
  it("şüpheli ama topu doğmuş / gözden geçirilmiş satır sayılmaz; WARN şüpheliyi engellemez", () => {
    expect(approvePrecheck([pl({ problems: suspect, rollId: "r", status: "ENTERED" }), pl({ problems: suspect, needsReview: false })], set("BLOCK_SUSPECT"), undefined).suspect).toBe(0);
    expect(approvePrecheck([pl({ problems: suspect })], set("WARN"), undefined).blocked).toBe(false);
  });
  it("409 DELIVERY_NOTE_SUSPECT_PENDING Türkçe yönlendirme + backend metni", () => {
    const err = new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { details: { code: "DELIVERY_NOTE_SUSPECT_PENDING" } } } as AxiosResponse);
    expect(approveErrorText(err, "Satır 3 şüpheli.")).toMatch(/^Şüpheli değerli satır gözden geçirilmedi.*\(Satır 3 şüpheli\.\)$/);
  });
});

describe("aynı müşteri partisi bandı", () => {
  it("⭐ başka belge varsa bağlantılı liste + kalan sayısı; yoksa / eski backend çizilmez", () => {
    const notes = [{ id: "n1", noteNo: "GB-0001", status: "APPROVED" as const, createdAt: "2026-11-01T08:00:00Z" }];
    const { unmount } = renderWithProviders(<SameBatchStrip sameBatch={{ batchNo: "P-77", total: 3, notes }} />);
    const strip = screen.getByTestId("same-batch-strip");
    expect(strip).toHaveTextContent("aynı partili (P-77) 3 başka belgesi var");
    expect(screen.getByRole("link", { name: "GB-0001" })).toHaveAttribute("href", "/operations/gelen-belgeler/n1");
    expect(strip).toHaveTextContent("Onaylandı");
    expect(strip).toHaveTextContent("+2 belge daha");
    unmount();
    renderWithProviders(<SameBatchStrip sameBatch={null} />);
    renderWithProviders(<SameBatchStrip sameBatch={undefined} />);
    renderWithProviders(<SameBatchStrip sameBatch={{ batchNo: "P", total: 0, notes: [] }} />);
    expect(screen.queryByTestId("same-batch-strip")).toBeNull();
  });
});

const BASE = { defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: false };

describe("Genel Ayarlar → Gelen Belge: okuma seçenekleri", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
  });

  it("eski backend alanları göndermez → iki alan çizilmez; BLOCK_SUSPECT seçilince yalnız o gider", async () => {
    getSettings.mockResolvedValue(BASE);
    updateSettings.mockResolvedValue({ ...BASE, unreviewedApproval: "BLOCK_SUSPECT" });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    await userEvent.click(await screen.findByRole("radio", { name: /Yalnız şüpheli değeri engelle/ }));
    expect(screen.queryByTestId("gb-header-line-source")).toBeNull();
    expect(screen.queryByTestId("gb-auto-sender")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ unreviewedApproval: "BLOCK_SUSPECT" });
  });

  it("⭐ varsayılanlar (Çıkış · kapalı) görünür; Giriş + şablondan gönderen seçilince YALNIZ bu iki alan gider", async () => {
    const server = { ...BASE, headerLineMeterSource: "OUTPUT", defaultHeaderLineMeterSource: "OUTPUT", autoSenderFromTemplate: false };
    getSettings.mockResolvedValue(server);
    updateSettings.mockResolvedValue({ ...server, headerLineMeterSource: "INPUT", autoSenderFromTemplate: true });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    expect(await screen.findByRole("radio", { name: /Çıkış \(sevk edilen\) metre/ })).toBeChecked();
    const toggle = screen.getByRole("switch", { name: "Gönderen cariyi okunan şablondan doldur" });
    expect(toggle).not.toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /Giriş metresi/ }));
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toEqual({ headerLineMeterSource: "INPUT", autoSenderFromTemplate: true });
  });

  it("⭐ belge geneli beyan: varsayılan 'Bilgi' seçili; 'Fark gerekçesi iste' seçilince YALNIZ documentTotalCheck gider; eski backend çizilmez", async () => {
    const server = { ...BASE, documentTotalCheck: "INFO", defaultDocumentTotalCheck: "INFO" };
    getSettings.mockResolvedValue(server);
    updateSettings.mockResolvedValue({ ...server, documentTotalCheck: "REQUIRE_REASON" });
    const { unmount } = renderWithProviders(<IncomingDocumentSettingsSection />);
    expect(await screen.findByRole("radio", { name: /Bilgi olarak göster/ })).toBeChecked();
    expect(screen.getByTestId("gb-document-total-check")).toHaveTextContent("Varsayılan: Bilgi olarak göster");
    await userEvent.click(screen.getByRole("radio", { name: /Fark gerekçesi iste/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ documentTotalCheck: "REQUIRE_REASON" });
    unmount();
    getSettings.mockResolvedValue(BASE);
    renderWithProviders(<IncomingDocumentSettingsSection />);
    await screen.findByRole("radio", { name: /Yalnız şüpheli değeri engelle/ });
    expect(screen.queryByTestId("gb-document-total-check")).toBeNull();
  });
});

describe("Genel Ayarlar → Gelen Belge: kayıt kipi (parti no + kurşun metresi)", () => {
  const KIP = {
    ...BASE,
    batchNumberSource: "SERIES", defaultBatchNumberSource: "SERIES",
    entryMode: "PER_LINE", defaultEntryMode: "PER_LINE",
    autoWorkOrderPatternless: "SKIP", defaultAutoWorkOrderPatternless: "SKIP",
  };
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
  });

  it("⭐ varsayılanlar (bugünkü) seçili; üçü değişince YALNIZ bu üç alan gider", async () => {
    getSettings.mockResolvedValue({ ...KIP, defaultItem: { id: "i1", code: "MM", name: "Müşteri malı", problem: null } });
    updateSettings.mockResolvedValue(KIP);
    renderWithProviders(<IncomingDocumentSettingsSection />);
    expect(await screen.findByRole("radio", { name: /Her satır bir top/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Numara serisinden/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Atla/ })).toBeChecked();
    expect(screen.getByTestId("gb-entry-mode")).toHaveTextContent("Varsayılan: Her satır bir top");
    await userEvent.click(screen.getByRole("radio", { name: /Belge başına tek kayıt/ }));
    expect(screen.queryByTestId("gb-entry-mode-needs-item")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: /Belgedeki parti no/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Hedef değersiz aç/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ entryMode: "PER_DOCUMENT", batchNumberSource: "DOCUMENT", autoWorkOrderPatternless: "OPEN" });
  });

  it("belge başına tek kayıt + varsayılan ürün boş → uyarı; kayıt yine sunucuya gider (kapı sunucuda)", async () => {
    getSettings.mockResolvedValue(KIP);
    updateSettings.mockRejectedValue(new AxiosError("400"));
    renderWithProviders(<IncomingDocumentSettingsSection />);
    await userEvent.click(await screen.findByRole("radio", { name: /Belge başına tek kayıt/ }));
    expect(screen.getByTestId("gb-entry-mode-needs-item")).toHaveTextContent("varsayılan ürünü ister");
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ entryMode: "PER_DOCUMENT" }));
  });

  it("eski backend alanları göndermez → üç alan çizilmez, gövdeye girmez", async () => {
    getSettings.mockResolvedValue(BASE);
    updateSettings.mockResolvedValue(BASE);
    renderWithProviders(<IncomingDocumentSettingsSection />);
    await userEvent.click(await screen.findByRole("radio", { name: /Yalnız şüpheli değeri engelle/ }));
    for (const id of ["gb-entry-mode", "gb-batch-number-source", "gb-auto-work-order-patternless"]) expect(screen.queryByTestId(id)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ unreviewedApproval: "BLOCK_SUSPECT" });
  });
});
