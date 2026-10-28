/**
 * Lista del bebé — API sobre Google Sheets
 *
 * 1. Pegá este archivo completo en Extensiones → Apps Script de tu planilla.
 * 2. Ejecutá setup() una vez: crea las pestañas Items, Opciones y Config.
 * 3. Cargá el PIN en Configuración del proyecto → Propiedades del script (clave: PIN).
 *    No pongas el PIN en este archivo: el repo es público.
 * 4. Implementá como aplicación web (Ejecutar como: Yo · Acceso: Cualquier usuario).
 *
 * Todos los valores se guardan como texto. Los "sí/no" se guardan como "sí" o vacío.
 * El estado de cada ítem no se guarda: la web lo calcula a partir de sus datos.
 */

const TABLAS = {
  Items: [
    'id', 'nombre', 'categoria', 'urgencia', 'cantidad', 'responsable', 'presupuesto',
    'no_necesario', 'conseguido_tipo', 'conseguido_fecha', 'donde', 'precio_final',
    'de_quien', 'valor_regalo', 'agradecido', 'notas', 'creado', 'actualizado'
  ],
  Opciones: [
    'id', 'item_id', 'nombre', 'tienda', 'link', 'precio', 'moneda', 'notas',
    'pros', 'contras', 'fav_1', 'fav_2', 'estado', 'creado', 'actualizado'
  ],
  Config: ['clave', 'valor']
};

const CONFIG_INICIAL = [
  ['fecha_parto', '2027-04-01'],
  ['persona_1', 'Nico'],
  ['persona_2', 'Ella'],
  ['categorias', 'Paseo, Dormir, Ropa, Alimentación, Baño e higiene, Salud, Habitación, Bolso del hospital, Para mamá']
];

const COLUMNA_VALIDA = /^[a-z0-9_]+$/;
let libroCache = null;

/* ───────────── Setup: se corre una sola vez desde el editor ───────────── */

function setup() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', libro.getId());

  Object.keys(TABLAS).forEach(function (nombre) {
    const hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
    asegurarColumnas(hoja, TABLAS[nombre]);
    hoja.getRange(1, 1, hoja.getMaxRows(), hoja.getMaxColumns()).setNumberFormat('@');
    hoja.getRange(1, 1, 1, hoja.getLastColumn()).setFontWeight('bold');
    hoja.setFrozenRows(1);
  });

  const config = libro.getSheetByName('Config');
  if (config.getLastRow() < 2) {
    config.getRange(2, 1, CONFIG_INICIAL.length, 2).setValues(CONFIG_INICIAL);
  }

  // Borra la pestaña vacía que trae la planilla por defecto
  libro.getSheets().forEach(function (hoja) {
    if (!TABLAS[hoja.getName()] && hoja.getLastRow() === 0 && libro.getSheets().length > 1) {
      libro.deleteSheet(hoja);
    }
  });
}

/* ───────────── Web app ───────────── */

// Abrir la URL /exec en el navegador sirve para chequear que todo esté bien
function doGet() {
  const libro = abrirLibro();
  return responder({
    ok: true,
    mensaje: 'La API de la lista del bebé está funcionando',
    pestanas: Object.keys(TABLAS).filter(function (n) { return libro.getSheetByName(n); }),
    pin_configurado: Boolean(PropertiesService.getScriptProperties().getProperty('PIN'))
  });
}

