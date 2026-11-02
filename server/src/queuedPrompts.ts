/**
 * The prompts waiting in the agent's queue, as the user typed them.
 *
 * pi keeps its queue as the *expanded* text of each message (input handlers run,
 * `/skill:` and prompt templates replaced), reports it whole on every change
 * (`queue_update`, one change per event), removes the first entry with a text when
 * it delivers that text, and can only give the whole queue back (`clearQueue()`),
 * texts only. To show, edit and remove a queued prompt the server needs what pi does
 * not keep: the text the user typed, the text that was sent, the images, and which
 * entry is which. This keeps that, and lets pi stay the authority on what is queued:
 * it is fed pi's own lists and reconciles them, and never infers a delivery from
 * anything else.
 *
 * A new string in pi's list is matched to the oldest *expectation* — a prompt the
 * server sent and has not yet seen accepted. One with no expectation is *foreign*:
 * an extension queued it, and the server cannot re-queue it faithfully.
 */
import type { QueuedPrompt, WireImage } from "@pi-outpost/shared";

export type QueueKind = QueuedPrompt["kind"];

/** What the server sent for a prompt: enough to show it, and to send it again. */
export interface QueuedPromptSource {
  /** What the user typed, and sees. */
  text: string;
  /** What was sent to the agent (mentions made absolute). */
  promptText: string;
  images?: WireImage[];
}

export interface QueuedEntry {
  id: string;
  kind: QueueKind;
  /** pi's string for this entry: what identifies it in pi's lists. */
  piText: string;
  /** Absent for a foreign entry. */
  source?: QueuedPromptSource;
}

/** A prompt the server is sending; consumed by the queue entry it becomes, if it becomes one. */
export interface Expectation {
  readonly source: QueuedPromptSource;
  /** The queue it goes to: a prompt sent during a turn is a steer. */
  readonly kind: QueueKind;
  /** The id the entry keeps: set when a prompt is queued again after a take-back. */
  readonly id?: string;
}

export interface QueueLists {
  steering: readonly string[];
  followUp: readonly string[];
}

export class QueuedPrompts {
  private entries: QueuedEntry[] = [];
  private expectations: Expectation[] = [];
  private suspended = false;
  private nextId = 1;

  constructor(private readonly idPrefix = "q") {}

  /** Register a prompt about to be sent. Call `settle` once the runtime has answered. */
  expect(source: QueuedPromptSource, options: { kind?: QueueKind; id?: string } = {}): Expectation {
    const expectation: Expectation = { source, kind: options.kind ?? "steer", ...(options.id !== undefined ? { id: options.id } : {}) };
    this.expectations.push(expectation);
    return expectation;
  }

  /**
   * The runtime answered. A prompt it did not queue (started a turn, handled by an
   * extension, refused) will never appear in the queue: forget it, or the next foreign
   * entry would be taken for it.
   */
  settle(expectation: Expectation, queued: boolean): void {
    if (queued) return;
    const index = this.expectations.indexOf(expectation);
    if (index !== -1) this.expectations.splice(index, 1);
  }

  /**
   * pi reported its queue. Returns the entries it delivered since the last report, in
   * order, so the caller can put them in the conversation; and whether anything changed.
   * While suspended (the queue is being taken back), reports are ignored: an emptied
   * queue then means the take-back, not a delivery.
   */
  update(lists: QueueLists): { delivered: QueuedEntry[]; changed: boolean } {
    if (this.suspended) return { delivered: [], changed: false };
    const steering = this.reconcile("steer", lists.steering);
    const followUp = this.reconcile("followUp", lists.followUp);
    const next = [...steering.kept, ...followUp.kept];
    const changed = next.length !== this.entries.length || next.some((entry, i) => entry !== this.entries[i]);
    this.entries = next;
    return { delivered: [...steering.delivered, ...followUp.delivered], changed };
  }

  /** Stop reading reports: the caller is about to take the whole queue back. */
  suspend(): void {
    this.suspended = true;
  }

  /**
   * The queue was taken back, and `returned` is what pi held at that moment. Entries
   * missing from it were delivered just before. The tracker is empty and reading
   * reports again afterwards; the caller queues `kept` again.
   */
  takeBack(returned: QueueLists): { delivered: QueuedEntry[]; kept: QueuedEntry[] } {
    this.suspended = false;
    const steering = this.reconcile("steer", returned.steering);
    const followUp = this.reconcile("followUp", returned.followUp);
    this.entries = [];
    return { delivered: [...steering.delivered, ...followUp.delivered], kept: [...steering.kept, ...followUp.kept] };
  }

  /** The take-back failed: nothing changed in pi, so read reports again as before. */
  resume(): void {
    this.suspended = false;
  }

  /** A new session: its queue starts empty, and nothing sent to the old one is coming. */
  reset(): void {
    this.entries = [];
    this.expectations = [];
    this.suspended = false;
  }

  find(id: string): QueuedEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  get hasForeign(): boolean {
    return this.entries.some((entry) => entry.source === undefined);
  }

  get size(): number {
    return this.entries.length;
  }

  /** What clients show. Editable only when the caller can rewrite the queue and nothing in it is foreign. */
  view(canRewrite: boolean): QueuedPrompt[] {
    const editable = canRewrite && !this.hasForeign;
    return this.entries.map((entry) => ({
      id: entry.id,
      text: entry.source?.text ?? entry.piText,
      ...(entry.source?.images?.length ? { images: entry.source.images } : {}),
      kind: entry.kind,
      editable,
    }));
  }

  /**
   * One kind's list against pi's. pi changes one thing per report: it appends a message,
   * or removes the first one with a text it delivered. So, per text, if pi now holds
   * fewer than we do, the *first* of ours with that text were delivered; if it holds
   * more, the extra ones are new. New strings are matched to expectations in order.
   */
  private reconcile(kind: QueueKind, list: readonly string[]): { kept: QueuedEntry[]; delivered: QueuedEntry[] } {
    const ours = this.entries.filter((entry) => entry.kind === kind);
    const byText = new Map<string, QueuedEntry[]>();
    for (const entry of ours) byText.set(entry.piText, [...(byText.get(entry.piText) ?? []), entry]);
    const theirs = new Map<string, number>();
    for (const text of list) theirs.set(text, (theirs.get(text) ?? 0) + 1);

    const delivered: QueuedEntry[] = [];
    for (const [text, entries] of byText) {
      const surplus = entries.length - (theirs.get(text) ?? 0);
      if (surplus > 0) delivered.push(...entries.splice(0, surplus));
    }
    const kept = list.map((text) => byText.get(text)?.shift() ?? this.adopt(kind, text));
    // Delivered in queue order, which is the order the agent read them in.
    delivered.sort((a, b) => ours.indexOf(a) - ours.indexOf(b));
    return { kept, delivered };
  }

  /**
   * A new string in pi's list. An extension can queue a message of its own while one of
   * ours is still in its input handlers, so the oldest expectation is not necessarily the
   * one: take one of the same queue whose text pi kept as is, else the oldest of the same
   * queue — pi may have expanded ours (`/skill:`, a template, an input transform).
   */
  private adopt(kind: QueueKind, piText: string): QueuedEntry {
    const sameKind = this.expectations.filter((candidate) => candidate.kind === kind);
    const expectation = sameKind.find((candidate) => candidate.source.promptText === piText) ?? sameKind[0];
    if (expectation) this.expectations.splice(this.expectations.indexOf(expectation), 1);
    return { id: expectation?.id ?? `${this.idPrefix}${this.nextId++}`, kind, piText, ...(expectation ? { source: expectation.source } : {}) };
  }
}
