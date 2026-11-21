# One-time setup: gives Beaman Console its own database on this computer.
#
#   - Uses the PostgreSQL programs already installed (C:\Program Files\PostgreSQL),
#     but keeps the app's data in its own folder and runs it on its own port (5433),
#     so it doesn't need the "postgres" password or touch other databases.
#   - Makes up a password for the app's database user and saves it in server/.env
#     (ignored by git; it never leaves this computer).
#   - Installs packages if needed, then creates the tables, or copies all data from
#     another database with -CopyFrom.
#
# Run it again any time: it keeps an existing database and its data.
# "Start Beaman Console.cmd" starts the database along with the app.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\setup-local.ps1 -CopyFrom "postgres://user@localhost:5432/dbname"

param(
  # A Postgres connection URL to copy all data from (only into a new, empty database).
  [string]$CopyFrom = '',
  # Where the database files live. Outside OneDrive, so syncing can't damage them.
  [string]$DataDir = (Join-Path $env:LOCALAPPDATA 'BeamanConsole\pgdata'),
  [int]$Port = 5433,
  [string]$Database = 'beaman_console_dev',
  [string]$AppUser = 'beaman_app'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $root 'server'
$clientDir = Join-Path $root 'client'
$envFile = Join-Path $serverDir '.env'
$logFile = Join-Path (Split-Path -Parent $DataDir) 'postgres.log'

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }

# ---- find PostgreSQL -------------------------------------------------------------------------
Step 'Looking for PostgreSQL'
$bin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
  Sort-Object { [int]($_.Name -replace '\D', '') } -Descending |
  ForEach-Object { Join-Path $_.FullName 'bin' } |
  Where-Object { Test-Path (Join-Path $_ 'initdb.exe') } |
  Select-Object -First 1
if (-not $bin) { Fail 'PostgreSQL was not found under C:\Program Files\PostgreSQL. Install PostgreSQL 18 first.' }
$pg = @{ initdb = "$bin\initdb.exe"; ctl = "$bin\pg_ctl.exe"; psql = "$bin\psql.exe"; dump = "$bin\pg_dump.exe"; createdb = "$bin\createdb.exe" }
Write-Host "Using $bin"

# ---- the database folder -----------------------------------------------------------------------
$fresh = -not (Test-Path (Join-Path $DataDir 'PG_VERSION'))
if ($fresh) {
  Step "Creating the database folder $DataDir"
  if (Test-Path $envFile) {
    $existing = (Get-Content $envFile | Where-Object { $_ -like 'DATABASE_URL=*' }) -join ''
    if ($existing -and $existing -notmatch "localhost:$Port/") {
      $backup = "$envFile.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
      Copy-Item $envFile $backup
      Write-Host "server/.env pointed somewhere else; saved it as $(Split-Path -Leaf $backup)."
    }
  }
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $appPassword = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DataDir) | Out-Null
  $pwFile = [IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $pwFile -Value $appPassword -Encoding ascii -NoNewline
    & $pg.initdb -D $DataDir -U $AppUser --pwfile=$pwFile --auth=scram-sha-256 -E UTF8 `
      --locale-provider=builtin --builtin-locale=C.UTF-8 --lc-collate=C --lc-ctype=C | Out-Null
    if ($LASTEXITCODE) { Fail 'Creating the database folder failed.' }
  } finally { Remove-Item $pwFile -ErrorAction SilentlyContinue }
  # Only this computer can connect, on the app's own port.
  Add-Content -Path (Join-Path $DataDir 'postgresql.conf') -Encoding ascii -Value "`n# Beaman Console`nport = $Port`nlisten_addresses = 'localhost'"
  Set-Content -Path $envFile -Encoding ascii -Value @(
    '# Written by scripts/setup-local.ps1. Not in git.',
    "DATABASE_URL=postgres://${AppUser}:$appPassword@localhost:$Port/$Database",
    'PORT=3001')
  Write-Host 'Created. Settings saved in server/.env.'
} else {
  Step "Using the existing database folder $DataDir"
  if (-not (Test-Path $envFile)) { Fail "server/.env is missing, so the app's password is unknown. Move $DataDir aside and run this again to start fresh." }
}

