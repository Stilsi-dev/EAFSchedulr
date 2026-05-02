$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

if (Test-Path $python) {
    & $python (Join-Path $PSScriptRoot "run.py")
} else {
    python (Join-Path $PSScriptRoot "run.py")
}
