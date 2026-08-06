"""Data models for the database query tool."""

from pydantic import BaseModel, ConfigDict


def to_camel(string: str) -> str:
    """Convert snake_case to camelCase."""
    components = string.split("_")
    return components[0] + "".join(word.capitalize() for word in components[1:])


# Configure global Pydantic settings for camelCase (pydantic v2)
BaseModel.model_config = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
)

from app.models.database import DatabaseConnection  # noqa: E402
from app.models.metadata import DatabaseMetadata  # noqa: E402
from app.models.query import QueryHistory, QuerySource  # noqa: E402
from app.models.schemas import (  # noqa: E402
    DatabaseConnectionInput,
    DatabaseConnectionResponse,
    DatabaseMetadataResponse,
    TableMetadata,
    ColumnMetadata,
    QueryInput,
    QueryResult,
    QueryColumn,
    QueryHistoryEntry,
    NaturalLanguageInput,
    GeneratedSqlResponse,
    ErrorResponse,
)

__all__ = [
    "DatabaseConnection",
    "DatabaseMetadata",
    "QueryHistory",
    "QuerySource",
    "DatabaseConnectionInput",
    "DatabaseConnectionResponse",
    "DatabaseMetadataResponse",
    "TableMetadata",
    "ColumnMetadata",
    "QueryInput",
    "QueryResult",
    "QueryColumn",
    "QueryHistoryEntry",
    "NaturalLanguageInput",
    "GeneratedSqlResponse",
    "ErrorResponse",
]
