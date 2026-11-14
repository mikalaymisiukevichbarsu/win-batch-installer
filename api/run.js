import { redis, ensureSeeded } from '../lib/db.js';

function escapePS(str) {
  return (str || '').replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
}

export default async function handler(req, res) {
  await ensureSeeded();

  const ids = req.query.ids;
  const rawPath = req.query.path;

  // Если переданы конкретные параметры - работаем как раньше (скрипт установки)
  if (ids && rawPath) {
    // ... здесь можно оставить старую логику генерации скрипта для автоматизации ...
    // Но для GUI-режима мы будем игнорировать это и всегда отдавать GUI, 
    // если не передан специальный флаг ?mode=script
    if (req.query.mode === 'script') {
        // Старая логика генерации скрипта (можно вернуть при необходимости)
        return res.status(400).send('Script mode not implemented in this version.');
    }
  }

  // --- ГЕНЕРАЦИЯ GUI-ПРИЛОЖЕНИЯ ---
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'https://win-batch-installer.vercel.app';

  // Код функции Download-WithProgress (тот же, что и раньше)
  const downloadFunc = `
function Download-WithProgress {
    param ([string]$Url, [string]$OutputFile)
    $request = [System.Net.HttpWebRequest]::Create($Url)
    $response = $request.GetResponse()
    $totalLength = $response.ContentLength
    $stream = $response.GetResponseStream()
    $fileStream = [System.IO.File]::Create($OutputFile)
    $buffer = New-Object byte[] 8192
    $bytesRead = 0; $totalBytesRead = 0
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $fileStream.Write($buffer, 0, $bytesRead)
        $totalBytesRead += $bytesRead
        $percent = [math]::Round(($totalBytesRead / $totalLength) * 100, 1)
        $speed = [math]::Round(($totalBytesRead / $stopwatch.Elapsed.TotalSeconds / 1MB), 2)
        $downloaded = [math]::Round($totalBytesRead / 1MB, 2)
        $total = [math]::Round($totalLength / 1MB, 2)
        Write-Host "\\rDownloading: $percent% | Speed: ${speed} MB/s | Size: ${downloaded} MB / ${total} MB" -NoNewline -ForegroundColor Yellow
    }
    $fileStream.Close(); $stream.Close(); $response.Close(); $stopwatch.Stop()
    Write-Host ""
    Write-Host "Download completed." -ForegroundColor Green
}
`;

  // Код GUI приложения на WinForms
  const guiCode = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

\$form = New-Object System.Windows.Forms.Form
\$form.Text = "Win Batch Installer"
\$form.Size = New-Object System.Drawing.Size(500, 600)
\$form.StartPosition = "CenterScreen"
\$form.FormBorderStyle = "FixedDialog"
\$form.MaximizeBox = \$false

\$label = New-Object System.Windows.Forms.Label
\$label.Text = "Select programs to install:"
\$label.Location = New-Object System.Drawing.Point(10, 10)
\$label.AutoSize = \$true
\$form.Controls.Add(\$label)

\$flowPanel = New-Object System.Windows.Forms.FlowLayoutPanel
\$flowPanel.Location = New-Object System.Drawing.Point(10, 40)
\$flowPanel.Size = New-Object System.Drawing.Size(460, 450)
\$flowPanel.AutoScroll = \$true
\$form.Controls.Add(\$flowPanel)

\$btnInstall = New-Object System.Windows.Forms.Button
\$btnInstall.Text = "Install Selected"
\$btnInstall.Location = New-Object System.Drawing.Point(10, 500)
\$btnInstall.Size = New-Object System.Drawing.Size(120, 30)
\$form.Controls.Add(\$btnInstall)

\$txtPath = New-Object System.Windows.Forms.TextBox
\$txtPath.Text = "C:\\\\Programs"
\$txtPath.Location = New-Object System.Drawing.Point(140, 500)
\$txtPath.Size = New-Object System.Drawing.Size(250, 30)
\$form.Controls.Add(\$txtPath)

# Загрузка списка программ из API
try {
    \$programs = Invoke-RestMethod -Uri "${baseUrl}/api/programs" -UseBasicParsing
    foreach (\$p in \$programs) {
        \$cb = New-Object System.Windows.Forms.CheckBox
        \$cb.Text = \$p.name
        \$cb.Tag = \$p  # Сохраняем объект программы в Tag
        \$cb.AutoSize = \$true
        \$cb.Margin = New-Object System.Windows.Forms.Padding(5)
        \$flowPanel.Controls.Add(\$cb)
    }
} catch {
    [System.Windows.Forms.MessageBox]::Show("Failed to load programs: \$_", "Error")
    exit
}

\$btnInstall.Add_Click({
    \$selected = \$flowPanel.Controls | Where-Object { \$_ -is [System.Windows.Forms.CheckBox] -and \$_.Checked }
    if (\$selected.Count -eq 0) {
        [System.Windows.Forms.MessageBox]::Show("Please select at least one program.", "Warning")
        return
    }
    
    \$installPath = \$txtPath.Text
    if (-not (Test-Path \$installPath)) { New-Item -ItemType Directory -Path \$installPath -Force | Out-Null }
    
    \$form.Enabled = \$false  # Блокируем форму во время установки
    \$btnInstall.Text = "Installing..."
    
    foreach (\$cb in \$selected) {
        \$prog = \$cb.Tag
        \$url = \$prog.url
        \$ext = [System.IO.Path]::GetExtension(\$url).TrimStart('.')
        \$fileName = "\$(\$prog.id)_installer.\$ext"
        \$tempFile = "\$env:TEMP\\\\\$fileName"
        
        Write-Host "Installing: \$(\$prog.name)" -ForegroundColor Cyan
        
        try {
            Download-WithProgress -Url \$url -OutputFile \$tempFile
            
            \$args = \$prog.args -replace '\\{PATH\\}', \$installPath
            if (\$ext -eq 'msi') {
                Start-Process msiexec.exe -ArgumentList "/i \`"\$tempFile\`" \$args" -Wait -NoNewWindow
            } else {
                Start-Process -FilePath \$tempFile -ArgumentList \$args -Wait -NoNewWindow
            }
            
            Remove-Item \$tempFile -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] \$(\$prog.name) installed." -ForegroundColor Green
        } catch {
            Write-Host "[FAIL] \$(\$prog.name): \$_" -ForegroundColor Red
        }
    }
    
    \$btnInstall.Text = "Install Selected"
    \$form.Enabled = \$true
    [System.Windows.Forms.MessageBox]::Show("Installation complete!", "Done")
})

[void]\$form.ShowDialog()
`;

  const fullScript = `${downloadFunc}\n${guiCode}`;
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send(fullScript);
}
