// Gülkesim K27 aynı gönderen belge no (WARN kipi): onay 409 `DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE` kutusu + "Yine de
// onayla" bayrakla yeniden gönderir · taslak detay şeridi · ayar radyosu (varsayılan Engelle; yalnız değişen alan gider).
// Negatif sonda: ApproveDialog'da `run.mutate(true)` → `run.mutate(false)` yapılınca "Yine de onayla" testi kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { renderWithProviders } from "@/test/render";
import { ApproveDialog } from "../ApproveDialog";
import { DuplicateDocNoStrip, duplicateDocNoConflict, duplicateGateConflict, withDuplicateConfirm } from "../DuplicateDocNo";
import { IncomingDocumentSettingsSection } from "@/pages/GeneralSettings/GelenBelgeSettingsSection";

const approveNote = vi.fn();
const getSettings = vi.fn();
const updateSettings = vi.fn();
vi.mock("../service", () => ({
  approveNote: (...a: unknown[]) => approveNote(...a),
  INCOMING_DOCUMENT_QUERY_KEY: "gelen-belge",
  getSuggestions: () => Promise.resolve({ noteId: "n1", lines: [] }),
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

const PEERS = [{ id: "p1", noteNo: "GB-0007", status: "APPROVED" as const, workOrderNumbers: ["IE-12"] }];
const err409 = (code: string, details: object = {}) =>
  new AxiosError("409", "ERR", undefined, undefined, { status: 409, data: { message: "Aynı belge no", details: { code, ...details } } } as AxiosResponse);
const ok = { warnings: ["GB-0009: aynı belge no (A-1) işi süren GB-0007 varken operatör onayıyla kaydedildi."], result: { note: { status: "APPROVED", lines: [] }, summary: { entered: 1, failed: 0, skipped: 0, replayed: 0, rollIds: [] } } };

describe("duplicateDocNoConflict", () => {
  it("yalnız DUPLICATE_DOC_NO_ACTIVE kodunda künye; BLOCK kodu (DUPLICATE_DOC_NO) ve başka hata null", () => {
    expect(duplicateDocNoConflict(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE", { senderDocNo: "A-1", peers: PEERS }))).toEqual({ senderDocNo: "A-1", peers: PEERS });
    expect(duplicateDocNoConflict(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO"))).toBeNull();
    expect(duplicateDocNoConflict(new Error("x"))).toBeNull();
  });
});

describe("ApproveDialog — aynı belge no (WARN)", () => {
  beforeEach(() => {
    approveNote.mockReset();
    getSettings.mockReset().mockResolvedValue({ defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN" });
  });
  it("⭐ 409 → kutu + önceki belge bağlantısı; 'Yine de onayla' bayrakla yeniden gönderir ve sonuç uyarısı görünür", async () => {
    approveNote.mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE", { senderDocNo: "A-1", peers: PEERS })).mockResolvedValueOnce(ok);
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    const box = await screen.findByTestId("duplicate-doc-no-confirm");
    expect(box).toHaveTextContent("Bu belge no (A-1) GB-0007 olarak zaten kayıtlı (iş sürüyor). Aynı kâğıdı ikinci kez mi okutuyorsunuz?");
    expect(within(box).getByTestId("duplicate-doc-no-open")).toHaveAttribute("href", "/operations/gelen-belgeler/p1");
    expect(screen.queryByTestId("approve-error")).toBeNull();
    expect(approveNote.mock.calls[0]![3]).toBeUndefined();
    await userEvent.click(within(box).getByRole("button", { name: "Yine de onayla" }));
    await screen.findByTestId("approve-result");
    expect(approveNote.mock.calls[1]![3]).toStrictEqual({ confirmDuplicateDocNo: true });
    expect(screen.getByTestId("approve-result")).toHaveTextContent("operatör onayıyla kaydedildi");
  });
  it("BLOCK kodu (DUPLICATE_DOC_NO) bugünkü gibi genel hata; kutu çizilmez", async () => {
    approveNote.mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO"));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await screen.findByTestId("approve-error");
    expect(screen.queryByTestId("duplicate-doc-no-confirm")).toBeNull();
  });
});

describe("DuplicateDocNoStrip", () => {
  it("⭐ işi süren eşler bağlantıyla + İE no; null / boş / eski backend çizilmez", () => {
    const { unmount } = renderWithProviders(<DuplicateDocNoStrip notice={{ senderDocNo: "A-1", peers: PEERS }} />);
    expect(screen.getByTestId("duplicate-doc-no-strip")).toHaveTextContent("Bu belge no (A-1) işi süren başka belgede de kayıtlı");
    expect(screen.getByRole("link", { name: "GB-0007" })).toHaveAttribute("href", "/operations/gelen-belgeler/p1");
    expect(screen.getByTestId("duplicate-doc-no-peer")).toHaveTextContent("Onaylandı · IE-12");
    unmount();
    renderWithProviders(<><DuplicateDocNoStrip notice={null} /><DuplicateDocNoStrip notice={undefined} /><DuplicateDocNoStrip notice={{ senderDocNo: "A-1", peers: [] }} /></>);
    expect(screen.queryByTestId("duplicate-doc-no-strip")).toBeNull();
  });
});

describe("Genel Ayarlar → Gelen Belge: aynı belge no", () => {
  const BASE = { defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: false };
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
  });
  it("⭐ varsayılan Engelle seçili; 'İşi sürüyorsa uyar' seçilince YALNIZ duplicateDocNo gider; eski backend çizilmez", async () => {
    const server = { ...BASE, duplicateDocNo: "BLOCK", defaultDuplicateDocNo: "BLOCK" };
    getSettings.mockResolvedValue(server);
    updateSettings.mockResolvedValue({ ...server, duplicateDocNo: "WARN" });
    const { unmount } = renderWithProviders(<IncomingDocumentSettingsSection />);
    const field = await screen.findByTestId("gb-duplicate-doc-no");
    expect(within(field).getByRole("radio", { name: /^Engelle/ })).toBeChecked();
    expect(field).toHaveTextContent("Varsayılan: Engelle");
    await userEvent.click(within(field).getByRole("radio", { name: /İşi sürüyorsa uyar/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ duplicateDocNo: "WARN" });
    unmount();
    getSettings.mockResolvedValue(BASE);
    renderWithProviders(<IncomingDocumentSettingsSection />);
    await screen.findByTestId("gelen-belge-settings");
    expect(screen.queryByTestId("gb-duplicate-doc-no")).toBeNull();
  });
});

describe("Genel Ayarlar → Gelen Belge: aynı müşteri parti no", () => {
  const BASE = { defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: false };
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
  });
  it("⭐ varsayılan İzin ver seçili; 'Uyar' seçilince YALNIZ duplicateBatchNo gider; eski backend çizilmez", async () => {
    const server = { ...BASE, duplicateDocNo: "BLOCK", defaultDuplicateDocNo: "BLOCK", duplicateBatchNo: "ALLOW", defaultDuplicateBatchNo: "ALLOW" };
    getSettings.mockResolvedValue(server);
    updateSettings.mockResolvedValue({ ...server, duplicateBatchNo: "WARN" });
    const { unmount } = renderWithProviders(<IncomingDocumentSettingsSection />);
    const field = await screen.findByTestId("gb-duplicate-batch-no");
    expect(within(field).getByRole("radio", { name: /^İzin ver/ })).toBeChecked();
    expect(field).toHaveTextContent("Varsayılan: İzin ver");
    expect(within(field).getByRole("radio", { name: /^Engelle/ })).not.toBeChecked();
    await userEvent.click(within(field).getByRole("radio", { name: /^Uyar/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toStrictEqual({ duplicateBatchNo: "WARN" });
    unmount();
    getSettings.mockResolvedValue({ ...BASE, duplicateDocNo: "BLOCK" });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    await screen.findByTestId("gb-duplicate-doc-no");
    expect(screen.queryByTestId("gb-duplicate-batch-no")).toBeNull();
  });
});

describe("ApproveDialog — aynı müşteri parti no", () => {
  const BP = [{ id: "p2", noteNo: "GB-0005", customerBatchNo: "ISM1439770", workOrderNumber: "IE0911260003" }];
  beforeEach(() => approveNote.mockReset());
  it("künye: WARN onaylanır, BLOCK onaylanmaz; bayraklar birikir", () => {
    const warn = duplicateGateConflict(err409("DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE", { peers: BP }));
    expect(warn).toEqual({ gate: "batchNo", confirmable: true, peers: BP });
    expect(duplicateGateConflict(err409("DELIVERY_NOTE_DUPLICATE_BATCH_NO", { peers: BP }))).toMatchObject({ gate: "batchNo", confirmable: false });
    expect(duplicateGateConflict(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO"))).toBeNull();
    expect(withDuplicateConfirm({ confirmDuplicateDocNo: true }, warn!)).toStrictEqual({ confirmDuplicateDocNo: true, confirmDuplicateBatchNo: true });
  });
  it("⭐ WARN 409 → 'BU PARTİ ZATEN VAR' + satır; 'Yine de aç' önceki belge no onayıyla birlikte gönderir", async () => {
    approveNote
      .mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE", { senderDocNo: "A-1", peers: PEERS }))
      .mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE", { peers: BP }))
      .mockResolvedValueOnce(ok);
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    await userEvent.click(within(await screen.findByTestId("duplicate-doc-no-confirm")).getByRole("button", { name: "Yine de onayla" }));
    const box = await screen.findByTestId("duplicate-batch-no-confirm");
    expect(box).toHaveTextContent("BU PARTİ ZATEN VAR");
    expect(box).toHaveTextContent("ISM1439770 → IE0911260003");
    expect(screen.queryByTestId("approve-error")).toBeNull();
    await userEvent.click(within(box).getByRole("button", { name: "Yine de aç" }));
    await screen.findByTestId("approve-result");
    expect(approveNote.mock.calls[2]![3]).toStrictEqual({ confirmDuplicateDocNo: true, confirmDuplicateBatchNo: true });
  });
  it("BLOCK 409 → yalnız bilgi ('Tamam'), onay düğmesi yok, yeniden gönderim yok", async () => {
    approveNote.mockRejectedValueOnce(err409("DELIVERY_NOTE_DUPLICATE_BATCH_NO", { peers: BP }));
    renderWithProviders(<ApproveDialog noteId="n1" lines={[]} open onOpenChange={() => {}} onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Onayla" }));
    const box = await screen.findByTestId("duplicate-batch-no-confirm");
    expect(within(box).queryByRole("button", { name: "Yine de aç" })).toBeNull();
    await userEvent.click(within(box).getByRole("button", { name: "Tamam" }));
    await waitFor(() => expect(screen.queryByTestId("duplicate-batch-no-confirm")).toBeNull());
    expect(approveNote).toHaveBeenCalledTimes(1);
  });
});
