import { redis, ensureSeeded } from '../lib/db.js';

export default async function handler(req, res) {
  try {
    await ensureSeeded();

    const host = req.headers.host || 'win-batch-installer.vercel.app';
    const baseUrl = `https://${host}`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    // XAML разметка для красивого окна
    const xaml = `
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Win Batch Installer" Height="550" Width="600"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize"
        Background="#1e1e1e" Foreground="White" FontFamily="Segoe UI">
    
    <Window.Resources>
        <!-- Стиль для чекбоксов -->
        <Style TargetType="CheckBox">
            <Setter Property="Foreground" Value="#e0e0e0"/>
            <Setter Property="FontSize" Value="14"/>
            <Setter Property="Margin" Value="0,5,0,5"/>
            <Setter Property="Cursor" Value="Hand"/>
        </Style>
        
        <!-- Стиль для кнопки -->
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
        </Grid.RowDefinitions>

        <!-- Заголовок -->
        <TextBlock Text="Выберите программы для установки" 
                   FontSize="20" FontWeight="Bold" Margin="0,0,0,20" Foreground="#ffffff"/>

        <!-- Список программ (ScrollViewer) -->
        <ScrollViewer Grid.Row="1" VerticalScrollBarVisibility="Auto" Margin="0,0,0,20">
            <StackPanel Name="ProgramsStack" />
        </ScrollViewer>

        <!-- Выбор пути -->
        <Grid Grid.Row="2" Margin="0,0,0,15">
            <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>
            
            <TextBlock Text="Папка:" VerticalAlignment="Center" Margin="0,0,10,0" Foreground="#aaaaaa"/>
            <TextBox Name="PathBox" Grid.Column="1" Text="C:\\Programs" 
                     Background="#2d2d2d" Foreground="White" BorderBrush="#444" Padding="5"/>
            <Button Grid.Column="2" Content="..." Width="30" Margin="10,0,0,0" 
                    Background="#333" Foreground="White" Cursor="Hand" Click="Browse_Click"/>
        </Grid>

        <!-- Кнопка установки -->
        <Button Name="InstallBtn" Grid.Row="3" Style="{StaticResource PrimaryButton}" 
                Content="Установить выбранное" Click="Install_Click" Margin="0,0,0,15"/>

        <!-- Статус -->
        <TextBlock Name="StatusText" Grid.Row="4" Text="Готов к работе" 
                   Foreground="#888" FontSize="12"/>
    </Grid>
</Window>
`;

    // PowerShell скрипт с логикой WPF
    const script = `
# Win Batch Installer WPF GUI v1.4.0
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Windows.Forms

\$BaseUrl = "${baseUrl}"

# Загружаем XAML
[xml]\$xaml = @"
${xaml}
"@

\$reader = (New-Object System.Xml.XmlNodeReader \$xaml)
\$window = [Windows.Markup.XamlReader]::Load(\$reader)

# Получаем элементы управления
\$programsStack = \$window.FindName("ProgramsStack")
\$pathBox = \$window.FindName("PathBox")
\$installBtn = \$window.FindName("InstallBtn")
\$statusText = \$window.FindName("StatusText")

# Глобальный список программ
\$Global:ProgramsList = @()

# Функция скачивания с обновлением статуса
function Download-File {
    param ([string]\$Url, [string]\$OutFile)
    \$wc = New-Object System.Net.WebClient
    \$wc.DownloadFile(\$Url, \$OutFile)
}

# Загрузка данных из API
\$statusText.Text = "Подключение к серверу..."
try {
    \$response = Invoke-RestMethod -Uri "\$BaseUrl/api/programs" -Method Get
    \$Global:ProgramsList = \$response
    
    foreach (\$prog in \$Global:ProgramsList) {
        \$cb = New-Object System.Windows.Controls.CheckBox
        \$cb.Content = \$prog.name
        \$cb.Tag = \$prog
        \$programsStack.Children.Add(\$cb)
    }
    \$statusText.Text = "Список программ загружен."
} catch {
    \$statusText.Text = "Ошибка подключения к API!"
    \$statusText.Foreground = "#ff5555"
}

# Логика кнопки Browse
\$window.Add_Loaded({
    \$browseBtn = \$window.FindName("...") # Это хак, лучше найти по имени если добавим x:Name
})

# Обработчик кнопки установки
\$installBtn.Add_Click({
    \$selected = \$programsStack.Children | Where-Object { \$_ -is [System.Windows.Controls.CheckBox] -and \$_ .IsChecked }
    
    if (\$selected.Count -eq 0) {
        [System.Windows.MessageBox]::Show("Выберите хотя бы одну программу!", "Внимание", "OK", "Warning")
        return
    }

    \$installPath = \$pathBox.Text
    if (-not (Test-Path \$installPath)) {
        New-Item -ItemType Directory -Path \$installPath -Force | Out-Null
    }

    \$installBtn.IsEnabled = \$false
    \$statusText.Foreground = "#ffffff"

    foreach (\$item in \$selected) {
        \$prog = \$item.Tag
        \$statusText.Text = "Установка: \$(\$prog.name)..."
        
        \$fileName = Split-Path \$prog.url -Leaf
        \$tempFile = Join-Path \$env:TEMP \$fileName
        
        try {
            Download-File -Url \$prog.url -OutFile \$tempFile
            
            \$args = if (\$prog.args) { \$prog.args -replace '\{PATH\}', \$installPath } else { "/SILENT" }
            \$proc = Start-Process -FilePath \$tempFile -ArgumentList \$args -Wait -PassThru -NoNewWindow
            
            Remove-Item \$tempFile -Force -ErrorAction SilentlyContinue
            
            if (\$proc.ExitCode -eq 0) {
                \$statusText.Text = "[OK] \$(\$prog.name) установлена."
            } else {
                \$statusText.Text = "[FAIL] \$(\$prog.name) (Код: \$(\$proc.ExitCode))"
            }
        } catch {
            \$statusText.Text = "[ERROR] \$(\$prog.name): \$_"
        }
    }

    \$statusText.Text = "Все задачи завершены!"
    \$installBtn.IsEnabled = \$true
    [System.Windows.MessageBox]::Show("Установка завершена!", "Готово", "OK", "Information")
})

# Показываем окно
\$window.ShowDialog()
`;

    return res.status(200).send(script);

  } catch (error) {
    console.error('Critical error in /api/run:', error);
    return res.status(500).send('Write-Host "[ERROR] Server error." -ForegroundColor Red');
  }
}
