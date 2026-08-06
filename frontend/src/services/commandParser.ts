/** Frontend command parser for slash commands. */

export interface ParsedCommand {
  command: string | null;
  subcommand: string | null;
  args: string | null;
  isCommand: boolean;
}

export interface CommandResult {
  action: string;
  message: string;
  format?: string;
  sql?: string;
}

const EXPORT_FORMATS = new Set(["csv", "json", "excel"]);

export function parseCommand(inputText: string): ParsedCommand {
  const text = inputText.trim();

  if (!text.startsWith("/")) {
    return { command: null, subcommand: null, args: null, isCommand: false };
  }

  const pattern = /^\/(\w+)(?:\s+(\w+))?(?:\s+(.+))?$/;
  const match = text.match(pattern);

  if (match) {
    const command = match[1]!.toLowerCase();
    const subcommand = match[2] ? match[2].toLowerCase() : null;
    const args = match[3] || null;
    return { command, subcommand, args, isCommand: true };
  }

  return { command: null, subcommand: null, args: null, isCommand: false };
}

export function executeCommand(inputText: string): CommandResult {
  const parsed = parseCommand(inputText);

  if (!parsed.isCommand) {
    return { action: "not_a_command", message: "Input is not a command." };
  }

  switch (parsed.command) {
    case "export":
      return handleExport(parsed, inputText);
    case "auto":
      return handleAuto(parsed, inputText);
    case "help":
      return { action: "help", message: getHelpText() };
    default:
      return {
        action: "unknown_command",
        message: `Unknown command: /${parsed.command}. Type /export help for available commands.`,
      };
  }
}

function handleExport(parsed: ParsedCommand, _rawText: string): CommandResult {
  const sub = parsed.subcommand;

  if (sub === "help") {
    return { action: "help", message: getHelpText() };
  }

  if (sub && EXPORT_FORMATS.has(sub)) {
    const format = sub === "excel" ? "excel" : sub;
    return {
      action: "export",
      format,
      message: `Exporting to ${format.toUpperCase()} format...`,
    };
  }

  return {
    action: "export_interactive",
    message: "Please select export format (csv, json, excel):",
  };
}

function handleAuto(parsed: ParsedCommand, rawText: string): CommandResult {
  let sql: string | null = null;

  if (rawText.toLowerCase().startsWith("/auto")) {
    sql = rawText.slice(5).trim() || null;
  }

  if (!sql) {
    const parts: string[] = [];
    if (parsed.subcommand) parts.push(parsed.subcommand);
    if (parsed.args) parts.push(parsed.args);
    sql = parts.join(" ").trim() || null;
  }

  if (sql) {
    return {
      action: "auto_export",
      sql,
      format: "csv",
      message: "Executing query and auto-exporting to CSV...",
    };
  }

  return {
    action: "error",
    message: "Usage: /auto <SQL statement>",
  };
}

export function getHelpText(): string {
  return `📤 Export Commands Help

Export Query Results:
- /export csv - Export current results to CSV format
- /export json - Export current results to JSON format
- /export excel - Export current results to Excel (with styling)
- /export - Interactive mode: prompts you to choose a format

Auto Execute & Export:
- /auto <SQL> - Execute SQL and auto-export to CSV

Examples:
- /export excel - Export last query results to Excel
- /auto SELECT * FROM users - Run query and export to CSV
- /export help - Show this help

Natural Language:
You can also say things like:
- "Export this result"
- "Save as Excel"
- "Download as CSV"`;
}

export function isCommand(input: string): boolean {
  return parseCommand(input).isCommand;
}

export function getExportFormatFromCommand(input: string): string | null {
  const parsed = parseCommand(input);
  if (parsed.command === "export" && parsed.subcommand && EXPORT_FORMATS.has(parsed.subcommand)) {
    return parsed.subcommand === "excel" ? "excel" : parsed.subcommand;
  }
  return null;
}
