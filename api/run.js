import { redis, ensureSeeded } from '../lib/db.js';

// Безопасное экранирование строки для PowerShell
function escapePS(str) {
  if (!str) return '';
  // Порядок важен: сначала бэктик, потом кавычки, потом доллар
  return String(str)
    .replace(/`/g, '``')
    .replace(/"/g, '`"')
    .replace(/\$/g, '`$');
}

// Упрощённая валидация пути
function validatePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return { error: 'Invalid installation path format.' };
  }
  
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > 200) {
    return { error: 'Invalid installation path format.' };
  }
  
  // Разрешаем только буквы диска или UNC-пути
  const validPattern = /^[A-Za-z]:\\|^\\\\[a-zA-Z0-9]/;
  if (!validPattern.test(trimmed)) {
    return { error: 'Invalid installation path format. Use C:\\Apps or \\\\server\\share.' };
  }
  
  // Проверяем недопустимые символы
  const invalidChars = /[<>:"|?*]/;
  if (invalidChars.test(trimmed)) {
    return { error: 'Invalid installation path format.' };
  }
  
  return { path: trimmed };
}

// Получение первого значения параметра (Vercel может вернуть массив)
function getFirstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  try {
    // Гарантируем наличие дефолтных программ
    await ensureSeeded();

    const idsParam = getFirstParam(req.query.ids);
    const pathParam = getFirstParam(req.query.path);

    // Заголовки ответа
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    // Валидация параметров
    if (!idsParam || !pathParam) {
      return res.status(400).send(
        'Write-Host "[ERROR] Missing parameters. Use: ?ids=app1,app2&path=C:\\Apps" -ForegroundColor Red'
      );
    }

    // Валидация пути установки
    const pathValidation = validatePath(pathParam);
    if (pathValidation.error) {
      return res.status(400).send(
        `Write-Host "[ERROR] ${pathValidation.error}" -ForegroundColor Red`
      );
    }
    
    const installPath = pathValidation.path;
    const escapedInstallPath = escapePS(installPath);

    // Получаем список ID программ
    const idList = String(idsParam)
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    if (idList.length === 0) {
      return res.status(400).send(
        'Write-Host "[ERROR] No program IDs provided." -ForegroundColor Red'
      );
    }

    // Загружаем программы из Redis
    const programs = [];
    for (const id of idList) {
      try {
        const program = await redis.hgetall(`program:${id}`);
        if (program && program.url && program.name) {
          programs.push({
            id: id,
            name: program.name,
            url: program.url,
            args: program.args || ''
          });
        }
      } catch (err) {
        console.error(`Error loading program ${id}:`, err);
      }
    }

    if (programs.length === 0) {
      return res.send(
        'Write-Host "[ERROR] No valid programs found for provided IDs." -ForegroundColor Red'
      );
    }

    // Генерация PowerShell скрипта через массив строк
    const lines = [];
    
    // Заголовок скрипта
    lines.push('# Win Batch Installer Script v1.2.0');
    lines.push('[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12');
    lines.push('$ErrorActionPreference = "Stop"');
    lines.push('');
    
    // Установка корневой папки
    lines.push(`$InstallRoot = "${escapedInstallPath}"`);
    lines.push('if (-not (Test-Path $InstallRoot)) {');
    lines.push('    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null');
    lines.push('}');
    lines.push('');

    // Генерация кода для каждой программы
    for (const program of programs) {
      const safeName = escapePS(program.name);
      const safeUrl = escapePS(program.url);
      
      // Определяем расширение файла
      const urlWithoutQuery = program.url.split('?')[0].split('#')[0];
      const ext = urlWithoutQuery.split('.').pop().toLowerCase();
      const isMSI = ext === 'msi';
      const fileExt = isMSI ? 'msi' : 'exe';
      
      // Безопасное имя файла (только alphanumeric + _ + -)
      const safeId = String(program.id).replace(/[^A-Za-z0-9._-]/g, '_');
      const fileName = `${safeId}_installer.${fileExt}`;
      
      // Путь к временному файлу
      const tempFilePath = `$env:TEMP\\${fileName}`;
      
      // Аргументы установки
      let installArgs = '';
      if (isMSI) {
        const baseArgs = program.args || '/qn /norestart';
        installArgs = baseArgs.replace(/\{PATH\}/g, '$InstallRoot');
      } else {
        const baseArgs = program.args || '/SILENT';
        installArgs = baseArgs.replace(/\{PATH\}/g, '$InstallRoot');
      }
      const escapedArgs = escapePS(installArgs);

      // Код установки программы
      lines.push(`Write-Host "Downloading ${safeName}..." -ForegroundColor Cyan`);
      lines.push('try {');
      lines.push(`    Invoke-WebRequest -Uri "${safeUrl}" -OutFile "${tempFilePath}" -UseBasicParsing`);
      lines.push(`    Write-Host "Installing ${safeName}..." -ForegroundColor Yellow`);
      
      if (isMSI) {
        lines.push(`    $proc = Start-Process msiexec.exe -ArgumentList "/i \"${tempFilePath}\" ${escapedArgs}" -Wait -PassThru -NoNewWindow`);
      } else {
        lines.push(`    $proc = Start-Process -FilePath "${tempFilePath}" -ArgumentList "${escapedArgs}" -Wait -PassThru -NoNewWindow`);
      }
      
      lines.push(`    Remove-Item "${tempFilePath}" -Force -ErrorAction SilentlyContinue`);
      lines.push('    if ($proc.ExitCode -eq 0) {');
      lines.push(`        Write-Host "[OK] ${safeName} installed successfully!" -ForegroundColor Green`);
      lines.push('    } else {');
      lines.push(`        Write-Host "[FAIL] ${safeName} exited with code $($proc.ExitCode)" -ForegroundColor Red`);
      lines.push('    }');
      lines.push('} catch {');
      lines.push(`    Write-Host "[FAIL] ${safeName}: $_" -ForegroundColor Red`);
      lines.push('}');
      lines.push('');
    }

    // Завершение скрипта
    lines.push('Write-Host "`nAll tasks completed!" -ForegroundColor Green');
    lines.push('if ([Environment]::UserInteractive) { Read-Host "Press Enter to exit" }');

    // Объединяем все строки с переносами
    const script = lines.join('\n');
    
    return res.status(200).send(script);

  } catch (error) {
    console.error('Critical error in /api/run:', error);
    return res.status(500).send(
      'Write-Host "[ERROR] Server error occurred. Please try again later." -ForegroundColor Red'
    );
  }
}
