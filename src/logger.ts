import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type LogLevel = "info" | "warn" | "error" | "debug";

export class Logger {
  log(level: LogLevel, message: string, ctx?: ExtensionContext, notify: boolean = false): void {
    switch (level) {
      case "info":
        if (notify && ctx) ctx.ui.notify(message, "info");
        break;
      case "warn":
        if (notify && ctx) ctx.ui.notify(message, "warn");
        break;
      case "error":
        if (notify && ctx) ctx.ui.notify(message, "error");
        break;
      case "debug":
        break;
    }
  }

  info(message: string, ctx?: ExtensionContext, notify: boolean = false): void {
    this.log("info", message, ctx, notify);
  }

  warn(message: string, ctx?: ExtensionContext, notify: boolean = false): void {
    this.log("warn", message, ctx, notify);
  }

  error(message: string, ctx?: ExtensionContext, notify: boolean = false): void {
    this.log("error", message, ctx, notify);
  }

  debug(message: string): void {
    this.log("debug", message);
  }
}

export const logger = new Logger();
