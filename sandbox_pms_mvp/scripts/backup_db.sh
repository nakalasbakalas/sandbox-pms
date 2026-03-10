#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

PG_DUMP_BIN="${PG_DUMP_BIN:-pg_dump}"
BACKUP_DIR="${1:-./backups}"
LABEL="${2:-sandbox_hotel}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_BASE="${BACKUP_DIR}/${LABEL}_${TIMESTAMP}.dump"
OUTPUT_PATH="${OUTPUT_BASE}"
CHECKSUM_PATH="${OUTPUT_PATH}.sha256"
MANIFEST_PATH="${OUTPUT_PATH}.json"

mkdir -p "${BACKUP_DIR}"

echo "Writing backup to ${OUTPUT_PATH}"
"${PG_DUMP_BIN}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${OUTPUT_PATH}" \
  "${DATABASE_URL}"

CHECKSUM="$(sha256sum "${OUTPUT_PATH}" | awk '{print $1}')"
printf '%s' "${CHECKSUM}" > "${CHECKSUM_PATH}"

DATABASE_TARGET="$(python - <<'PY'
from urllib.parse import urlparse
import os

raw = os.environ["DATABASE_URL"]
parsed = urlparse(raw)
host = parsed.hostname or ""
port = f":{parsed.port}" if parsed.port else ""
path = parsed.path or ""
scheme = parsed.scheme or "postgresql"
print(f"{scheme}://***@{host}{port}{path}")
PY
)"

cat > "${MANIFEST_PATH}" <<JSON
{
  "label": "${LABEL}",
  "backup_file": "$(basename "${OUTPUT_PATH}")",
  "created_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database_target": "${DATABASE_TARGET}",
  "checksum_sha256": "${CHECKSUM}",
  "retention_days": ${RETENTION_DAYS},
  "storage_encryption_required": ${BACKUP_ENCRYPTION_REQUIRED:-0},
  "restore_verify_command": "$(printf '%s' "${RESTORE_VERIFY_COMMAND:-}" | sed 's/"/\\"/g')"
}
JSON

if [[ "${RETENTION_DAYS}" -gt 0 ]]; then
  find "${BACKUP_DIR}" -type f -name '*.dump' -mtime "+${RETENTION_DAYS}" -print0 | while IFS= read -r -d '' OLD_FILE; do
    rm -f "${OLD_FILE}" "${OLD_FILE}.sha256" "${OLD_FILE}.json"
  done
fi

echo "Backup complete."
echo "Checksum: ${CHECKSUM}"
echo "Manifest: ${MANIFEST_PATH}"
