/**
 * Live progress reporter for the resume CLI.
 *
 * Two render modes, chosen automatically from the stream's TTY-ness:
 *   - TTY: a single in-place line with a braille spinner, the current phase,
 *     a streamed detail (e.g. token count), and an elapsed timer that ticks.
 *   - non-TTY (piped, captured by an agent, CI): discrete one-line-per-phase
 *     output — no spinner frames, no carriage returns, no heartbeat spam.
 *     This is what keeps the experience clean when the skill is driven by a
 *     parent process that captures stdout/stderr.
 *
 * Everything is written to stderr so stdout stays pure for `--json` mode and
 * for piping the result elsewhere.
 */
import { stderr } from "node:process";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface ProgressOptions {
  /** Force TTY (live) or plain (discrete) rendering. Defaults to stderr.isTTY. */
  tty?: boolean;
  /** Stream to write to. Defaults to process.stderr. */
  stream?: NodeJS.WriteStream;
}

export class Progress {
  private readonly isTTY: boolean;
  private readonly out: NodeJS.WriteStream;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = "";
  private detail = "";
  private startMs = 0;

  constructor(opts: ProgressOptions = {}) {
    this.out = opts.stream ?? stderr;
    this.isTTY = opts.tty ?? !!this.out.isTTY;
  }

  /** Begin a phase. In TTY mode starts the spinner/timer; otherwise prints one line. */
  start(label: string): void {
    this.stopTimer();
    this.label = label;
    this.detail = "";
    this.startMs = Date.now();
    if (this.isTTY) {
      this.render();
      this.timer = setInterval(() => this.render(), 80);
      this.timer.unref?.();
    } else {
      this.out.write(`▶ ${label}…\n`);
    }
  }

  /** Update the streamed detail for the current phase (TTY only; ignored when piped). */
  update(detail: string): void {
    this.detail = detail;
    // In non-TTY mode we deliberately do NOT print — discrete phases only.
    if (this.isTTY) this.render();
  }

  /** Resolve the current phase as succeeded. */
  succeed(label?: string): void {
    this.finish(`✓ ${label ?? this.label}${this.elapsedSuffix()}`);
  }

  /** Resolve the current phase as failed. */
  fail(label?: string): void {
    this.finish(`✖ ${label ?? this.label}${this.elapsedSuffix()}`);
  }

  /** Tear down without printing a resolution line (e.g. on unexpected exit). */
  stop(): void {
    this.stopTimer();
    if (this.isTTY) this.clearLine();
  }

  // ---- internals ----

  private finish(line: string): void {
    this.stopTimer();
    if (this.isTTY) this.clearLine();
    this.out.write(`${line}\n`);
  }

  private elapsed(): number {
    return (Date.now() - this.startMs) / 1000;
  }

  private elapsedSuffix(): string {
    const s = this.elapsed();
    return s >= 1 ? `  (${s.toFixed(1)}s)` : "";
  }

  private render(): void {
    if (!this.isTTY) return;
    const spinner = FRAMES[this.frame = (this.frame + 1) % FRAMES.length];
    const elapsed = `${this.elapsed().toFixed(0)}s`;
    const detail = this.detail ? `  ${this.detail}` : "";
    this.clearLine();
    this.out.write(`${spinner} ${this.label}${detail}  ·  ${elapsed}`);
  }

  private clearLine(): void {
    this.out.write("\r\x1b[2K");
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
