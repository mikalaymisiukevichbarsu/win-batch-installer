import { redis, ensureSeeded } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    // Убеждаемся, что база засеяна дефолтными программами
    await ensureSeeded();

    // Получаем базовый URL текущего домена, чтобы GUI мог сам запросить список программ
    const host = req.headers.host || 'win-batch-installer.vercel.app';
    const protocol = 'https';
    const baseUrl = `${protocol}://${host}`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    // Генерируем PowerShell скрипт с GUI
    const script = `
# Win Batch Installer GUI Launcher v1.3.0
# Загрузка необходимых сборок .NET для WinForms
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Базовый URL API
\$BaseUrl = "${baseUrl}"

# Функция для скачивания файла с прогресс-баром
function Download-WithProgress {
    param (
        [string]\$Url,
        [string]\$OutFile
    )
    
    \$webClient = New-Object System.Net.WebClient
    \$webClient.Headers.Add("User-Agent", "PowerShell Script")
    
    # Обработчик события изменения прогресса
    \$Event = Register-ObjectEvent -InputObject \$webClient -EventName DownloadProgressChanged -Action {
        \$Global:DownloadProgress = \$EventArgs.ProgressPercentage
        \$Global:DownloadSpeed = [math]::Round((\$EventArgs.BytesReceived / 1MB), 2)
    }
    
    try {
        \$webClient.DownloadFileAsync(\$Url, \$OutFile)
        
        # Ждем завершения загрузки, обновляя UI
        while (\$webClient.IsBusy) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 100
        }
        
        Unregister-Event -SourceIdentifier \$Event.Name
        return \$true
    }
    catch {
        Unregister-Event -SourceIdentifier \$Event.Name
        throw \$_
    }
}

# Основная функция создания окна
function Show-InstallerGui {
    # Создаем главное окно
    \$form = New-Object System.Windows.Forms.Form
    \$form.Text = "Win Batch Installer"
    \$form.Size = New-Object System.Drawing.Size(600, 500)
    \$form.StartPosition = "CenterScreen"
    \$form.FormBorderStyle = "FixedDialog"
    \$form.MaximizeBox = \$false
    
    # Заголовок
    \$labelTitle = New-Object System.Windows.Forms.Label
    \$labelTitle.Location = New-Object System.Drawing.Point(20, 20)
    \$labelTitle.Size = New-Object System.Drawing.Size(560, 30)
    \$labelTitle.Font = New-Object System.Drawing.Font("Arial", 12, [System.Drawing.FontStyle]::Bold)
    \$labelTitle.Text = "Выберите программы для установки:"
    \$form.Controls.Add(\$labelTitle)
    
    # Panel для списка программ (с прокруткой)
    \$panelPrograms = New-Object System.Windows.Forms.Panel
    \$panelPrograms.Location = New-Object System.Drawing.Point(20, 60)
    \$panelPrograms.Size = New-Object System.Drawing.Size(540, 300)
    \$panelPrograms.AutoScroll = \$true
    \$panelPrograms.BorderStyle = "FixedSingle"
    \$form.Controls.Add(\$panelPrograms)
    
    # Поле выбора пути
    \$labelPath = New-Object System.Windows.Forms.Label
    \$labelPath.Location = New-Object System.Drawing.Point(20, 370)
    \$labelPath.Size = New-Object System.Drawing.Size(100, 20)
    \$labelPath.Text = "Папка установки:"
    \$form.Controls.Add(\$labelPath)
    
    \$textBoxPath = New-Object System.Windows.Forms.TextBox
    \$textBoxPath.Location = New-Object System.Drawing.Point(120, 370)
    \$textBoxPath.Size = New-Object System.Drawing.Size(350, 20)
    \$textBoxPath.Text = "C:\\\\Programs"
    \$form.Controls.Add(\$textBoxPath)
    
    \$btnBrowse = New-Object System.Windows.Forms.Button
    \$btnBrowse.Location = New-Object System.Drawing.Point(480, 368)
    \$btnBrowse.Size = New-Object System.Drawing.Size(80, 25)
    \$btnBrowse.Text = "Browse..."
    \$btnBrowse.Add_Click({
        \$folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
        if (\$folderBrowser.ShowDialog() -eq "OK") {
            \$textBoxPath.Text = \$folderBrowser.SelectedPath
        }
    })
    \$form.Controls.Add(\$btnBrowse)
    
    # Кнопка установки
    \$btnInstall = New-Object System.Windows.Forms.Button
    \$btnInstall.Location = New-Object System.Drawing.Point(20, 420)
    \$btnInstall.Size = New-Object System.Drawing.Size(540, 40)
    \$btnInstall.Text = "Установить выбранное"
    \$btnInstall.Font = New-Object System.Drawing.Font("Arial", 10, [System.Drawing.FontStyle]::Bold)
    \$btnInstall.BackColor = [System.Drawing.Color]::LightGreen
    \$form.Controls.Add(\$btnInstall)
    
    # Статус бар
    \$statusLabel = New-Object System.Windows.Forms.Label
    \$statusLabel.Location = New-Object System.Drawing.Point(20, 470)
    \$statusLabel.Size = New-Object System.Drawing.Size(540, 20)
    \$statusLabel.Text = "Готов к работе"
    \$form.Controls.Add(\$statusLabel)
    
    # Загрузка списка программ из API
    \$statusLabel.Text = "Загрузка списка программ..."
    [System.Windows.Forms.Application]::DoEvents()
    
    try {
        \$response = Invoke-RestMethod -Uri "\$BaseUrl/api/programs" -Method Get
        \$programs = \$response
    }
    catch {
        \$statusLabel.Text = "Ошибка загрузки списка программ!"
        \$statusLabel.ForeColor = [System.Drawing.Color]::Red
        return
    }
    
    # Создаем чекбоксы для каждой программы
    \$checkboxes = @{}
    \$yOffset = 10
    
    foreach (\$prog in \$programs) {
        \$cb = New-Object System.Windows.Forms.CheckBox
        \$cb.Location = New-Object System.Drawing.Point(10, \$yOffset)
        \$cb.Size = New-Object System.Drawing.Size(500, 30)
        \$cb.Text = "\$(\$prog.name) (\$(\$prog.id))"
        \$cb.Tag = \$prog # Сохраняем объект программы в Tag
        \$panelPrograms.Controls.Add(\$cb)
        \$checkboxes[\$prog.id] = \$cb
        \$yOffset += 35
    }
    
    # Логика кнопки установки
    \$btnInstall.Add_Click({
        \$installPath = \$textBoxPath.Text
        if (-not (Test-Path \$installPath)) {
            try {
                New-Item -ItemType Directory -Path \$installPath -Force | Out-Null
            }
            catch {
                [System.Windows.Forms.MessageBox]::Show("Не удалось создать папку: \$installPath", "Ошибка", "OK", "Error")
                return
            }
        }
        
        # Собираем выбранные программы
        \$selected = @()
        foreach (\$id in \$checkboxes.Keys) {
            if (\$checkboxes[\$id].Checked) {
                \$selected += \$checkboxes[\$id].Tag
            }
        }
        
        if (\$selected.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show("Выберите хотя бы одну программу!", "Внимание", "OK", "Warning")
            return
        }
        
        \$btnInstall.Enabled = \$false
        \$statusLabel.Text = "Начинаю установку..."
        
        # Запускаем установку в отдельном потоке или последовательно
        foreach (\$prog in \$selected) {
            \$statusLabel.Text = "Скачивание: \$(\$prog.name)..."
            [System.Windows.Forms.Application]::DoEvents()
            
            \$url = \$prog.url
            \$fileName = Split-Path \$url -Leaf
            if (-not \$fileName) { \$fileName = "installer.exe" }
            \$tempFile = Join-Path \$env:TEMP \$fileName
            
            try {
                # Скачивание
                Download-WithProgress -Url \$url -OutFile \$tempFile
                
                \$statusLabel.Text = "Установка: \$(\$prog.name)..."
                [System.Windows.Forms.Application]::DoEvents()
                
                # Определение типа установщика
                \$ext = [System.IO.Path]::GetExtension(\$url).ToLower()
                \$args = ""
                
                if (\$prog.args) {
                    \$args = \$prog.args -replace '\{PATH\}', \$installPath
                } else {
                    if (\$ext -eq ".msi") { \$args = "/qn /norestart" }
                    else { \$args = "/SILENT" }
                }
                
                # Запуск установщика
                \$proc = Start-Process -FilePath \$tempFile -ArgumentList \$args -Wait -PassThru -NoNewWindow
                
                if (\$proc.ExitCode -eq 0) {
                    \$statusLabel.Text = "[OK] \$(\$prog.name) установлена."
                } else {
                    \$statusLabel.Text = "[FAIL] \$(\$prog.name) код ошибки: \$(\$proc.ExitCode)"
                    [System.Windows.Forms.MessageBox]::Show("Ошибка установки \$(\$prog.name)", "Ошибка", "OK", "Error")
                }
                
                # Очистка
                Remove-Item \$tempFile -Force -ErrorAction SilentlyContinue
                
            }
            catch {
                \$statusLabel.Text = "[ERROR] \$(\$prog.name): \$_"
                [System.Windows.Forms.MessageBox]::Show("Ошибка: \$_", "Ошибка", "OK", "Error")
            }
        }
        
        \$statusLabel.Text = "Все задачи завершены!"
        \$btnInstall.Enabled = \$true
        [System.Windows.Forms.MessageBox]::Show("Установка завершена!", "Готово", "OK", "Information")
    })
    
    # Показываем форму
    \$form.ShowDialog()
}

# Запуск GUI
Show-InstallerGui
`;

    return res.status(200).send(script);

  } catch (error) {
    console.error('Critical error in /api/run:', error);
    return res.status(500).send(
      'Write-Host "[ERROR] Server error occurred. Please try again later." -ForegroundColor Red'
    );
  }
}
