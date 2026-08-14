/**
 * What a spreadsheet cell *means*, from the number format the workbook points it at.
 *
 * A cell is `<c r="B2" s="3"><v>45292</v></c>`. Nothing there says the value is a
 * date; `s="3"` indexes `cellXfs` in `xl/styles.xml`, whose entry carries a
 * `numFmtId`, and only that identifier separates a date from a price from a count.
 * Returning `45292` is technically correct and semantically wrong, in a way the
 * output does not reveal — which is why this module exists at all.
 *
 * DETERMINISM: the rendering here is *not* a reproduction of Excel's. Excel's
 * display depends on the reader's locale — built-in id 14 shows the system short
 * date, and the built-in currency ids take their symbol from the system, so the
 * same file reads differently on two machines. A server has no such locale, and
 * inventing one would make extraction depend on where it runs. So: ISO dates and
 * times, `.` as decimal separator, no thousands separator, `%` for percentages,
 * and a currency symbol only when the workbook's own format string states one.
 * What is preserved is the format's *kind* and its *declared precision*; what is
 * dropped is presentation that only ever existed at display time.
 *
 * Nothing below may use `Intl`, `toLocaleString`, or a local-time getter.
 */

export type CellFormat =
  /** No format applied — render the number as it is. */
  | { kind: "general" }
  /** `@` — the value is shown as text. */
  | { kind: "text" }
  /** `decimals: null` means the format declared no decimal placeholders. */
  | { kind: "number"; decimals: number | null }
  | { kind: "percent"; decimals: number }
  /** `symbol` is only ever a literal the format string carries. */
  | { kind: "currency"; symbol: string; decimals: number }
  | { kind: "datetime"; date: boolean; time: boolean }
  /**
   * The chain broke: an id neither built in nor defined by the workbook. The
   * caller renders the raw value and marks the cell — silence here would be the
   * plausible-but-wrong table this whole module exists to prevent.
   */
  | { kind: "unresolved" };

/**
 * The built-in format ids, as ECMA-376 lists them — with the currency symbols
 * deliberately removed.
 *
 * Ids 5–8 and 41–44 are the "currency" and "accounting" formats, and the symbol
 * they show comes from the reader's system, not from the file. Under the rule
 * this module works to — a symbol only when the format string states one — a
 * built-in id can never contribute one, because the file says nothing but a
 * number. So they resolve to their numeric shape, and the value comes back as a
 * plain number rather than wearing a currency we guessed.
 *
 * Ids 23–36 are reserved and locale-specific; they are absent on purpose, so
 * they resolve as unresolved and say so.
 */
