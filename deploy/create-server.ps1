# Creates the EC2 server for TBVault (run once from your PC, AWS CLI signed in as admin):
#   - SSH key pair saved to ~/.ssh/tbvault-key.pem
#   - security group tbvault-web-sg: SSH from your IP only, HTTP/HTTPS from anywhere
#   - lets that group reach the RDS database (tbvault-db-sg)
#   - IAM role so the server can use the S3 bucket without access keys
#   - Ubuntu 24.04 instance with a 20 GB disk and a fixed public IP (Elastic IP)
# Saves the IP to deploy/.server-ip for deploy.ps1. Safe to re-run.
#
#   powershell -ExecutionPolicy Bypass -File deploy\create-server.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\create-server.ps1 -InstanceType t3.small

param(
    [string]$Region = "ap-southeast-2",
    [string]$InstanceType = "t3.micro",
    [string]$Bucket = "tbault-images",
    [string]$Name = "tbvault-server",
    [string]$KeyName = "tbvault-key",
    [string]$WebGroup = "tbvault-web-sg",
    [string]$DbGroup = "tbvault-db-sg",
    [string]$Role = "tbvault-ec2-role"
)

$ErrorActionPreference = "Stop"
$keyFile = Join-Path $HOME ".ssh\$KeyName.pem"
$ipFile = Join-Path $PSScriptRoot ".server-ip"
$tmp = Join-Path $env:TEMP "tbvault-create-server"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Invoke-Aws {
    $out = & aws @args --region $Region
    if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed (exit $LASTEXITCODE)" }
    return $out
}
function Test-Aws {
    $old = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & aws @args --region $Region 2>$null | Out-Null
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $old
    return $ok
}
function Write-Json([string]$name, [string]$json) {
    $path = Join-Path $tmp $name
    [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
    return "file://$path"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) { throw "AWS CLI not found (winget install Amazon.AWSCLI)" }
$account = Invoke-Aws sts get-caller-identity --query Account --output text
Write-Host "AWS account $account, region $Region, $InstanceType" -ForegroundColor Cyan

# 1. SSH key
if (-not (Test-Aws ec2 describe-key-pairs --key-names $KeyName)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $keyFile) | Out-Null
    $material = Invoke-Aws ec2 create-key-pair --key-name $KeyName --key-type ed25519 --query KeyMaterial --output text
    [IO.File]::WriteAllText($keyFile, (($material -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
    # ssh refuses keys that other Windows users can read.
    icacls $keyFile /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
    Write-Host "Created key pair $KeyName -> $keyFile"
} elseif (-not (Test-Path $keyFile)) {
    throw "Key pair $KeyName exists in AWS but $keyFile is missing. Delete it (aws ec2 delete-key-pair --key-name $KeyName --region $Region) and re-run."
} else {
    Write-Host "Key pair $KeyName already exists"
}

# 2. Security groups
$vpcId = Invoke-Aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text
$webSg = Invoke-Aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpcId" "Name=group-name,Values=$WebGroup" --query "SecurityGroups[0].GroupId" --output text
if (-not $webSg -or $webSg -eq "None") {
    $webSg = Invoke-Aws ec2 create-security-group --group-name $WebGroup --description "TBVault web server" --vpc-id $vpcId --query GroupId --output text
    Write-Host "Created security group $WebGroup ($webSg)"
}
$myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
Test-Aws ec2 authorize-security-group-ingress --group-id $webSg --protocol tcp --port 22 --cidr "$myIp/32" | Out-Null
Test-Aws ec2 authorize-security-group-ingress --group-id $webSg --protocol tcp --port 80 --cidr "0.0.0.0/0" | Out-Null
Test-Aws ec2 authorize-security-group-ingress --group-id $webSg --protocol tcp --port 443 --cidr "0.0.0.0/0" | Out-Null
Write-Host "Web group: SSH from $myIp, HTTP/HTTPS from anywhere"

$dbSg = Invoke-Aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$vpcId" "Name=group-name,Values=$DbGroup" --query "SecurityGroups[0].GroupId" --output text
if ($dbSg -and $dbSg -ne "None") {
    Test-Aws ec2 authorize-security-group-ingress --group-id $dbSg --protocol tcp --port 5432 --source-group $webSg | Out-Null
    Write-Host "Database group $DbGroup now accepts the server"
} else {
    Write-Host "No $DbGroup found - run backend\scripts\setup-rds.ps1 first, then re-run this" -ForegroundColor Yellow
}

# 3. IAM role for S3 (no access keys on the server)
if (-not (Test-Aws iam get-role --role-name $Role)) {
    $trust = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
    Invoke-Aws iam create-role --role-name $Role --assume-role-policy-document (Write-Json "trust.json" $trust) | Out-Null
    Write-Host "Created IAM role $Role"
}
$s3Policy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::$Bucket/*" },
    { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::$Bucket" }
  ]
}
"@
Invoke-Aws iam put-role-policy --role-name $Role --policy-name tbvault-s3 --policy-document (Write-Json "s3.json" $s3Policy) | Out-Null
if (-not (Test-Aws iam get-instance-profile --instance-profile-name $Role)) {
    Invoke-Aws iam create-instance-profile --instance-profile-name $Role | Out-Null
    Invoke-Aws iam add-role-to-instance-profile --instance-profile-name $Role --role-name $Role | Out-Null
    Write-Host "Created instance profile $Role (waiting for IAM to catch up...)"
    Start-Sleep -Seconds 15
}

# 4. The instance
$instanceId = Invoke-Aws ec2 describe-instances --filters "Name=tag:Name,Values=$Name" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[0].Instances[0].InstanceId" --output text
if (-not $instanceId -or $instanceId -eq "None") {
    $ami = Invoke-Aws ssm get-parameters --names "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id" --query "Parameters[0].Value" --output text
    $disks = Write-Json "disks.json" '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":true}}]'
    # A new instance profile can take a little while before EC2 accepts it.
    for ($try = 1; ; $try++) {
        try {
            $instanceId = Invoke-Aws ec2 run-instances --image-id $ami --instance-type $InstanceType --key-name $KeyName `
                --security-group-ids $webSg --iam-instance-profile "Name=$Role" --block-device-mappings $disks `
                --metadata-options "HttpTokens=required,HttpEndpoint=enabled" `
                --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$Name}]" `
                --query "Instances[0].InstanceId" --output text
            break
        } catch {
            if ($try -ge 4) { throw }
            Write-Host "  run-instances failed, retrying in 15s..."
            Start-Sleep -Seconds 15
        }
    }
    Write-Host "Launched $instanceId (Ubuntu 24.04, $InstanceType)"
} else {
    Write-Host "Instance $Name already exists ($instanceId)"
    Test-Aws ec2 start-instances --instance-ids $instanceId | Out-Null
}
Invoke-Aws ec2 wait instance-running --instance-ids $instanceId | Out-Null

# 5. Fixed public IP
$ip = Invoke-Aws ec2 describe-addresses --filters "Name=instance-id,Values=$instanceId" --query "Addresses[0].PublicIp" --output text
if (-not $ip -or $ip -eq "None") {
    $allocation = Invoke-Aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$Name}]" --query AllocationId --output text
    Invoke-Aws ec2 associate-address --instance-id $instanceId --allocation-id $allocation | Out-Null
    $ip = Invoke-Aws ec2 describe-addresses --allocation-ids $allocation --query "Addresses[0].PublicIp" --output text
    Write-Host "Attached Elastic IP $ip"
}
Set-Content -Path $ipFile -Value $ip -NoNewline -Encoding ascii
Remove-Item -Recurse -Force $tmp

Write-Host ""
Write-Host "Server ready: $ip" -ForegroundColor Green
Write-Host "  SSH:  ssh -i $keyFile ubuntu@$ip   (give it a minute to boot)"
Write-Host "  Next: powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Domain your-domain"
