import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createSecureContext } from "node:tls";
import type { ServerOptions } from "node:https";
import type { AppConfig } from "./config.ts";

/** Read once at startup; a TLS failure never selects a plaintext fallback. */
export async function listenerTls(config: Pick<AppConfig, "tls">): Promise<ServerOptions | undefined> {
  if (!config.tls) return undefined;
  const { certFile, keyFile } = config.tls;
  let cert: Buffer;
  let key: Buffer;
  try {
    [cert, key] = await Promise.all([readFile(certFile), readFile(keyFile)]);
  } catch {
    throw new Error("Cannot read server.tls certificate/key files; check the configured paths and service-account permissions.");
  }
  try {
    const certificate = new X509Certificate(cert);
    const now = Date.now();
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
      throw new Error("certificate outside validity period");
    }
    const options: ServerOptions = { cert, key, minVersion: "TLSv1.2" };
    // Node checks PEM parsing and certificate/private-key agreement here, before listen.
    createSecureContext(options);
    return options;
  } catch {
    // OpenSSL diagnostics are deliberately not forwarded: no input key bytes in errors.
    throw new Error("Invalid server.tls certificate/key pair: use matching PEM files with a currently valid certificate. HTTPS startup refused; no HTTP fallback.");
  }
}
