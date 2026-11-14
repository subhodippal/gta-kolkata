// Language & voice: every visible string comes from data/strings.json,
// every spoken line from data/comment.json. Default language: Bengali (বাংলা).
let S = {}, C = {};
let lang = 'bn';
let voiceOn = true;
const listeners = [];
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export async function loadI18n() {
  const [s, c] = await Promise.all([fetch('data/strings.json').then(r => r.json()), fetch('data/comment.json').then(r => r.json())]);
  S = s; C = c;
  lang = store.get('lang') || S.meta?.default || 'bn';
  voiceOn = store.get('voice') !== 'off';
  // make sure the Bengali font is ready before canvases draw text
  try { await Promise.race([document.fonts.load('700 20px "Hind Siliguri"', 'কলকাতা'), new Promise(r => setTimeout(r, 2500))]); } catch { /* ignore */ }
  applyDom();
}

export const getLang = () => lang;
export const strings = () => S;

const pick = (o) => (o == null ? '' : typeof o === 'string' ? o : (o[lang] ?? o.en ?? o.bn ?? ''));
const fill = (str, vars) => vars ? str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : str;

/** UI string by key */
export function t(key, vars) { return fill(pick(S.ui?.[key]) || key, vars); }
/** place name by index (roads, shops, buildings, parks) */
export function tn(i) { const e = S.names?.[i]; return e ? (e[lang] || e.en) : ''; }
export function tnEn(i) { const e = S.names?.[i]; return e ? e.en : ''; }
/** POI type (restaurant, clothes, indian;chinese...) */
export function tt(type) { if (!type) return ''; const e = S.types?.[type]; return e ? pick(e) : type.replace(/_/g, ' '); }
export function tk(kind) { return pick(S.kinds?.[kind]); }
export function tlegend(kind) { return pick(S.legend?.[kind]); }
export function tdist(id) { return pick(S.districts?.[id]) || id; }
export function tland(id, field) { return pick(S.landmarks?.[id]?.[field]); }
export function tfamous(enName) { return pick(S.famous?.[enName]); }
export function tmenu(kind) { return (S.menus?.[kind] || S.menus?.food || []).map(m => ({ name: pick(m), price: m.price })); }
/** numbers in Bengali digits when Bengali is active */
export function num(n) { const s = String(n); return lang === 'bn' ? s.replace(/[0-9]/g, d => BN_DIGITS[d]) : s; }

/** spoken lines */
export function line(key, vars) {
  let o = C[key];
  if (Array.isArray(o)) o = o[Math.floor(Math.random() * o.length)];
  return fill(pick(o), vars);
}
export function landmarkLine(id) { return pick(C.landmarks?.[id]); }

export function setLang(l) {
  lang = l; store.set('lang', l);
  applyDom();
  listeners.forEach(f => f(l));
}
export function onLang(f) { listeners.push(f); }

export function applyDom() {
  document.documentElement.lang = lang;
  document.title = t('page_title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  document.body.classList.toggle('lang-bn', lang === 'bn');
}

// ------------------------------------------------------------ voice (Web Speech API)
let voices = [];
function refreshVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) { refreshVoices(); speechSynthesis.onvoiceschanged = refreshVoices; }

export function hasVoice(l = lang) {
  const tag = (C.meta?.voice?.[l] || l).toLowerCase();
  return voices.some(v => v.lang.toLowerCase().replace('_', '-').startsWith(tag.slice(0, 2)));
}
export function voiceEnabled() { return voiceOn; }
export function setVoice(on) { voiceOn = on; store.set('voice', on ? 'on' : 'off'); if (!on && window.speechSynthesis) speechSynthesis.cancel(); }

/** read text aloud (strips HTML). Returns false if no suitable voice */
export function speak(html) {
  if (!voiceOn || !window.speechSynthesis) return false;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const tag = C.meta?.voice?.[lang] || (lang === 'bn' ? 'bn-IN' : 'en-IN');
  const v = voices.find(v => v.lang.replace('_', '-') === tag) || voices.find(v => v.lang.toLowerCase().startsWith(tag.slice(0, 2)));
  if (!v) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = v; u.lang = v.lang; u.rate = C.meta?.rate?.[lang] || 1;
  speechSynthesis.speak(u);
  return true;
}
