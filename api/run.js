import { redis, ensureSeeded } from '../lib/db.js';

// Экранирование строки для безопасной подстановки в PowerShell
function escapePS(str) {
  return (str || '').replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
}

const WINDOWS_INVALID = /[<>"|?*\u0000-\u001f]/;

function firstParam(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function normalizeInstallPath(raw) {
  if (typeof raw !== 'string') return { error: 'Invalid installation path format.' };
  const trimmed = raw.trim().replace(/\//g, '\\');
  if (!trimmed) return { error: 'Invalid installation path format.' };
  
  const driveMatch = /^[A-Za-z]:/.exec(trimmed);
  let prefix = '';
  if (driveMatch) prefix = driveMatch[0];
  else return { error: 'Invalid installation path format. Use C:\\Apps or D:\\Programs.' };

  let rest = trimmed.slice(prefix.length);
  if (rest.startsWith('\\')) rest = rest.slice(1);
  if (WINDOWS_INVALID.test(rest) || rest.includes(':')) {
    return { error: 'Invalid installation path format.' };
  }

  const rawSegments = rest.split('\\');
  if (rawSegments[rawSegments.length - 1] === '') rawSegments.pop();

  for (const segment of rawSegments) {
    if (segment === '' || segment === '.' || segment === '..') return { error: 'Relative path segments are not allowed.' };
  }

  const normalized = prefix + '\\' + rawSegments.join('\\');
  return { path: normalized };
}

export default async function handler(req, res) {
  await ensureSeeded();

  const ids = firstParam(req.query.ids);
  const rawPath = firstParam(req.query.path);

  // --- ЛОГИКА 1: Открытие веб-интерфейса (если нет параметров) ---
  if (!ids || !rawPath) {
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'https://win-batch-installer.vercel.app';
      
    const script = `
Write-Host "Opening program selection interface..." -ForegroundColor Cyan
Start-Process "${baseUrl}"
Write-Host "Please select programs in the opened browser window." -ForegroundColor Green
`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(script);
  }

  // --- ЛОГИКА 2: Генерация скрипта установки с прогресс-баром ---
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const normalized = normalizeInstallPath(rawPath);
  if (normalized.error) {
    return res.status(400).send(`Write-Host "[ERROR] ${normalized.error}" -ForegroundColor Red`);
  }
  const safePath = normalized.path;
  const escapedPath = escapePS(safePath);

  const idList = String(ids).split(',').map((s) => s.trim()).filter(Boolean);
  const programs = [];
  for (const id of idList) {
    const p = await redis.hgetall(`program:${id}`);
    if (p && p.url) programs.push(p);
  }

  if (programs.length === 0) {
    return res.send('Write-Host "[ERROR] No valid programs found." -ForegroundColor Red');
  }

  // Функция скачивания с прогресс-баром и скоростью
  let script = `# Win Batch Installer Script v1.3.0\n`;
  script += `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12\n`;
  script += `$ErrorActionPreference = "Stop"\n`;
  script += `$InstallRoot = "${escapedPath}"\n\n`;
  
  script += `function Download-WithProgress {\n`;
  script += `    param ([string]$Url, [string]$OutputFile)\n`;
  script += `    $request = [System.Net.HttpWebRequest]::Create($Url)\n`;
  script += `    $response = $request.GetResponse()\n`;
  script += `    $totalLength = $response.ContentLength\n`;
  script += `    $stream = $response.GetResponseStream()\n`;
  script += `    $fileStream = [System.IO.File]::Create($OutputFile)\n`;
  script += `    $buffer = New-Object byte[] 8192\n`;
  script += `    $bytesRead = 0; $totalBytesRead = 0\n`;
  script += `    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()\n\n`;
  script += `    while (($bytesRead = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {\n`;
  script += `        $fileStream.Write($buffer, 0, $bytesRead)\n`;
  script += `        $totalBytesRead += $bytesRead\n`;
  script += `        $percent = [math]::Round(($totalBytesRead / $totalLength) * 100, 1)\n`;
  script += `        $speed = [math]::Round(($totalBytesRead / $stopwatch.Elapsed.TotalSeconds / 1MB), 2)\n`;
  script += `        $downloaded = [math]::Round($totalBytesRead / 1MB, 2)\n`;
  script += `        $total = [math]::Round($totalLength / 1MB, 2)\n`;
  script += `        Write-Host "\\rDownloading: $percent% | Speed: ${speed} MB/s | Size: ${downloaded} MB / ${total} MB" -NoNewline -ForegroundColor Yellow\n`;
  script += `    }\n\n`;
  script += `    $fileStream.Close(); $stream.Close(); $response.Close(); $stopwatch.Stop()\n`;
  script += `    Write-Host ""\n`;
  script += `    Write-Host "Download completed successfully." -ForegroundColor Green\n`;
  script += `}\n\n`;

  script += `if (-not (Test-Path $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }\n\n`;

  for (const p of programs) {
    const url = p.url.split('?')[0].split('#')[0];
    const ext = url.split('.').pop().toLowerCase();
    const safeId = String(p.id || 'program').replace(/[^A-Za-z0-9._-]/g, '_');
    const fileName = `${safeId}_installer.${ext === 'msi' ? 'msi' : 'exe'}`;
    const tempFile = `$env:TEMP\\${fileName}`;

    const safeName = escapePS(p.name);
    const safeUrl = escapePS(p.url);
    const installArgs = escapePS(p.args || '').replace(/\{PATH\}/g, '$InstallRoot');

    script += `Write-Host "\\nInstalling: ${safeName}" -ForegroundColor Cyan\n`;
    script += `try {\n`;
    script += `    Download-WithProgress -Url "${safeUrl}" -OutputFile "${tempFile}"\n`;
    script += `    Write-Host "Running installer..." -ForegroundColor Yellow\n`;

    if (ext === 'msi') {
      script += `    $proc = Start-Process msiexec.exe -ArgumentList "/i \`${tempFile}\`" ${installArgs}" -Wait -PassThru -NoNewWindow\n`;
    } else {
      script += `    $proc = Start-Process -FilePath "${tempFile}" -ArgumentList "${installArgs}" -Wait -PassThru -NoNewWindow\n`;
    }

    script += `    Remove-Item "${tempFile}" -Force -ErrorAction SilentlyContinue\n`;
    script += `    if ($proc.ExitCode -eq 0) {\n`;
    script += `        Write-Host "[OK] ${safeName} installed successfully." -ForegroundColor Green\n`;
    script += `    } else {\n`;
    script += `        Write-Host "[FAIL] ${safeName} exited with code $($proc.ExitCode)" -ForegroundColor Red\n`;
    script += `    }\n`;
    script += `} catch {\n`;
    script += `    Write-Host "[FAIL] ${safeName}: $_" -ForegroundColor Red\n`;
    script += `}\n\n`;
  }

  script += `Write-Host "\\nAll tasks completed." -ForegroundColor Green\n`;
  script += `if ([Environment]::UserInteractive) { Read-Host "Press Enter to exit" }\n`;

  return res.status(200).send(script);
}
