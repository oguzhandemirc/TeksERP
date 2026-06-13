// Vitest global setup — Testing Library jest-dom matcher'ları (toBeInTheDocument vb.)
// + her testten sonra DOM temizliği.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
