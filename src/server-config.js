const path = require('path');

const PORT = process.env.PORT || 3000;

const ALLOWED_ORIGINS = new Set([
  'https://anivmeste.ru',
  'https://www.anivmeste.ru',
  'https://anivmeste.onrender.com'
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

const KODIK_TOKEN = String(process.env.KODIK_TOKEN || '').trim();

if (!KODIK_TOKEN) {
  console.error('❌ KODIK TOKEN не найден (env KODIK_TOKEN)');
} else {
  console.log('✅ KODIK TOKEN загружен');
}

module.exports = {
  PORT,
  ALLOWED_ORIGINS,
  isAllowedOrigin,
  KODIK_TOKEN,
  ROOT_DIR: path.resolve(__dirname, '..')
};