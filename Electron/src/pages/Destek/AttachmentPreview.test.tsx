import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AttachmentPreview } from "./AttachmentPreview";
import { destekService } from "./service";
import { codeError } from "./testing";
import type { TicketAttachment } from "./types";

/**
 * Ek önizlemesi sunucu vekilinden (§5.10) `blob:` olarak gelir: panel CSP'si merkez alan adına izin vermez.
 * Ölçülen: eski `baglanti` ucu KULLANILMAZ, blob adresi bileşen kalkınca bırakılır, hata/silinmişte ad görünür.
 */
vi.mock("./service", () => ({
  destekService: { attachmentContent: vi.fn(), attachmentLink: vi.fn() },
}));
const svc = vi.mocked(destekService);

const base: TicketAttachment = {
  id: "a3e1c2d4-1111-4222-8333-944455556666",
  name: "ekran.webp",
  mime: "image/webp",
  size: 48213,
  createdAt: "2026-11-15T09:12:44.120Z",
  hasThumb: true,
  deleted: false,
  deletedAt: null,
};

function mount(a: TicketAttachment) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AttachmentPreview a={a} />
    </QueryClientProvider>,
  );
}

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
let created: string[];
let revoked: string[];
beforeEach(() => {
  vi.resetAllMocks();
  created = [];
  revoked = [];
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:test/${created.length + 1}`;
    created.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
});
afterEach(() => {
  vi.useRealTimers();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

describe("ek önizlemesi (sunucu vekili)", () => {
  it("küçük görsel /icerik?variant=thumb'tan blob olarak çizilir; bileşen kalkınca blob bırakılır", async () => {
    svc.attachmentContent.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
    const view = mount(base);
    const img = await screen.findByRole("img", { name: "ekran.webp" });
    expect(img.getAttribute("src")).toBe("blob:test/1");
    expect(svc.attachmentContent).toHaveBeenCalledWith(base.id, "thumb");
    expect(svc.attachmentLink).not.toHaveBeenCalled();
    view.unmount();
    expect(revoked).toEqual(["blob:test/1"]);
  });

  it("yüklenemezse dosya adı görünür", async () => {
    svc.attachmentContent.mockRejectedValue(codeError(502, "DESTEK_ULASILAMADI"));
    mount(base);
    await waitFor(() => expect(svc.attachmentContent).toHaveBeenCalled());
    expect(await screen.findByText("ekran.webp")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("410 → 'süresi doldu' satırı; silinmiş ek hiç istek atmaz", async () => {
    svc.attachmentContent.mockRejectedValue(codeError(410, "ATTACHMENT_EXPIRED"));
    const view = mount(base);
    expect(await screen.findByText(/Ek süresi dolduğu için silindi/)).toBeInTheDocument();
    view.unmount();
    vi.mocked(svc.attachmentContent).mockClear();
    mount({ ...base, deleted: true, deletedAt: "2026-11-15T10:00:00.000Z" });
    expect(screen.getByText(/Ek süresi dolduğu için silindi/)).toBeInTheDocument();
    expect(svc.attachmentContent).not.toHaveBeenCalled();
  });

  it("PDF önizleme istemez; tıklanınca asıl dosya indirilir ve blob bırakılır", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    svc.attachmentContent.mockResolvedValue(new Blob(["%PDF-"], { type: "application/pdf" }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    mount({ ...base, name: "kilavuz.pdf", mime: "application/pdf", hasThumb: false });
    expect(svc.attachmentContent).not.toHaveBeenCalled();
    screen.getByRole("button", { name: /kilavuz.pdf/ }).click();
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(svc.attachmentContent).toHaveBeenCalledWith(base.id, "original");
    vi.advanceTimersByTime(10_000);
    expect(revoked).toEqual(["blob:test/1"]);
    click.mockRestore();
  });
});
