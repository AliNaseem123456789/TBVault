# Creates the chatbot's EC2 server in a SECOND AWS account (run once from your PC).
#
# Two AWS CLI logins are used:
#   -AwsProfile  the chatbot's account (where the server is created)       default: "chatbot"
#   -MainProfile the TBVault account (database + product photos live there)  default: "default"
# Add the chatbot account once with:  aws configure --profile chatbot
#
# In the chatbot account:
#   - SSH key pair saved to ~/.ssh/tbvault-chatbot-key.pem
#   - security group tbvault-chatbot-sg: SSH from your IP only, HTTP/HTTPS from anywhere
#   - IAM role tbvault-chatbot-role (no keys on the server; the TBVault account trusts this role)
#   - Ubuntu 24.04 instance (t3.small, 2 GB RAM) with a 20 GB disk and a fixed IP (Elastic IP)
# In the TBVault account:
#   - the database security group (tbvault-db-sg) accepts the chatbot server's IP on port 5432
#   - the photo bucket lets tbvault-chatbot-role read photos (for photo search indexing)
# Saves the IP to deploy/chatbot/.server-ip for deploy.ps1. Safe to re-run.
#
#   powershell -ExecutionPolicy Bypass -File deploy\chatbot\create-server.ps1

param(
    [string]$AwsProfile = "chatbot",
    [string]$MainProfile = "default",
    [string]$Region = "ap-southeast-2",
    [string]$InstanceType = "t3.small",
    [string]$Name = "tbvault-chatbot",
    [string]$KeyName = "tbvault-chatbot-key",
    [string]$WebGroup = "tbvault-chatbot-sg",
    [string]$Role = "tbvault-chatbot-role",
    [string]$DbGroup = "tbvault-db-sg",
    [string]$Bucket = "",          # default: S3_BUCKET from backend/.env.production or backend/.env
    [string]$BucketRegion = ""     # default: S3_REGION from the same file
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$keyFile = Join-Path $HOME ".ssh\$KeyName.pem"
$ipFile = Join-Path $PSScriptRoot ".server-ip"
$tmp = Join-Path $env:TEMP "tbvault-chatbot-create"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# --- small helpers ----------------------------------------------------------------
# Use-ChatbotAccount / Use-MainAccount run a command in the chatbot / TBVault account and stop the script on failure.
# Try-ChatbotAccount / Try-MainAccount return the output, or $null when the command fails (e.g. "already exists").
# (Not named "Aws": PowerShell names ignore case, so a function "Aws" would hide aws.exe.)
function Run-Aws([string]$prof, [string]$region, [object[]]$cmd, [bool]$mustWork) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $out = & aws @cmd --region $region --profile $prof 2>$null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($code -ne 0) {
        if ($mustWork) { throw "aws $($cmd -join ' ') (profile $prof) failed (exit $code). Run it by hand to see the error." }
        return $null
    }
    if ($null -eq $out) { return "" }   # some commands print nothing when they succeed
    return $out
}
function Use-ChatbotAccount { Run-Aws $AwsProfile $Region $args $true }
function Try-ChatbotAccount { Run-Aws $AwsProfile $Region $args $false }
function Use-MainAccount { Run-Aws $MainProfile $Region $args $true }
function Try-MainAccount { Run-Aws $MainProfile $Region $args $false }
function Empty($value) { return (-not $value) -or ($value -eq "None") }
function Write-Json([string]$name, [string]$json) {
    $path = Join-Path $tmp $name
    [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
    return "file://$path"
}
function Read-EnvValue([string]$key) {
    foreach ($file in @("backend\.env.production", "backend\.env")) {
        $path = Join-Path $root $file
        if (Test-Path $path) {
            $line = Get-Content $path | Where-Object { $_ -match "^\s*$key=" } | Select-Object -First 1
            if ($line) { return ($line -split "=", 2)[1].Trim() }
        }
    }
    return ""
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI not found (winget install Amazon.AWSCLI)" }
if (-not $Bucket) { $Bucket = Read-EnvValue "S3_BUCKET" }
if (-not $BucketRegion) { $BucketRegion = Read-EnvValue "S3_REGION" }
if (-not $BucketRegion) { $BucketRegion = $Region }

$account = Try-ChatbotAccount sts get-caller-identity --query Account --output text
if (-not $account) { throw "AWS profile '$AwsProfile' doesn't work. Set it up with: aws configure --profile $AwsProfile" }
$mainAccount = Try-MainAccount sts get-caller-identity --query Account --output text
if (-not $mainAccount) { throw "AWS profile '$MainProfile' (the TBVault account) doesn't work. Check: aws sts get-caller-identity --profile $MainProfile" }
Write-Host "Chatbot account $account (profile $AwsProfile), TBVault account $mainAccount (profile $MainProfile), region $Region" -ForegroundColor Cyan
if ($account -eq $mainAccount) { Write-Host "Note: both profiles are the same account. That works too." -ForegroundColor Yellow }

# 1. SSH key ------------------------------------------------------------------------
if (-not (Try-ChatbotAccount ec2 describe-key-pairs --key-names $KeyName)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $keyFile) | Out-Null
    $material = Use-ChatbotAccount ec2 create-key-pair --key-name $KeyName --key-type ed25519 --query KeyMaterial --output text
    [IO.File]::WriteAllText($keyFile, (($material -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
    # ssh refuses keys that other Windows users can read.
    icacls $keyFile /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
    Write-Host "Created key pair $KeyName -> $keyFile"
} elseif (-not (Test-Path $keyFile)) {
    throw "Key pair $KeyName exists in AWS but $keyFile is missing. Delete it (aws ec2 delete-key-pair --key-name $KeyName --region $Region --profile $AwsProfile) and re-run."
} else {
    Write-Host "Key pair $KeyName already exists"
}

# 2. Security group -----------------------------------------------------------------
$vpcId = Use-ChatbotAccount ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text
if (Empty $vpcId) { throw "The chatbot account has no default VPC in $Region." }
$webSg = Use-ChatbotAccount ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpcId" "Name=group-name,Values=$WebGroup" --query "SecurityGroups[0].GroupId" --output text
if (Empty $webSg) {
    $webSg = Use-ChatbotAccount ec2 create-security-group --group-name $WebGroup --description "TBVault chatbot server" --vpc-id $vpcId --query GroupId --output text
    Write-Host "Created security group $WebGroup ($webSg)"
}
$myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
Try-ChatbotAccount ec2 authorize-security-group-ingress --group-id $webSg --protocol tcp --port 22 --cidr "$myIp/32" | Out-Null
Try-ChatbotAccount ec2 authorize-security-group-ingress --group-id $webSg --protocol tcp --port 80 --cidr "0.0.0.0/0" | Out-Null
Try-ChatbotAccount ec2 authorize-security-group-ingress --group-id $webSg --protocol tcp --port 443 --cidr "0.0.0.0/0" | Out-Null
Write-Host "Security group: SSH from $myIp, HTTP/HTTPS from anywhere (the API itself needs the internal key)"

# 3. IAM role: an identity for the server. It gets no permissions here; the TBVault
#    account's photo bucket names this role in step 6.
if (-not (Try-ChatbotAccount iam get-role --role-name $Role)) {
    $trust = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
    Use-ChatbotAccount iam create-role --role-name $Role --assume-role-policy-document (Write-Json "trust.json" $trust) | Out-Null
    Write-Host "Created IAM role $Role"
}
if (-not (Try-ChatbotAccount iam get-instance-profile --instance-profile-name $Role)) {
    Use-ChatbotAccount iam create-instance-profile --instance-profile-name $Role | Out-Null
    Use-ChatbotAccount iam add-role-to-instance-profile --instance-profile-name $Role --role-name $Role | Out-Null
    Write-Host "Created instance profile $Role (waiting for IAM to catch up...)"
    Start-Sleep -Seconds 15
}
$roleArn = "arn:aws:iam::${account}:role/$Role"

# 4. The instance -------------------------------------------------------------------
$instanceId = Use-ChatbotAccount ec2 describe-instances --filters "Name=tag:Name,Values=$Name" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[0].Instances[0].InstanceId" --output text
if (Empty $instanceId) {
    $ami = Use-ChatbotAccount ssm get-parameters --names "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id" --query "Parameters[0].Value" --output text
    $disks = Write-Json "disks.json" '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":true}}]'
    # A new instance profile can take a little while before EC2 accepts it.
    for ($try = 1; ; $try++) {
        $instanceId = Try-ChatbotAccount ec2 run-instances --image-id $ami --instance-type $InstanceType --key-name $KeyName `
            --security-group-ids $webSg --iam-instance-profile "Name=$Role" --block-device-mappings $disks `
            --metadata-options "HttpTokens=required,HttpEndpoint=enabled" `
            --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$Name}]" `
            --query "Instances[0].InstanceId" --output text
        if ($instanceId) { break }
        if ($try -ge 4) { throw "run-instances failed 4 times. Is $InstanceType allowed on this account's free plan?" }
        Write-Host "  run-instances failed, retrying in 15s..."
        Start-Sleep -Seconds 15
    }
    Write-Host "Launched $instanceId (Ubuntu 24.04, $InstanceType)"
} else {
    Write-Host "Instance $Name already exists ($instanceId)"
    Try-ChatbotAccount ec2 start-instances --instance-ids $instanceId | Out-Null
}
Use-ChatbotAccount ec2 wait instance-running --instance-ids $instanceId | Out-Null

# 5. Fixed public IP ----------------------------------------------------------------
$ip = Use-ChatbotAccount ec2 describe-addresses --filters "Name=instance-id,Values=$instanceId" --query "Addresses[0].PublicIp" --output text
if (Empty $ip) {
    $allocation = Use-ChatbotAccount ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$Name}]" --query AllocationId --output text
    Use-ChatbotAccount ec2 associate-address --instance-id $instanceId --allocation-id $allocation | Out-Null
    $ip = Use-ChatbotAccount ec2 describe-addresses --allocation-ids $allocation --query "Addresses[0].PublicIp" --output text
    Write-Host "Attached Elastic IP $ip"
}
Set-Content -Path $ipFile -Value $ip -NoNewline -Encoding ascii

# 6. TBVault account: let the chatbot server in -------------------------------------
Write-Host ""
Write-Host "TBVault account:" -ForegroundColor Cyan

# 6a. Database: RDS is reachable from the internet but only from allowed IPs.
$dbSg = Use-MainAccount ec2 describe-security-groups --filters "Name=group-name,Values=$DbGroup" --query "SecurityGroups[0].GroupId" --output text
if (Empty $dbSg) {
    Write-Host "  No $DbGroup found in the TBVault account - allow $ip on port 5432 in your RDS security group by hand." -ForegroundColor Yellow
} else {
    $rule = '[{"IpProtocol":"tcp","FromPort":5432,"ToPort":5432,"IpRanges":[{"CidrIp":"' + $ip + '/32","Description":"TBVault chatbot server"}]}]'
    Try-MainAccount ec2 authorize-security-group-ingress --group-id $dbSg --ip-permissions (Write-Json "db-rule.json" $rule) | Out-Null
    Write-Host "  Database ($DbGroup) accepts $ip on port 5432"
}

# 6b. Photos: add one statement to the bucket policy that lets the chatbot role read objects.
#     Any statements already in the policy are kept.
if (-not $Bucket) {
    Write-Host "  S3_BUCKET not found in backend/.env - pass -Bucket to let the chatbot read product photos." -ForegroundColor Yellow
} else {
    $sid = "TbvaultChatbotReadPhotos"
    $current = Run-Aws $MainProfile $BucketRegion @("s3api", "get-bucket-policy", "--bucket", $Bucket, "--query", "Policy", "--output", "text") $false
    if ($current) {
        $policy = ($current -join "`n") | ConvertFrom-Json
    } else {
        $policy = [pscustomobject]@{ Version = "2012-10-17"; Statement = @() }
    }
    $statements = @($policy.Statement | Where-Object { $_ -and $_.Sid -ne $sid })
    $statements += [pscustomobject]@{
        Sid = $sid; Effect = "Allow"; Principal = @{ AWS = $roleArn }
        Action = "s3:GetObject"; Resource = "arn:aws:s3:::$Bucket/*"
    }
    $policy.Statement = $statements
    $policyFile = Write-Json "bucket-policy.json" ($policy | ConvertTo-Json -Depth 20)
    # S3 rejects a role it can't see yet ("Invalid principal"), so give a new role a moment.
    for ($try = 1; ; $try++) {
        $ok = Run-Aws $MainProfile $BucketRegion @("s3api", "put-bucket-policy", "--bucket", $Bucket, "--policy", $policyFile) $false
        if ($null -ne $ok) { break }
        if ($try -ge 6) { throw "Could not update the policy of bucket $Bucket. Run: aws s3api get-bucket-policy --bucket $Bucket --profile $MainProfile" }
        Start-Sleep -Seconds 10
    }
    Write-Host "  Bucket $Bucket lets $Role (chatbot account) read photos"
}
Remove-Item -Recurse -Force $tmp

Write-Host ""
Write-Host "Chatbot server ready: $ip" -ForegroundColor Green
Write-Host "  SSH:  ssh -i $keyFile ubuntu@$ip   (give it a minute to boot)"
Write-Host "  Next: point a domain at $ip (e.g. a DuckDNS name), then:"
Write-Host "        powershell -ExecutionPolicy Bypass -File deploy\chatbot\deploy.ps1 -Domain your-chatbot-domain"
