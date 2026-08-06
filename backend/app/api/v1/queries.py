"""Query execution API endpoints."""

import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from typing import List, Optional
from pydantic import BaseModel
from app.database import get_session
from app.models.database import DatabaseConnection
from app.models.query import QuerySource
from app.models.schemas import (
    QueryInput,
    QueryResult,
    QueryHistoryEntry,
    NaturalLanguageInput,
    GeneratedSqlResponse,
)
from app.services.query_wrapper import execute_query_with_service
from app.services.query import get_query_history
from app.services.sql_validator import SqlValidationError
from app.services.nl2sql import nl2sql_service
from app.services.metadata import get_cached_metadata
from app.services.command_parser import command_parser
from app.services.agent_service import agent_service

router = APIRouter(prefix="/api/v1/dbs", tags=["queries"])


# Interaction schemas
class CommandParseRequest(BaseModel):
    """Request to parse a command."""
    input: str


class CommandParseResponse(BaseModel):
    """Response with parsed command information."""
    is_command: bool
    command: Optional[str] = None
    subcommand: Optional[str] = None
    args: Optional[str] = None
    action: str
    message: str


class SmartInteractionRequest(BaseModel):
    """Request for smart interaction processing."""
    user_input: str = ""
    last_query_columns: Optional[List[str]] = None
    last_query_rows: Optional[List[dict]] = None
    action: Optional[str] = None
    query_result: Optional[dict] = None


class SmartInteractionResponse(BaseModel):
    """Response with interaction results."""
    action: str
    message: str
    format: Optional[str] = None
    prompt: Optional[str] = None
    recommended_format: Optional[str] = None


class QueryWithExportRequest(BaseModel):
    """Request to execute query and get export prompt."""
    sql: str
    auto_export: bool = False
    export_format: Optional[str] = None


def to_history_entry(history) -> QueryHistoryEntry:
    """Convert QueryHistory to QueryHistoryEntry schema."""
    return QueryHistoryEntry(
        id=history.id,
        databaseName=history.database_name,
        sqlText=history.sql_text,
        executedAt=history.executed_at,
        executionTimeMs=history.execution_time_ms,
        rowCount=history.row_count,
        success=history.success,
        errorMessage=history.error_message,
        querySource=history.query_source.value,
    )


@router.post("/{name}/query", response_model=QueryResult)
async def execute_sql_query(
    name: str,
    input_data: QueryInput,
    session: Session = Depends(get_session),
) -> QueryResult:
    """
    Execute SQL query against a database.

    Args:
        name: Database connection name
        input_data: Query input with SQL
        session: Database session

    Returns:
        Query result with columns and rows
    """
    # Get connection
    statement = select(DatabaseConnection).where(
        DatabaseConnection.name == name
    )
    connection = session.exec(statement).first()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database connection '{name}' not found",
        )

    # Execute query
    try:
        result = await execute_query_with_service(
            session,
            name,
            connection.db_type,
            connection.url,
            input_data.sql,
            QuerySource.MANUAL,
        )
        return result
    except SqlValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query execution failed: {str(e)}",
        )


@router.get("/{name}/history", response_model=List[QueryHistoryEntry])
async def get_query_history_for_database(
    name: str,
    limit: int = 50,
    session: Session = Depends(get_session),
) -> List[QueryHistoryEntry]:
    """
    Get query history for a database.

    Args:
        name: Database connection name
        limit: Maximum number of queries to return
        session: Database session

    Returns:
        List of query history entries
    """
    # Verify connection exists
    statement = select(DatabaseConnection).where(
        DatabaseConnection.name == name
    )
    connection = session.exec(statement).first()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database connection '{name}' not found",
        )

    # Get history
    history_list = await get_query_history(session, name, limit)
    return [to_history_entry(h) for h in history_list]


@router.post("/{name}/query/natural", response_model=GeneratedSqlResponse)
async def natural_language_to_sql(
    name: str,
    input_data: NaturalLanguageInput,
    session: Session = Depends(get_session),
) -> GeneratedSqlResponse:
    """
    Convert natural language to SQL query using OpenAI.

    Args:
        name: Database connection name
        input_data: Natural language prompt
        session: Database session

    Returns:
        Generated SQL query with explanation
    """
    # Get connection
    statement = select(DatabaseConnection).where(DatabaseConnection.name == name)
    connection = session.exec(statement).first()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database connection '{name}' not found",
        )

    # Get metadata for context
    try:
        metadata_obj = await get_cached_metadata(session, connection.name)
        if not metadata_obj:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Metadata not found for database '{name}'. Please refresh metadata first.",
            )
        metadata = json.loads(metadata_obj.metadata_json)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load metadata: {str(e)}",
        )

    # Generate SQL
    try:
        result = await nl2sql_service.generate_sql(input_data.prompt, metadata, connection.db_type)
        return GeneratedSqlResponse(
            sql=result["sql"],
            explanation=result["explanation"],
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate SQL: {str(e)}",
        )


@router.post("/{name}/command/parse", response_model=CommandParseResponse)
async def parse_command(
    name: str,
    request: CommandParseRequest,
    session: Session = Depends(get_session),
) -> CommandParseResponse:
    """
    Parse user input as a command.

    Checks if the input is a slash command and returns parsed information.

    Args:
        name: Database connection name
        request: Command parse request
        session: Database session

    Returns:
        Parsed command response
    """
    # Verify connection exists
    statement = select(DatabaseConnection).where(DatabaseConnection.name == name)
    connection = session.exec(statement).first()
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database connection '{name}' not found",
        )

    # Parse command
    parsed = command_parser.parse(request.input)
    result = command_parser.execute_command(request.input)

    return CommandParseResponse(
        is_command=parsed.is_command,
        command=parsed.command,
        subcommand=parsed.subcommand,
        args=parsed.args,
        action=result["action"],
        message=result["message"],
    )


