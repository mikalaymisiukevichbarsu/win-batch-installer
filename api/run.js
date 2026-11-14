import { redis, ensureSeeded } from '../lib/db.js';

export default async function handler(req, res) {
  await ensureSeeded();

  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'https://win-batch-installer.vercel.app';

  const lines = [];

  // --- ФУНКЦИЯ СКАЧИВАНИЯ ---
  lines.push('function Download-WithProgress {');
  lines.push('    param ([string]$Url, [string]$OutputFile)');
  lines.push('    $request = [System.Net.HttpWebRequest]::Create($Url)');
  lines.push('    $response = $request.GetResponse()');
  lines.push('    $totalLength = $response.ContentLength');
  lines.push('    $stream = $response.GetResponseStream()');
  lines.push('    $fileStream = [System.IO.File]::Create($OutputFile)');
  lines.push('    $buffer = New-Object byte[] 8192');
  lines.push('    $bytesRead = 0; $totalBytesRead = 0');
  lines.push('    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()');
  lines.push('    while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {');
  lines.push('        $fileStream.Write($buffer, 0, $bytesRead)');
  lines.push('        $totalBytesRead += $bytesRead');
  lines.push('        $percent = [math]::Round(($totalBytesRead / $totalLength) * 100, 1)');
  lines.push('        $speed = [math]::Round(($totalBytesRead / $stopwatch.Elapsed.TotalSeconds / 1MB), 2)');
  lines.push('        $downloaded = [math]::Round($totalBytesRead / 1MB, 2)');
  lines.push('        $total = [math]::Round($totalLength / 1MB, 2)');
  lines.push('        Write-Host "\\rDownloading: $percent% | Speed: ${speed} MB/s | Size: ${downloaded} MB / ${total} MB" -NoNewline -ForegroundColor Yellow');
  lines.push('    }');
  lines.push('    $fileStream.Close(); $stream.Close(); $response.Close(); $stopwatch.Stop()');
  lines.push('    Write-Host ""');
  lines.push('    Write-Host "Download completed." -ForegroundColor Green');
  lines.push('}');
  lines.push('');

  // --- ИНИЦИАЛИЗАЦИЯ GUI ---
  lines.push('[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null');
  lines.push('[System.Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null');
  lines.push('');
  
  lines.push('$form = New-Object System.Windows.Forms.Form');
  lines.push('$form.Text = "Win Batch Installer v1.3"');
  lines.push('$form.Size = New-Object System.Drawing.Size(600, 700)');
  lines.push('$form.StartPosition = "CenterScreen"');
  lines.push('$form.FormBorderStyle = "FixedDialog"');
  lines.push('$form.MaximizeBox = $false');
  lines.push('$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)');
  lines.push('');

  // Заголовок
  lines.push('$lblTitle = New-Object System.Windows.Forms.Label');
  lines.push('$lblTitle.Text = "Select programs to install:"');
  lines.push('$lblTitle.Location = New-Object System.Drawing.Point(15, 15)');
  lines.push('$lblTitle.AutoSize = $true');
  lines.push('$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)');
  lines.push('$form.Controls.Add($lblTitle)');
  lines.push('');

  // Панель с чекбоксами
  lines.push('$flowPanel = New-Object System.Windows.Forms.FlowLayoutPanel');
  lines.push('$flowPanel.Location = New-Object System.Drawing.Point(15, 45)');
  lines.push('$flowPanel.Size = New-Object System.Drawing.Size(550, 480)');
  lines.push('$flowPanel.AutoScroll = $true');
  lines.push('$flowPanel.BorderStyle = "FixedSingle"');
  lines.push('$flowPanel.Padding = New-Object System.Windows.Forms.Padding(5)');
  lines.push('$form.Controls.Add($flowPanel)');
  lines.push('');

  // Поле пути и кнопка обзора
  lines.push('$lblPath = New-Object System.Windows.Forms.Label');
  lines.push('$lblPath.Text = "Installation path:"');
  lines.push('$lblPath.Location = New-Object System.Drawing.Point(15, 540)');
  lines.push('$lblPath.AutoSize = $true');
  lines.push('$form.Controls.Add($lblPath)');
  lines.push('');

  lines.push('$txtPath = New-Object System.Windows.Forms.TextBox');
  lines.push('$txtPath.Text = "C:\\\\Programs"');
  lines.push('$txtPath.Location = New-Object System.Drawing.Point(15, 560)');
  lines.push('$txtPath.Size = New-Object System.Drawing.Size(400, 30)');
  lines.push('$form.Controls.Add($txtPath)');
  lines.push('');

  lines.push('$btnBrowse = New-Object System.Windows.Forms.Button');
  lines.push('$btnBrowse.Text = "Browse..."');
  lines.push('$btnBrowse.Location = New-Object System.Drawing.Point(425, 558)');
  lines.push('$btnBrowse.Size = New-Object System.Drawing.Size(140, 32)');
  lines.push('$form.Controls.Add($btnBrowse)');
  lines.push('');

  // Кнопка установки
  lines.push('$btnInstall = New-Object System.Windows.Forms.Button');
  lines.push('$btnInstall.Text = "Install Selected Programs"');
  lines.push('$btnInstall.Location = New-Object System.Drawing.Point(15, 610)');
  lines.push('$btnInstall.Size = New-Object System.Drawing.Size(550, 40)');
  lines.push('$btnInstall.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)');
  lines.push('$btnInstall.BackColor = [System.Drawing.Color]::FromArgb(0, 120, 215)');
  lines.push('$btnInstall.ForeColor = [System.Drawing.Color]::White');
  lines.push('$btnInstall.FlatStyle = "Flat"');
  lines.push('$form.Controls.Add($btnInstall)');
  lines.push('');

  // --- ЛОГИКА ЗАГРУЗКИ ПРОГРАММ ---
  lines.push('try {');
  lines.push(`    $programs = Invoke-RestMethod -Uri "${baseUrl}/api/programs" -UseBasicParsing`);
  lines.push('    if ($programs.Count -eq 0) { throw "No programs found in database." }');
  lines.push('    foreach ($p in $programs) {');
  lines.push('        $cb = New-Object System.Windows.Forms.CheckBox');
  lines.push('        $cb.Text = $p.name');
  lines.push('        $cb.Tag = $p');
  lines.push('        $cb.AutoSize = $true');
  lines.push('        $cb.Margin = New-Object System.Windows.Forms.Padding(0, 5, 0, 5)');
  lines.push('        $cb.Font = New-Object System.Drawing.Font("Segoe UI", 10)');
  lines.push('        $flowPanel.Controls.Add($cb)');
  lines.push('    }');
  lines.push('} catch {');
  lines.push('    [System.Windows.Forms.MessageBox]::Show("Error loading programs: $_", "Connection Error", "OK", "Error")');
  lines.push('    exit');
  lines.push('}');
  lines.push('');

  // --- ОБРАБОТЧИК КНОПКИ BROWSE ---
  lines.push('$btnBrowse.Add_Click({');
  lines.push('    $folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog');
  lines.push('    $folderBrowser.Description = "Select installation folder"');
  lines.push('    $folderBrowser.SelectedPath = $txtPath.Text');
  lines.push('    if ($folderBrowser.ShowDialog() -eq "OK") {');
  lines.push('        $txtPath.Text = $folderBrowser.SelectedPath');
  lines.push('    }');
  lines.push('});');
  lines.push('');

  // --- ОБРАБОТЧИК КНОПКИ INSTALL ---
  lines.push('$btnInstall.Add_Click({');
  lines.push('    $selected = $flowPanel.Controls | Where-Object { $_ -is [System.Windows.Forms.CheckBox] -and $_.Checked }');
  lines.push('    if ($selected.Count -eq 0) {');
  lines.push('        [System.Windows.Forms.MessageBox]::Show("Please select at least one program.", "Warning", "OK", "Warning")');
  lines.push('        return');
  lines.push('    }');
  lines.push('    ');
  lines.push('    $installPath = $txtPath.Text');
  lines.push('    if (-not (Test-Path $installPath)) { New-Item -ItemType Directory -Path $installPath -Force | Out-Null }');
  lines.push('    ');
  lines.push('    $form.Enabled = $false');
  lines.push('    $btnInstall.Text = "Installing... (Check console for progress)"');
  lines.push('    ');
  lines.push('    foreach ($cb in $selected) {');
  lines.push('        $prog = $cb.Tag');
  lines.push('        $url = $prog.url');
  lines.push("        $ext = [System.IO.Path]::GetExtension($url).TrimStart('.')");
  lines.push('        $fileName = "$($prog.id)_installer.$ext"');
  lines.push('        $tempFile = "$env:TEMP\\\\$fileName"');
  lines.push('        ');
  lines.push('        Write-Host "--------------------------------------------------"');
  lines.push('        Write-Host "Installing: $($prog.name)" -ForegroundColor Cyan');
  lines.push('        try {');
  lines.push('            Download-WithProgress -Url $url -OutputFile $tempFile');
  lines.push("            $args = $prog.args -replace '\\{PATH\\}', $installPath");
  lines.push('            if ($ext -eq \'msi\') {');
  lines.push('                Start-Process msiexec.exe -ArgumentList "/i \\"$tempFile\\" $args" -Wait -NoNewWindow');
  lines.push('            } else {');
  lines.push('                Start-Process -FilePath $tempFile -ArgumentList $args -Wait -NoNewWindow');
  lines.push('            }');
  lines.push('            Remove-Item $tempFile -Force -ErrorAction SilentlyContinue');
  lines.push('            Write-Host "[OK] $($prog.name) installed successfully." -ForegroundColor Green');
  lines.push('        } catch {');
  lines.push('            Write-Host "[FAIL] $($prog.name): $_" -ForegroundColor Red');
  lines.push('        }');
  lines.push('    }');
  lines.push('    ');
  lines.push('    $btnInstall.Text = "Install Selected Programs"');
  lines.push('    $form.Enabled = $true');
  lines.push('    [System.Windows.Forms.MessageBox]::Show("All selected programs have been processed!", "Done", "OK", "Information")');
  lines.push('});');
  lines.push('');
  lines.push('[void]$form.ShowDialog()');

  const script = lines.join('\n');
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.status(200).send(script);
}
