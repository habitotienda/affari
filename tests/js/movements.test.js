/* node tests/js/movements.test.js — marcas de anulado/editado y botones de corrección de movimientos (js/views.js + js/movements.js) */
const fs = require('fs'), assert = require('assert');
const views = fs.readFileSync(__dirname + '/../../js/views.js', 'utf8'), mov = fs.readFileSync(__dirname + '/../../js/movements.js', 'utf8');
const grab = (src, re) => { const m = src.match(re); assert(m, 'no se encontró ' + re); return m[0]; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<i:${n}>`;
const code = [grab(views, /const tkAttr = [\s\S]*?\n};\n/), grab(views, /const tkChip = [\s\S]*?;\n/),
  grab(mov, /const mvLockMsg = [\s\S]*?;\n/), grab(mov, /const mvDay = .*\n/), grab(mov, /const mvClosedNote = [\s\S]*?: '';\n/), grab(mov, /function mvActions[\s\S]*?\n}\n/), grab(mov, /const mvInline = .*\n/)].join('\n');
const { tkAttr, tkChip, mvActions, mvClosedNote, mvInline } = new Function('esc', 'icon', code + '; return { tkAttr, tkChip, mvActions, mvClosedNote, mvInline };')(esc, icon);

const base = { id: 1, kind: 'entrada', concept: 'x', amount: 10, method: 'Efectivo', created_at: '2026-11-20 10:00:00' };
// filas normales no cambian
assert.strictEqual(tkAttr(base, 0), ''); assert.strictEqual(tkChip(base), '');
// venta de varios productos: igual que antes
assert.strictEqual(tkAttr({ ...base, items: [1, 2] }, 3), ' class="tk-row" data-tk="3" tabindex="0" role="button" aria-label="Ver los productos de esta venta"');
// anulada: fila tachada + chip con el motivo (escapado)
assert.strictEqual(tkAttr({ ...base, voided_at: 'x' }, 0), ' class="mv-void"');
assert.strictEqual(tkAttr({ ...base, items: [1, 2], voided_at: 'x' }, 2), ' class="tk-row mv-void" data-tk="2" tabindex="0" role="button" aria-label="Ver los productos de esta venta"');
assert(tkChip({ ...base, voided_at: 'x', void_reason: '<b>"Cancelaron"</b>' }).includes('Anulado') && !tkChip({ ...base, voided_at: 'x', void_reason: '<b>' }).includes('<b>'));
// editada: chip «Editado»; anulada gana sobre editada
assert(tkChip({ ...base, edited_at: '2026-11-20 11:00:00' }).includes('Editado'));
assert(!tkChip({ ...base, edited_at: 'x', voided_at: 'y' }).includes('Editado'));
// botones: normal → editar + anular; anulada → restaurar; bloqueada → candado sin botones
const a = mvActions(base, 4); assert(a.includes('data-mv="edit" data-ix="4"') && a.includes('data-mv="void" data-ix="4"') && a.includes('Editar') && a.includes('Anular'));
const c = mvActions(base, 4, true); assert(!c.includes('>Editar<') && !/<\/i:edit>Editar/.test(c) && c.includes('aria-label="Editar movimiento"'));
const r = mvActions({ ...base, voided_at: 'x' }, 1); assert(r.includes('data-mv="restore"') && !r.includes('data-mv="edit"') && !r.includes('data-mv="void"'));
for (const locked of ['comprobante', 'proveedor']) { const l = mvActions({ ...base, locked }, 1); assert(!l.includes('data-mv=') && l.includes('i:lock')); }
// versión para celular: bajo el concepto, sin candado en filas bloqueadas
assert(mvInline(base, 2).startsWith('<div class="mv-inline">') && mvInline(base, 2).includes('data-ix="2"') && mvInline({ ...base, locked: 'proveedor' }, 2) === '');
// aviso de cierre de caja
assert.strictEqual(mvClosedNote({ closed_days: [] }), ''); assert.strictEqual(mvClosedNote({}), '');
assert(mvClosedNote({ closed_days: ['2026-11-20'] }).includes('20/11/2026'));
console.log('movements.test.js OK');
