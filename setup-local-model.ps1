$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$modelRoot = Join-Path $appRoot 'local-model'
$repo = Join-Path $modelRoot 'fashn-vton-1.5'
$weights = Join-Path $modelRoot 'weights'
$wheels = Join-Path $modelRoot 'wheels'
$venv = Join-Path $appRoot '.venv'

$basePython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path $basePython)) {
  $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
  if ($pythonCommand) { $basePython = $pythonCommand.Source }
  else { throw 'Install Python 3.10, 3.11, or 3.12 from python.org, then run this setup again.' }
}

New-Item -ItemType Directory -Path $modelRoot -Force | Out-Null
if (-not (Test-Path (Join-Path $repo 'pyproject.toml'))) {
  $archive = Join-Path $modelRoot 'fashn-vton-1.5.zip'
  $extract = Join-Path $modelRoot 'extract'
  $downloadScript = "fetch('https://github.com/fashn-AI/fashn-vton-1.5/archive/refs/heads/main.zip').then(async r => { if(!r.ok) throw Error('HTTP '+r.status); require('fs').writeFileSync(process.argv[1], Buffer.from(await r.arrayBuffer())); }).catch(e => { console.error(e); process.exit(1); })"
  & node -e $downloadScript $archive
  if ($LASTEXITCODE -ne 0) { throw 'Could not download the open-source model code.' }
  Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
  $source = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
  if (-not $source -or -not (Test-Path (Join-Path $source.FullName 'pyproject.toml'))) { throw 'The downloaded model source archive was incomplete.' }
  Move-Item -LiteralPath $source.FullName -Destination $repo -Force
  Remove-Item -LiteralPath $archive -Force
  Remove-Item -LiteralPath $extract -Recurse -Force
}

if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
  if ((Split-Path -Leaf $basePython) -eq 'py.exe') { & $basePython -3.12 -m venv $venv }
  else { & $basePython -m venv $venv }
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Python environment.' }
}
$python = Join-Path $venv 'Scripts\python.exe'
& $python -m pip install --no-index torch torchvision
if ($LASTEXITCODE -ne 0) { throw 'The CPU-only PyTorch runtime is missing or incomplete.' }
if (-not (Test-Path (Join-Path $venv 'Lib\site-packages\fashn_human_parser'))) {
  & node (Join-Path $appRoot 'install-local-deps.mjs') $python $wheels
  if ($LASTEXITCODE -ne 0) { throw 'Could not download or install the CPU model dependencies.' }
}
& $python -m pip install --no-index --no-deps --no-build-isolation -e $repo
if ($LASTEXITCODE -ne 0) { throw 'Could not install FASHN VTON.' }
New-Item -ItemType Directory -Path (Join-Path $modelRoot 'hf-cache') -Force | Out-Null
$env:HF_HOME = Join-Path $modelRoot 'hf-cache'
$env:PYTHONUTF8 = '1'
& $python (Join-Path $repo 'scripts\download_weights.py') --weights-dir $weights
if ($LASTEXITCODE -ne 0) { throw 'Could not download the model weights.' }
Write-Host 'Local model setup complete. Start the app with npm start; allow a few minutes for the first model load.' -ForegroundColor Green
