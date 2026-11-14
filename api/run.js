import { redis, ensureSeeded } from '../lib/db.js';

export default async function handler(req, res) {
  await ensureSeeded();

  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}` 
    : 'https://win-batch-installer.vercel.app';

  // Собираем скрипт по частям, чтобы избежать проблем с экранированием ${} и \
  const lines = [];

  // 1. Функция скачивания с прогрессом
  lines.push(`function Download-WithProgress {`);
  lines.push(`    param ([string]$Url, [string]$OutputFile)`);
  lines.push(`    $request = [System.Net.HttpWebRequest]::Create($Url)`);
  lines.push(`    $response = $request.GetResponse()`);
  lines.push(`    $totalLength = $response.ContentLength`);
  lines.push(`    $stream = $response.GetResponseStream()`);
  lines.push(`    $fileStream = [System.IO.File]::Create($OutputFile)`);
  lines.push(`    $buffer = New-Object byte[] 8192`);
  lines.push(`    $bytesRead = 0; $totalBytesRead = 0`);
  lines.push(`    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()`);
  lines.push(`    while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {`);
  lines.push(`        $fileStream.Write($buffer, 0, $bytesRead)`);
  lines.push(`        $totalBytesRead += $bytesRead`);
  lines.push(`        $percent = [math]::Round(($totalBytesRead / $totalLength) * 100, 1)`);
  lines.push(`        $speed = [math]::Round(($totalBytesRead / $stopwatch.Elapsed.TotalSeconds / 1MB), 2)`);
  lines.push(`        $downloaded = [math]::Round($totalBytesRead / 1MB, 2)`);
  lines.push(`        $total = [math]::Round($totalLength / 1MB, 2)`);
  lines.push(`        Write-Host "\\rDownloading: $percent% | Speed: ${speed} MB/s | Size: ${downloaded} MB / ${total} MB" -NoNewline -ForegroundColor Yellow`);
  lines.push(`    }`);
  lines.push(`    $fileStream.Close(); $stream.Close(); $response.Close(); $stopwatch.Stop()`);
  lines.push(`    Write-Host ""`);
  lines.push(`    Write-Host "Download completed." -ForegroundColor Green`);
  lines.push(`}`);
  lines.push(``);

  // 2. Загрузка сборок WinForms
  lines.push(`Add-Type -AssemblyName System.Windows.Forms`);
  lines.push(`Add-Type -AssemblyName System.Drawing`);
  lines.push(``);

  // 3. Создание формы
  lines.push(`$form = New-Object System.Windows.Forms.Form`);
  lines.push(`$form.Text = "Win Batch Installer"`);
  lines.push(`$form.Size = New-Object System.Drawing.Size(500, 600)`);
  lines.push(`$form.StartPosition = "CenterScreen"`);
  lines.push(`$form.FormBorderStyle = "FixedDialog"`);
  lines.push(`$form.MaximizeBox = $false`);
  lines.push(``);

  // 4. Элементы управления
  lines.push(`$label = New-Object System.Windows.Forms.Label`);
  lines.push(`$label.Text = "Select programs to install:"`);
  lines.push(`$label.Location = New-Object System.Drawing.Point(10, 10)`);
  lines.push(`$label.AutoSize = $true`);
  lines.push(`$form.Controls.Add($label)`);
  lines.push(``);

  lines.push(`$flowPanel = New-Object System.Windows.Forms.FlowLayoutPanel`);
  lines.push(`$flowPanel.Location = New-Object System.Drawing.Point(10, 40)`);
  lines.push(`$flowPanel.Size = New-Object System.Drawing.Size(460, 450)`);
  lines.push(`$flowPanel.AutoScroll = $true`);
  lines.push(`$form.Controls.Add($flowPanel)`);
  lines.push(``);

  lines.push(`$txtPath = New-Object System.Windows.Forms.TextBox`);
  lines.push(`$txtPath.Text = "C:\\Programs"`);
  lines.push(`$txtPath.Location = New-Object System.Drawing.Point(10, 500)`);
  lines.push(`$txtPath.Size = New-Object System.Drawing.Size(300, 30)`);
  lines.push(`$form.Controls.Add($txtPath)`);
  lines.push(``);

  lines.push(`$btnInstall = New-Object System.Windows.Forms.Button`);
  lines.push(`$btnInstall.Text = "Install Selected"`);
  lines.push(`$btnInstall.Location = New-Object System.Drawing.Point(320, 500)`);
  lines.push(`$btnInstall.Size = New-Object System.Drawing.Size(150, 30)`);
  lines.push(`$form.Controls.Add($btnInstall)`);
  lines.push(``);

  // 5. Загрузка программ из API
  lines.push(`try {`);
  lines.push(`    $programs = Invoke-RestMethod -Uri "${baseUrl}/api/programs" -UseBasicParsing`);
  lines.push(`    foreach ($p in $programs) {`);
  lines.push(`        $cb = New-Object System.Windows.Forms.CheckBox`);
  lines.push(`        $cb.Text = $p.name`);
  lines.push(`        $cb.Tag = $p`);
  lines.push(`        $cb.AutoSize = $true`);
  lines.push(`        $cb.Margin = New-Object System.Windows.Forms.Padding(5)`);
  lines.push(`        $flowPanel.Controls.Add($cb)`);
  lines.push(`    }`);
  lines.push(`} catch {`);
  lines.push(`    [System.Windows.Forms.MessageBox]::Show("Failed to load programs: $_", "Error")`);
  lines.push(`    exit`);
  lines.push(`}`);
  lines.push(``);

  // 6. Обработчик кнопки установки
  lines.push(`$btnInstall.Add_Click({`);
  lines.push(`    $selected = $flowPanel.Controls | Where-Object { $_ -is [System.Windows.Forms.CheckBox] -and $_.Checked }`);
  lines.push(`    if ($selected.Count -eq 0) {`);
  lines.push(`        [System.Windows.Forms.MessageBox]::Show("Please select at least one program.", "Warning")`);
  lines.push(`        return`);
  lines.push(`    }`);
  lines.push(`    `);
  lines.push(`    $installPath = $txtPath.Text`);
  lines.push(`    if (-not (Test-Path $installPath)) { New-Item -ItemType Directory -Path $installPath -Force | Out-Null }`);
  lines.push(`    `);
  lines.push(`    $form.Enabled = $false`);
  lines.push(`    $btnInstall.Text = "Installing..."`);
  lines.push(`    `);
  lines.push(`    foreach ($cb in $selected) {`);
  lines.push(`        $prog = $cb.Tag`);
  lines.push(`        $url = $prog.url`);
  lines.push(`        $ext = [System.IO.Path]::GetExtension($url).TrimStart('.')`);
  lines.push(`        $fileName = "$($prog.id)_installer.$ext"`);
  lines.push(`        $tempFile = "$env:TEMP\\$fileName"`);
  lines.push(`        `);
  lines.push(`        Write-Host "Installing: $($prog.name)" -ForegroundColor Cyan`);
  lines.push(`        try {`);
  lines.push(`            Download-WithProgress -Url $url -OutputFile $tempFile`);
  lines.push(`            $args = $prog.args -replace '\\{PATH\\}', $installPath`);
  lines.push(`            if ($ext -eq 'msi') {`);
  lines.push(`                Start-Process msiexec.exe -ArgumentList "/i \`"$tempFile\`" $args" -Wait -NoNewWindow`);
  lines.push(`            } else {`);
  lines.push(`                Start-Process -FilePath $tempFile -ArgumentList $args -Wait -NoNewWindow`);
  lines.push(`            }`);
  lines.push(`            Remove-Item $tempFile -Force -ErrorAction SilentlyContinue`);
  lines.push(`            Write-Host "[OK] $($prog.name) installed." -ForegroundColor Green`);
  lines.push(`        } catch {`);
  lines.push(`            Write-Host "[FAIL] $($prog.name): $_" -ForegroundColor Red`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push(`    `);
  lines.push(`    $btnInstall.Text = "Install Selected"`);
  lines.push(`    $form.Enabled = $true`);
  lines.push(`    [System.Windows.Forms.MessageBox]::Show("Installation complete!", "Done")`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`[void]$form.ShowDialog()`);

  const script = lines.join('\n');
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(script);
}
