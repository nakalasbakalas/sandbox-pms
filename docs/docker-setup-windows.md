# Docker Setup On Windows

Use Docker Desktop with the WSL 2 backend for the local disposable PostgreSQL databases.

Official references:

- Microsoft WSL install: https://learn.microsoft.com/windows/wsl/install
- Docker Desktop Windows install: https://docs.docker.com/desktop/setup/install/windows-install/
- Docker Desktop WSL 2 backend: https://docs.docker.com/desktop/features/wsl/

## Install WSL 2

Open PowerShell as Administrator:

```powershell
wsl --install
wsl --update
wsl --set-default-version 2
```

Restart Windows if prompted. Then verify:

```powershell
wsl --version
wsl -l -v
```

Any installed Linux distribution used for development should show version `2`.

## Install Docker Desktop

1. Download Docker Desktop for Windows from Docker's official install page.
2. Run `Docker Desktop Installer.exe`.
3. Select the WSL 2 backend when prompted.
4. Start Docker Desktop from the Windows Start menu.
5. Open Docker Desktop settings and confirm `Use the WSL 2 based engine` is enabled.
6. Apply changes and restart Docker Desktop if requested.

Verify Docker from PowerShell:

```powershell
docker --version
docker compose version
docker run hello-world
```

## Run The Project Database

The project maps host port `55432` to container port `5432` to avoid conflicts with an existing local PostgreSQL on `5432`.

```powershell
npm run db:up
npm run db:doctor
npm run db:ready
```

For mutating E2E:

```powershell
$env:ALLOW_DB_E2E = 'true'
$env:E2E_DATABASE_URL = 'postgresql://sandbox:sandbox@localhost:55432/sandbox_hotel_e2e?schema=public'
npm run db:e2e:ready
npm run test:e2e:db
```

## Troubleshooting

`docker` command not found:

- Close and reopen PowerShell after installing Docker Desktop.
- Confirm Docker Desktop is installed and started.
- Confirm Docker is on `PATH`.

Docker Desktop not running:

- Start Docker Desktop from the Windows Start menu.
- Wait until the status shows Docker is running.
- Retry `docker run hello-world`.

WSL 2 not enabled:

- Run PowerShell as Administrator.
- Run `wsl --install`, `wsl --update`, and `wsl --set-default-version 2`.
- Restart Windows if prompted.
- In Docker Desktop settings, enable the WSL 2 backend.

Hardware virtualization disabled:

- Reboot into BIOS/UEFI.
- Enable Intel VT-x, Intel Virtualization Technology, AMD-V, or SVM Mode.
- Boot Windows and rerun `wsl --version`.

Port `5432` already in use:

- This project intentionally uses host port `55432`.
- Confirm `.env` and `.env.local` use `localhost:55432`.
- Confirm `docker-compose.db.yml` has `55432:5432`.

Database credentials mismatch:

- Expected local user: `sandbox`.
- Expected local password: `sandbox`.
- Expected local databases: `sandbox_hotel_dev` and `sandbox_hotel_e2e`.
- Run `npm run db:doctor` to see the sanitized connection details and connectivity result.

Container exists but the old volume has wrong credentials:

```powershell
npm run db:down
docker volume ls
docker volume rm sandbox-hotel-pms-2_sandbox_hotel_postgres_data
npm run db:up
```

Only remove the volume when you intentionally want to delete the local disposable database contents.

## Docker-Free Fallback

If Docker is unavailable, use a disposable hosted PostgreSQL database or staging database:

```powershell
$env:ALLOW_DB_E2E = 'true'
$env:E2E_DATABASE_URL = 'postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public'
npm run db:doctor
npm run db:e2e:ready
npm run test:e2e:db
```

The hosted database must be disposable or staging only. The safety guard blocks production-like database names and requires the target to clearly identify itself as `e2e`, `test`, `staging`, `ci`, `dev`, `local`, or `disposable`.