# The app's password, from server/.env (used for the steps below).
$url = (Get-Content $envFile | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1) -replace '^DATABASE_URL=', ''
if ($url -notmatch '^postgres://([^:]+):([^@]+)@') { Fail 'server/.env has no DATABASE_URL with a password.' }
$env:PGPASSWORD = $Matches[2]
$AppUser = $Matches[1]

# ---- start it ---------------------------------------------------------------------------------------
Step 'Starting the database'
& $pg.ctl status -D $DataDir *> $null
if ($LASTEXITCODE -ne 0) {
  # The database keeps running after pg_ctl finishes, so wait for pg_ctl alone: capturing its
  # output, or Start-Process -Wait (which also waits for what it leaves running), would never return.
  $p = Start-Process -FilePath $pg.ctl -ArgumentList @('start', '-D', "`"$DataDir`"", '-l', "`"$logFile`"", '-w') -NoNewWindow -PassThru
  $p.WaitForExit()
  if ($p.ExitCode) { Fail "The database didn't start. See $logFile." }
  Write-Host 'Started.'
} else { Write-Host 'Already running.' }

$created = $false
$exists = & $pg.psql -h localhost -p $Port -U $AppUser -d postgres -X -t -A -c "SELECT 1 FROM pg_database WHERE datname = '$Database'"
if ($LASTEXITCODE) { Fail "Couldn't connect to the database. See $logFile." }
if (-not $exists) {
  & $pg.createdb -h localhost -p $Port -U $AppUser $Database
  if ($LASTEXITCODE) { Fail 'Creating the database failed.' }
  $created = $true
}

# ---- packages ----------------------------------------------------------------------------------------
foreach ($dir in @($serverDir, $clientDir)) {
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Step "Installing packages in $(Split-Path -Leaf $dir)"
    Push-Location $dir; try { npm install --no-fund --no-audit; if ($LASTEXITCODE) { Fail 'npm install failed.' } } finally { Pop-Location }
  }
}

# ---- data ----------------------------------------------------------------------------------------------
if ($CopyFrom) {
  if (-not $created) { Fail "Not copying: $Database already existed, and copying only goes into a new, empty database." }
  Step "Copying everything from $($CopyFrom -replace ':[^:@/]*@', ':***@')"
  $env:PGCLIENTENCODING = 'UTF8'
  $appPw = $env:PGPASSWORD
  Remove-Item Env:PGPASSWORD   # the source has its own login
  $dumpFile = [IO.Path]::GetTempFileName()
  try {
    & $pg.dump --dbname=$CopyFrom --no-owner --no-privileges --encoding=UTF8 --file=$dumpFile
    if ($LASTEXITCODE) { Fail "Couldn't read from $CopyFrom." }
    $env:PGPASSWORD = $appPw
    & $pg.psql -h localhost -p $Port -U $AppUser -d $Database -v ON_ERROR_STOP=1 -X -q -f $dumpFile | Out-Null
    if ($LASTEXITCODE) { Fail 'The copy failed. Delete the database folder and run this again.' }
  } finally { Remove-Item $dumpFile -ErrorAction SilentlyContinue; Remove-Item Env:PGCLIENTENCODING -ErrorAction SilentlyContinue }
  Write-Host 'Copied.'
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

Step 'Creating or updating the tables'
Push-Location $serverDir; try { npm run migrate --silent; if ($LASTEXITCODE) { Fail 'Creating the tables failed.' } } finally { Pop-Location }

Write-Host "`nAll set. Double-click 'Start Beaman Console.cmd' in $root to run the app." -ForegroundColor Green
