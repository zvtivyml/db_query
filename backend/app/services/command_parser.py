"""Command parser for processing slash commands."""

import re
from typing import Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class ParsedCommand:
    """Represents a parsed command."""

    def __init__(self, command: str, subcommand: Optional[str] = None, args: Optional[str] = None):
        self.command = command
        self.subcommand = subcommand
        self.args = args

    @property
    def is_command(self) -> bool:
        return self.command is not None

    def to_dict(self) -> dict:
        return {
            "command": self.command,
            "subcommand": self.subcommand,
            "args": self.args,
        }


class CommandParser:
    """Parses and dispatches slash commands.

    Supported commands:
    - /export csv, /export json, /export excel
    - /export (interactive selection)
    - /auto <SQL>
    - /export help
    """

    EXPORT_FORMATS = {"csv", "json", "excel"}

    def __init__(self):
        self._command_handlers = {}
        self._register_default_handlers()

    def _register_default_handlers(self):
        """Register default command handlers."""
        self._command_handlers["export"] = self._handle_export
        self._command_handlers["auto"] = self._handle_auto
        self._command_handlers["help"] = self._handle_help

    def parse(self, input_text: str) -> ParsedCommand:
        """Parse input text and extract command if present.

        Args:
            input_text: User input text

        Returns:
            ParsedCommand object
        """
        text = input_text.strip()

        # Check if it's a slash command
        if text.startswith("/"):
            # Match: /command [subcommand] [args]
            pattern = r"^/(\w+)(?:\s+(\w+))?(?:\s+(.+))?$"
            match = re.match(pattern, text, re.DOTALL)

            if match:
                command = match.group(1).lower()
                subcommand = match.group(2).lower() if match.group(2) else None
                args = match.group(3)
                return ParsedCommand(command=command, subcommand=subcommand, args=args)

        # Not a command
        return ParsedCommand(command=None)

    def is_export_command(self, input_text: str) -> bool:
        """Check if input is an export-related command.

        Args:
            input_text: User input text

        Returns:
            True if it's an export command
        """
        parsed = self.parse(input_text)
        return parsed.command == "export"

    def is_auto_command(self, input_text: str) -> bool:
        """Check if input is an auto-export command.

        Args:
            input_text: User input text

        Returns:
            True if it's an auto command
        """
        parsed = self.parse(input_text)
        return parsed.command == "auto"

    def get_export_format(self, input_text: str) -> Optional[str]:
        """Extract export format from command.

        Args:
            input_text: User input text

        Returns:
            Export format or None
        """
        parsed = self.parse(input_text)
        if parsed.command == "export" and parsed.subcommand:
            format_lower = parsed.subcommand.lower()
            if format_lower in self.EXPORT_FORMATS:
                return "excel" if format_lower == "excel" else format_lower
        return None

    def get_sql_from_auto(self, input_text: str) -> Optional[str]:
        """Extract SQL from /auto command.

        Args:
            input_text: User input text

        Returns:
            SQL statement or None
        """
        parsed = self.parse(input_text)
        if parsed.command == "auto" and parsed.args:
            return parsed.args.strip()
        return None

    def get_command_help(self) -> str:
        """Get help text for all export commands.

        Returns:
            Help text string
        """
        help_text = """📤 **Export Commands Help**

**Export Query Results:**
- `/export csv` - Export current results to CSV format
- `/export json` - Export current results to JSON format
- `/export excel` - Export current results to Excel (with styling)
- `/export` - Interactive mode: prompts you to choose a format

**Auto Execute & Export:**
- `/auto <SQL>` - Execute SQL and auto-export to CSV

**Examples:**
- `/export excel` - Export last query results to Excel
- `/auto SELECT * FROM users` - Run query and export to CSV
- `/export help` - Show this help

**Natural Language:**
You can also say things like:
- "Export this result"
- "Save as Excel"
- "Download as CSV"
"""
        return help_text

    def _handle_export(self, parsed: ParsedCommand) -> dict:
        """Handle /export command."""
        # Check if subcommand is a valid format
        if parsed.subcommand and parsed.subcommand.lower() in self.EXPORT_FORMATS:
            format_lower = parsed.subcommand.lower()
            format_name = "excel" if format_lower == "excel" else format_lower
            return {
                "action": "export",
                "format": format_name,
                "message": f"Exporting to {format_name} format...",
            }
        elif parsed.subcommand == "help":
            return {
                "action": "help",
                "message": self.get_command_help(),
            }
        else:
            return {
                "action": "export_interactive",
                "message": "Please select export format (csv, json, excel):",
            }

    def _handle_auto(self, parsed: ParsedCommand, raw_text: str = "") -> dict:
        """Handle /auto command."""
        # Extract SQL from raw text to preserve original case
        if raw_text:
            # Remove "/auto " prefix
            sql = raw_text.strip()
            if sql.lower().startswith("/auto"):
                sql = sql[5:].strip()
        else:
            # Fallback: reconstruct from parsed components
            parts = []
            if parsed.subcommand:
                parts.append(parsed.subcommand)
            if parsed.args:
                parts.append(parsed.args)
            sql = " ".join(parts).strip()
        
        if sql:
            return {
                "action": "auto_export",
                "sql": sql,
                "format": "csv",  # Default format for auto
                "message": f"Executing query and auto-exporting to CSV...",
            }
        else:
            return {
                "action": "error",
                "message": "Usage: /auto <SQL statement>",
            }

    def _handle_help(self, parsed: ParsedCommand) -> dict:
        """Handle /help command."""
        return {
            "action": "help",
            "message": self.get_command_help(),
        }

    def execute_command(self, input_text: str) -> dict:
        """Execute a parsed command.

        Args:
            input_text: User input text

        Returns:
            Command execution result
        """
        parsed = self.parse(input_text)

        if not parsed.is_command:
            return {
                "action": "not_a_command",
                "message": "Input is not a command.",
            }

        handler = self._command_handlers.get(parsed.command)
        if handler:
            # Pass raw text to handlers that need it (e.g., /auto for SQL preservation)
            import inspect
            sig = inspect.signature(handler)
            if "raw_text" in sig.parameters:
                return handler(parsed, raw_text=input_text)
            return handler(parsed)
        else:
            return {
                "action": "unknown_command",
                "message": f"Unknown command: /{parsed.command}. Type /export help for available commands.",
            }


# Global instance
command_parser = CommandParser()
