"""Agent service for intelligent export interactions.

Handles:
- Post-export prompt: asking user if they want to export after query
- Format recommendation based on data characteristics
- Natural language intent recognition for export requests
"""

import re
from typing import Optional, List, Dict, Any
import logging

logger = logging.getLogger(__name__)


class AgentService:
    """Agent service for intelligent export interactions."""

    # Natural language patterns that indicate export intent
    EXPORT_INTENT_PATTERNS = [
        # Direct export requests
        r"(export|导出|保存|下载|生成|输出).*(结果|数据|查询|文件)",
        r"(save|export|download).*(result|data|file|this)",
        # Format-specific requests
        r"(导出|export).*(csv|json|excel|xlsx)",
        r"(保存|下载|导出).*(为|成).*(csv|json|excel)",
        r"(save|export).*(as|to).*(csv|json|excel|xlsx)",
        # Generic save/download
        r"(保存|下载|导出|导出).*(这个|这个结果|一下|文件)",
        r"(save|download|export).*(this|it|result)",
        # Chinese specific
        r"把.*结果.*导出",
        r"将.*查询.*导出",
        r"输出.*为.*文件",
    ]

    # Format keywords mapping
    FORMAT_KEYWORDS = {
        "excel": ["excel", "xlsx", "表格", "电子表格"],
        "csv": ["csv", "逗号分隔", "文本"],
        "json": ["json", "json格式"],
    }

    def __init__(self):
        self._compile_patterns()

    def _compile_patterns(self):
        """Pre-compile regex patterns for efficiency."""
        self._compiled_patterns = [
            re.compile(p, re.IGNORECASE) for p in self.EXPORT_INTENT_PATTERNS
        ]

    def detect_export_intent(self, user_input: str) -> dict:
        """Detect if user's input indicates an export intent.

        Args:
            user_input: User's natural language input

        Returns:
            Dict with intent information:
            {
                "has_export_intent": bool,
                "detected_format": str or None,
                "confidence": float
            }
        """
        input_lower = user_input.lower()

        # Check against patterns
        for pattern in self._compiled_patterns:
            if pattern.search(input_lower):
                detected_format = self._detect_format_from_input(user_input)
                return {
                    "has_export_intent": True,
                    "detected_format": detected_format,
                    "confidence": 0.8,
                }

        # Additional keyword-based detection
        export_keywords = ["导出", "export", "保存", "save", "下载", "download"]
        for keyword in export_keywords:
            if keyword in input_lower:
                detected_format = self._detect_format_from_input(user_input)
                return {
                    "has_export_intent": True,
                    "detected_format": detected_format,
                    "confidence": 0.5,
                }

        return {
            "has_export_intent": False,
            "detected_format": None,
            "confidence": 0.0,
        }

    def _detect_format_from_input(self, user_input: str) -> Optional[str]:
        """Detect target format from user input.

        Args:
            user_input: User's input text

        Returns:
            Detected format or None
        """
        input_lower = user_input.lower()

        for format, keywords in self.FORMAT_KEYWORDS.items():
            for keyword in keywords:
                if keyword.lower() in input_lower:
                    return format

        return None

    def generate_export_prompt(self, columns: List[str], rows: List[Dict[str, Any]]) -> dict:
        """Generate a post-export prompt asking user if they want to export.

        Includes format recommendation based on data characteristics.

        Args:
            columns: List of column names
            rows: List of row data

        Returns:
            Dict with prompt and recommendation:
            {
                "prompt": str,
                "recommended_format": str,
                "reason": str,
                "options": list
            }
        """
        from app.services.exporter import QueryExporter

        # Get format recommendation
        recommended_format = QueryExporter.recommend_format(columns, rows)
        reason = self._get_recommendation_reason(columns, rows, recommended_format)

        # Build prompt (bilingual for better user experience)
        row_count = len(rows)
        col_count = len(columns)

        prompt = (
            f"✅ 查询执行成功！共找到 {row_count} 行 {col_count} 列数据。\n\n"
            f"📊 **智能推荐**：建议导出为 **{recommended_format.upper()}** 格式。\n"
            f"   原因：{reason}\n\n"
            f"📁 **是否需要将这次查询结果导出为文件？**\n\n"
            f"**可用格式：**\n"
            f"  • `csv` - 简单文本格式，适用于纯数据\n"
            f"  • `json` - 结构化格式，适用于复杂/嵌套数据\n"
            f"  • `excel` - 带样式的电子表格，适用于报告\n\n"
            f"**快捷命令：**\n"
            f"  • `/export csv` - 导出为 CSV\n"
            f"  • `/export json` - 导出为 JSON\n"
            f"  • `/export excel` - 导出为 Excel\n"
            f"  • 或者直接说 '是' 使用推荐格式 ({recommended_format})"
        )

        return {
            "prompt": prompt,
            "recommended_format": recommended_format,
            "reason": reason,
            "options": ["csv", "json", "excel"],
        }

    def _get_recommendation_reason(
        self, columns: List[str], rows: List[Dict[str, Any]], format: str
    ) -> str:
        """Get human-readable reason for format recommendation.

        Args:
            columns: List of column names
            rows: List of row data
            format: Recommended format

        Returns:
            Recommendation reason string
        """
        # Analyze data characteristics
        has_chinese = False
        for col in columns:
            if any("\u4e00" <= char <= "\u9fff" for char in col):
                has_chinese = True
                break

        if not has_chinese:
            for row in rows[:20]:
                for col in columns:
                    val = str(row.get(col, ""))
                    if any("\u4e00" <= char <= "\u9fff" for char in val):
                        has_chinese = True
                        break
                if has_chinese:
                    break

        has_complex = False
        for row in rows[:10]:
            for col in columns:
                val = row.get(col)
                if isinstance(val, (dict, list, tuple, set)):
                    has_complex = True
                    break
            if has_complex:
                break

        reasons = {
            "excel": [],
            "json": [],
            "csv": [],
        }

        if format == "excel":
            if len(columns) > 10:
                reasons["excel"].append(f"high column count ({len(columns)} columns)")
            if has_chinese:
                reasons["excel"].append("contains Chinese text")
            if not reasons["excel"]:
                reasons["excel"].append("good for formatted reports and spreadsheets")

        elif format == "json":
            if has_complex:
                reasons["json"].append("contains complex/nested data structures")
            else:
                reasons["json"].append("structured format for data exchange")

        elif format == "csv":
            if not has_chinese and len(columns) <= 10:
                reasons["csv"].append("pure numeric/simple text data")
            else:
                reasons["csv"].append("universal text format, good for most use cases")

        reason_key = reasons.get(format, ["general purpose"])
        return " and ".join(reason_key)

    def process_user_response(
        self, user_input: str, last_query_result: Optional[dict] = None
    ) -> dict:
        """Process user's response to the export prompt.

        Handles natural language responses like "yes", "csv", "excel", etc.

        Args:
            user_input: User's response text
            last_query_result: Last query result data (optional)

        Returns:
            Dict with action to take:
            {
                "action": str,
                "format": str or None,
                "message": str
            }
        """
        from app.services.exporter import QueryExporter

        input_lower = user_input.lower().strip()

        # Check for affirmative responses
        affirmative_words = ["yes", "y", "ok", "okay", "sure", "好的", "可以", "是", "对"]
        for word in affirmative_words:
            if word in input_lower:
                if last_query_result:
                    recommended = QueryExporter.recommend_format(
                        last_query_result.get("columns", []),
                        last_query_result.get("rows", []),
                    )
                    return {
                        "action": "export",
                        "format": recommended,
                        "message": f"Great! Exporting to {recommended} format...",
                    }
                else:
                    return {
                        "action": "prompt_format",
                        "message": "Which format would you like (csv, json, excel)?",
                    }

        # Check for format selection
        for format_name in ["excel", "csv", "json"]:
            if format_name in input_lower:
                return {
                    "action": "export",
                    "format": format_name,
                    "message": f"Got it! Exporting to {format_name} format...",
                }

        # Check for negative responses
        negative_words = ["no", "n", "cancel", "skip", "not", "不用", "不需要", "不", "算了"]
        for word in negative_words:
            if word in input_lower:
                return {
                    "action": "skip",
                    "message": "No problem! The results are displayed above.",
                }

        # Check for export intent
        intent = self.detect_export_intent(user_input)
        if intent["has_export_intent"]:
            format = intent["detected_format"]
            if format:
                return {
                    "action": "export",
                    "format": format,
                    "message": f"Detected export request to {format}. Exporting...",
                }
            else:
                return {
                    "action": "prompt_format",
                    "message": "I'll export your results. Which format? (csv, json, excel)",
                }

        # Unknown response
        return {
            "action": "unknown",
            "message": "I didn't understand. You can say 'yes' for recommended format, or specify 'csv', 'json', or 'excel'.",
        }


# Global instance
agent_service = AgentService()
