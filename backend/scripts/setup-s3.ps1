# Creates the S3 bucket + a limited IAM user for TBVault product images,
# then writes the S3_* values into backend/.env and VITE_MEDIA_BASE_URL into frontend/.env.local.
#
# Needs the AWS CLI v2, signed in as an admin of your account (aws configure).
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File backend\scripts\setup-s3.ps1
#   powershell -ExecutionPolicy Bypass -File backend\scripts\setup-s3.ps1 -Bucket my-other-name
# Safe to re-run: existing bucket/user are reused. Each run that finds no S3 key in .env creates a new access key.

param(
    [string]$Bucket = "tbvault-images-ali",
    [string]$Region = "ap-south-1",
    [string]$UserName = "tbvault-app"
)

$ErrorActionPreference = "Stop"
$backendEnv = Join-Path $PSScriptRoot "..\.env"
$frontendEnv = Join-Path $PSScriptRoot "..\..\frontend\.env.local"
$tmp = Join-Path $env:TEMP "tbvault-s3-setup"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# Native commands don't throw in PowerShell; stop on a non-zero exit code ourselves.
function Invoke-Aws {
    $out = & aws @args
    if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed (exit $LASTEXITCODE)" }
    return $out
}

# True when the aws command succeeds. Used for "does it exist?" checks, whose failure is expected.
# (Windows PowerShell turns redirected stderr into errors, so relax the preference while probing.)
function Test-Aws {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & aws @args 2>$null | Out-Null
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $old
    return $ok
}

# Writes JSON without a BOM so the AWS CLI can read it via file://
function Write-Json([string]$name, [string]$json) {
    $path = Join-Path $tmp $name
    [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
    return "file://$path"
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

function Get-EnvValue([string]$path, [string]$key) {
    if (-not (Test-Path $path)) { return "" }
    $line = Get-Content $path | Where-Object { $_ -match "^\s*$key=" } | Select-Object -First 1
    if ($line) { return ($line -split "=", 2)[1].Trim() } else { return "" }
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw "AWS CLI not found. Install it with: winget install Amazon.AWSCLI  (then open a new terminal)"
}

$account = Invoke-Aws sts get-caller-identity --query Account --output text
Write-Host "AWS account $account, region $Region, bucket $Bucket" -ForegroundColor Cyan

# 1. Bucket
if (Test-Aws s3api head-bucket --bucket $Bucket) {
    Write-Host "Bucket already exists - reusing it"
} else {
    if ($Region -eq "us-east-1") {
        Invoke-Aws s3api create-bucket --bucket $Bucket --region $Region | Out-Null
    } else {
        Invoke-Aws s3api create-bucket --bucket $Bucket --region $Region --create-bucket-configuration "LocationConstraint=$Region" | Out-Null
    }
    Write-Host "Created bucket $Bucket"
}

# 2. Allow a public bucket policy (ACLs stay blocked), then make products/* readable by anyone
Invoke-Aws s3api put-public-access-block --bucket $Bucket --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false" | Out-Null
$bucketPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadProductImages",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$Bucket/products/*"
  }]
}
"@
Invoke-Aws s3api put-bucket-policy --bucket $Bucket --policy (Write-Json "bucket-policy.json" $bucketPolicy) | Out-Null
Write-Host "products/* is public-read"

# 3. IAM user that can only touch this bucket
if (-not (Test-Aws iam get-user --user-name $UserName)) {
    Invoke-Aws iam create-user --user-name $UserName | Out-Null
    Write-Host "Created IAM user $UserName"
} else {
    Write-Host "IAM user $UserName already exists - reusing it"
}
$userPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::$Bucket/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::$Bucket" }
  ]
}
"@
Invoke-Aws iam put-user-policy --user-name $UserName --policy-name tbvault-s3 --policy-document (Write-Json "user-policy.json" $userPolicy) | Out-Null
Write-Host "Attached policy tbvault-s3"

# 4. Access key (only if .env doesn't already have one)
if (Get-EnvValue $backendEnv "S3_ACCESS_KEY_ID") {
    Write-Host "backend/.env already has S3_ACCESS_KEY_ID - not creating another key"
} else {
    $key = Invoke-Aws iam create-access-key --user-name $UserName --query "AccessKey.[AccessKeyId,SecretAccessKey]" --output text
    $parts = ($key -split "\s+")
    Set-EnvValue $backendEnv "S3_ACCESS_KEY_ID" $parts[0]
    Set-EnvValue $backendEnv "S3_SECRET_ACCESS_KEY" $parts[1]
    Write-Host "Created access key $($parts[0]) and saved it to backend/.env"
}

# 5. Remaining settings
Set-EnvValue $backendEnv "S3_REGION" $Region
Set-EnvValue $backendEnv "S3_BUCKET" $Bucket
Set-EnvValue $backendEnv "S3_ENDPOINT" ""
$mediaUrl = "https://$Bucket.s3.$Region.amazonaws.com"
Set-EnvValue $frontendEnv "VITE_MEDIA_BASE_URL" $mediaUrl

Remove-Item -Recurse -Force $tmp
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  backend/.env        S3_REGION, S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY"
Write-Host "  frontend/.env.local VITE_MEDIA_BASE_URL=$mediaUrl"
Write-Host "Next: node scripts/copy-images-to-s3.js (in backend, with MinIO running), then restart the API and vite."
