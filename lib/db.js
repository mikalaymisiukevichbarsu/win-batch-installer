import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export const DEFAULT_PROGRAMS = [
  { id: 'chrome', name: 'Google Chrome', category: 'Браузеры', icon: 'https://www.google.com/chrome/static/images/favicons/apple-icon-180x180.png', url: 'https://dl.google.com/chrome/install/ChromeStandaloneSetup64.exe', args: '/silent /install' },
  { id: '7zip', name: '7-Zip', category: 'Утилиты', icon: 'https://www.7-zip.org/favicon.ico', url: 'https://www.7-zip.org/a/7z2408-x64.exe', args: '/S /D={PATH}\\7-Zip' },
  { id: 'vlc', name: 'VLC Media Player', category: 'Мультимедиа', icon: 'https://www.videolan.org/images/favicon.png', url: 'https://get.videolan.org/vlc/3.0.21/win64/vlc-3.0.21-win64.exe', args: '/L=1 /S /D={PATH}\\VLC' },
  { id: 'notepadpp', name: 'Notepad++', category: 'Утилиты', icon: 'https://notepad-plus-plus.org/favicon.ico', url: 'https://github.com/notepad-plus-plus/notepad-plus-plus/releases/download/v8.6.9/npp.8.6.9.Installer.x64.exe', args: '/S /D={PATH}\\Notepad++' },
  { id: 'telegram', name: 'Telegram Desktop', category: 'Мессенджеры', icon: 'https://telegram.org/img/website_icon.svg', url: 'https://telegram.org/dl/desktop/win64', args: '/VERYSILENT /NORESTART /DIR="{PATH}\\Telegram"' },
];

// Храним флаг в самом Redis, но сидинг больше НЕ перезаписывает существующие
// записи: для каждой программы проверяем её собственный ключ. Даже если флаг
// потерян (эвакуация из кэша, восстановление БД), отредактированные данные
// останутся нетронутыми — будет добавлено только отсутствующее.
export async function ensureSeeded() {
  const exists = await redis.exists('programs:seeded');
  if (exists) return;

  for (const p of DEFAULT_PROGRAMS) {
    const key = `program:${p.id}`;
    const already = await redis.exists(key);
    if (already) continue;
    await redis.hset(key, p);
  }
  await redis.set('programs:seeded', 'true');
}
