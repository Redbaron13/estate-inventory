<#
  One-time setup for working on Estate Inventory on a Windows PC.

  Run from the project folder in PowerShell:
      powershell -ExecutionPolicy Bypass -File setup\setup-windows.ps1

  Installs what is missing (Git, Node.js LTS, GitHub CLI, Docker Desktop,
  Deno), links this folder to the GitHub repository (or creates the private
  repository if it does not exist yet), installs packages, starts the local
  database with demo data and writes .env.local. Safe to run again: anything
  already done is skipped.
#>
param(
  [string]$Repo = 'Redbaron13/estate-inventory'
)

# Native tools report failure through exit codes; check those explicitly.
# (With 'Stop', Windows PowerShell 5.1 aborts on harmless stderr output.)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($message) { Write-Host "`n== $message" -ForegroundColor Cyan }
function Info($message) { Write-Host "   $message" }
function Fail($message) { Write-Host "`n!! $message" -ForegroundColor Red; exit 1 }
function Have($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

# ---------------------------------------------------------------- tools
Step 'Checking tools'
if (-not (Have 'winget')) {
  Fail 'winget is missing. Install "App Installer" from the Microsoft Store, then run this again.'
}
$tools = @(
  @{ Command = 'git';    Id = 'Git.Git';              Name = 'Git' },
  @{ Command = 'node';   Id = 'OpenJS.NodeJS.LTS';    Name = 'Node.js LTS' },
  @{ Command = 'gh';     Id = 'GitHub.cli';           Name = 'GitHub CLI' },
  @{ Command = 'docker'; Id = 'Docker.DockerDesktop'; Name = 'Docker Desktop' },
  @{ Command = 'deno';   Id = 'DenoLand.Deno';        Name = 'Deno (type-checks the API)' }
)
foreach ($tool in $tools) {
  if (Have $tool.Command) { Info "$($tool.Name): found"; continue }
  Info "$($tool.Name): installing..."
  winget install --id $tool.Id --exact --silent --accept-source-agreements --accept-package-agreements
  Refresh-Path
  if (-not (Have $tool.Command) -and $tool.Command -ne 'docker') {
    Fail "$($tool.Name) did not install. Close this window, open a new PowerShell and run the script again."
  }
}

$nodeMajor = [int]((node -v) -replace '^v(\d+).*', '$1')
if ($nodeMajor -lt 22) {
  Info "Node.js $nodeMajor is too old (22 or newer needed). Upgrading..."
  winget upgrade --id OpenJS.NodeJS.LTS --exact --silent --accept-source-agreements --accept-package-agreements
  Refresh-Path
}

# ---------------------------------------------------------------- docker
Step 'Checking Docker (runs the local database)'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $desktop) {
    Info 'Starting Docker Desktop...'
    Start-Process $desktop
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 3
      docker info *> $null
      if ($LASTEXITCODE -eq 0) { break }
    }
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Fail ('Docker is not running. If it was just installed, restart the PC (it may ask to enable WSL), ' +
          'open Docker Desktop once and accept its terms, then run this script again.')
  }
}
Info 'Docker is running'

# ---------------------------------------------------------------- git + github
Step 'Linking this folder to GitHub'
if (-not (git config --global user.name)) {
  $name = Read-Host '   Your name for saved changes (commits)'
  git config --global user.name $name
}
if (-not (git config --global user.email)) {
  $email = Read-Host '   Your email for saved changes (commits)'
  git config --global user.email $email
}
git config --global core.autocrlf input

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Info 'Sign in to GitHub in the browser window that opens...'
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Fail 'GitHub sign-in did not complete.' }
}
gh auth setup-git *> $null

if (Test-Path .git) {
  Info 'Already linked:'
  git remote -v | Select-Object -First 1
} else {
  gh repo view $Repo *> $null
  if ($LASTEXITCODE -eq 0) {
    Info "Found github.com/$Repo. Linking without changing your files..."
    git init -b main | Out-Null
    git remote add origin "https://github.com/$Repo.git"
    git fetch origin
    if ($LASTEXITCODE -ne 0) { Fail 'Could not download from GitHub.' }
    # Point this folder at the GitHub history but keep the files on disk as
    # they are; any differences show up in "git status" for you to review.
    git reset origin/main | Out-Null
    git branch --set-upstream-to=origin/main main | Out-Null
  } else {
    Info "github.com/$Repo does not exist yet. Creating it as a private repository..."
    git init -b main | Out-Null
    git add -A
    git commit -m 'Initial import' | Out-Null
    gh repo create $Repo --private --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { Fail 'Could not create the GitHub repository.' }
  }
}
$changes = git status --short
if ($changes) {
  Info 'Files that differ from GitHub (review with "git status"):'
  $changes | Select-Object -First 15 | ForEach-Object { Info "  $_" }
} else {
  Info 'This folder matches GitHub.'
}

# ---------------------------------------------------------------- packages
Step 'Installing packages'
npm ci
if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed.' }

# ---------------------------------------------------------------- database
Step 'Starting the local database (first run downloads about 2 GB)'
npx supabase start
if ($LASTEXITCODE -ne 0) { Fail 'The local database did not start. Is Docker Desktop running?' }

$status = ((npx supabase status -o json) -join "`n") | ConvertFrom-Json
@(
  '# Written by setup\setup-windows.ps1 for the local database. Not committed.'
  "VITE_SUPABASE_URL=$($status.API_URL)"
  "VITE_SUPABASE_ANON_KEY=$($status.ANON_KEY)"
  'VITE_APP_ENV=local'
) | Set-Content -Encoding ascii .env.local
Info '.env.local written'

# ---------------------------------------------------------------- done
Step 'Ready'
Write-Host @"
   Start the app:      npm run dev           then open http://localhost:5173
   Demo sign-in:       alex@example.com / estate-demo-pass   (also blair@ and casey@)
   Sign-in codes:      emails land in http://127.0.0.1:54324 (local inbox)
   Run all checks:     npm run check  and  npm run db:test
   Stop the database:  npm run db:stop

   Save and share a change:
     git checkout -b my-change
     git add -A
     git commit -m "Describe the change"
     git push -u origin my-change
     gh pr create --fill        (tests run on GitHub; merge when green)
"@
