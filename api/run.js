import { redis, ensureSeeded } from '../lib/db.js';

// Экранирование строки для безопасной подстановки в PowerShell-строку
// с двойными кавычками. Порядок важен: сначала удваиваем бэктик, иначе
// мы экранируем те бэктики, которые сами же и добавили.
function escapePS(str) {
  return (str || '').replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
}

// Символы, недопустимые в пути Windows. Двоеточие проверяется отдельно: оно
// разрешено только в префиксе диска ("D:\"). Скобки, & и ; в именах папок
// допустимы ("C:\Program Files (x86)", "Tools & Utils") и безопасны внутри
// строки PowerShell с двойными кавычками.
const WINDOWS_INVALID = /[<>"|?*\u0000-\u001f]/;

// Vercel отдаёт массив, если query-параметр повторён (?ids=a&ids=b).
function firstParam(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

// Возвращает { path } при успехе либо { error } с текстом для пользователя.
export function normalizeInstallPath(raw) {
  if (typeof raw !== 'string') return { error: 'Invalid installation path format.' };

  const trimmed = raw.trim().replace(/\//g, '\\');
  if (!trimmed) return { error: 'Invalid installation path format.' };
  if (trimmed.length > 200) return { error: 'Installation path is too long.' };

  const driveMatch = /^[A-Za-z]:\\/.exec(trimmed);
  const uncMatch = /^\\\\[^\\]+\\[^\\]+/.exec(trimmed);

  let prefix;
  if (driveMatch) prefix = driveMatch[0];
  else if (uncMatch) prefix = uncMatch[0];
  else return { error: 'Invalid installation path format. Use C:\\Apps or \\\\server\\share.' };

  // Проверяем остаток пути без префикса: двоеточие в нём уже недопустимо.
  // У UNC-префикса ("\\server\share") нет завершающего слэша, поэтому один
  // ведущий слэш остатка отбрасываем — иначе получится пустой сегмент.
  let rest = trimmed.slice(prefix.length);
  if (rest.startsWith('\\')) rest = rest.slice(1);
  if (WINDOWS_INVALID.test(rest) || rest.includes(':')) {
    return { error: 'Invalid installation path format.' };
  }

  const rawSegments = rest.split('\\');
  // Разрешаем один завершающий обратный слэш: он отбрасывается.
  if (rawSegments[rawSegments.length - 1] === '') rawSegments.pop();

  for (const segment of rawSegments) {
    if (segment === '') return { error: 'Invalid installation path format.' };
    if (segment === '.' || segment === '..') return { error: 'Relative path segments are not allowed.' };
    if (/[. ]$/.test(segment)) return { error: 'Path segments cannot end with a dot or space.' };
  }

  const normalized = rawSegments.length
    ? prefix + (prefix.endsWith('\\') ? '' : '\\') + rawSegments.join('\\')
    : prefix;
  return { path: normalized };
}

export default async function handler(req, res) {
  // Гарантируем наличие данных даже при прямом обращении к /run на холодном Redis
  await ensureSeeded();

  const ids = firstParam(req.query.ids);
  const rawPath = firstParam(req.query.path);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (!ids || !rawPath) {
    return res.status(400).send('Write-Host "[ERROR] Missing parameters. Use: ?ids=app1,app2&path=C:\\Apps" -ForegroundColor Red');
  }

  const normalized = normalizeInstallPath(rawPath);
  if (normalized.error) {
    return res.status(400).send(`Write-Host "[ERROR] ${normalized.error}" -ForegroundColor Red`);
  }
  const safePath = normalized.path;

  const idList = String(ids).split(',').map((s) => s.trim()).filter(Boolean);

  const programs = [];
  for (const id of idList) {
    const p = await redis.hgetall(`program:${id}`);
    if (p && p.url) programs.push(p);
  }

  if (programs.length === 0) {
    return res.send('Write-Host "[ERROR] No valid programs found for provided IDs." -ForegroundColor Red');
  }

  // Путь попадает внутрь строки PowerShell с двойными кавычками, поэтому
  // экранируем его: ` -> ``, " -> `", $ -> `$
  const escapedPath = escapePS(safePath);

  let script = `# Win Batch Installer Script v1.2.0\n`;
  script += `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12\n`;
  script += `$ErrorActionPreference = "Stop"\n`;
  script += `$InstallRoot = "${escapedPath}"\n\n`;
  script += `if (-not (Test-Path $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }\n\n`;

  for (const p of programs) {
    const url = p.url.split('?')[0].split('#')[0];
    const ext = url.split('.').pop().toLowerCase();
    // id приходит из ключа Redis, поэтому имя временного файла санитизируем
    // отдельно: кавычка в id сломала бы синтаксис всего скрипта.
    const safeId = String(p.id || 'program').replace(/[^A-Za-z0-9._-]/g, '_');
    const fileName = `${safeId}_installer.${ext === 'msi' ? 'msi' : 'exe'}`;
    const tempFile = `$env:TEMP\\${fileName}`;

    const safeName = escapePS(p.name);
    const safeUrl = escapePS(p.url);
    // Сначала экранируем аргументы как литерал, затем подставляем переменную
    // $InstallRoot, чтобы она осталась именно переменной, а не текстом.
    const installArgs = escapePS(p.args || '').replace(/\{PATH\}/g, '$InstallRoot');

    script += `Write-Host "Downloading ${safeName}..." -ForegroundColor Cyan\n`;
    script += `try {\n`;
    script += `    Invoke-WebRequest -Uri "${safeUrl}" -OutFile "${tempFile}" -UseBasicParsing\n`;
    script += `    Write-Host "Installing ${safeName}..." -ForegroundColor Yellow\n`;

    if (ext === 'msi') {
      // В PowerShell экранирование кавычки — это бэктик, а не обратный слэш.
      script += `    $proc = Start-Process msiexec.exe -ArgumentList "/i \`"${tempFile}\`" ${installArgs}" -Wait -PassThru -NoNewWindow\n`;
    } else {
      script += `    $proc = Start-Process -FilePath "${tempFile}" -ArgumentList "${installArgs}" -Wait -PassThru -NoNewWindow\n`;
    }

    script += `    Remove-Item "${tempFile}" -Force -ErrorAction SilentlyContinue\n`;
    script += `    if ($proc.ExitCode -eq 0) {\n`;
    script += `        Write-Host "[OK] ${safeName} installed successfully!" -ForegroundColor Green\n`;
    script += `    } else {\n`;
    script += `        Write-Host "[FAIL] ${safeName} exited with code $($proc.ExitCode)" -ForegroundColor Red\n`;
    script += `    }\n`;
    script += `} catch {\n`;
    script += `    Write-Host "[FAIL] ${safeName}: $_" -ForegroundColor Red\n`;
    script += `}\n\n`;
  }

  // `n — это перевод строки в PowerShell; "\n" выводился бы буквально.
  script += `Write-Host "\`nAll tasks completed!" -ForegroundColor Green\n`;
  // Пауза только при интерактивном запуске (не блокирует CI/автоматизацию)
  script += `if ([Environment]::UserInteractive) { Read-Host "Press Enter to exit" }\n`;

  return res.status(200).send(script);
}
