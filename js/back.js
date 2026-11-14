/* Botón «atrás» del celular para menús, diálogos y cajones.
   Back.open({ onBack }) → al abrir un menú: agrega una entrada al historial. Al tocar «atrás»:
     · si onBack() devuelve true, el menú resolvió el paso solo (cerró una hoja, volvió un paso) y sigue abierto;
     · si no, se lo saca de la pila y onBack() ya debió cerrarlo.
   Back.release(h) → el menú se cerró por su cuenta (X, Esc, guardar): quita su entrada del historial.
   Back.drop(h) → lo saca de la pila SIN tocar el historial (cuando otra navegación ya reemplazó la entrada). */
const Back = (() => {
  const stack = [], queued = []; let wait = 0;
  const push = () => { try { history.pushState({ bk: 1 }, ''); } catch {} };
  addEventListener('popstate', () => {
    if (wait) { if (!--wait) queued.splice(0).forEach(push); return; }     // eco de un history.back() propio
    const h = stack[stack.length - 1]; if (!h) return;
    stack.pop();                                                            // sale de la pila ANTES de llamar: si onBack cierra el menú, release() no repite el history.back()
    if (h.onBack && h.onBack() === true) { stack.push(h); push(); }         // se resolvió adentro: sigue abierto y mantiene su entrada
  });
  return {
    open(h) { stack.push(h); wait ? queued.push(h) : push(); return h; },
    has: h => !!h && stack.includes(h),
    drop(h) { const i = stack.indexOf(h); if (i >= 0) stack.splice(i, 1); const q = queued.indexOf(h); if (q >= 0) queued.splice(q, 1); },
    release(h) {
      const i = stack.indexOf(h); if (i < 0) return; stack.splice(i, 1);
      const q = queued.indexOf(h); if (q >= 0) { queued.splice(q, 1); return; }   // todavía no se había agregado su entrada
      wait++; try { history.back(); } catch { wait--; }
    }
  };
})();
