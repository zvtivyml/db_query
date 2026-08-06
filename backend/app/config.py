"""Application configuration.

Simple configuration compatible with any Python environment.
"""

from pathlib import Path
import os


class Settings:
    """Application settings."""

    def __init__(self):
        """Initialize settings from environment variables."""
        # OpenAI API
        self.openai_api_key = os.environ.get("OPENAI_API_KEY", "")
        self.openai_base_url = os.environ.get("OPENAI_BASE_URL", "")
        self.nl2sql_model = os.environ.get("NL2SQL_MODEL", "gpt-4o-mini")

        # Data directory
        self.db_query_data_dir = os.environ.get(
            "DB_QUERY_DATA_DIR", str(Path.home() / ".db_query")
        )

        # Logging
        self.log_level = os.environ.get("LOG_LEVEL", "INFO")

        # CORS
        self.cors_origins = os.environ.get("CORS_ORIGINS", "*")

        # Query configuration
        self.query_default_limit = int(os.environ.get("QUERY_DEFAULT_LIMIT", "1000"))
        self.query_history_retention = int(
            os.environ.get("QUERY_HISTORY_RETENTION", "50")
        )

        # Database pool configuration
        self.db_pool_min_size = int(os.environ.get("DB_POOL_MIN_SIZE", "1"))
        self.db_pool_max_size = int(os.environ.get("DB_POOL_MAX_SIZE", "5"))
        self.db_pool_command_timeout = int(
            os.environ.get("DB_POOL_COMMAND_TIMEOUT", "60")
        )

        # Metadata cache configuration
        self.metadata_cache_hours = int(
            os.environ.get("METADATA_CACHE_HOURS", "24")
        )

    @property
    def cors_origins_list(self):
        """Parse CORS origins string into list."""
        if self.cors_origins == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def db_path(self):
        """Get SQLite database path."""
        data_dir = Path(self.db_query_data_dir).expanduser()
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "db_query.db"


# Try to load from .env file if exists
_env_file = Path(".env")
if _env_file.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

settings = Settings()
