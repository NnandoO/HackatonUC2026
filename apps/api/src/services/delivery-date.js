export function limaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function resolveDeliveryDate(value, now = new Date()) {
  const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let iso;
  const explicit = text.match(/\b(\d{4})[-/](\d{2})[-/](\d{2})\b/);
  const local = text.match(/\b(\d{2})[-/](\d{2})[-/](\d{4})\b/);
  if (explicit) iso = `${explicit[1]}-${explicit[2]}-${explicit[3]}`;
  else if (local) iso = `${local[3]}-${local[2]}-${local[1]}`;
  else {
    const date = new Date(`${limaDate(now)}T12:00:00Z`);
    let offset;
    if (/\bpasado manana\b/.test(text)) offset = 2;
    else if (/\bmanana\b/.test(text)) offset = 1;
    else if (/\bhoy\b/.test(text)) offset = 0;
    else {
      const weekdays = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
      const index = weekdays.findIndex(day => new RegExp(`\\b${day}\\b`).test(text));
      if (index >= 0) offset = (index - date.getUTCDay() + 7) % 7;
    }
    if (offset === undefined) return null;
    date.setUTCDate(date.getUTCDate() + offset);
    iso = date.toISOString().slice(0, 10);
  }
  const parsed = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}
