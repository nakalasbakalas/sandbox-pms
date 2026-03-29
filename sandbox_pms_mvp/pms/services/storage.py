"""Storage backend abstraction for uploaded guest documents.

Provides a ``StorageBackend`` protocol with two concrete implementations:

* ``LocalStorageBackend`` — writes files to the local filesystem (current
  default, zero extra dependencies).
* ``S3StorageBackend`` — uploads files to Amazon S3 (or any S3-compatible
  store) and generates time-limited presigned download URLs.  Requires
  ``boto3`` to be installed and the following config keys::

      STORAGE_BACKEND = "s3"
      S3_BUCKET        = "my-pms-docs"          # required
      S3_REGION        = "eu-west-1"             # optional, defaults to us-east-1
      AWS_ACCESS_KEY_ID     = "..."              # or omit for IAM role auth
      AWS_SECRET_ACCESS_KEY = "..."

Use ``get_storage_backend()`` inside a Flask application context to obtain
the configured backend.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Protocol, runtime_checkable

from flask import current_app


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class StorageBackend(Protocol):
    """Interface every storage backend must satisfy."""

    def save(self, file_storage, reservation_id: uuid.UUID, ext: str) -> str:
        """Persist *file_storage* and return an opaque ``storage_key``."""
        ...

    def read(self, storage_key: str) -> bytes:
        """Return the raw bytes for the file identified by *storage_key*."""
        ...

    def generate_url(
        self,
        storage_key: str,
        filename: str,
        content_type: str,
        expires_in: int = 3600,
    ) -> str | None:
        """Return a URL that serves the file, or *None* to serve bytes directly.

        ``LocalStorageBackend`` always returns *None* (the caller reads the
        bytes and streams them).  ``S3StorageBackend`` returns a presigned URL,
        allowing the browser to fetch the object directly from S3 so the
        application server is not in the critical path for large files.
        """
        ...


# ---------------------------------------------------------------------------
# Local filesystem backend (default)
# ---------------------------------------------------------------------------


class LocalStorageBackend:
    """Store files on the local filesystem under ``UPLOAD_DIR``."""

    def _base_dir(self) -> Path:
        base = current_app.config.get("UPLOAD_DIR") or os.path.join(
            current_app.instance_path, "uploads", "documents"
        )
        p = Path(base)
        p.mkdir(parents=True, exist_ok=True)
        return p

    def save(self, file_storage, reservation_id: uuid.UUID, ext: str) -> str:
        res_dir = self._base_dir() / str(reservation_id)
        res_dir.mkdir(parents=True, exist_ok=True)
        unique_name = f"{uuid.uuid4().hex}{ext}"
        dest = res_dir / unique_name
        file_storage.save(str(dest))
        return f"{reservation_id}/{unique_name}"

    def read(self, storage_key: str) -> bytes:
        file_path = self._base_dir() / storage_key
        if not file_path.is_file():
            raise FileNotFoundError(f"Document not found: {storage_key}")
        with open(str(file_path), "rb") as fh:
            return fh.read()

    def generate_url(
        self,
        storage_key: str,
        filename: str,
        content_type: str,
        expires_in: int = 3600,
    ) -> str | None:
        # Local backend: caller should stream bytes directly.
        return None


# ---------------------------------------------------------------------------
# S3 backend
# ---------------------------------------------------------------------------


class S3StorageBackend:
    """Store files in Amazon S3 (or an S3-compatible store).

    Requires ``boto3``.  Config keys: ``S3_BUCKET``, ``S3_REGION``,
    ``AWS_ACCESS_KEY_ID``, ``AWS_SECRET_ACCESS_KEY``.
    """

    def _client(self):
        try:
            import boto3  # type: ignore[import]
        except ImportError as exc:
            raise RuntimeError(
                "boto3 is required for S3 storage. Install it with: pip install boto3"
            ) from exc

        cfg = current_app.config
        kwargs: dict = {"region_name": cfg.get("S3_REGION", "us-east-1")}
        if cfg.get("AWS_ACCESS_KEY_ID"):
            kwargs["aws_access_key_id"] = cfg["AWS_ACCESS_KEY_ID"]
            kwargs["aws_secret_access_key"] = cfg.get("AWS_SECRET_ACCESS_KEY", "")
        if cfg.get("S3_ENDPOINT_URL"):
            # Support non-AWS S3-compatible stores (MinIO, Cloudflare R2, etc.)
            kwargs["endpoint_url"] = cfg["S3_ENDPOINT_URL"]
        return boto3.client("s3", **kwargs)

    def _bucket(self) -> str:
        bucket = current_app.config.get("S3_BUCKET")
        if not bucket:
            raise RuntimeError("S3_BUCKET is not configured.")
        return bucket

    def save(self, file_storage, reservation_id: uuid.UUID, ext: str) -> str:
        unique_name = f"{uuid.uuid4().hex}{ext}"
        storage_key = f"{reservation_id}/{unique_name}"
        data = file_storage.read()
        file_storage.seek(0)
        self._client().put_object(
            Bucket=self._bucket(),
            Key=storage_key,
            Body=data,
            ContentType=file_storage.content_type or "application/octet-stream",
        )
        return storage_key

    def read(self, storage_key: str) -> bytes:
        response = self._client().get_object(Bucket=self._bucket(), Key=storage_key)
        return response["Body"].read()

    def generate_url(
        self,
        storage_key: str,
        filename: str,
        content_type: str,
        expires_in: int = 3600,
    ) -> str | None:
        return self._client().generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket(),
                "Key": storage_key,
                "ResponseContentDisposition": f'inline; filename="{filename}"',
                "ResponseContentType": content_type,
            },
            ExpiresIn=expires_in,
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

_BACKENDS: dict[str, type] = {
    "local": LocalStorageBackend,
    "s3": S3StorageBackend,
}


def get_storage_backend() -> StorageBackend:
    """Return the configured ``StorageBackend`` instance.

    Reads ``STORAGE_BACKEND`` from Flask config (default: ``"local"``).
    """
    name = (current_app.config.get("STORAGE_BACKEND") or "local").lower()
    cls = _BACKENDS.get(name)
    if cls is None:
        raise RuntimeError(
            f"Unknown STORAGE_BACKEND '{name}'. Valid options: {', '.join(_BACKENDS)}"
        )
    return cls()
