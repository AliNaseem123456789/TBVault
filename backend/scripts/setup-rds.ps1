# Creates a PostgreSQL database on AWS RDS for TBVault, opens port 5432 to this PC's public IP,
# downloads the RDS CA bundle and writes DATABASE_URL + DB_SSL_CA_FILE into backend/.env.
# The old backend/.env is backed up first (.env.backup-<time>).
#
# Needs the AWS CLI v2, signed in as an admin of your account (aws configure).
#   powershell -ExecutionPolicy Bypass -File backend\scripts\setup-rds.ps1
#   powershell -ExecutionPolicy Bypass -File backend\scripts\setup-rds.ps1 -Region ap-southeast-2 -EngineVersion 17
#
# Re-run it whenever your home IP changes: it adds the new IP to the security group.
# Re-running when the database already exists resets the master password and rewrites DATABASE_URL.

param(
    [string]$Region = "ap-southeast-2",
    [string]$Instance = "tbvault-db",
    [string]$DbName = "tbvault",
    [string]$MasterUser = "tbvault_admin",
    [string]$InstanceClass = "db.t4g.micro",
    [string]$EngineVersion = "",          # empty = RDS default (latest)
    [string]$SecurityGroup = "tbvault-db-sg"
)

$ErrorActionPreference = "Stop"
$backendDir = Join-Path $PSScriptRoot ".."
$backendEnv = Join-Path $backendDir ".env"
$certDir = Join-Path $backendDir "certs"
$certFile = Join-Path $certDir "rds-global-bundle.pem"

# Native commands don't throw in PowerShell; stop on a non-zero exit code ourselves.
function Invoke-Aws {
    $out = & aws @args --region $Region
    if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed (exit $LASTEXITCODE)" }
    return $out
}

# Runs an aws command whose failure is expected/acceptable; returns $true on success.
function Test-Aws {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & aws @args --region $Region 2>$null | Out-Null
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $old
    return $ok
}

# Replaces KEY=... in an env file, or appends it.
function Set-EnvValue([string]$path, [string]$key, [string]$value) {
    $lines = @()
    if (Test-Path $path) { $lines = @(Get-Content $path) }
    $found = $false
    $lines = @($lines | ForEach-Object {
        if ($_ -match "^\s*$key=") { $found = $true; "$key=$value" } else { $_ }
    })
    if (-not $found) { $lines = @($lines) + "$key=$value" }
    [IO.File]::WriteAllLines($path, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
}

# Letters and digits only, so it never needs escaping inside DATABASE_URL.
function New-Password([int]$length = 28) {
    $chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray()
    $bytes = New-Object byte[] $length
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI not found. Install it with: winget install Amazon.AWSCLI  (then open a new terminal)"
}

$account = Invoke-Aws sts get-caller-identity --query Account --output text
Write-Host "AWS account $account, region $Region, instance $Instance" -ForegroundColor Cyan

# 1. Security group in the default VPC, open to this PC only
$vpcId = Invoke-Aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text
if (-not $vpcId -or $vpcId -eq "None") { throw "No default VPC in $Region. Create one: aws ec2 create-default-vpc --region $Region" }

$sgId = Invoke-Aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpcId" "Name=group-name,Values=$SecurityGroup" --query "SecurityGroups[0].GroupId" --output text
if (-not $sgId -or $sgId -eq "None") {
    $sgId = Invoke-Aws ec2 create-security-group --group-name $SecurityGroup --description "TBVault Postgres access" --vpc-id $vpcId --query GroupId --output text
    Write-Host "Created security group $SecurityGroup ($sgId)"
} else {
    Write-Host "Security group $SecurityGroup ($sgId) already exists - reusing it"
}

$myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
if (Test-Aws ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 5432 --cidr "$myIp/32") {
    Write-Host "Allowed Postgres (5432) from your IP $myIp"
} else {
    Write-Host "Postgres (5432) from $myIp was already allowed"
}

# 2. The database
$password = New-Password
if (Test-Aws rds describe-db-instances --db-instance-identifier $Instance) {
    Write-Host "Database $Instance already exists - resetting its master password so .env can be rewritten"
    Invoke-Aws rds modify-db-instance --db-instance-identifier $Instance --master-user-password $password --apply-immediately | Out-Null
} else {
    $createArgs = @(
        "rds", "create-db-instance",
        "--db-instance-identifier", $Instance,
        "--engine", "postgres",
        "--db-instance-class", $InstanceClass,
        "--allocated-storage", "20",
        "--storage-type", "gp2",
        "--master-username", $MasterUser,
        "--master-user-password", $password,
        "--db-name", $DbName,
        "--vpc-security-group-ids", $sgId,
        "--publicly-accessible",
        "--no-multi-az",
        "--backup-retention-period", "1",
        "--storage-encrypted"
    )
    if ($EngineVersion) { $createArgs += @("--engine-version", $EngineVersion) }
    Invoke-Aws @createArgs | Out-Null
    Write-Host "Creating database $Instance ($InstanceClass, 20 GB). This takes 5-15 minutes..."
}

# `aws rds wait` gives up after ~30 minutes; loop in case it is slower.
do {
    $ready = Test-Aws rds wait db-instance-available --db-instance-identifier $Instance
    if (-not $ready) { Write-Host "  still not available, waiting again..." }
} until ($ready)
Start-Sleep -Seconds 20   # a password change applies just after the instance reports available
do {
    $status = Invoke-Aws rds describe-db-instances --db-instance-identifier $Instance --query "DBInstances[0].DBInstanceStatus" --output text
    if ($status -ne "available") { Write-Host "  status: $status"; Start-Sleep -Seconds 15 }
} until ($status -eq "available")

$endpoint = Invoke-Aws rds describe-db-instances --db-instance-identifier $Instance --query "DBInstances[0].Endpoint.Address" --output text
Write-Host "Database is available at $endpoint" -ForegroundColor Green

# 3. CA bundle so the app can verify it is talking to RDS
New-Item -ItemType Directory -Force -Path $certDir | Out-Null
Invoke-WebRequest -Uri "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem" -OutFile $certFile -UseBasicParsing
Write-Host "Saved RDS CA bundle to backend/certs/rds-global-bundle.pem"

# 4. backend/.env (backup first)
if (Test-Path $backendEnv) {
    $backup = "$backendEnv.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item $backendEnv $backup
    Write-Host "Backed up backend/.env to $(Split-Path $backup -Leaf)"
}
Set-EnvValue $backendEnv "DATABASE_URL" "postgresql://${MasterUser}:${password}@${endpoint}:5432/${DbName}?sslmode=require"
Set-EnvValue $backendEnv "DB_SSL_CA_FILE" "./certs/rds-global-bundle.pem"

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  backend/.env  DATABASE_URL (password saved only there), DB_SSL_CA_FILE"
Write-Host "Next, in backend:"
Write-Host "  npx prisma migrate deploy"
Write-Host "  npm run seed"
Write-Host "  npm run dev"
