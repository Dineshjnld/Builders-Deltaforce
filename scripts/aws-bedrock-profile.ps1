param([Parameter(Mandatory)][string]$AlertEmail)
$ErrorActionPreference='Stop'
$cli=(Get-Command aws.exe -ErrorAction SilentlyContinue).Source
if(!$cli){$cli=Join-Path $env:ProgramFiles 'Amazon/AWSCLIV2/aws.exe'}
py -3.13 (Join-Path $PSScriptRoot 'aws-project-budget.py') --verify-only --email $AlertEmail
if($LASTEXITCODE){throw 'Budget verification must succeed first.'}
$account=& $cli sts get-caller-identity --query Account --output text --region us-west-2
if($LASTEXITCODE -or $account -notmatch '^\d{12}$'){throw 'Cannot identify this AWS account.'}
$arn=& $cli bedrock create-inference-profile --inference-profile-name deltaforce-agent-studio-nova-lite --client-request-token "deltaforce-agent-studio-nova-lite-$account-v1" --model-source 'copyFrom=arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-lite-v1:0' --tags 'key=DeltaforceProject,value=AgentStudio' --region us-west-2 --query inferenceProfileArn --output text
if($LASTEXITCODE){throw 'Project inference profile creation failed.'}
$profile=& $cli bedrock get-inference-profile --inference-profile-identifier $arn --region us-west-2 --output json | ConvertFrom-Json
if($LASTEXITCODE -or $profile.type -ne 'APPLICATION' -or $profile.status -ne 'ACTIVE' -or @($profile.models).Count -ne 1 -or $profile.models[0].modelArn -ne 'arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-lite-v1:0'){throw 'Profile is not ready or does not match the project model.'}
$tags=& $cli bedrock list-tags-for-resource --resource-arn $arn --region us-west-2 --output json | ConvertFrom-Json
if($LASTEXITCODE -or !($tags.tags | Where-Object {$_.key -eq 'DeltaforceProject' -and $_.value -eq 'AgentStudio'})){throw 'Required project tag missing.'}
Write-Output "Verified project inference profile: $arn"
Write-Output 'Confirm the DeltaforceProject cost allocation tag is Active in Billing before enabling inference.'
