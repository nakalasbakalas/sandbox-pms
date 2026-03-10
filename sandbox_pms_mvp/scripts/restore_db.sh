#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file> [--drop-existing]" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 1
fi

PG_RESTORE_BIN="${PG_RESTORE_BIN:-pg_restore}"
BACKUP_FILE="$1"
DROP_EXISTING="${2:-}"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"
MANIFEST_FILE="${BACKUP_FILE}.json"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ -f "${CHECKSUM_FILE}" ]]; then
  EXPECTED_CHECKSUM="$(tr -d '[:space:]' < "${CHECKSUM_FILE}")"
  ACTUAL_CHECKSUM="$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')"
  if [[ "${EXPECTED_CHECKSUM}" != "${ACTUAL_CHECKSUM}" ]]; then
    echo "Backup checksum verification failed." >&2
    exit 1
  fi
fi

if [[ -f "${MANIFEST_FILE}" ]]; then
  echo "Restore manifest loaded for $(basename "${BACKUP_FILE}")"
fi

ARGS=(--verbose --no-owner --no-privileges --dbname="${DATABASE_URL}")
if [[ "${DROP_EXISTING}" == "--drop-existing" ]]; then
  ARGS+=(--clean --if-exists)
fi

echo "Restoring ${BACKUP_FILE} into target database."
"${PG_RESTORE_BIN}" "${ARGS[@]}" "${BACKUP_FILE}"

if [[ -n "${RESTORE_VERIFY_COMMAND:-}" ]]; then
  echo "Running restore verification command."
  bash -lc "${RESTORE_VERIFY_COMMAND}"
fi

echo "Restore complete."
