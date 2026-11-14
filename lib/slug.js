// Преобразование названия программы в безопасный id (slug).
//
// id попадает в ключ Redis и в имя временного файла, поэтому алфавит строго
// ограничен: латиница, цифры, дефис. Кириллица транслитерируется, чтобы
// названия вида "Моя программа" давали осмысленный "moya-programma",
// а не пустую строку из дефисов.

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'i', є: 'e', ґ: 'g',
  ў: 'u',
};

export function slugify(name, maxLength = 64) {
  const input = String(name || '').toLowerCase();

  let latin = '';
  for (const ch of input) {
    if (TRANSLIT[ch] !== undefined) latin += TRANSLIT[ch];
    else latin += ch;
  }

  const slug = latin
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');

  return slug;
}

// id, который пройдёт проверку даже если от названия ничего не осталось
// (например, "中文工具" или "!!!"). Детерминированный, чтобы повторное
// создание той же программы перезаписывало запись, а не плодило дубли.
export function fallbackSlug(name, maxLength = 64) {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `app-${hash.toString(36)}`.slice(0, maxLength);
}
