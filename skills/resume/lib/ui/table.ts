/**
 * Minimal Unicode box-drawing table renderer for CLI output.
 *
 * Pure and dependency-free. Computes column widths from content, word-wraps
 * cells that exceed a per-column cap, and supports left/right alignment.
 * Returns a string (caller decides where to print it) so it stays testable.
 */
export interface TableOptions {
  /** Per-column alignment. Defaults to "left" for every column. */
  align?: ("left" | "right")[];
  /** Total table width budget (incl. borders). Defaults to 80, or terminal width. */
  maxWidth?: number;
  /** Indent every line by this many spaces. */
  indent?: number;
}

export function renderTable(
  headers: string[],
  rows: string[][],
  opts: TableOptions = {},
): string {
  const cols = headers.length;
  const align = opts.align ?? headers.map(() => "left" as const);
  const maxWidth = opts.maxWidth ?? 80;
  const indent = " ".repeat(opts.indent ?? 0);

  // Natural width of each column (longest single line in any cell/header).
  const natural = headers.map((h, c) =>
    Math.max(visW(h), ...rows.map((r) => visW(r[c] ?? "")), 1),
  );

  // Budget: borders take (cols + 1) verticals + 2 padding spaces per column.
  const overhead = cols + 1 + cols * 2;
  const avail = Math.max(cols * 6, maxWidth - overhead);
  const widths = fitWidths(natural, avail);

  // Wrap every cell to its column width.
  const wrap = (text: string, w: number) => wrapCell(text, w);
  const headerLines = headers.map((h, c) => wrap(h, widths[c]));
  const bodyLines = rows.map((r) => r.map((cell, c) => wrap(cell ?? "", widths[c])));

  const top = border("┌", "┬", "┐", widths, indent);
  const mid = border("├", "┼", "┤", widths, indent);
  const bot = border("└", "┴", "┘", widths, indent);

  const out: string[] = [top];
  out.push(...renderRow(headerLines, widths, align, indent));
  out.push(mid);
  for (const rowLines of bodyLines) {
    out.push(...renderRow(rowLines, widths, align, indent));
  }
  out.push(bot);
  return out.join("\n");
}

// ---- internals ----

/** Visible width (strips ANSI; counts code points, not UTF-16 units). */
function visW(s: string): number {
  return [...stripAnsi(s)].length;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Shrink the widest columns until the total fits the available budget. */
function fitWidths(natural: number[], avail: number): number[] {
  const widths = natural.slice();
  let total = widths.reduce((a, b) => a + b, 0);
  let guard = 10_000;
  while (total > avail && guard-- > 0) {
    // Trim the currently-widest column by one.
    let widest = 0;
    for (let i = 1; i < widths.length; i++) if (widths[i] > widths[widest]) widest = i;
    if (widths[widest] <= 4) break; // don't collapse below a usable minimum
    widths[widest]--;
    total--;
  }
  return widths;
}

/** Greedy word-wrap; hard-breaks tokens longer than the column. */
function wrapCell(text: string, width: number): string[] {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  if (words.length === 1 && words[0] === "") return [""];
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (visW(word) > width) {
      // Hard break an over-long token.
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      const head = [...word].slice(0, width).join("");
      lines.push(head);
      word = [...word].slice(width).join("");
    }
    if (!cur) cur = word;
    else if (visW(cur) + 1 + visW(word) <= width) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function border(
  left: string,
  joiner: string,
  right: string,
  widths: number[],
  indent: string,
): string {
  return indent + left + widths.map((w) => "─".repeat(w + 2)).join(joiner) + right;
}

function renderRow(
  cellLines: string[][],
  widths: number[],
  align: ("left" | "right")[],
  indent: string,
): string[] {
  const height = Math.max(...cellLines.map((l) => l.length), 1);
  const lines: string[] = [];
  for (let row = 0; row < height; row++) {
    const parts = cellLines.map((lines, c) => {
      const text = lines[row] ?? "";
      const pad = widths[c] - visW(text);
      const padded =
        align[c] === "right" ? " ".repeat(Math.max(0, pad)) + text : text + " ".repeat(Math.max(0, pad));
      return ` ${padded} `;
    });
    lines.push(indent + "│" + parts.join("│") + "│");
  }
  return lines;
}
