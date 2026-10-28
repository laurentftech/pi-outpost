import { afterEach, describe, expect, it, vi } from "vitest";
import { readUploadFile, UploadError } from "./uploads";

describe("readUploadFile failures", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["error", "abort"])("reports a FileReader %s instead of leaving the import pending", async (event) => {
    vi.stubGlobal("FileReader", class {
      onerror?: () => void;
      onabort?: () => void;
      readAsDataURL() { queueMicrotask(() => event === "error" ? this.onerror?.() : this.onabort?.()); }
    });
    await expect(readUploadFile(new File(["bytes"], "file.txt"))).rejects.toThrow(
      event === "error" ? "The file could not be read" : "Reading the file was cancelled",
    );
    await expect(readUploadFile(new File(["bytes"], "file.txt"))).rejects.toBeInstanceOf(UploadError);
  });
});
