/**
 * Fuzz target: an email file, as the mail tool reads one (`readMessage`). The bytes are an attachment
 * or a file the agent was pointed at: `.eml` (MIME), or `.msg`, which `readMessage` hands to the
 * compound-file reader by its signature.
 *
 * A `MailError` is the parser refusing the input — unreadable, encrypted, over budget — and is not a
 * finding. Anything else thrown, a hang or a crash is.
 */
import { MailError, readMessage } from "../../server/src/mail.ts";

export function fuzz(data: Buffer): void {
  try {
    readMessage(data);
  } catch (error) {
    if (error instanceof MailError) return;
    throw error;
  }
}