const BUILTIN_FORMATS = new Map<number, string>([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [5, "#,##0_);(#,##0)"],
  [6, "#,##0_);[Red](#,##0)"],
  [7, "#,##0.00_);(#,##0.00)"],
  [8, "#,##0.00_);[Red](#,##0.00)"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [12, "# ?/?"],
  [13, "# ??/??"],
  [14, "mm-dd-yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [41, "_(* #,##0_);_(* (#,##0);_(* \"-\"_);_(@_)"],
  [42, "_(* #,##0_);_(* (#,##0);_(* \"-\"_);_(@_)"],
  [43, "_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)"],
  [44, "_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"],
]);

/** The format code for an id, preferring what the workbook defines over the built-in table. */
export function formatCodeFor(numFmtId: number, workbookFormats: Map<number, string>): string | undefined {
  return workbookFormats.get(numFmtId) ?? BUILTIN_FORMATS.get(numFmtId);
}

/* ── Reading a format code ──────────────────────────────────────────────────── */

/**
 * One piece of a format section: text that is shown as written, or format codes
 * whose letters carry meaning.
 *
 * Splitting first is what makes `"May"` a literal rather than a month token and
 * `[Red]` a colour rather than a date. A parser that scans letters without this
 * step reads a currency name as a date pattern.
 */
interface Piece {
  kind: "literal" | "code";
  text: string;
}

function tokenizeSection(section: string): { pieces: Piece[]; symbol: string; elapsed: boolean } {
  const pieces: Piece[] = [];
  let symbol = "";
  let elapsed = false;
  let code = "";

  const flush = () => {
    if (code !== "") pieces.push({ kind: "code", text: code });
    code = "";
  };

  for (let at = 0; at < section.length; at++) {
    const char = section[at];

    if (char === '"') {
      const end = section.indexOf('"', at + 1);
      const literal = section.slice(at + 1, end === -1 ? section.length : end);
      flush();
      pieces.push({ kind: "literal", text: literal });
      symbol += currencyish(literal);
      at = end === -1 ? section.length : end;
      continue;
    }
    if (char === "\\") {
      // An escaped character is shown as written: `\€` is a euro sign, not a code
      const next = section[at + 1] ?? "";
      flush();
      pieces.push({ kind: "literal", text: next });
      symbol += currencyish(next);
      at++;
      continue;
    }
    if (char === "_" || char === "*") {
      // `_x` reserves the width of x, `*x` repeats x to fill. Both are spacing,
      // and the character they carry is never content.
      at++;
      continue;
    }
    if (char === "[") {
      const end = section.indexOf("]", at + 1);
      const body = section.slice(at + 1, end === -1 ? section.length : end);
      if (body.startsWith("$")) {
        // `[$€-407]` states a currency; `[$-409]` states only a locale
        const dash = body.indexOf("-");
        symbol += dash === -1 ? body.slice(1) : body.slice(1, dash);
      } else if (/^[hms]+$/i.test(body)) {
        // `[h]` is elapsed time, which is a duration and not a clock reading
        elapsed = true;
      }
      // [Red], [Blue], [<=100] and the rest are presentation or conditions
      at = end === -1 ? section.length : end;
      continue;
    }
    code += char;
  }
  flush();
  return { pieces, symbol, elapsed };
}

/** Characters a literal contributes as a currency symbol — never letters or digits. */
function currencyish(literal: string): string {
  return [...literal].filter((char) => /[^\s\w.,;:()\-+/#?*%@[\]]/u.test(char)).join("");
}

/**
 * Whether an `m` run means months or minutes.
 *
 * The rule Excel uses, and the reason this cannot be decided character by
 * character: `m` is minutes when it follows an hour or precedes a second, and
 * months everywhere else. `h:mm` is a clock, `mm-dd-yy` is a date, and the two
 * differ only by what surrounds them.
 */
function isMinuteRun(codeText: string, start: number, end: number): boolean {
  for (let at = start - 1; at >= 0; at--) {
    const char = codeText[at].toLowerCase();
    if (char === "h") return true;
    if ("ymds".includes(char)) break;
  }
  for (let at = end; at < codeText.length; at++) {
    const char = codeText[at].toLowerCase();
    if (char === "s") return true;
    if ("yhmd".includes(char)) break;
  }
  return false;
}

/**
 * What one section of a format code means.
 *
 * Deliberately not a format engine: it decides *kind* and *precision* and stops.
 * Conditional sections, colours, locale prefixes, fill and width characters are
 * recognised so they cannot be mistaken for content, and then stepped over.
 */
export function analyzeFormatSection(section: string): CellFormat {
  const { pieces, symbol, elapsed } = tokenizeSection(section);
  const codeText = pieces
    .filter((piece) => piece.kind === "code")
    .map((piece) => piece.text)
    .join("");

  if (codeText.includes("@")) return { kind: "text" };

  let hasDate = false;
  let hasTime = elapsed;
  for (let at = 0; at < codeText.length; at++) {
    const char = codeText[at].toLowerCase();
    if (!"ymdhs".includes(char)) continue;
    let end = at;
    while (end < codeText.length && codeText[end].toLowerCase() === char) end++;
    if (char === "y" || char === "d") hasDate = true;
    else if (char === "h" || char === "s") hasTime = true;
    else if (isMinuteRun(codeText, at, end)) hasTime = true;
    else hasDate = true;
    at = end - 1;
  }
  if (hasDate || hasTime) return { kind: "datetime", date: hasDate, time: hasTime };

  const placeholders = /[0#?]/.test(codeText);
  const decimalMatch = /[0#?]*\.([0#?]+)/.exec(codeText);
  const decimals = decimalMatch ? decimalMatch[1].length : placeholders ? 0 : null;

  if (codeText.includes("%")) return { kind: "percent", decimals: decimals ?? 0 };
  if (symbol !== "") return { kind: "currency", symbol, decimals: decimals ?? 0 };
  if (!placeholders && codeText.trim().toLowerCase() === "general") return { kind: "general" };
  if (!placeholders) return { kind: "general" };
  return { kind: "number", decimals };
}

/**
 * A format code, for a value of this sign.
 *
 * `positive;negative;zero;text` — a code may declare up to four sections, and
 * only the one matching the value describes how it is shown. A parser that
 * always reads the first gets the decimals of a negative number wrong whenever
 * the two sections disagree.
 */
export function parseFormatCode(code: string, value: number): CellFormat {
  const sections = splitSections(code);
  if (sections.length === 0) return { kind: "general" };
  let index = 0;
  if (value < 0 && sections.length > 1) index = 1;
  else if (value === 0 && sections.length > 2) index = 2;
  return analyzeFormatSection(sections[index]);
}

/** Split on `;` — but not on one inside a literal, a bracket, or an escape. */
function splitSections(code: string): string[] {
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  let bracketed = false;
  for (let at = 0; at < code.length; at++) {
    const char = code[at];
    if (char === "\\") {
      current += char + (code[at + 1] ?? "");
      at++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "[") bracketed = true;
    else if (!quoted && char === "]") bracketed = false;
    else if (char === ";" && !quoted && !bracketed) {
      sections.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  sections.push(current);
  return sections;
}

/* ── Rendering ──────────────────────────────────────────────────────────────── */

/** The 1900 epoch's day 1 is 1900-01-01, so the base is the day before. */
const EPOCH_1900 = Date.UTC(1899, 11, 31);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const MS_PER_DAY = 86_400_000;

export interface DateParts {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * A serial number as a date.
 *
 * The 1900 system counts a 29th of February 1900 that never happened — Lotus
 * 1-2-3 had the bug and Excel kept it deliberately for compatibility, so it is
 * part of the format rather than a mistake to correct. Serial 60 *is* that
 * phantom day, and serials past it are one greater than the elapsed days.
 *
 * Everything is computed in UTC: a local-time getter would make the same
 * workbook extract differently on a machine in another time zone.
 */
export function serialToDate(serial: number, epoch1904: boolean): DateParts | null {
  if (!Number.isFinite(serial) || serial < 0) return null;

  let days = Math.floor(serial);
  const fraction = serial - days;
  let secondsOfDay = Math.round(fraction * 86_400);
  if (secondsOfDay >= 86_400) {
    secondsOfDay -= 86_400;
    days += 1;
  }

  if (!epoch1904 && days === 60) {
    // The day Excel believes in. Reported as it is shown rather than shifted to a
    // real date, because shifting it would silently disagree with the workbook.
    return {
      year: 1900,
      month: 2,
      day: 29,
      hours: Math.floor(secondsOfDay / 3600),
      minutes: Math.floor((secondsOfDay % 3600) / 60),
      seconds: secondsOfDay % 60,
    };
  }

  const adjusted = !epoch1904 && days > 60 ? days - 1 : days;
  const base = epoch1904 ? EPOCH_1904 : EPOCH_1900;
  const at = new Date(base + adjusted * MS_PER_DAY);
  if (Number.isNaN(at.getTime())) return null;

  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    hours: Math.floor(secondsOfDay / 3600),
    minutes: Math.floor((secondsOfDay % 3600) / 60),
    seconds: secondsOfDay % 60,
  };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatDateParts(parts: DateParts, show: { date: boolean; time: boolean }): string {
  const date = `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
  const time = `${pad(parts.hours, 2)}:${pad(parts.minutes, 2)}:${pad(parts.seconds, 2)}`;
  if (show.date && show.time) return `${date} ${time}`;
  if (show.time) return time;
  return date;
}

/** A number with no format to answer to. `String` is locale-independent; `toLocaleString` is not. */
function generalNumber(value: number): string {
  return String(value);
}

/**
 * A numeric cell value as text, under the format its style points at.
 *
 * Rounding runs through `toFixed`, so `0.15` under `0%` is `15%` rather than
 * `15.000000000000002%` — binary floating point makes the multiplication
 * inexact, and the format's declared precision is what settles it.
 */
export function renderNumericValue(value: number, format: CellFormat, epoch1904: boolean): string {
  switch (format.kind) {
    case "datetime": {
      const parts = serialToDate(value, epoch1904);
      // A negative or unrepresentable serial is not a date whatever the format
      // claims; the number is the honest answer.
      if (parts === null) return generalNumber(value);
      return formatDateParts(parts, { date: format.date, time: format.time });
    }
    case "percent":
      return `${(value * 100).toFixed(format.decimals)}%`;
    case "currency": {
      const magnitude = Math.abs(value).toFixed(format.decimals);
      // The sign goes outside the symbol, so `-€12.00` cannot be read as a
      // currency named "-€".
      return `${value < 0 ? "-" : ""}${format.symbol}${magnitude}`;
    }
    case "number":
      return format.decimals === null ? generalNumber(value) : value.toFixed(format.decimals);
    case "text":
    case "general":
    case "unresolved":
      return generalNumber(value);
  }
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

export interface WorkbookStyles {
  /** `s="3"` indexes this: style index → numFmtId. */
  numberFormatByStyle: number[];
  /** The formats the workbook defines itself, id → format code. */
  formatCodes: Map<number, string>;
}

/**
 * The format a cell's style points at, or `unresolved` when the chain breaks.
 *
 * Every break is reported rather than defaulted: a style index past the table,
 * an id in the reserved locale-specific range, an id the workbook never defined.
 * Falling back to "general" would return the raw number as though it were the
 * displayed one, which is the failure this module is here to prevent.
 */
export function formatForStyle(style: number | undefined, styles: WorkbookStyles, value: number): CellFormat {
  if (style === undefined) return { kind: "general" };
  const numFmtId = styles.numberFormatByStyle[style];
  if (numFmtId === undefined) return { kind: "unresolved" };
  const code = formatCodeFor(numFmtId, styles.formatCodes);
  if (code === undefined) return { kind: "unresolved" };
  return parseFormatCode(code, value);
}
