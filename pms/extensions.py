from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy(session_options={"expire_on_commit": False})
migrate = Migrate(compare_type=True, render_as_batch=False)
