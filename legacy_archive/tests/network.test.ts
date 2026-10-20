import { describe, it, expect } from "vitest";
import { isPublicAddress, validatePublicUrl } from "../server/network";
import { validateCanvasDomain } from "../server/canvas";
describe("integration boundaries", () => {
  it("blocks loopback, private, link-local, multicast, mapped private IPv6", () => {
    for (const address of [
      "127.0.0.1",
      "10.2.3.4",
      "192.168.1.1",
      "172.16.1.1",
      "169.254.169.254",
      "::1",
      "fe80::1",
      "fc00::1",
      "224.0.0.1",
      "::ffff:127.0.0.1",
    ])
      expect(isPublicAddress(address), address).toBe(false);
  });
  it("accepts public network addresses", () => {
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("rejects unsupported protocols and credential-bearing URLs", async () => {
    await expect(validatePublicUrl("http://example.com")).rejects.toThrow(
      "HTTPS",
    );
    await expect(
      validatePublicUrl("https://name:password@example.com"),
    ).rejects.toThrow("HTTPS");
    await expect(validatePublicUrl("https://example.com:8443")).rejects.toThrow(
      "HTTPS",
    );
  });
  it("restricts Canvas tokens to school Instructure domains", () => {
    expect(validateCanvasDomain("https://school.instructure.com/")).toBe(
      "school.instructure.com",
    );
    for (const domain of [
      "instructure.com.evil.test",
      "school.instructure.com@evil.test",
      "localhost",
      "school.instructure.com/path",
    ])
      expect(() => validateCanvasDomain(domain)).toThrow("school");
  });
});
