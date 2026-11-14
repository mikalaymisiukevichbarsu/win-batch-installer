import { ensureSeeded } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    try {
      if (typeof ensureSeeded === 'function') {
        await ensureSeeded();
      }
    } catch (dbError) {
      console.error('Database seed warning:', dbError);
    }

    const host = req.headers.host || 'win-batch-installer.vercel.app';
    const baseUrl = `https://${host}`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    const xaml = `
<Window xmlns="http://microsoft.com"
        xmlns:x="http://microsoft.com"
        Title="Win Batch Installer" Height="650" Width="600"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#1e1e1e" Foreground="White" FontFamily="Segoe UI">
    
    <Window.Resources>
        <Style TargetType="CheckBox">
            <Setter Property="Foreground" Value="#e0e0e0"/>
            <Setter Property="FontSize" Value="14"/>
            <Setter Property="Margin" Value="0,5,0,5"/>
            <Setter Property="Cursor" Value="Hand"/>
        </Style>
        <Style TargetType="Button" x:Key="PrimaryButton">
            <Setter Property="Background" Value="#0078d4"/>
            <Setter Property="Foreground" Value="White"/>
            <Setter Property="FontSize" Value="14"/>
            <Setter Property="FontWeight" Value="Bold"/>
            <Setter Property="Height" Value="40"/>
            <Setter Property="Cursor" Value="Hand"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="{TemplateBinding Background}" CornerRadius="4">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
            <Style.Triggers>
                <Trigger Property="IsMouseOver" Value="True">
                    <Setter Property="Background" Value="#1084d8"/>
                </Trigger>
            </Style.Triggers>
        </Style>
    </Window.Resources>

    <Grid Margin="20">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <TextBlock Grid.Row="0" Text="Выберите программы" FontSize="20" FontWeight="Bold" Margin="0,0,0,20"/>

        <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,0,0,20">
            <StackPanel Name="ProgramsStack" />
        </ScrollViewer>

        <Grid Grid.Row="2" Margin="0,0,0,15">
            <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>
            <TextBlock Text="Папка:" VerticalAlignment="Center" Margin="0,0,10,0" Foreground="#aaaaaa"/>
            <TextBox Name="PathBox" Grid.Column="1" Text="C:\\Programs" Background="#2d2d2d" Foreground="White" BorderBrush="#444" Padding="5"/>
            <Button x:Name="BrowseBtn" Grid.Column="2" Content="..." Width="30" Margin="10,0,0,0" Background="#333" Foreground="White" Cursor="Hand"/>
        </Grid>

        <ProgressBar Name="ProgressBar" Grid.Row="3" Height="20" Minimum="0" Maximum="100" Margin="0,0,0,10" Visibility="Collapsed"/>
        
        <ScrollViewer Name="LogScroll" Grid.Row="4" Height="120" VerticalScrollBarVisibility="Auto" Margin="0,0,0,10">
            <TextBlock Name="LogText" Text="" Foreground="#888" FontSize="11" TextWrapping="Wrap"/>
        </ScrollViewer>

        <Button Name="InstallBtn" Grid.Row="5" Style="{StaticResource PrimaryButton}" Content="Установить выбранное" Margin="0,0,0,15"/>
        <TextBlock Name="StatusText" Grid.Row="6" Text="Готов к работе" Foreground="#888" FontSize="12"/>
    </Grid>
</Window>
`;

    const script = `
# Win Batch Installer WPF GUI v1.7.3
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Windows.Forms

\$BaseUrl = "${baseUrl}"

[xml]\$xaml = @"
${xaml}
"@

\$reader = (New-Object System.Xml.XmlNodeReader \$xaml)
\$window = [Windows.Markup.XamlReader]::Load(\$reader)

\$programsStack = \$window.FindName("ProgramsStack")
\$pathBox = \$window.FindName("PathBox")
\$installBtn = \$window.FindName("InstallBtn")
\$browseBtn = \$window.FindName("BrowseBtn")
\$statusText = \$window.FindName("StatusText")
\$progressBar = \$window.FindName("ProgressBar")
\$logText = \$window.FindName("LogText")
\$logScroll = \$window.FindName("LogScroll")

\$Global:ProgramsList = @()

function Add-Log {
    param ([string]\$Message)
    \$logText.Text += "\$Message\`n"
    \$logScroll.ScrollToEnd()
    [System.Windows.Forms.Application]::DoEvents()
}

function Download-WithProgress {
    param ([string]\$Url, [string]\$OutFile)
    \$wc = New-Object System.Net.WebClient
    \$wc.Headers.Add("User-Agent", "Mozilla/5.0")
    
    \$eventJob = Register-ObjectEvent -InputObject \$wc -EventName DownloadProgressChanged -Action {
        \$Global:DownloadProgress = \$EventArgs.ProgressPercentage
    }
    
    \$Global:DownloadProgress = 0
    \$task = \$wc.DownloadFileTaskAsync(\$Url, \$OutFile)
    
    while (-not \$task.IsCompleted) {
        \$progressBar.Value = \$Global:DownloadProgress
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 50
    }
    
    Unregister-Event -SourceIdentifier \$eventJob.Name -ErrorAction SilentlyContinue
    \$wc.Dispose()
    
    if (\$task.IsFaulted) {
        throw \$task.Exception.InnerException
    }
}

\$statusText.Text = "Подключение к серверу..."
try {
    \$response = Invoke-RestMethod -Uri "\$BaseUrl/api/programs" -Method Get
    \$Global:ProgramsList = \$response
    
    foreach (\$prog in \$Global:ProgramsList) {
        \$cb = New-Object System.Windows.Controls.CheckBox
        \$cb.Content = \$prog.name
        \$cb.Tag = \$prog
        \$programsStack.Children.Add(\$cb) | Out-Null
    }
    \$statusText.Text = "Список программ загружен."
} catch {
    \$statusText.Text = "Ошибка подключения к API!"
    \$statusText.Foreground = "#ff5555"
    Add-Log "[ERROR] Не удалось получить список: \$_"
}

\$browseBtn.Add_Click({
    \$folderBrowser = New-Object System.Windows.Forms.FolderBrowserDialog
    \$folderBrowser.Description = "Выберите папку для установки"
    if (\$folderBrowser.ShowDialog() -eq "OK") {
        \$pathBox.Text = \$folderBrowser.SelectedPath
    }
})

\$installBtn.Add_Click({
    \$selected = @(\$programsStack.Children | Where-Object { \$_ -is [System.Windows.Controls.CheckBox] -and \$_.IsChecked })
    
    if (\$selected.Count -eq 0) {
        [System.Windows.MessageBox]::Show("Выберите хотя бы одну программу!", "Внимание", "OK", "Warning") | Out-Null
        return
    }

    \$installPath = \$pathBox.Text.Trim()
    if (-not \$installPath) { \$installPath = "C:\\Programs" }

    \$confirmMsg = "Вы собираетесь установить:\`n\`n"
    foreach (\$item in \$selected) {
        \$confirmMsg += "• \$(\$item.Tag.name)\`n"
    }
    \$confirmMsg += "\`nЦелевая папка: \$installPath\`n\`nПродолжить?"

    \$result = [System.Windows.MessageBox]::Show(\$confirmMsg, "Подтверждение установки", "YesNo", "Question")
    if (\$result -ne "Yes") {
        Add-Log "Установка отменена пользователем."
        return
    }

    Add-Log "Начало установки..."
    Add-Log "Целевая папка: \$installPath"
    
    if (-not (Test-Path \$installPath)) {
        try {
            New-Item -ItemType Directory -Path \$installPath -Force | Out-Null
            Add-Log "Папка создана."
        } catch {
            Add-Log "[ERROR] Не удалось создать папку: \$_"
            return
        }
    }

    \$installBtn.IsEnabled = \$false
    \$progressBar.Visibility = "Visible"
    \$logText.Text = ""

    foreach (\$item in \$selected) {
        \$prog = \$item.Tag
        \$statusText.Text = "Обработка: \$(\$prog.name)..."
        \$progressBar.Value = 0
        
        \$fileName = Split-Path \$prog.url -Leaf
        if (-not \$fileName -or \$fileName -notmatch '\\.') { \$fileName = "installer_\$(Get-Random).exe" }
        \$tempFile = Join-Path \$env:TEMP \$fileName
        
        Add-Log ">> Скачивание \$(\$prog.name)..."
        Add-Log "   Временный файл: \$tempFile"

        try {
            Download-WithProgress -Url \$prog.url -OutFile \$tempFile
            
            \$statusText.Text = "Установка: \$(\$prog.name)..."
            \$progressBar.IsIndeterminate = \$true
            Add-Log "   Запуск установщика..."
            
            \$rawArgs = if (\$prog.args) { \$prog.args -replace '\\{PATH\\}', \$installPath } else { "/SILENT" }
            \$cmdLine = 'start /wait "" "' + \$tempFile + '" ' + \$rawArgs
            
            \$proc = Start-Process cmd -ArgumentList "/c \$cmdLine" -Wait -PassThru -NoNewWindow
            
            Remove-Item \$tempFile -Force -ErrorAction SilentlyContinue
            
            \$progressBar.IsIndeterminate = \$false
            \$progressBar.Value = 100
            
            if (\$proc.ExitCode -eq 0) {
                Add-Log "[OK] \$(\$prog.name) установлена в \$installPath"
            } else {
                Add-Log "[FAIL] \$(\$prog.name) (Код: \$(\$proc.ExitCode))"
            }
        } catch {
            \$progressBar.IsIndeterminate = \$false
            Add-Log "[ERROR] \$(\$prog.name): \$_"
        }
  }
$statusText.Text = "Все задачи завершены!"
$installBtn.IsEnabled = $true
$progressBar.Visibility = "Collapsed"
Add-Log "--- ГОТОВО ---"
[System.Windows.MessageBox]::Show("Установка завершена!", "Готово", "OK", "Information") | Out-Null
})
$window.ShowDialog() | Out-Null
`;
return res.status(200).send(script);
} catch (error) {
console.error('Critical error in /api/run:', error);
return res.status(500).send(`Write-Host "[ERROR] Server error: ${error.message}" -ForegroundColor Red`);
}
}
