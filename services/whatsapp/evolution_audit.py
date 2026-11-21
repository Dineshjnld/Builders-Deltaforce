"""Show recent integration activity without printing message bodies or credentials."""
import os
import sqlite3
from contextlib import closing

if __name__ == "__main__":
    with closing(sqlite3.connect(os.environ["DB_PATH"])) as db:
        for timestamp, action, subject, detail in db.execute(
            "SELECT timestamp,action,subject,detail FROM whatsapp_audit ORDER BY id DESC LIMIT 15"
        ):
            print(timestamp, action, subject, detail)
