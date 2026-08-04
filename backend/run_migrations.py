"""Run Alembic migrations with an explicit absolute configuration.

This avoids deployment failures caused by Render starting the process from an
unexpected working directory or reading another alembic.ini file.
"""
from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config


def main() -> None:
    backend_dir = Path(__file__).resolve().parent
    migrations_dir = backend_dir / "migrations"
    ini_path = backend_dir / "alembic.ini"

    if not migrations_dir.is_dir():
        raise RuntimeError(f"Alembic migrations directory not found: {migrations_dir}")

    config = Config(str(ini_path) if ini_path.is_file() else None)
    config.set_main_option("script_location", str(migrations_dir))
    config.set_main_option("prepend_sys_path", str(backend_dir))

    # env.py reads DATABASE_URL through app.config. Set cwd only to make all
    # relative imports and auxiliary paths deterministic on Render.
    os.chdir(backend_dir)
    command.upgrade(config, "head")


if __name__ == "__main__":
    main()
