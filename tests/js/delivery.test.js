/* node tests/js/delivery.test.js — formas de entrega (retiro / domicilio) del catálogo */
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../../js/store/utils.js', 'utf8');
const sfModes = new Function(src.match(/function sfModes[\s\S]*?\n}\n/)[0] + '; return sfModes;')();
assert.deepStrictEqual(sfModes({ optPickup: true, optDelivery: true }), ['retiro', 'envio']);
assert.deepStrictEqual(sfModes({ optPickup: true, optDelivery: false }), ['retiro']);
assert.deepStrictEqual(sfModes({ optPickup: false, optDelivery: true }), ['envio']);
assert.deepStrictEqual(sfModes({ optPickup: false, optDelivery: false }), ['retiro']);   // nunca queda sin opciones
assert.deepStrictEqual(sfModes({ delivery: true }), ['retiro', 'envio']);                // catálogo anterior con envíos
assert.deepStrictEqual(sfModes({}), ['retiro']);
console.log('delivery.test.js OK');
