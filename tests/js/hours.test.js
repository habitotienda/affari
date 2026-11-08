/* node tests/js/hours.test.js — mismos casos que tests/hours_test.py, sobre la versión del navegador */
const fs = require('fs'), assert = require('assert');
const sfEsc = s => String(s);
const L = new Function('sfEsc', fs.readFileSync(__dirname + '/../../js/store/hours.js', 'utf8') + '; return { sfOpenStatus, sfStatusText, sfHoursBadge, sfHoursTable, sfNowIn };')(sfEsc);
const at = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh + 3, mm);        // Buenos Aires = UTC-3 todo el año
const mk = days => ({ enabled: true, tz: 'America/Argentina/Buenos_Aires', days });
const S = (h, ...a) => L.sfOpenStatus(h, at(...a));

const h = mk({ mon: [['09:00', '13:00'], ['16:00', '20:00']], tue: [['09:00', '13:00'], ['16:00', '20:00']], sat: [['10:00', '14:00']] });
assert.deepStrictEqual(S(h, 2026, 11, 9, 10, 30), { open: true, soon: false, closes: '13:00', opens: null });
assert.strictEqual(S(h, 2026, 11, 9, 12, 30).soon, true, 'falta ≤ 1 h');
let s = S(h, 2026, 11, 9, 14, 0); assert.ok(!s.open && s.opens.days === 0 && s.opens.time === '16:00');
s = S(h, 2026, 11, 9, 20, 0); assert.ok(!s.open && s.opens.days === 1 && s.opens.time === '09:00');
s = S(h, 2026, 11, 11, 12, 0); assert.ok(!s.open && s.opens.days === 3 && s.opens.time === '10:00');
s = S(h, 2026, 11, 14, 15, 0); assert.ok(!s.open && s.opens.days === 2 && s.opens.time === '09:00');
assert.strictEqual(L.sfOpenStatus({ enabled: false, days: {} }), null);
assert.strictEqual(L.sfOpenStatus(null), null);

const bar = mk({ fri: [['20:00', '02:00']] });
assert.deepStrictEqual(S(bar, 2026, 11, 13, 23, 0), { open: true, soon: false, closes: '02:00', opens: null });
assert.ok(S(bar, 2026, 11, 14, 1, 0).open); assert.ok(!S(bar, 2026, 11, 14, 2, 0).open);
assert.ok(S(mk({ sun: [['22:00', '03:00']] }), 2026, 11, 9, 1, 0).open, 'domingo de noche → lunes');
assert.strictEqual(S(mk({ mon: [['09:00', '13:00'], ['13:00', '18:00']] }), 2026, 11, 9, 10, 0).closes, '18:00');
assert.deepStrictEqual(S(mk({}), 2026, 11, 9, 10, 0), { open: false, soon: false, closes: null, opens: null });

// la zona horaria es la del NEGOCIO, no la del visitante: 02:00 UTC del martes = lunes 23:00 en Buenos Aires
assert.strictEqual(L.sfNowIn('America/Argentina/Buenos_Aires', Date.UTC(2026, 10, 10, 2, 0)).dow, 0);
assert.strictEqual(L.sfNowIn('America/Argentina/Buenos_Aires', Date.UTC(2026, 10, 10, 3, 0)).min, 0, 'medianoche = 0 y no 24');

// textos
const T = x => L.sfStatusText(x);
assert.deepStrictEqual(T(S(h, 2026, 11, 9, 10, 30)), { label: 'Abierto ahora', detail: 'cierra 13:00 hs' });
assert.deepStrictEqual(T(S(h, 2026, 11, 9, 12, 30)), { label: 'Cierra pronto', detail: 'cierra 13:00 hs' });
assert.deepStrictEqual(T(S(h, 2026, 11, 9, 14, 0)), { label: 'Cerrado', detail: 'abre hoy 16:00 hs' });
assert.deepStrictEqual(T(S(h, 2026, 11, 9, 20, 0)), { label: 'Cerrado', detail: 'abre mañana 09:00 hs' });
assert.deepStrictEqual(T(S(h, 2026, 11, 11, 12, 0)), { label: 'Cerrado', detail: 'abre el sábado 10:00 hs' });
assert.ok(L.sfHoursBadge(S(h, 2026, 11, 9, 14, 0)).includes('closed'));
assert.ok(L.sfHoursTable(h, at(2026, 11, 9, 10, 0)).match(/sf-hrow today"><span>Lunes/));
console.log('hours.js: OK');
