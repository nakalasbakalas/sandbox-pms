from __future__ import annotations

from pathlib import Path

import pytest
from flask_migrate import upgrade

from pms.app import create_app
from pms.seeds import seed_all


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"


@pytest.fixture()
def app_factory(tmp_path):
    def factory(*, seed: bool = False, config: dict | None = None):
        db_path = tmp_path / ("seeded.db" if seed else "empty.db")
        app_config = {
            "TESTING": True,
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path.as_posix()}",
            "AUTO_BOOTSTRAP_SCHEMA": False,
            "AUTO_SEED_REFERENCE_DATA": False,
            "INVENTORY_BOOTSTRAP_DAYS": 30,
            "ADMIN_EMAIL": "admin@sandbox.local",
            "ADMIN_PASSWORD": "sandbox-admin-123",
            # Allow large uploads in tests so oversized-file assertions are
            # evaluated at the service layer rather than being rejected by
            # Flask's request-body middleware before the test can run.
            "MAX_CONTENT_LENGTH": 32 * 1024 * 1024,  # 32 MB
        }
        if config:
            app_config.update(config)
        app = create_app(app_config)
        with app.app_context():
            upgrade(directory=str(MIGRATIONS_DIR))
            if seed:
                seed_all(app.config["INVENTORY_BOOTSTRAP_DAYS"])
        return app

    return factory
