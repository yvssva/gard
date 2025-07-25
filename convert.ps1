param(
    [Parameter(Mandatory=$true)]
    [string]$targetDir,
    [Parameter(Mandatory=$true)]
    [ValidateSet('wav', 'mp3')]
    [string]$targetFormat
)

Write-Host "Iniciando processo de conversão para $($targetFormat.ToUpper())..." -ForegroundColor Green

if (-not (Test-Path -Path $targetDir -PathType Container)) {
    Write-Host "ERRO: O diretório '$targetDir' não foi encontrado." -ForegroundColor Red
    exit 1
}

Set-Location -Path $targetDir

$oggFiles = Get-ChildItem -Filter *.ogg

if ($oggFiles.Count -eq 0) {
    Write-Host "Nenhum arquivo .ogg encontrado para converter." -ForegroundColor Yellow
    exit 0
}

Write-Host "Encontrados $($oggFiles.Count) arquivos .ogg para converter."

foreach ($file in $oggFiles) {
    $outputName = $file.BaseName + "." + $targetFormat
    Write-Host "Convertendo $($file.Name) para $($outputName)..."
    
    ffmpeg -loglevel error -i $file.Name $outputName
    
    if ($?) {
        Write-Host "Conversão de $($file.Name) concluída com sucesso." -ForegroundColor Green
        Remove-Item $file.Name
    } else {
        Write-Host "ERRO ao converter $($file.Name)." -ForegroundColor Red
    }
}

Write-Host "Processo de conversão finalizado! Os arquivos originais .ogg foram removidos." -ForegroundColor Green