import { redis, ensureSeeded } from '../lib/db.js';
import { slugify, fallbackSlug } from '../lib/slug.js';

// id программы попадает в имя ключа Redis и в имя временного файла,
// поэтому допускаем только безопасный алфавит.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function firstParam(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function toStringField(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

// Название может быть на русском или содержать только символы, которые не
// проходят в slug (например "中文工具"): транслитерируем, а если ничего не
// осталось — берём детерминированный запасной id.
function resolveId(name) {
  const slug = slugify(name);
  if (ID_PATTERN.test(slug)) return slug;
  return fallbackSlug(name);
}

export default async function handler(req, res) {
  await ensureSeeded();
  const { method } = req;
  const adminPass = process.env.ADMIN_PASSWORD;
  console.log('DEBUG ADMIN_PASS:', adminPass); // <-- ДОБАВИТЬ ЭТУ СТРОКУ
  console.log('DEBUG AUTH_HEADER:', req.headers.authorization); // <-- И ЭТУ

  const isAuthenticated = () => {
    const authHeader = req.headers.authorization;
    return authHeader === `Bearer ${adminPass}` && !!adminPass;
  };

  try {
    // Проверка токена без возврата данных (для авторизации в админке)
    if (method === 'HEAD') {
      if (isAuthenticated()) {
        return res.status(200).end();
      }
      return res.status(401).end();
    }

    // Публичный список программ
    if (method === 'GET') {
      const keys = await redis.keys('program:*');
      if (keys.length === 0) return res.status(200).json([]);
      const programs = await Promise.all(keys.map(k => redis.hgetall(k)));
      return res.status(200).json(programs.filter(Boolean));
    }

    // Создание программы
    if (method === 'POST') {
      if (!isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
      const data = req.body || {};
      const name = toStringField(data.name).trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      const id = resolveId(name);
      await redis.hset(`program:${id}`, {
        id,
        name,
        category: toStringField(data.category),
        icon: toStringField(data.icon),
        url: toStringField(data.url),
        args: toStringField(data.args),
      });
      return res.status(201).json({ success: true, id });
    }

    // Обновление программы
    if (method === 'PUT') {
      if (!isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
      const body = req.body || {};
      const id = firstParam(body.id);
      if (!id) return res.status(400).json({ error: 'ID required' });
      if (!ID_PATTERN.test(id)) return res.status(400).json({ error: 'Invalid ID' });
      await redis.hset(`program:${id}`, {
        id,
        name: toStringField(body.name),
        category: toStringField(body.category),
        icon: toStringField(body.icon),
        url: toStringField(body.url),
        args: toStringField(body.args),
      });
      return res.status(200).json({ success: true });
    }

    // Удаление программы
    if (method === 'DELETE') {
      if (!isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
      const id = firstParam(req.query.id);
      if (!id) return res.status(400).json({ error: 'ID required' });
      if (!ID_PATTERN.test(id)) return res.status(400).json({ error: 'Invalid ID' });
      await redis.del(`program:${id}`);
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']);
    return res.status(405).end(`Method ${method} Not Allowed`);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