@router.post("/{name}/interaction", response_model=SmartInteractionResponse)
async def smart_interaction(
    name: str,
    request: SmartInteractionRequest,
    session: Session = Depends(get_session),
) -> SmartInteractionResponse:
    """
    Smart interaction endpoint for Agent-like behavior.

    Handles:
    1. Detecting export intent in natural language
    2. Processing user responses to export prompts
    3. Recommending export formats

    Args:
        name: Database connection name
        request: Smart interaction request
        session: Database session

    Returns:
        Interaction response with action to take
    """
    # Verify connection exists
    statement = select(DatabaseConnection).where(DatabaseConnection.name == name)
    connection = session.exec(statement).first()
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database connection '{name}' not found",
        )

    # Handle generate_prompt action
    if request.action == "generate_prompt" and request.query_result:
        query_result = request.query_result
        columns = [col["name"] for col in query_result.get("columns", [])]
        rows = query_result.get("rows", [])
        
        if not rows:
            return SmartInteractionResponse(
                action="no_results",
                message="查询结果为空，无法生成导出建议。",
            )
        
        # Generate export prompt with format recommendation
        prompt_result = agent_service.generate_export_prompt(columns, rows)
        return SmartInteractionResponse(
            action="show_export_prompt",
            message=prompt_result["prompt"],
            prompt=prompt_result["prompt"],
            recommended_format=prompt_result.get("recommended_format"),
        )

    # Handle process_response action
    if request.action == "process_response" and request.query_result:
        query_result = request.query_result
        columns = query_result.get("columns", [])
        rows = query_result.get("rows", [])
        
        result = agent_service.process_user_response(
            request.user_input,
            {"columns": columns, "rows": rows},
        )
        return SmartInteractionResponse(
            action=result["action"],
            message=result["message"],
            format=result.get("format"),
            prompt=result.get("message") if result["action"] == "prompt_format" else None,
        )

    # First check if it's a command
    parsed = command_parser.parse(request.user_input)
    if parsed.is_command:
        result = command_parser.execute_command(request.user_input)
        return SmartInteractionResponse(
            action=result["action"],
            message=result["message"],
            format=result.get("format"),
        )

    # Check for export intent
    intent = agent_service.detect_export_intent(request.user_input)

    if intent["has_export_intent"]:
        format = intent["detected_format"]
        if format:
            return SmartInteractionResponse(
                action="export",
                message=f"检测到导出请求，正在导出为 {format} 格式...",
                format=format,
            )
        else:
            return SmartInteractionResponse(
                action="prompt_format",
                message="我可以帮你导出数据。请选择格式：CSV、JSON 或 Excel",
                prompt="请选择导出格式：csv、json 或 excel",
            )

    # Process as response to a previous prompt
    if request.last_query_rows is not None:
        result = agent_service.process_user_response(
            request.user_input,
            {"columns": request.last_query_columns or [], "rows": request.last_query_rows},
        )
        return SmartInteractionResponse(
            action=result["action"],
            message=result["message"],
            format=result.get("format"),
            prompt=result.get("message") if result["action"] == "prompt_format" else None,
        )

    # Default: return query prompt recommendation
    if request.last_query_columns and request.last_query_rows:
        prompt_result = agent_service.generate_export_prompt(
            request.last_query_columns,
            request.last_query_rows,
        )
        return SmartInteractionResponse(
            action="show_export_prompt",
            message=prompt_result["prompt"],
            prompt=prompt_result["prompt"],
            recommended_format=prompt_result["recommended_format"],
        )

    # Fallback
    return SmartInteractionResponse(
        action="unknown",
        message="抱歉，我无法理解你的请求。请尝试输入命令或自然语言查询。",
    )


@router.post("/{name}/query-with-export", response_model=dict)
async def execute_query_with_export_prompt(
    name: str,
    request: QueryWithExportRequest,
    session: Session = Depends(get_session),
) -> dict:
    """
    Execute query and optionally trigger export flow.

    This endpoint combines query execution with intelligent export suggestions.

    Args:
        name: Database connection name
        request: Query with export options
        session: Database session

    Returns:
        Query result + export prompt/action
    """
    # Verify connection exists
    statement = select(DatabaseConnection).where(DatabaseConnection.name == name)
    connection = session.exec(statement).first()
    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database connection '{name}' not found",
        )

    # Execute query
    try:
        result = await execute_query_with_service(
            session,
            name,
            connection.db_type,
            connection.url,
            request.sql,
            QuerySource.MANUAL,
        )
    except SqlValidationError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Query execution failed: {str(e)}",
        )

    # If auto_export is requested, perform the export
    if request.auto_export and request.export_format:
        from app.services.exporter import QueryExporter, ExportError

        columns = [col.name for col in result.columns]
        try:
            exporter = QueryExporter()
            export_result = exporter.export(
                columns=columns,
                rows=result.rows,
                format=request.export_format,
            )
            return {
                "query_result": result.model_dump(),
                "export": {
                    "status": "success",
                    "file_path": export_result.file_path,
                    "format": export_result.format,
                    "row_count": export_result.row_count,
                },
                "export_prompt": None,
            }
        except ExportError as e:
            return {
                "query_result": result.model_dump(),
                "export": {
                    "status": "failed",
                    "error": str(e),
                },
                "export_prompt": None,
            }

    # Generate export prompt recommendation
    columns = [col.name for col in result.columns]
    export_prompt = agent_service.generate_export_prompt(columns, result.rows)

    return {
        "query_result": result.model_dump(),
        "export": None,
        "export_prompt": export_prompt,
    }
