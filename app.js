/* Lista del bebé — toda la lógica de la web */
(function () {
  'use strict';

  /* ───────────── Constantes ───────────── */

  const API_URL = ((window.APP_CONFIG && window.APP_CONFIG.API_URL) || '').trim();
  const URGENCIAS = ['Antes de que nazca', 'Primer mes', 'Puede esperar'];
  const COLORES = ['#9CC3A0', '#A8C8E2', '#EBD291', '#F0B2AB', '#C6B6E0', '#98D3C4', '#F2BC8D', '#B5C0EE', '#D3C4AE', '#E8B4D2'];
  const SIN_CATEGORIA = 'Sin categoría';
  const SIN_URGENCIA = 'Sin definir';
  const INTERVALO_SYNC = 15000;
  const CAMPOS_CONSEGUIDO = ['conseguido_tipo', 'conseguido_fecha', 'donde', 'precio_final', 'de_quien', 'valor_regalo', 'agradecido'];
  const ORDEN_FILA = { pendiente: 0, comparando: 1, elegido: 2, conseguido: 3, no_necesario: 4 };
  const ORDEN_MANTITA = { conseguido: 0, elegido: 1, comparando: 2, pendiente: 3 };
  const ORDEN_PROXIMO = { pendiente: 0, comparando: 1, elegido: 2 };
  const LS = { pin: 'bebe.pin', yo: 'bebe.yo', modo: 'bebe.lista.modo', filtro: 'bebe.lista.filtro' };

  const ICONOS = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    corazon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 10c0 5.65-7 10-7 10z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    mas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    atras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="15" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
  };

  /* ───────────── Estado ───────────── */

  const app = {
    items: [],
    opciones: [],
    config: {},
    cargado: false,
    firma: '',
    pin: leerLS(LS.pin),
    yo: leerLS(LS.yo),
    cola: [],
    enviando: false,
    sinConexion: false,
    previa: '#lista',
    ultimo: { categoria: '', urgencia: URGENCIAS[0], responsable: '' },
    mantitaAnimada: false,
    error: ''
  };

  let cacheOpciones = null;
  let temporizadorToast = null;

  /* ───────────── Utilidades ───────────── */

  function leerLS(clave) {
    try { return localStorage.getItem(clave) || ''; } catch (e) { return ''; }
  }

  function guardarLS(clave, valor) {
    try {
      if (valor) localStorage.setItem(clave, valor);
      else localStorage.removeItem(clave);
    } catch (e) { /* el navegador no deja guardar: seguimos igual */ }
  }

  function $(selector, raiz) { return (raiz || document).querySelector(selector); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function si(v) {
    const s = String(v == null ? '' : v).trim().toLowerCase();
    return s !== '' && s !== 'no' && s !== 'false' && s !== '0';
  }

  function num(v) {
    if (v == null || v === '') return 0;
    let s = String(v).replace(/[^\d.,-]/g, '');
    if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function limpiarPrecio(v) {
    const n = num(v);
    return n > 0 ? String(Math.round(n * 100) / 100) : '';
  }

  const formatoPrecio = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatoTotal = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  function precio(n) { return Number.isInteger(n) ? formatoTotal.format(n) : formatoPrecio.format(n); }
  function total(n) { return formatoTotal.format(Math.round(n)); }

  function hoyISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function parseFecha(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function fechaCorta(s) {
    const d = parseFecha(s);
    return d ? d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', '') : '';
  }

  function fechaLarga(s) {
    const d = parseFecha(s);
    return d ? d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' }) : '';
  }

  function nuevoId() {
    const base = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2) + Date.now().toString(16);
    return base.replace(/-/g, '').slice(0, 10);
  }

  function hrefSeguro(url) { return /^https?:\/\//i.test(url || '') ? url : ''; }

  function normalizarLink(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : 'https://' + s;
  }

  function dominio(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function lineas(v) {
    return String(v || '').split(/\n/).map(function (s) { return s.replace(/^[\s\-•+*·]+/, '').trim(); }).filter(Boolean);
  }

  function plural(n, uno, varios) { return n === 1 ? uno : varios; }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function texto(v) { return String(v == null ? '' : v).trim(); }
  function g(tabla, fila) { return { tipo: 'guardar', tabla: tabla, fila: fila }; }
  function borrar(tabla, id) { return { tipo: 'borrar', tabla: tabla, id: id }; }

  /* ───────────── Modelo ───────────── */

  function personas() { return [app.config.persona_1 || 'Persona 1', app.config.persona_2 || 'Persona 2']; }
  function yoIndice() { return app.yo === '2' ? 2 : 1; }
  function inicial(nombre) { return (texto(nombre)[0] || '?').toUpperCase(); }

  function categoriasConfig() {
    return String(app.config.categorias || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function categorias() {
    const lista = categoriasConfig();
    app.items.forEach(function (it) {
      const c = texto(it.categoria);
      if (c && lista.indexOf(c) === -1) lista.push(c);
    });
    return lista;
  }

  function categoriaDe(it) { return texto(it.categoria) || SIN_CATEGORIA; }

  function colorCat(cat) {
    const i = categorias().indexOf(cat);
    return i < 0 ? 'var(--sin-cat)' : COLORES[i % COLORES.length];
  }

  function urgenciaDe(it) { return URGENCIAS.indexOf(it.urgencia) !== -1 ? it.urgencia : SIN_URGENCIA; }
  function rankUrg(it) { const i = URGENCIAS.indexOf(it.urgencia); return i < 0 ? 3 : i; }

  function buscarItem(id) { return app.items.find(function (x) { return x.id === id; }); }
  function buscarOpcion(id) { return app.opciones.find(function (x) { return x.id === id; }); }

  function opcionesDe(itemId) {
    if (!cacheOpciones) {
      cacheOpciones = {};
      app.opciones.forEach(function (o) {
        (cacheOpciones[o.item_id] = cacheOpciones[o.item_id] || []).push(o);
      });
    }
    return cacheOpciones[itemId] || [];
  }

  function estadoOpcion(o) { return o.estado === 'elegida' || o.estado === 'descartada' ? o.estado : 'activa'; }
  function elegidaDe(itemId) { return opcionesDe(itemId).find(function (o) { return estadoOpcion(o) === 'elegida'; }); }
  function activasDe(itemId) { return opcionesDe(itemId).filter(function (o) { return estadoOpcion(o) === 'activa'; }); }
  function descartadasDe(itemId) { return opcionesDe(itemId).filter(function (o) { return estadoOpcion(o) === 'descartada'; }); }

  // El estado no se guarda: se deduce de los datos
  function estadoItem(it) {
    if (si(it.no_necesario)) return 'no_necesario';
    if (texto(it.conseguido_tipo)) return 'conseguido';
    if (elegidaDe(it.id)) return 'elegido';
    if (activasDe(it.id).length) return 'comparando';
    return 'pendiente';
  }

  function itemsActivos() { return app.items.filter(function (it) { return !si(it.no_necesario); }); }

  function progreso(items) {
    const p = { total: 0, tengo: 0, elegido: 0, pct: 0 };
    items.forEach(function (it) {
      const e = estadoItem(it);
      if (e === 'no_necesario') return;
      p.total++;
      if (e === 'conseguido') p.tengo++;
      else if (e === 'elegido') p.elegido++;
    });
    p.pct = p.total ? Math.round(p.tengo * 100 / p.total) : 0;
    return p;
  }

  function precioMinimo(opciones) {
    const precios = opciones.map(function (o) { return num(o.precio); }).filter(function (n) { return n > 0; });
    return precios.length ? Math.min.apply(null, precios) : 0;
  }

  function cuentas(items) {
    const r = { gastado: 0, comprometido: 0, falta: 0, sinEstimar: 0, regalos: 0, sinPrecio: 0 };
    items.forEach(function (it) {
      const e = estadoItem(it);
      const el = elegidaDe(it.id);
      const precioElegida = el ? num(el.precio) : 0;
      if (e === 'conseguido') {
        if (it.conseguido_tipo === 'regalo') r.regalos += num(it.valor_regalo) || precioElegida;
        else if (it.conseguido_tipo !== 'prestado') {
          const p = num(it.precio_final) || precioElegida;
          if (p) r.gastado += p; else r.sinPrecio++;
        }
      } else if (e === 'elegido') {
        r.comprometido += precioElegida;
      } else if (e === 'pendiente' || e === 'comparando') {
        const estimado = precioMinimo(activasDe(it.id)) || num(it.presupuesto);
        if (estimado) r.falta += estimado; else r.sinEstimar++;
      }
    });
    return r;
  }

  function agrupar(items, modo) {
    const orden = modo === 'urgencia' ? URGENCIAS.concat(SIN_URGENCIA) : categorias().concat(SIN_CATEGORIA);
    const mapa = new Map(orden.map(function (n) { return [n, []]; }));
    items.forEach(function (it) {
      const k = modo === 'urgencia' ? urgenciaDe(it) : categoriaDe(it);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(it);
    });
    return Array.from(mapa.entries()).filter(function (par) { return par[1].length; });
  }

  function ordenarFilas(a, b) {
    return ORDEN_FILA[estadoItem(a)] - ORDEN_FILA[estadoItem(b)]
      || rankUrg(a) - rankUrg(b)
      || texto(a.nombre).localeCompare(texto(b.nombre), 'es');
  }

  function textoEstado(it) {
    const e = estadoItem(it);
    if (e === 'conseguido') {
      if (it.conseguido_tipo === 'regalo') return it.de_quien ? 'Regalo de ' + it.de_quien : 'Fue un regalo';
      if (it.conseguido_tipo === 'prestado') return it.de_quien ? 'Prestado por ' + it.de_quien : 'Ya lo teníamos';
      return it.conseguido_fecha ? 'Comprado el ' + fechaCorta(it.conseguido_fecha) : 'Comprado';
    }
    if (e === 'elegido') {
      const el = elegidaDe(it.id);
      const p = num(el.precio);
      return 'Falta comprar: ' + (el.nombre || 'la opción elegida') + (p ? ' (' + precio(p) + ')' : '');
    }
    if (e === 'comparando') {
      const act = activasDe(it.id);
      const min = precioMinimo(act);
      const base = act.length === 1 ? '1 opción cargada' : 'Comparando ' + act.length + ' opciones';
      return base + (min ? ', desde ' + precio(min) : '');
    }
    if (e === 'no_necesario') return 'No lo necesitamos';
    return num(it.presupuesto) ? 'Sin opciones, presupuesto ' + precio(num(it.presupuesto)) : 'Sin opciones todavía';
  }

  /* ───────────── Comunicación con la planilla ───────────── */

  async function llamar(cuerpo) {
    let respuesta;
    try {
      respuesta = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ pin: app.pin }, cuerpo))
      });
    } catch (e) {
      const err = new Error('sin_conexion');
      err.red = true;
      throw err;
    }
    let datos;
    try {
      datos = await respuesta.json();
    } catch (e) {
      const err = new Error('respuesta_invalida');
      err.red = true;
      throw err;
    }
    if (!datos.ok) {
      const err = new Error(datos.error || 'error');
      err.servidor = true;
      throw err;
    }
    return datos;
  }

  function aplicarServidor(datos) {
    const firma = JSON.stringify([datos.items, datos.opciones, datos.config]);
    if (app.cargado && firma === app.firma) return false;
    app.firma = firma;
    app.items = datos.items || [];
    app.opciones = datos.opciones || [];
    app.config = datos.config || {};
    app.cargado = true;
    cacheOpciones = null;
    return true;
  }

  function aplicarLocal(cambio) {
    cacheOpciones = null;
    if (cambio.tabla === 'Config') {
      if (cambio.tipo === 'guardar') app.config[cambio.fila.clave] = cambio.fila.valor;
      return;
    }
    const lista = cambio.tabla === 'Items' ? app.items : app.opciones;
    if (cambio.tipo === 'borrar') {
      const i = lista.findIndex(function (x) { return x.id === cambio.id; });
      if (i >= 0) lista.splice(i, 1);
      return;
    }
    const j = lista.findIndex(function (x) { return x.id === cambio.fila.id; });
    if (j >= 0) Object.assign(lista[j], cambio.fila);
    else lista.push(Object.assign({}, cambio.fila));
  }

  // Aplica el cambio en pantalla al instante y lo manda a la planilla por detrás
  function cambiar(cambios) {
    if (!cambios.length) return;
    cambios.forEach(aplicarLocal);
    app.cola.push(cambios);
    render();
    procesarCola();
  }

  async function procesarCola() {
    if (app.enviando || !app.cola.length) return;
    app.enviando = true;
    pintarSync();
    let resincronizar = false;
    while (app.cola.length) {
      try {
        const datos = await llamar({ accion: 'cambios', cambios: app.cola[0] });
        app.cola.shift();
        setConexion(true);
        if (!app.cola.length && aplicarServidor(datos)) render();
      } catch (e) {
        if (e.message === 'pin_incorrecto') { app.cola = []; manejarError(e); break; }
        if (e.servidor) {
          app.cola.shift();
          resincronizar = true;
          toast('No se pudo guardar un cambio: ' + e.message);
          continue;
        }
        setConexion(false);
        await esperar(5000);
      }
    }
    app.enviando = false;
    pintarSync();
    if (resincronizar) { app.firma = ''; refrescar(); }
  }

  async function refrescar() {
    if (!app.pin || !app.cargado || app.enviando || app.cola.length || document.hidden) return;
    try {
      const datos = await llamar({ accion: 'leer' });
      setConexion(true);
      if (!app.enviando && !app.cola.length && aplicarServidor(datos)) render();
    } catch (e) {
      manejarError(e);
    }
  }

  function manejarError(e) {
    if (e.message === 'pin_incorrecto') {
      app.pin = '';
      app.cargado = false;
      guardarLS(LS.pin, '');
      app.error = 'El PIN cambió. Ingresalo de nuevo.';
      cerrarHoja();
      render();
    } else if (e.red) {
      setConexion(false);
    }
  }

  function setConexion(ok) {
    if (app.sinConexion === !ok) return;
    app.sinConexion = !ok;
    pintarSync();
  }

  function pintarSync() {
    const el = $('#sync');
    if (!el) return;
    let t = '';
    if (app.sinConexion) t = 'Sin conexión, reintentando…';
    else if (app.enviando || app.cola.length) t = 'Guardando…';
    el.textContent = t;
    el.hidden = !t;
  }

  async function cargarInicial() {
    if (!apiConfigurada()) return renderSinConfig();
    renderCargando();
    try {
      const datos = await llamar({ accion: 'leer' });
      app.error = '';
      aplicarServidor(datos);
      render({ arriba: true });
    } catch (e) {
      if (e.message === 'pin_incorrecto') {
        app.pin = '';
        guardarLS(LS.pin, '');
        app.error = 'Ese PIN no coincide con el de la planilla.';
        renderPin();
      } else {
        renderErrorConexion();
      }
    }
  }

  function apiConfigurada() { return API_URL && !/PEGAR/i.test(API_URL); }

  /* ───────────── Navegación y render ───────────── */

  function ruta() {
    const partes = location.hash.replace(/^#\/?/, '').split('/');
    return { vista: partes[0] || 'inicio', id: partes[1] ? decodeURIComponent(partes[1]) : '' };
  }

  function guardarScrolls() {
    const m = {};
    document.querySelectorAll('[data-scroll-id]').forEach(function (el) { m[el.dataset.scrollId] = el.scrollLeft; });
    return m;
  }

  function restaurarScrolls(m) {
    document.querySelectorAll('[data-scroll-id]').forEach(function (el) {
      if (m[el.dataset.scrollId] != null) el.scrollLeft = m[el.dataset.scrollId];
    });
  }

  function render(opciones) {
    if (!apiConfigurada()) return renderSinConfig();
    if (!app.pin) return renderPin();
    if (!app.cargado) return;
    if (!app.yo) return renderElegirPersona();

    document.body.classList.remove('sin-sesion');
    const r = ruta();
    const scrolls = guardarScrolls();
    const y = window.scrollY;
    let html;
    if (r.vista === 'lista') html = vistaLista();
    else if (r.vista === 'plata') html = vistaPlata();
    else if (r.vista === 'archivo') html = vistaArchivo();
    else if (r.vista === 'item') html = vistaItem(r.id);
    else html = vistaInicio();
    $('#vista').innerHTML = html;
    restaurarScrolls(scrolls);
    window.scrollTo(0, opciones && opciones.arriba ? 0 : y);
    marcarTab(r.vista);
    pintarSync();
  }

  function marcarTab(vista) {
    const activa = vista === 'item' ? 'lista' : (['lista', 'plata', 'archivo'].indexOf(vista) !== -1 ? vista : 'inicio');
    document.querySelectorAll('#tabs a').forEach(function (a) {
      if (a.dataset.vista === activa) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function alCambiarRuta() {
    const r = ruta();
    if (r.vista !== 'item') app.previa = '#' + r.vista;
    cerrarHoja();
    render({ arriba: true });
  }

  /* ───────────── Pantallas de ingreso ───────────── */

  function mantitaDecorativa() {
    const estados = ['conseguido', 'conseguido', 'elegido', 'pendiente', 'conseguido', 'pendiente', 'conseguido', 'elegido', 'pendiente', 'conseguido', 'pendiente', 'pendiente'];
    return estados.map(function (e, i) {
      return '<span class="parche ' + e + '" style="--c:' + COLORES[i % COLORES.length] + '"></span>';
    }).join('');
  }

  function pantallaIngreso(contenido) {
    document.body.classList.add('sin-sesion');
    $('#vista').innerHTML = '<section class="ingreso"><div class="ingreso-marca" aria-hidden="true">' + mantitaDecorativa() + '</div><h1>Lista del bebé</h1>' + contenido + '</section>';
  }

  function renderSinConfig() {
    pantallaIngreso('<p>Falta conectar la planilla. Abrí <code>config.js</code> y pegá la URL de la API, la que termina en <code>/exec</code>.</p>');
  }

  function renderPin() {
    pantallaIngreso(
      '<form class="form" data-form="pin" autocomplete="off">' +
        '<p>Ingresá el PIN que configuraste en la planilla. Queda guardado en este celular.</p>' +
        (app.error ? '<p class="error" role="alert">' + esc(app.error) + '</p>' : '') +
        campo('PIN', '<input name="pin" type="password" required autocomplete="current-password">') +
        '<button class="btn primario ancho" type="submit">Entrar</button>' +
      '</form>'
    );
  }

  function renderCargando() { pantallaIngreso('<p class="nota">Cargando la lista…</p>'); }

  function renderErrorConexion() {
    pantallaIngreso('<p>No pudimos conectarnos con la planilla. Revisá la conexión y probá de nuevo.</p><button class="btn primario ancho" type="button" data-accion="reintentar">Probar de nuevo</button>');
  }

  function renderElegirPersona() {
    const n = personas();
    pantallaIngreso(
      '<p>¿Quién sos? Así sabemos de quién es cada corazón.</p>' +
      '<div class="quien">' +
        '<button class="btn primario ancho" type="button" data-accion="soy" data-valor="1">' + esc(n[0]) + '</button>' +
        '<button class="btn primario ancho" type="button" data-accion="soy" data-valor="2">' + esc(n[1]) + '</button>' +
      '</div>'
    );
  }

  /* ───────────── Piezas reutilizables ───────────── */

  function barra(p, color) {
    const a = p.total ? p.tengo / p.total * 100 : 0;
    const b = p.total ? p.elegido / p.total * 100 : 0;
    return '<div class="barra" style="--c:' + color + '" role="img" aria-label="' + p.tengo + ' de ' + p.total + ' conseguidos, ' + p.elegido + ' elegidos">' +
      '<span class="seg tengo" style="width:' + a + '%"></span><span class="seg elegido" style="width:' + b + '%"></span></div>';
  }

  function filaItem(it, conCategoria) {
    const hecha = estadoItem(it) === 'conseguido';
    const cat = categoriaDe(it);
    const cant = parseInt(it.cantidad, 10) || 1;
    const id = esc(it.id);
    return '<li class="fila' + (hecha ? ' hecha' : '') + '">' +
      '<button class="check" type="button" data-accion="alternar" data-id="' + id + '" aria-pressed="' + hecha + '" aria-label="' + (hecha ? 'Desmarcar ' : 'Marcar como conseguido: ') + esc(it.nombre) + '">' + ICONOS.check + '</button>' +
      '<a class="fila-cuerpo" href="#item/' + encodeURIComponent(it.id) + '">' +
        '<span class="fila-nombre">' + esc(it.nombre) + (cant > 1 ? ' <span class="cantidad">×' + cant + '</span>' : '') + '</span>' +
        '<span class="fila-meta"><i class="punto" style="--c:' + colorCat(cat) + '"></i>' + (conCategoria ? esc(cat) + '. ' : '') + esc(textoEstado(it)) + '</span>' +
      '</a>' +
      (it.responsable ? '<span class="avatar" title="Se encarga ' + esc(it.responsable) + '">' + esc(inicial(it.responsable)) + '</span>' : '') +
    '</li>';
  }

  function segmentado(accion, opciones, actual) {
    return '<div class="segmentado" role="group">' + opciones.map(function (o) {
      return '<button type="button" data-accion="' + accion + '" data-valor="' + o[0] + '" aria-pressed="' + (o[0] === actual) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function botonCerrar() { return '<button class="btn texto" type="button" data-accion="cerrar-hoja">Cerrar</button>'; }

  // etiqueta y ayuda son textos fijos del código (no datos de la planilla)
  function campo(etiqueta, control, ayuda) {
    return '<label class="campo"><span class="etiqueta">' + etiqueta + '</span>' + control + (ayuda ? '<span class="ayuda">' + ayuda + '</span>' : '') + '</label>';
  }

  function chips(nombre, opciones, valor) {
    return '<div class="chips">' + opciones.map(function (o) {
      return '<label class="chip"><input type="radio" name="' + nombre + '" value="' + esc(o[0]) + '"' + (o[0] === valor ? ' checked' : '') + '><span>' + esc(o[1]) + '</span></label>';
    }).join('') + '</div>';
  }

  function grupoChips(etiqueta, nombre, opciones, valor) {
    return '<fieldset class="campo"><legend class="etiqueta">' + etiqueta + '</legend>' + chips(nombre, opciones, valor) + '</fieldset>';
  }

  function interruptor(etiqueta, nombre, encendido) {
    return '<label class="interruptor"><span>' + etiqueta + '</span><input type="checkbox" name="' + nombre + '"' + (encendido ? ' checked' : '') + '></label>';
  }

  /* ───────────── Inicio: ¿Cómo vamos? ───────────── */

  function bloqueCuenta() {
    const parto = parseFecha(app.config.fecha_parto);
    if (!parto) return '';
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const dias = Math.round((parto - hoy) / 86400000);
    const semanas = Math.max(0, Math.min(42, Math.floor((280 - dias) / 7)));
    let frase;
    if (dias > 1) frase = 'Faltan ' + dias + ' días para el ' + fechaLarga(app.config.fecha_parto) + '.';
    else if (dias === 1) frase = 'Falta un día.';
    else if (dias === 0) frase = 'Hoy es la fecha probable de parto.';
    else frase = 'Ya pasó la fecha probable de parto.';
    const extra = dias >= 0 && dias <= 280 ? '<span>Van ' + semanas + ' semanas de 40.</span>' : '';
    return '<p class="cuenta">' + frase + extra + '</p>';
  }

  function mantita(items) {
    const cats = categorias();
    const orden = items.slice().sort(function (a, b) {
      return ORDEN_MANTITA[estadoItem(a)] - ORDEN_MANTITA[estadoItem(b)]
        || cats.indexOf(categoriaDe(a)) - cats.indexOf(categoriaDe(b))
        || texto(a.nombre).localeCompare(texto(b.nombre), 'es');
    });
    const tam = items.length <= 24 ? ' grande' : (items.length <= 70 ? ' media' : '');
    const animar = !app.mantitaAnimada;
    app.mantitaAnimada = true;
    const parches = orden.map(function (it, i) {
      const e = estadoItem(it);
      const clase = e === 'conseguido' || e === 'elegido' ? e : 'pendiente';
      const etiqueta = it.nombre + ': ' + (e === 'conseguido' ? 'lo tenemos' : e === 'elegido' ? 'elegido' : 'falta');
      return '<a class="parche ' + clase + '" href="#item/' + encodeURIComponent(it.id) + '" style="--c:' + colorCat(categoriaDe(it)) + ';--i:' + Math.min(i, 120) + '" aria-label="' + esc(etiqueta) + '"></a>';
    }).join('');
    return '<div class="mantita' + tam + (animar ? ' animar' : '') + '">' + parches + '</div>' +
      '<div class="leyenda" aria-hidden="true"><span><i class="muestra conseguido"></i>Lo tenemos</span><span><i class="muestra elegido"></i>Elegido</span><span><i class="muestra falta"></i>Falta</span></div>';
  }

  function vistaInicio() {
    const items = itemsActivos();
    const yo = personas()[yoIndice() - 1];
    const cabecera = '<header class="cabecera"><div><p class="saludo">Hola, ' + esc(yo) + '</p><h1>¿Cómo vamos?</h1></div>' +
      '<button class="icono-btn" type="button" data-accion="ajustes" aria-label="Ajustes">' + ICONOS.ajustes + '</button></header>';
    const cuenta = bloqueCuenta();

    if (!items.length) {
      return cabecera + cuenta + '<div class="vacio"><p>Todavía no cargamos nada. Empecemos por lo primero que se te ocurra.</p>' +
        '<button class="btn primario" type="button" data-accion="nuevo-item">Agregar algo</button></div>';
    }

    const p = progreso(items);
    const antes = progreso(items.filter(function (it) { return it.urgencia === URGENCIAS[0]; }));
    const resumen = '<div class="resumen">' +
      '<p class="pct"><strong>' + p.pct + '%</strong> resuelto</p>' +
      '<p>Ya tenemos ' + p.tengo + ' de ' + p.total + ' ' + plural(p.total, 'cosa', 'cosas') + (p.elegido ? ' y elegimos ' + p.elegido + ' más' : '') + '.</p>' +
      (antes.total ? '<div class="barra-titulo"><span>Antes de que nazca</span><span>' + antes.tengo + ' de ' + antes.total + '</span></div>' + barra(antes, 'var(--acento)') : '') +
    '</div>';

    const proximos = items.filter(function (it) {
      return it.urgencia !== URGENCIAS[2] && ORDEN_PROXIMO[estadoItem(it)] !== undefined;
    }).sort(function (a, b) {
      return rankUrg(a) - rankUrg(b)
        || ORDEN_PROXIMO[estadoItem(a)] - ORDEN_PROXIMO[estadoItem(b)]
        || texto(a.nombre).localeCompare(texto(b.nombre), 'es');
    }).slice(0, 4);

    const bloqueProximos = '<section><h2>Lo próximo</h2>' + (proximos.length
      ? '<ul class="lista">' + proximos.map(function (it) { return filaItem(it, true); }).join('') + '</ul>'
      : '<p class="nota">No queda nada urgente sin resolver.</p>') + '</section>';

    const porAgradecer = items.filter(function (it) {
      return estadoItem(it) === 'conseguido' && it.conseguido_tipo === 'regalo' && !si(it.agradecido);
    }).length;
    const aviso = porAgradecer
      ? '<a class="aviso" href="#plata">' + (porAgradecer === 1 ? 'Hay un regalo' : 'Hay ' + porAgradecer + ' regalos') + ' por agradecer</a>'
      : '';

    const porCategoria = agrupar(items, 'categoria').map(function (par) {
      const pc = progreso(par[1]);
      const color = colorCat(par[0]);
      return '<li><div class="barra-titulo"><span><i class="punto" style="--c:' + color + '"></i>' + esc(par[0]) + '</span><span>' + pc.tengo + ' de ' + pc.total + '</span></div>' + barra(pc, color) + '</li>';
    }).join('');

    return cabecera + cuenta + mantita(items) + resumen + bloqueProximos + aviso +
      '<section><h2>Por categoría</h2><ul class="lista-plana">' + porCategoria + '</ul></section>';
  }

  /* ───────────── Lista ───────────── */

  function vistaLista() {
    const modo = leerLS(LS.modo) === 'urgencia' ? 'urgencia' : 'categoria';
    const guardado = leerLS(LS.filtro);
    const filtro = ['falta', 'conseguidos', 'todo'].indexOf(guardado) !== -1 ? guardado : 'falta';
    const activos = itemsActivos();
    const pasa = function (it) {
      const e = estadoItem(it);
      if (filtro === 'todo') return true;
      return filtro === 'conseguidos' ? e === 'conseguido' : e !== 'conseguido';
    };

    let cuerpo = '';
    agrupar(activos, modo).forEach(function (par) {
      const visibles = par[1].filter(pasa).sort(ordenarFilas);
      if (!visibles.length) return;
      const pc = progreso(par[1]);
      const punto = modo === 'categoria' ? '<i class="punto" style="--c:' + colorCat(par[0]) + '"></i>' : '';
      cuerpo += '<section class="grupo"><h2 class="grupo-titulo">' + punto + esc(par[0]) + '<span>' + pc.tengo + ' de ' + pc.total + '</span></h2>' +
        '<ul class="lista">' + visibles.map(function (it) { return filaItem(it, modo === 'urgencia'); }).join('') + '</ul></section>';
    });

    if (!activos.length) {
      cuerpo = '<div class="vacio"><p>La lista está vacía. Agreguen lo primero que se les ocurra; después se ordena solo.</p></div>';
    } else if (!cuerpo) {
      cuerpo = filtro === 'falta'
        ? '<p class="nota">No falta nada: todo lo de la lista está conseguido.</p>'
        : '<p class="nota">Todavía no conseguimos nada de la lista.</p>';
    }

    return '<header class="cabecera"><h1>Lista</h1></header>' +
      '<div class="controles">' +
        segmentado('modo', [['categoria', 'Por categoría'], ['urgencia', 'Por urgencia']], modo) +
        segmentado('filtro', [['falta', 'Falta'], ['conseguidos', 'Conseguido'], ['todo', 'Todo']], filtro) +
      '</div>' + cuerpo +
      '<button class="fab" type="button" data-accion="nuevo-item">' + ICONOS.mas + '<span>Agregar</span></button>';
  }

  /* ───────────── Detalle del ítem y comparador ───────────── */

  function vistaItem(id) {
    const volver = '<a class="volver" href="#lista" data-accion="volver">' + ICONOS.atras + 'Volver</a>';
    const it = buscarItem(id);
    if (!it) return '<header class="cabecera fina">' + volver + '</header><p class="nota">Este ítem ya no existe.</p>';

    const e = estadoItem(it);
    const cat = categoriaDe(it);
    const el = elegidaDe(it.id);
    const cant = parseInt(it.cantidad, 10) || 1;
    const visibles = opcionesDe(it.id).filter(function (o) { return estadoOpcion(o) !== 'descartada'; }).sort(function (a, b) {
      const ea = estadoOpcion(a) === 'elegida' ? 0 : 1;
      const eb = estadoOpcion(b) === 'elegida' ? 0 : 1;
      return ea - eb || (num(a.precio) || 1e12) - (num(b.precio) || 1e12);
    });
    const nDesc = descartadasDe(it.id).length;

    const datos = '<span class="dato"><i class="punto" style="--c:' + colorCat(cat) + '"></i>' + esc(cat) + '</span>' +
      '<span class="dato">' + esc(urgenciaDe(it)) + '</span>' +
      (it.responsable ? '<span class="dato">Se encarga ' + esc(it.responsable) + '</span>' : '') +
      (cant > 1 ? '<span class="dato">' + cant + ' unidades</span>' : '');

    const comparador = (visibles.length || e !== 'conseguido')
      ? '<section class="comparador"><div class="seccion-titulo"><h2>Opciones</h2>' +
          (nDesc ? '<a href="#archivo">' + nDesc + ' ' + plural(nDesc, 'descartada', 'descartadas') + '</a>' : '') + '</div>' +
          '<div class="tarjetas" data-scroll-id="ops-' + esc(it.id) + '">' +
            visibles.map(function (o) { return tarjetaOpcion(o, visibles); }).join('') +
            '<button class="tarjeta-nueva" type="button" data-accion="nueva-opcion" data-id="' + esc(it.id) + '">' + ICONOS.mas + '<span>Agregar opción</span></button>' +
          '</div></section>'
      : '';

    return '<header class="cabecera fina">' + volver +
        '<button class="btn chico" type="button" data-accion="editar-item" data-id="' + esc(it.id) + '">Editar</button></header>' +
      '<h1 class="item-titulo">' + esc(it.nombre) + '</h1>' +
      '<div class="datos">' + datos + '</div>' +
      bloqueEstado(it, e, el) + comparador +
      (it.notas ? '<section><h2>Notas</h2><p class="notas">' + esc(it.notas) + '</p></section>' : '');
  }

  function bloqueEstado(it, e, el) {
    const id = esc(it.id);
    if (e === 'no_necesario') {
      return '<div class="estado"><p>Lo marcamos como que no lo necesitamos.</p>' +
        '<button class="btn secundario" type="button" data-accion="necesario" data-id="' + id + '">Volver a la lista</button></div>';
    }
    if (e === 'conseguido') {
      const tipo = it.conseguido_tipo;
      const cuando = it.conseguido_fecha ? ' el ' + fechaCorta(it.conseguido_fecha) : '';
      let frase;
      if (tipo === 'regalo') frase = 'Nos lo regaló ' + (it.de_quien ? esc(it.de_quien) : 'alguien') + cuando + '.';
      else if (tipo === 'prestado') frase = it.de_quien ? 'Nos lo prestó ' + esc(it.de_quien) + '.' : 'Ya lo teníamos.';
      else {
        const p = num(it.precio_final) || (el ? num(el.precio) : 0);
        frase = 'Lo compramos' + cuando + (it.donde ? ' en ' + esc(it.donde) : '') + (p ? ' por ' + precio(p) : '') + '.';
      }
      const agradecer = tipo === 'regalo'
        ? '<button class="toggle" type="button" data-accion="agradecido" data-id="' + id + '" aria-pressed="' + si(it.agradecido) + '">' + ICONOS.check + '<span>Ya agradecimos</span></button>'
        : '';
      return '<div class="estado hecho"><p><span class="sello">' + ICONOS.check + '</span><span>' + frase + '</span></p>' + agradecer +
        '<div class="estado-acciones"><button class="btn secundario" type="button" data-accion="conseguido" data-id="' + id + '">Editar</button>' +
        '<button class="btn texto" type="button" data-accion="desmarcar" data-id="' + id + '">Desmarcar</button></div></div>';
    }
    let frase;
    if (e === 'elegido') {
      const p = num(el.precio);
      frase = 'Elegimos ' + esc(el.nombre || 'una opción') + (p ? ' (' + precio(p) + ')' : '') + '. Falta conseguirlo.';
    } else if (e === 'comparando') {
      const n = activasDe(it.id).length;
      frase = n === 1 ? 'Hay una opción cargada.' : 'Estamos comparando ' + n + ' opciones.';
    } else {
      frase = 'Todavía no cargamos opciones.';
    }
    return '<div class="estado"><p>' + frase + '</p>' +
      '<button class="btn primario ancho" type="button" data-accion="conseguido" data-id="' + id + '">Ya lo tenemos</button></div>';
  }

  function tarjetaOpcion(o, todas) {
    const elegida = estadoOpcion(o) === 'elegida';
    const p = num(o.precio);
    const conPrecio = todas.map(function (x) { return num(x.precio); }).filter(function (x) { return x > 0; });
    const barata = p > 0 && conPrecio.length > 1 && p === Math.min.apply(null, conPrecio);
    const f1 = si(o.fav_1);
    const f2 = si(o.fav_2);
    const nombres = personas();
    const yo = yoIndice();
    const id = esc(o.id);

    function corazon(k, nombre, on) {
      if (k === yo) {
        return '<button class="corazon' + (on ? ' on' : '') + '" type="button" data-accion="fav" data-id="' + id + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Sacar de mis favoritas' : 'Marcar como favorita') + '">' + ICONOS.corazon + '<span>' + esc(nombre) + '</span></button>';
      }
      return '<span class="corazon ajeno' + (on ? ' on' : '') + '" role="img" aria-label="' + esc(nombre) + (on ? ' la marcó como favorita' : ' todavía no la marcó') + '">' + ICONOS.corazon + '<span>' + esc(nombre) + '</span></span>';
    }

    const pros = lineas(o.pros);
    const contras = lineas(o.contras);
    const link = hrefSeguro(o.link);
    const insignias = (barata ? '<span>La más barata</span>' : '') + (f1 && f2 ? '<span>Favorita de los dos</span>' : '');

    return '<article class="tarjeta' + (elegida ? ' elegida' : '') + '">' +
      (elegida ? '<p class="marca">La elegimos</p>' : '') +
      '<p class="op-tienda">' + esc(o.tienda || dominio(o.link) || 'Sin tienda') + '</p>' +
      '<h3 class="op-nombre">' + esc(o.nombre || 'Sin nombre') + '</h3>' +
      '<p class="op-precio">' + (p ? precio(p) : 'Sin precio') + '</p>' +
      (insignias ? '<div class="insignias">' + insignias + '</div>' : '') +
      '<div class="corazones">' + corazon(1, nombres[0], f1) + corazon(2, nombres[1], f2) + '</div>' +
      (pros.length ? '<ul class="pros" aria-label="A favor">' + pros.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      (contras.length ? '<ul class="contras" aria-label="En contra">' + contras.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
      (o.notas ? '<p class="op-notas">' + esc(o.notas) + '</p>' : '') +
      '<div class="op-acciones">' +
        (elegida
          ? '<button class="btn secundario" type="button" data-accion="recomparar" data-id="' + esc(o.item_id) + '">Volver a comparar</button>'
          : '<button class="btn primario" type="button" data-accion="elegir" data-id="' + id + '">Elegir esta</button>') +
        '<div class="op-secundarias">' +
          (link ? '<a class="btn texto" href="' + esc(link) + '" target="_blank" rel="noopener">Ver en la tienda</a>' : '<span></span>') +
          '<button class="btn texto" type="button" data-accion="editar-opcion" data-id="' + id + '">Editar</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  /* ───────────── Plata ───────────── */

  function vistaPlata() {
    const items = itemsActivos();
    const c = cuentas(items);
    const previsto = c.gastado + c.comprometido + c.falta;
    const partes = [['gastado', 'Gastado', c.gastado], ['comprometido', 'Elegido, falta comprar', c.comprometido], ['falta', 'Estimado de lo que falta', c.falta]];

    const barraTotal = previsto
      ? '<div class="barra-plata" role="img" aria-label="Gastado ' + total(c.gastado) + ', elegido ' + total(c.comprometido) + ', falta ' + total(c.falta) + '">' +
          partes.map(function (x) { return '<span class="seg ' + x[0] + '" style="width:' + (x[2] / previsto * 100) + '%"></span>'; }).join('') + '</div>'
      : '';
    const montos = '<dl class="montos">' + partes.map(function (x) {
      return '<div><dt><i class="muestra m-' + x[0] + '"></i>' + x[1] + '</dt><dd>' + total(x[2]) + '</dd></div>';
    }).join('') + '</dl>';

    const notas = [];
    if (c.sinEstimar) notas.push(c.sinEstimar + ' ' + plural(c.sinEstimar, 'cosa no tiene', 'cosas no tienen') + ' precio todavía y no ' + plural(c.sinEstimar, 'entra', 'entran') + ' en el estimado.');
    if (c.sinPrecio) notas.push(c.sinPrecio + ' ' + plural(c.sinPrecio, 'compra no tiene', 'compras no tienen') + ' el precio cargado.');

    const grupos = agrupar(items, 'categoria').map(function (par) { return [par[0], cuentas(par[1])]; })
      .filter(function (par) { return par[1].gastado + par[1].comprometido + par[1].falta > 0; });
    const maximo = Math.max.apply(null, [1].concat(grupos.map(function (par) { return par[1].gastado + par[1].comprometido + par[1].falta; })));
    const filas = grupos.map(function (par) {
      const k = par[1];
      const t = k.gastado + k.comprometido + k.falta;
      return '<li class="cat-plata"><div class="barra-titulo"><span><i class="punto" style="--c:' + colorCat(par[0]) + '"></i>' + esc(par[0]) + '</span><span>' + total(t) + '</span></div>' +
        '<div class="barra-plata chica" style="width:' + (t / maximo * 100) + '%">' +
          ['gastado', 'comprometido', 'falta'].map(function (x) { return '<span class="seg ' + x + '" style="width:' + (k[x] / t * 100) + '%"></span>'; }).join('') +
        '</div></li>';
    }).join('');

    const regalos = items.filter(function (it) { return estadoItem(it) === 'conseguido' && it.conseguido_tipo === 'regalo'; })
      .sort(function (a, b) { return String(b.conseguido_fecha || '').localeCompare(String(a.conseguido_fecha || '')); });

    return '<header class="cabecera"><h1>Plata</h1></header>' +
      '<section class="total-plata"><p class="monto-grande">' + total(previsto) + '</p><p class="nota">Previsto en total, sumando lo gastado, lo elegido y lo que falta.</p>' + barraTotal + montos +
        notas.map(function (n) { return '<p class="nota">' + n + '</p>'; }).join('') + '</section>' +
      (filas ? '<section><h2>Por categoría</h2><ul class="lista-plana">' + filas + '</ul></section>' : '') +
      '<section><h2>Regalos</h2>' + (regalos.length
        ? '<p>Llegaron ' + total(c.regalos) + ' en regalos.</p><ul class="lista">' + regalos.map(filaRegalo).join('') + '</ul>'
        : '<p class="nota">Cuando marquen algo como regalo, aparece acá con un check para acordarse de agradecer.</p>') +
      '</section>';
  }

  function filaRegalo(it) {
    const el = elegidaDe(it.id);
    const v = num(it.valor_regalo) || (el ? num(el.precio) : 0);
    const ok = si(it.agradecido);
    return '<li class="fila">' +
      '<button class="check' + (ok ? ' on' : '') + '" type="button" data-accion="agradecido" data-id="' + esc(it.id) + '" aria-pressed="' + ok + '" aria-label="Ya agradecimos: ' + esc(it.nombre) + '">' + ICONOS.check + '</button>' +
      '<a class="fila-cuerpo" href="#item/' + encodeURIComponent(it.id) + '"><span class="fila-nombre">' + esc(it.nombre) + '</span>' +
        '<span class="fila-meta">' + esc(it.de_quien ? 'De ' + it.de_quien : 'Regalo') + (v ? ', ' + precio(v) : '') + '. ' + (ok ? 'Ya agradecimos.' : 'Falta agradecer.') + '</span></a>' +
    '</li>';
  }

  /* ───────────── Archivo ───────────── */

  function vistaArchivo() {
    const descartadas = app.opciones.filter(function (o) { return estadoOpcion(o) === 'descartada'; });
    const noNecesarios = app.items.filter(function (it) { return si(it.no_necesario); });
    let html = '<header class="cabecera"><h1>Archivo</h1></header>';

    if (!descartadas.length && !noNecesarios.length) {
      return html + '<p class="nota">Acá van a aparecer las opciones que quedan afuera cuando eligen otra, y las cosas que decidan que no necesitan.</p>';
    }

    if (descartadas.length) {
      const porItem = new Map();
      descartadas.forEach(function (o) {
        if (!porItem.has(o.item_id)) porItem.set(o.item_id, []);
        porItem.get(o.item_id).push(o);
      });
      html += '<section><h2>Opciones descartadas</h2>';
      porItem.forEach(function (ops, itemId) {
        const it = buscarItem(itemId);
        html += '<div class="grupo-archivo"><a class="grupo-titulo" href="#item/' + encodeURIComponent(itemId) + '">' + esc(it ? it.nombre : 'Ítem borrado') + '</a><ul class="lista">' +
          ops.map(function (o) {
            const p = num(o.precio);
            const link = hrefSeguro(o.link);
            return '<li class="fila"><div class="fila-cuerpo"><span class="fila-nombre">' + esc(o.nombre || 'Sin nombre') + '</span>' +
              '<span class="fila-meta">' + esc(o.tienda || dominio(o.link) || 'Sin tienda') + (p ? ', ' + precio(p) : '') +
              (link ? '. <a href="' + esc(link) + '" target="_blank" rel="noopener">Ver</a>' : '') + '</span></div>' +
              '<button class="btn chico" type="button" data-accion="recuperar" data-id="' + esc(o.id) + '">Recuperar</button></li>';
          }).join('') + '</ul></div>';
      });
      html += '</section>';
    }

    if (noNecesarios.length) {
      html += '<section><h2>Cosas que no necesitamos</h2><ul class="lista">' + noNecesarios.map(function (it) {
        return '<li class="fila"><a class="fila-cuerpo" href="#item/' + encodeURIComponent(it.id) + '"><span class="fila-nombre">' + esc(it.nombre) + '</span>' +
          '<span class="fila-meta">' + esc(categoriaDe(it)) + '</span></a>' +
          '<button class="btn chico" type="button" data-accion="necesario" data-id="' + esc(it.id) + '">Volver a la lista</button></li>';
      }).join('') + '</ul></section>';
    }
    return html;
  }

  /* ───────────── Hojas (formularios) ───────────── */

  function abrirHoja(html, alAbrir) {
    const capa = $('#capa');
    capa.innerHTML = '<div class="fondo" data-accion="cerrar-hoja"></div><div class="hoja" role="dialog" aria-modal="true">' + html + '</div>';
    capa.hidden = false;
    document.body.classList.add('con-hoja');
    const hoja = $('.hoja', capa);
    if (alAbrir) alAbrir(hoja);
    requestAnimationFrame(function () { capa.classList.add('abierta'); });
  }

  function cerrarHoja() {
    const capa = $('#capa');
    if (!capa || capa.hidden) return;
    capa.classList.remove('abierta');
    capa.hidden = true;
    capa.innerHTML = '';
    document.body.classList.remove('con-hoja');
  }

  function abrirHojaItem(it) {
    const nuevo = !it;
    const v = it || { nombre: '', categoria: app.ultimo.categoria, urgencia: app.ultimo.urgencia, responsable: app.ultimo.responsable, cantidad: '1', presupuesto: '', notas: '' };
    const n = personas();
    const html = '<form class="form" data-form="item"' + (nuevo ? '' : ' data-id="' + esc(it.id) + '"') + ' autocomplete="off">' +
      '<div class="hoja-cabecera"><h2>' + (nuevo ? 'Agregar algo' : 'Editar') + '</h2>' + botonCerrar() + '</div>' +
      campo('¿Qué necesitamos?', '<input name="nombre" required maxlength="120" value="' + esc(v.nombre) + '" placeholder="Ej: cochecito, bodies, termómetro">') +
      '<fieldset class="campo"><legend class="etiqueta">Categoría</legend>' +
        chips('categoria', categorias().map(function (c) { return [c, c]; }), v.categoria) +
        '<input class="mt" name="categoria_nueva" maxlength="40" placeholder="O escribí una categoría nueva">' +
      '</fieldset>' +
      grupoChips('¿Para cuándo?', 'urgencia', URGENCIAS.map(function (u) { return [u, u]; }), v.urgencia) +
      grupoChips('¿Quién se encarga?', 'responsable', [['', 'Sin asignar'], [n[0], n[0]], [n[1], n[1]]], v.responsable || '') +
      '<div class="campo"><span class="etiqueta">Cantidad</span><div class="stepper">' +
        '<button type="button" data-accion="paso" data-delta="-1" aria-label="Menos">−</button>' +
        '<input name="cantidad" type="number" inputmode="numeric" min="1" value="' + esc(v.cantidad || '1') + '" aria-label="Cantidad">' +
        '<button type="button" data-accion="paso" data-delta="1" aria-label="Más">+</button>' +
      '</div></div>' +
      '<details class="mas"' + (v.presupuesto || v.notas ? ' open' : '') + '><summary>Más detalles</summary>' +
        campo('Presupuesto aproximado (USD)', '<input name="presupuesto" inputmode="decimal" value="' + esc(v.presupuesto || '') + '" placeholder="Opcional">', 'Sirve para estimar cuánto falta gastar mientras no haya opciones cargadas.') +
        campo('Notas', '<textarea name="notas" rows="3">' + esc(v.notas || '') + '</textarea>') +
      '</details>' +
      (nuevo ? '' : interruptor('No lo necesitamos', 'no_necesario', si(it.no_necesario))) +
      '<div class="form-acciones">' +
        (nuevo
          ? '<button class="btn secundario" type="submit" name="seguir" value="1">Agregar y seguir</button>'
          : '<button class="btn peligro" type="button" data-accion="borrar-item" data-id="' + esc(it.id) + '">Borrar</button>') +
        '<button class="btn primario" type="submit">' + (nuevo ? 'Agregar' : 'Guardar') + '</button>' +
      '</div></form>';
    abrirHoja(html, function (h) { if (nuevo) $('input[name="nombre"]', h).focus(); });
  }

  function guardarItem(f, boton) {
    const fd = new FormData(f);
    const nombre = texto(fd.get('nombre'));
    if (!nombre) return;
    const editando = f.dataset.id;
    const categoria = texto(fd.get('categoria_nueva')) || texto(fd.get('categoria'));
    const fila = {
      id: editando || nuevoId(),
      nombre: nombre,
      categoria: categoria,
      urgencia: texto(fd.get('urgencia')),
      responsable: texto(fd.get('responsable')),
      cantidad: String(Math.max(1, parseInt(fd.get('cantidad'), 10) || 1)),
      presupuesto: limpiarPrecio(fd.get('presupuesto')),
      notas: texto(fd.get('notas'))
    };
    const antes = editando ? buscarItem(editando) : null;
    const eraNoNecesario = antes ? si(antes.no_necesario) : false;
    if (editando) fila.no_necesario = fd.get('no_necesario') ? 'sí' : '';

    const cambios = [g('Items', fila)];
    const cats = categoriasConfig();
    if (categoria && cats.indexOf(categoria) === -1) {
      cambios.push(g('Config', { clave: 'categorias', valor: cats.concat(categoria).join(', ') }));
    }
    app.ultimo = { categoria: categoria, urgencia: fila.urgencia, responsable: fila.responsable };
    cambiar(cambios);

    if (!editando && boton && boton.name === 'seguir') {
      abrirHojaItem(null);
      toast('Agregamos “' + nombre + '”');
      return;
    }
    cerrarHoja();
    if (!editando) toast('Agregamos “' + nombre + '”');
    else if (fila.no_necesario && !eraNoNecesario) toast('Lo pasamos al archivo');
    else toast('Guardado');
  }

  function abrirHojaOpcion(o, itemId) {
    const nueva = !o;
    const v = o || { item_id: itemId };
    const it = buscarItem(v.item_id);
    const html = '<form class="form" data-form="opcion" data-item="' + esc(v.item_id) + '"' + (nueva ? '' : ' data-id="' + esc(o.id) + '"') + ' autocomplete="off">' +
      '<div class="hoja-cabecera"><h2>' + (nueva ? 'Agregar opción' : 'Editar opción') + '</h2>' + botonCerrar() + '</div>' +
      (it ? '<p class="hoja-sub">Para: ' + esc(it.nombre) + '</p>' : '') +
      campo('Modelo o nombre', '<input name="nombre" maxlength="120" value="' + esc(v.nombre || '') + '" placeholder="Ej: Chicco Bravo">') +
      campo('Link', '<input name="link" inputmode="url" autocapitalize="off" value="' + esc(v.link || '') + '" placeholder="Pegá el link del producto">') +
      '<div class="campo-doble">' +
        campo('Tienda', '<input name="tienda" maxlength="60" value="' + esc(v.tienda || '') + '" placeholder="Sale del link">') +
        campo('Precio (USD)', '<input name="precio" inputmode="decimal" value="' + esc(v.precio || '') + '" placeholder="0">') +
      '</div>' +
      campo('A favor', '<textarea name="pros" rows="3" placeholder="Una cosa por línea">' + esc(v.pros || '') + '</textarea>') +
      campo('En contra', '<textarea name="contras" rows="3" placeholder="Una cosa por línea">' + esc(v.contras || '') + '</textarea>') +
      campo('Notas', '<textarea name="notas" rows="2">' + esc(v.notas || '') + '</textarea>') +
      '<div class="form-acciones">' +
        (nueva ? '' :
          '<button class="btn peligro" type="button" data-accion="borrar-opcion" data-id="' + esc(o.id) + '">Borrar</button>' +
          (estadoOpcion(o) === 'activa' ? '<button class="btn secundario" type="button" data-accion="descartar-opcion" data-id="' + esc(o.id) + '">Descartar</button>' : '')) +
        '<button class="btn primario" type="submit">' + (nueva ? 'Agregar' : 'Guardar') + '</button>' +
      '</div></form>';
    abrirHoja(html, function (h) { if (nueva) $('input[name="nombre"]', h).focus(); });
  }

  function guardarOpcion(f) {
    const fd = new FormData(f);
    const link = normalizarLink(fd.get('link'));
    const fila = {
      id: f.dataset.id || nuevoId(),
      item_id: f.dataset.item,
      nombre: texto(fd.get('nombre')),
      tienda: texto(fd.get('tienda')) || dominio(link),
      link: link,
      precio: limpiarPrecio(fd.get('precio')),
      moneda: 'USD',
      pros: texto(fd.get('pros')),
      contras: texto(fd.get('contras')),
      notas: texto(fd.get('notas'))
    };
    if (!fila.nombre && !fila.link) { toast('Cargá al menos el nombre o el link.'); return; }
    if (!f.dataset.id) fila.estado = 'activa';
    cambiar([g('Opciones', fila)]);
    cerrarHoja();
    toast(f.dataset.id ? 'Guardado' : 'Agregamos la opción');
  }

  function abrirHojaConseguido(id) {
    const it = buscarItem(id);
    if (!it) return;
    const el = elegidaDe(id);
    const tipo = it.conseguido_tipo === 'regalo' || it.conseguido_tipo === 'prestado' ? it.conseguido_tipo : 'compra';
    const ya = estadoItem(it) === 'conseguido';
    const html = '<form class="form" data-form="conseguido" data-id="' + esc(id) + '" data-tipo="' + tipo + '" autocomplete="off">' +
      '<div class="hoja-cabecera"><h2>Ya lo tenemos</h2>' + botonCerrar() + '</div>' +
      '<p class="hoja-sub">' + esc(it.nombre) + '</p>' +
      grupoChips('¿Cómo lo conseguimos?', 'conseguido_tipo', [['compra', 'Lo compramos'], ['regalo', 'Nos lo regalaron'], ['prestado', 'Prestado o ya lo teníamos']], tipo) +
      campo('Fecha', '<input name="conseguido_fecha" type="date" value="' + esc(it.conseguido_fecha || hoyISO()) + '">') +
      '<div class="solo-compra">' +
        campo('¿Dónde?', '<input name="donde" maxlength="60" value="' + esc(it.donde || (el ? el.tienda : '')) + '">') +
        campo('Precio final (USD)', '<input name="precio_final" inputmode="decimal" value="' + esc(it.precio_final || (el ? el.precio : '')) + '">') +
      '</div>' +
      '<div class="solo-regalo solo-prestado">' +
        campo('<span class="t-regalo">¿Quién nos lo regaló?</span><span class="t-prestado">¿Quién nos lo prestó?</span>',
          '<input name="de_quien" maxlength="60" value="' + esc(it.de_quien || '') + '">',
          '<span class="t-prestado">Si ya lo teníamos, dejalo vacío.</span>') +
      '</div>' +
      '<div class="solo-regalo">' +
        campo('Valor aproximado (USD)', '<input name="valor_regalo" inputmode="decimal" value="' + esc(it.valor_regalo || (el ? el.precio : '')) + '">', 'Para sumar cuánto llegó en regalos.') +
        interruptor('Ya agradecimos', 'agradecido', si(it.agradecido)) +
      '</div>' +
      '<div class="form-acciones">' +
        (ya ? '<button class="btn texto" type="button" data-accion="desmarcar" data-id="' + esc(id) + '">Desmarcar</button>' : '') +
        '<button class="btn primario" type="submit">Guardar</button>' +
      '</div></form>';
    abrirHoja(html);
  }

  function guardarConseguido(f) {
    const fd = new FormData(f);
    const tipo = texto(fd.get('conseguido_tipo')) || 'compra';
    const fila = { id: f.dataset.id, conseguido_tipo: tipo, conseguido_fecha: texto(fd.get('conseguido_fecha')) || hoyISO(), donde: '', precio_final: '', de_quien: '', valor_regalo: '', agradecido: '' };
    if (tipo === 'compra') {
      fila.donde = texto(fd.get('donde'));
      fila.precio_final = limpiarPrecio(fd.get('precio_final'));
    } else {
      fila.de_quien = texto(fd.get('de_quien'));
    }
    if (tipo === 'regalo') {
      fila.valor_regalo = limpiarPrecio(fd.get('valor_regalo'));
      fila.agradecido = fd.get('agradecido') ? 'sí' : '';
    }
    cambiar([g('Items', fila)]);
    cerrarHoja();
    toast('Listo, ya lo tenemos');
  }

  function abrirAjustes() {
    const n = personas();
    const html = '<form class="form" data-form="ajustes" autocomplete="off">' +
      '<div class="hoja-cabecera"><h2>Ajustes</h2>' + botonCerrar() + '</div>' +
      campo('Fecha probable de parto', '<input name="fecha_parto" type="date" value="' + esc(app.config.fecha_parto || '') + '">') +
      '<div class="campo-doble">' +
        campo('Nombre 1', '<input name="persona_1" maxlength="30" value="' + esc(app.config.persona_1 || '') + '">') +
        campo('Nombre 2', '<input name="persona_2" maxlength="30" value="' + esc(app.config.persona_2 || '') + '">') +
      '</div>' +
      grupoChips('En este celular soy', 'yo', [['1', n[0]], ['2', n[1]]], String(yoIndice())) +
      campo('Categorías', '<textarea name="categorias" rows="3">' + esc(app.config.categorias || '') + '</textarea>', 'Separadas por comas, en el orden en que quieran verlas.') +
      '<div class="form-acciones"><button class="btn primario" type="submit">Guardar</button></div>' +
      '<div class="ajustes-extra">' +
        '<button class="btn texto" type="button" data-accion="exportar">Copiar todos los datos (para pegarlos en un chat)</button>' +
        '<button class="btn texto" type="button" data-accion="salir">Salir en este celular</button>' +
      '</div></form>';
    abrirHoja(html);
  }

  function guardarAjustes(f) {
    const fd = new FormData(f);
    const nuevos = {
      fecha_parto: texto(fd.get('fecha_parto')),
      persona_1: texto(fd.get('persona_1')),
      persona_2: texto(fd.get('persona_2')),
      categorias: String(fd.get('categorias') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).join(', ')
    };
    const cambios = [];
    // Si cambia un nombre, actualizamos los ítems que tenía asignados
    ['persona_1', 'persona_2'].forEach(function (k) {
      const viejo = app.config[k];
      if (viejo && nuevos[k] && viejo !== nuevos[k]) {
        app.items.forEach(function (it) {
          if (it.responsable === viejo) cambios.push(g('Items', { id: it.id, responsable: nuevos[k] }));
        });
      }
    });
    Object.keys(nuevos).forEach(function (k) {
      const vacioPermitido = k === 'categorias';
      if ((app.config[k] || '') !== nuevos[k] && (nuevos[k] || vacioPermitido)) {
        cambios.push(g('Config', { clave: k, valor: nuevos[k] }));
      }
    });
    const yo = texto(fd.get('yo'));
    if (yo && yo !== app.yo) { app.yo = yo; guardarLS(LS.yo, yo); }
    cerrarHoja();
    if (cambios.length) cambiar(cambios); else render();
    toast('Guardado');
  }

  /* ───────────── Acciones ───────────── */

  function copiaCampos(fila, campos) {
    const c = { id: fila.id };
    campos.forEach(function (k) { c[k] = fila[k] || ''; });
    return c;
  }

  function alternarConseguido(id) {
    const it = buscarItem(id);
    if (!it) return;
    if (estadoItem(it) === 'conseguido') { desmarcar(id); return; }
    const el = elegidaDe(id);
    const antes = copiaCampos(it, CAMPOS_CONSEGUIDO);
    cambiar([g('Items', {
      id: id,
      conseguido_tipo: 'compra',
      conseguido_fecha: hoyISO(),
      donde: it.donde || (el ? el.tienda || '' : ''),
      precio_final: it.precio_final || (el ? el.precio || '' : '')
    })]);
    toast('Marcamos “' + it.nombre + '” como comprado', [
      { texto: 'Editar', fn: function () { abrirHojaConseguido(id); } },
      { texto: 'Deshacer', fn: function () { cambiar([g('Items', antes)]); } }
    ]);
  }

  function desmarcar(id) {
    const it = buscarItem(id);
    if (!it) return;
    const antes = copiaCampos(it, CAMPOS_CONSEGUIDO);
    const vacio = { id: id };
    CAMPOS_CONSEGUIDO.forEach(function (k) { vacio[k] = ''; });
    cambiar([g('Items', vacio)]);
    toast('“' + it.nombre + '” volvió a la lista', [{ texto: 'Deshacer', fn: function () { cambiar([g('Items', antes)]); } }]);
  }

  function elegir(opcionId) {
    const op = buscarOpcion(opcionId);
    if (!op) return;
    const afectadas = opcionesDe(op.item_id).filter(function (o) { return o.id === op.id || estadoOpcion(o) !== 'descartada'; });
    const antes = afectadas.map(function (o) { return g('Opciones', { id: o.id, estado: o.estado || '' }); });
    cambiar(afectadas.map(function (o) { return g('Opciones', { id: o.id, estado: o.id === op.id ? 'elegida' : 'descartada' }); }));
    const otras = afectadas.length - 1;
    const sufijo = otras ? (otras === 1 ? '. La otra pasó al archivo.' : '. Las otras ' + otras + ' pasaron al archivo.') : '.';
    toast('Elegimos ' + (op.nombre || 'esta opción') + sufijo, [{ texto: 'Deshacer', fn: function () { cambiar(antes); } }]);
  }

  function volverAComparar(itemId) {
    const ops = opcionesDe(itemId).filter(function (o) { return estadoOpcion(o) !== 'activa'; });
    cambiar(ops.map(function (o) { return g('Opciones', { id: o.id, estado: 'activa' }); }));
    toast('Todas las opciones volvieron al comparador');
  }

  function alternarFav(opcionId) {
    const o = buscarOpcion(opcionId);
    if (!o) return;
    const k = 'fav_' + yoIndice();
    const fila = { id: o.id };
    fila[k] = si(o[k]) ? '' : 'sí';
    cambiar([g('Opciones', fila)]);
  }

  function alternarAgradecido(id) {
    const it = buscarItem(id);
    if (!it) return;
    cambiar([g('Items', { id: id, agradecido: si(it.agradecido) ? '' : 'sí' })]);
  }

  function borrarItem(id) {
    const it = buscarItem(id);
    if (!it) return;
    if (!window.confirm('¿Borrar “' + it.nombre + '” y sus opciones? No se puede deshacer.')) return;
    const cambios = [borrar('Items', id)].concat(opcionesDe(id).map(function (o) { return borrar('Opciones', o.id); }));
    cerrarHoja();
    if (ruta().vista === 'item') location.hash = app.previa || '#lista';
    cambiar(cambios);
    toast('Borramos “' + it.nombre + '”');
  }

  function borrarOpcion(id) {
    const o = buscarOpcion(id);
    if (!o) return;
    if (!window.confirm('¿Borrar esta opción? No se puede deshacer. Si solo no les convence, usen “Descartar”.')) return;
    cerrarHoja();
    cambiar([borrar('Opciones', id)]);
  }

  async function exportar() {
    const datos = JSON.stringify({ exportado: new Date().toISOString(), config: app.config, items: app.items, opciones: app.opciones });
    try {
      await navigator.clipboard.writeText(datos);
      toast('Copiamos todos los datos. Ya los podés pegar en el chat.');
    } catch (e) {
      abrirHoja('<div class="form"><div class="hoja-cabecera"><h2>Datos</h2>' + botonCerrar() + '</div>' +
        '<p class="hoja-sub">Seleccioná todo el texto y copialo.</p>' +
        '<textarea class="exportado" rows="10" readonly>' + esc(datos) + '</textarea></div>',
        function (h) { const t = $('textarea', h); t.focus(); t.select(); });
    }
  }

  function salir() {
    if (!window.confirm('¿Salir en este celular? Después vas a tener que volver a ingresar el PIN.')) return;
    app.pin = '';
    app.yo = '';
    app.cargado = false;
    app.items = [];
    app.opciones = [];
    app.config = {};
    app.firma = '';
    app.error = '';
    guardarLS(LS.pin, '');
    guardarLS(LS.yo, '');
    cerrarHoja();
    render();
  }

  /* ───────────── Toast ───────────── */

  function toast(mensaje, acciones) {
    acciones = acciones || [];
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(mensaje) + '</span>' + acciones.map(function (a, i) {
      return '<button type="button" data-toast="' + i + '">' + esc(a.texto) + '</button>';
    }).join('');
    t.onclick = function (e) {
      const b = e.target.closest('[data-toast]');
      if (!b) return;
      ocultarToast();
      acciones[+b.dataset.toast].fn();
    };
    t.classList.add('visible');
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(ocultarToast, acciones.length ? 6000 : 3000);
  }

  function ocultarToast() { $('#toast').classList.remove('visible'); }

  /* ───────────── Eventos ───────────── */

  function alClick(e) {
    const el = e.target.closest('[data-accion]');
    if (!el) return;
    const accion = el.dataset.accion;
    const id = el.dataset.id;
    switch (accion) {
      case 'cerrar-hoja': cerrarHoja(); break;
      case 'nuevo-item': abrirHojaItem(null); break;
      case 'editar-item': abrirHojaItem(buscarItem(id)); break;
      case 'borrar-item': borrarItem(id); break;
      case 'alternar': alternarConseguido(id); break;
      case 'conseguido': abrirHojaConseguido(id); break;
      case 'desmarcar': cerrarHoja(); desmarcar(id); break;
      case 'agradecido': alternarAgradecido(id); break;
      case 'necesario': cambiar([g('Items', { id: id, no_necesario: '' })]); toast('Volvió a la lista'); break;
      case 'nueva-opcion': abrirHojaOpcion(null, id); break;
      case 'editar-opcion': abrirHojaOpcion(buscarOpcion(id)); break;
      case 'borrar-opcion': borrarOpcion(id); break;
      case 'descartar-opcion': cerrarHoja(); cambiar([g('Opciones', { id: id, estado: 'descartada' })]); toast('La pasamos al archivo'); break;
      case 'elegir': elegir(id); break;
      case 'recomparar': volverAComparar(id); break;
      case 'recuperar': cambiar([g('Opciones', { id: id, estado: 'activa' })]); toast('Volvió al comparador'); break;
      case 'fav': alternarFav(id); break;
      case 'modo': guardarLS(LS.modo, el.dataset.valor); render(); break;
      case 'filtro': guardarLS(LS.filtro, el.dataset.valor); render(); break;
      case 'ajustes': abrirAjustes(); break;
      case 'exportar': exportar(); break;
      case 'salir': salir(); break;
      case 'reintentar': cargarInicial(); break;
      case 'soy': app.yo = el.dataset.valor; guardarLS(LS.yo, app.yo); render({ arriba: true }); break;
      case 'volver': e.preventDefault(); location.hash = app.previa || '#lista'; break;
      case 'paso': {
        const input = el.parentElement.querySelector('input');
        input.value = Math.max(1, (parseInt(input.value, 10) || 1) + parseInt(el.dataset.delta, 10));
        break;
      }
    }
  }

  function alEnviar(e) {
    const f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    const tipo = f.dataset.form;
    if (tipo === 'pin') {
      const pin = texto(new FormData(f).get('pin'));
      if (!pin) return;
      app.pin = pin;
      app.error = '';
      guardarLS(LS.pin, pin);
      cargarInicial();
    } else if (tipo === 'item') guardarItem(f, e.submitter);
    else if (tipo === 'opcion') guardarOpcion(f);
    else if (tipo === 'conseguido') guardarConseguido(f);
    else if (tipo === 'ajustes') guardarAjustes(f);
  }

  function alCambiar(e) {
    const t = e.target;
    const f = t.closest('form');
    if (!f) return;
    if (t.name === 'conseguido_tipo') f.dataset.tipo = t.value;
    if (t.name === 'categoria') {
      const nueva = f.querySelector('[name="categoria_nueva"]');
      if (nueva) nueva.value = '';
    }
  }

  function alEscribir(e) {
    const t = e.target;
    if (t.name === 'categoria_nueva' && t.value) {
      t.closest('form').querySelectorAll('[name="categoria"]').forEach(function (r) { r.checked = false; });
    }
  }

  function iniciar() {
    document.addEventListener('click', alClick);
    document.addEventListener('submit', alEnviar);
    document.addEventListener('change', alCambiar);
    document.addEventListener('input', alEscribir);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarHoja(); });
    window.addEventListener('hashchange', alCambiarRuta);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(); });
    window.addEventListener('online', function () { procesarCola(); refrescar(); });
    window.addEventListener('beforeunload', function (e) {
      if (app.cola.length) { e.preventDefault(); e.returnValue = ''; }
    });
    setInterval(refrescar, INTERVALO_SYNC);

    if (!apiConfigurada()) renderSinConfig();
    else if (app.pin) cargarInicial();
    else renderPin();
  }

  iniciar();
})();
