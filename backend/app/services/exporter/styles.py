"""Excel styles configuration for export."""

from openpyxl.styles import Font, Alignment, Border, Side, PatternFill

# Font settings
EXCEL_FONT_NAME = "微软雅黑"
EXCEL_FONT_SIZE = 11

# Header row styles (Row 1)
HEADER_FONT = Font(
    name=EXCEL_FONT_NAME,
    size=EXCEL_FONT_SIZE,
    bold=True,
)

HEADER_FILL = PatternFill(
    start_color="FFD700",  # Dark yellow
    end_color="FFD700",
    fill_type="solid",
)

# Data row styles
DATA_FONT = Font(
    name=EXCEL_FONT_NAME,
    size=EXCEL_FONT_SIZE,
    bold=False,
)

# Border styles
BLACK_BORDER = Border(
    left=Side(style="thin", color="000000"),
    right=Side(style="thin", color="000000"),
    top=Side(style="thin", color="000000"),
    bottom=Side(style="thin", color="000000"),
)

# Alignment
CELL_ALIGNMENT = Alignment(
    horizontal="center",
    vertical="center",
    wrap_text=True,
)
