"""Export API endpoints."""

import os
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlmodel import Session, select
from typing import Optional
from pydantic import BaseModel
from app.database import get_session
from app.models.database import DatabaseConnection
from app.models.schemas import QueryResult
from app.services.query_wrapper import execute_query_with_service
from app.services.query import get_query_history
from app.models.query import QuerySource, QueryHistory
from app.services.exporter import QueryExporter, ExporterResult, ExportError

router = APIRouter(prefix="/api/v1/dbs", tags=["export"])


# Request/Response schemas
class ExportRequest(BaseModel):
    """Request to export existing query results."""
    format: str = "csv"  # csv, json, excel
    filename: Optional[str] = None
    query_id: Optional[int] = None  # Query history ID to export


class AutoExportRequest(BaseModel):
    """Request to execute query and auto-export."""
    sql: str
    format: str = "csv"  # Default to CSV
    filename: Optional[str] = None


class ExportResponse(BaseModel):
    """Export response."""
    file_path: str
    format: str
    row_count: int
    message: str
    download_url: Optional[str] = None


class ExportHelpResponse(BaseModel):
    """Help response for export commands."""
    commands: list[dict[str, str]]


def _get_exporter() -> QueryExporter:
    """Get or create QueryExporter instance."""
    return QueryExporter()


def _get_export_file_path(file_path: str) -> Optional[str]:
    """Extract relative path for download URL."""
    try:
        export_dir = str(QueryExporter().export_dir)
        if file_path.startswith(export_dir):
            return os.path.relpath(file_path, export_dir)
        return None
    except Exception:
        return None


@router.post("/{name}/export", response_model=ExportResponse)
async def export_query_results(
    name: str,
    request: ExportRequest,
    session: Session = Depends(get_session),
) -> ExportResponse:
    """
    Export query results to specified format.

    Can export from:
    1. A query history entry (by query_id)
    2. The most recent query for this database

    Args:
        name: Database connection name
        request: Export request with format and optional query_id
        session: Database session

    Returns:
        Export response with file path
    """
    # Verify connection exists
    statement = select(DatabaseConnection).where(DatabaseConnection.name == name)
    connection = session.exec(statement).first()

    if not connection:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Database connection '{name}' not found",
        )

    # Get data to export
    columns, rows = await _get_export_data(session, name, connection, request.query_id)

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No data to export. The query returned no results.",
        )

    # Perform export
    exporter = _get_exporter()
    try:
        result = exporter.export(
            columns=columns,
            rows=rows,
            format=request.format,
            filename=request.filename,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except ExportError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )

    # Build response
    download_url = f"/api/v1/dbs/export/download?file={os.path.basename(result.file_path)}"

    return ExportResponse(
        file_path=result.file_path,
        format=result.format,
        row_count=result.row_count,
        message=result.message,
        download_url=download_url,
    )


@router.post("/{name}/export/auto", response_model=ExportResponse)
async def auto_execute_and_export(
    name: str,
    request: AutoExportRequest,
    session: Session = Depends(get_session),
) -> ExportResponse:
    """
    Auto-execute a query and export results in one step.

    This implements the /auto <SQL> command functionality.

    Args:
        name: Database connection name
        request: Auto-export request with SQL and format
        session: Database session

    Returns:
        Export response with file path
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
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Query execution failed: {str(e)}",
        )

    # Check if results have data
    if not result.rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Query executed but returned no results to export.",
        )

    # Perform export
    exporter = _get_exporter()
    columns = [col.name for col in result.columns]

    try:
        export_result = exporter.export(
            columns=columns,
            rows=result.rows,
            format=request.format,
            filename=request.filename,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except ExportError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )

    download_url = f"/api/v1/dbs/export/download?file={os.path.basename(export_result.file_path)}"

    return ExportResponse(
        file_path=export_result.file_path,
        format=export_result.format,
        row_count=export_result.row_count,
        message=f"Auto-export completed: {export_result.message}",
        download_url=download_url,
    )


@router.get("/export/download")
async def download_exported_file(file: str) -> FileResponse:
    """
    Download an exported file.

    Args:
        file: Filename to download

    Returns:
        File download response
    """
    exporter = _get_exporter()
    file_path = exporter.export_dir / file

    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File '{file}' not found",
        )

    # Determine media type
    suffix = file_path.suffix.lower()
    if suffix == ".csv":
        media_type = "text/csv"
    elif suffix == ".json":
        media_type = "application/json"
    elif suffix in (".xlsx", ".xls"):
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        media_type = "application/octet-stream"

    return FileResponse(
        path=str(file_path),
        filename=file,
        media_type=media_type,
    )


@router.get("/export/help", response_model=ExportHelpResponse)
async def export_help() -> ExportHelpResponse:
    """
    Get help information for export commands.

    Returns:
        List of available export commands and descriptions
    """
    commands = [
        {
            "command": "/export csv",
            "description": "Export the current query results to CSV format",
        },
        {
            "command": "/export json",
            "description": "Export the current query results to JSON format",
        },
        {
            "command": "/export excel",
            "description": "Export the current query results to Excel with styling",
        },
        {
            "command": "/export",
            "description": "Interactive export - prompts for format selection",
        },
        {
            "command": "/auto <SQL>",
            "description": "Execute SQL and auto-export to CSV format",
        },
        {
            "command": "/export help",
            "description": "Show this help information",
        },
    ]

    return ExportHelpResponse(commands=commands)


async def _get_export_data(
    session: Session,
    database_name: str,
    connection: DatabaseConnection,
    query_id: Optional[int] = None,
) -> tuple:
    """Get data from query history for export.

    Args:
        session: Database session
        database_name: Database connection name
        connection: Database connection
        query_id: Specific query ID or None for latest

    Returns:
        Tuple of (columns, rows)
    """
    # Get the query history entry
    if query_id:
        statement = select(QueryHistory).where(
            QueryHistory.id == query_id,
            QueryHistory.database_name == database_name,
        )
    else:
        from sqlmodel import desc
        statement = (
            select(QueryHistory)
            .where(QueryHistory.database_name == database_name)
            .order_by(desc(QueryHistory.executed_at))
            .limit(1)
        )

    history_entry = session.exec(statement).first()

    if not history_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No query history found for this database. Please execute a query first.",
        )

    if not history_entry.success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Last query failed: {history_entry.error_message}",
        )

    # Re-execute the query to get fresh data
    try:
        result = await execute_query_with_service(
            session,
            database_name,
            connection.db_type,
            connection.url,
            history_entry.sql_text,
            QuerySource.MANUAL,
        )
        columns = [col.name for col in result.columns]
        rows = result.rows
        return columns, rows
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to re-execute query for export: {str(e)}",
        )