// La web manda: { pin, accion: 'leer' }  o  { pin, accion: 'cambios', cambios: [...] }
// Cada cambio: { tipo: 'guardar', tabla, fila: {...} }  o  { tipo: 'borrar', tabla, id }
function doPost(e) {
  try {
    const pedido = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const pin = PropertiesService.getScriptProperties().getProperty('PIN');
    if (!pin || String(pedido.pin || '') !== pin) {
      return responder({ ok: false, error: 'pin_incorrecto' });
    }

    if (pedido.accion === 'leer') {
      return responder(Object.assign({ ok: true }, leerTodo()));
    }

    if (pedido.accion === 'cambios') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        const resultados = (pedido.cambios || []).map(aplicarCambio);
        SpreadsheetApp.flush();
        return responder(Object.assign({ ok: true, resultados: resultados }, leerTodo()));
      } finally {
        lock.releaseLock();
      }
    }

    return responder({ ok: false, error: 'accion_desconocida' });
  } catch (err) {
    return responder({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ───────────── Lectura ───────────── */

function leerTodo() {
  const config = {};
  leerTabla('Config').forEach(function (fila) {
    if (fila.clave) config[fila.clave] = fila.valor;
  });
  return {
    items: leerTabla('Items'),
    opciones: leerTabla('Opciones'),
    config: config
  };
}

function leerTabla(nombre) {
  const datos = obtenerHoja(nombre).getDataRange().getValues();
  if (datos.length < 2) return [];
  const headers = datos[0].map(String);
  return datos.slice(1)
    .filter(function (fila) {
      return fila.some(function (c) { return c !== '' && c !== null; });
    })
    .map(function (fila) {
      const obj = {};
      headers.forEach(function (h, i) { if (h) obj[h] = normalizar(fila[i]); });
      return obj;
    });
}

/* ───────────── Escritura ───────────── */

function aplicarCambio(cambio) {
  if (!cambio || !TABLAS[cambio.tabla]) throw new Error('Tabla inválida: ' + (cambio && cambio.tabla));
  const hoja = obtenerHoja(cambio.tabla);
  if (cambio.tipo === 'guardar') return guardarFila(hoja, cambio.fila || {});
  if (cambio.tipo === 'borrar') return borrarFila(hoja, cambio.id);
  throw new Error('Tipo de cambio inválido: ' + cambio.tipo);
}

// Si la fila existe (mismo id) actualiza solo las columnas que vienen; si no, la agrega.
function guardarFila(hoja, fila) {
  const clave = hoja.getName() === 'Config' ? 'clave' : 'id';
  const conTiempos = clave === 'id';

  if (!fila[clave]) {
    if (!conTiempos) throw new Error('Falta la clave');
    fila[clave] = Utilities.getUuid().slice(0, 8);
  }

  const columnas = Object.keys(fila).filter(function (c) { return COLUMNA_VALIDA.test(c); });
  if (conTiempos) columnas.push('creado', 'actualizado');
  const headers = asegurarColumnas(hoja, columnas);

  const datos = hoja.getDataRange().getValues();
  const colClave = headers.indexOf(clave);
  let nroFila = -1;
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][colClave]) === String(fila[clave])) { nroFila = i + 1; break; }
  }
  const esNueva = nroFila === -1;
  const actual = esNueva ? [] : datos[nroFila - 1];

  if (conTiempos) {
    const ahora = Utilities.formatDate(new Date(), zonaHoraria(), 'yyyy-MM-dd HH:mm');
    fila.actualizado = ahora;
    if (esNueva && !fila.creado) fila.creado = ahora;
  }

  const valores = headers.map(function (h, i) {
    if (Object.prototype.hasOwnProperty.call(fila, h)) return aTexto(fila[h]);
    return esNueva ? '' : normalizar(actual[i]);
  });

  if (esNueva) {
    nroFila = Math.max(hoja.getLastRow(), 1) + 1;
    if (nroFila > hoja.getMaxRows()) hoja.insertRowsAfter(hoja.getMaxRows(), 50);
  }
  hoja.getRange(nroFila, 1, 1, headers.length).setNumberFormat('@').setValues([valores]);
  return { tabla: hoja.getName(), clave: fila[clave], nueva: esNueva };
}

function borrarFila(hoja, id) {
  if (!id) throw new Error('Falta el id');
  const datos = hoja.getDataRange().getValues();
  const col = datos[0].map(String).indexOf(hoja.getName() === 'Config' ? 'clave' : 'id');
  for (let i = datos.length - 1; i >= 1; i--) {
    if (String(datos[i][col]) === String(id)) {
      hoja.deleteRow(i + 1);
      return { tabla: hoja.getName(), clave: id, borrada: true };
    }
  }
  return { tabla: hoja.getName(), clave: id, borrada: false };
}

/* ───────────── Utilidades ───────────── */

// Agrega al final las columnas que falten y devuelve el encabezado completo
function asegurarColumnas(hoja, columnas) {
  const ultimaCol = hoja.getLastColumn();
  let headers = ultimaCol > 0 ? hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(String) : [];
  const faltantes = columnas.filter(function (c, i) {
    return c && headers.indexOf(c) === -1 && columnas.indexOf(c) === i;
  });
  if (faltantes.length) {
    const necesarias = headers.length + faltantes.length;
    if (necesarias > hoja.getMaxColumns()) {
      hoja.insertColumnsAfter(hoja.getMaxColumns(), necesarias - hoja.getMaxColumns());
    }
    hoja.getRange(1, headers.length + 1, 1, faltantes.length)
      .setNumberFormat('@')
      .setValues([faltantes])
      .setFontWeight('bold');
    headers = headers.concat(faltantes);
  }
  return headers;
}

function abrirLibro() {
  if (!libroCache) {
    const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    libroCache = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }
  return libroCache;
}

function obtenerHoja(nombre) {
  const hoja = abrirLibro().getSheetByName(nombre);
  if (!hoja) throw new Error('No existe la pestaña ' + nombre + '. ¿Corriste setup()?');
  return hoja;
}

function zonaHoraria() {
  return abrirLibro().getSpreadsheetTimeZone();
}

function normalizar(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const hora = Utilities.formatDate(v, zonaHoraria(), 'HH:mm');
    return Utilities.formatDate(v, zonaHoraria(), hora === '00:00' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

function aTexto(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v === true) return 'sí';
  return String(v);
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}