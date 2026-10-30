/**
 * Lista del bebé — importar la lista escrita y sumar "dónde se compra", "puede ser regalo" y "repetido"
 *
 * Se usa desde el editor:
 * 1. En Apps Script, al lado de "Archivos" tocá + → Secuencia de comandos, llamala Importar y pegá este archivo entero.
 *    (Si ya existe, reemplazá todo su contenido.)
 * 2. Guardá, elegí importarLista en el selector de funciones (arriba) y tocá Ejecutar.
 * No hace falta volver a implementar: la API no cambia.
 *
 * Si la lista ya estaba importada, importarLista no toca los datos: solo suma las columnas que falten y
 * rehace las pestañas de consulta (lo mismo que actualizarVistas).
 *
 * Qué hace:
 * - Agrega cuatro columnas a Items: comprar_en (Argentina, EEUU online o EEUU local), posible_regalo (sí o vacío),
 *   regala (quién dijo que lo regala) y repetido (el mismo nombre en varios ítems que pueden ser la misma cosa).
 * - Marca lo que vino del registro de Amazon como "EEUU online".
 * - Suma los ítems de la lista escrita (ids lst001 en adelante) y agrega la categoría Otros.
 * - Ordena Items por categoría con los repetidos juntos, y los resalta en amarillo.
 * - Crea dos pestañas de consulta, "Por dónde" y "Regalos", que se actualizan solas.
 */

const COLUMNAS_NUEVAS = ['comprar_en', 'posible_regalo', 'repetido', 'regala'];
const LUGARES_COMPRA = ['Argentina', 'EEUU online', 'EEUU local'];
const CATEGORIA_OTROS = 'Otros';

function importarLista() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const libro = abrirLibro();
    const hoja = obtenerHoja('Items');
    const headers = asegurarColumnas(hoja, TABLAS.Items.concat(COLUMNAS_NUEVAS));
    const col = {};
    headers.forEach(function (h, i) { col[h] = i; });

    const ultima = hoja.getLastRow();
    const filas = (ultima > 1 ? hoja.getRange(2, 1, ultima - 1, headers.length).getValues() : [])
      .map(function (f) { return f.map(normalizar); })
      .filter(function (f) { return f.some(function (c) { return c !== ''; }); });

    // Si ya se importó, no se tocan los datos: correrlo de nuevo podría devolver marcas que sacaron desde la web
    if (filas.some(function (f) { return /^lst\d+$/.test(String(f[col.id])); })) {
      prepararColumnas(hoja, col, headers.length);
      crearVistas(libro, col);
      SpreadsheetApp.flush();
      const aviso = 'La lista ya estaba importada: no toqué los datos, solo actualicé las columnas y las pestañas Por dónde y Regalos.';
      Logger.log(aviso);
      return aviso;
    }

    const ids = {};
    filas.forEach(function (f) { ids[f[col.id]] = true; });
    const ahora = Utilities.formatDate(new Date(), zonaHoraria(), 'yyyy-MM-dd HH:mm');

    // 1. Lo que vino del registro de Amazon se compra online en EE.UU.
    const repetidosAmazon = repetidosRegistroAmazon();
    let actualizados = 0;
    filas.forEach(function (f) {
      const id = String(f[col.id]);
      if (!/^amz\d+$/.test(id)) return;
      let cambio = false;
      if (!f[col.comprar_en]) { f[col.comprar_en] = 'EEUU online'; cambio = true; }
      if (repetidosAmazon[id] && !f[col.repetido]) { f[col.repetido] = repetidosAmazon[id]; cambio = true; }
      if (cambio) { f[col.actualizado] = ahora; actualizados++; }
    });

    // 2. Suma los ítems de la lista escrita que todavía no estén
    let agregados = 0;
    listaEscrita().forEach(function (d) {
      if (ids[d[0]]) return;
      const f = headers.map(function () { return ''; });
      f[col.id] = d[0];
      f[col.nombre] = d[1];
      f[col.categoria] = d[2];
      f[col.urgencia] = d[3];
      f[col.cantidad] = String(d[4]);
      f[col.comprar_en] = d[5];
      f[col.repetido] = d[6];
      f[col.notas] = d[7];
      f[col.creado] = ahora;
      f[col.actualizado] = ahora;
      filas.push(f);
      agregados++;
    });

    // 3. Categoría nueva en Config
    const categorias = asegurarCategoria(CATEGORIA_OTROS);

    // 4. Ordena por categoría y deja los repetidos uno al lado del otro
    const rankCat = function (f) {
      const i = categorias.indexOf(String(f[col.categoria]).trim());
      return i < 0 ? categorias.length : i;
    };
    const clave = function (f) { return String(f[col.repetido] || f[col.nombre]).replace(/^[¿¡\s]+/, '').toLowerCase(); };
    filas.sort(function (a, b) {
      return rankCat(a) - rankCat(b)
        || clave(a).localeCompare(clave(b), 'es')
        || String(a[col.nombre]).replace(/^[¿¡\s]+/, '').localeCompare(String(b[col.nombre]).replace(/^[¿¡\s]+/, ''), 'es');
    });

    if (filas.length + 1 > hoja.getMaxRows()) {
      hoja.insertRowsAfter(hoja.getMaxRows(), filas.length + 1 - hoja.getMaxRows() + 50);
    }
    if (filas.length) hoja.getRange(2, 1, filas.length, headers.length).setNumberFormat('@').setValues(filas);
    // Si había filas vacías en el medio, quedan restos al final: se limpian
    if (ultima > filas.length + 1) {
      hoja.getRange(filas.length + 2, 1, ultima - filas.length - 1, hoja.getLastColumn()).clearContent();
    }

    // 5. Desplegables, resaltado de repetidos y pestañas de consulta
    prepararColumnas(hoja, col, headers.length);
    crearVistas(libro, col);

    SpreadsheetApp.flush();
    const resumen = 'Listo: se sumaron ' + agregados + ' ítems de la lista escrita y se actualizaron ' +
      actualizados + ' del registro de Amazon. Items tiene ' + filas.length + ' filas.';
    Logger.log(resumen);
    return resumen;
  } finally {
    lock.releaseLock();
  }
}

// Suma las columnas que falten y rehace las pestañas de consulta, sin tocar los datos
function actualizarVistas() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const hoja = obtenerHoja('Items');
    const headers = asegurarColumnas(hoja, TABLAS.Items.concat(COLUMNAS_NUEVAS));
    const col = {};
    headers.forEach(function (h, i) { col[h] = i; });
    prepararColumnas(hoja, col, headers.length);
    crearVistas(abrirLibro(), col);
    SpreadsheetApp.flush();
    Logger.log('Listo: columnas y pestañas actualizadas.');
  } finally {
    lock.releaseLock();
  }
}

// Agrega la categoría a Config si falta y devuelve la lista completa, en orden
function asegurarCategoria(nueva) {
  const config = obtenerHoja('Config');
  const datos = config.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][0]) !== 'categorias') continue;
    const lista = String(datos[i][1] || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (lista.indexOf(nueva) === -1) {
      lista.push(nueva);
      config.getRange(i + 1, 2).setNumberFormat('@').setValue(lista.join(', '));
    }
    return lista;
  }
  config.appendRow(['categorias', nueva]);
  return [nueva];
}

function prepararColumnas(hoja, col, ancho) {
  const filas = hoja.getMaxRows() - 1;

  const lugar = SpreadsheetApp.newDataValidation()
    .requireValueInList(LUGARES_COMPRA, true)
    .setAllowInvalid(true)
    .setHelpText('Argentina, EEUU online o EEUU local. Vacío quiere decir que falta definirlo.')
    .build();
  hoja.getRange(2, col.comprar_en + 1, filas, 1).setDataValidation(lugar);

  const regalo = SpreadsheetApp.newDataValidation()
    .requireValueInList(['sí'], true)
    .setAllowInvalid(true)
    .setHelpText('"sí" si alguien se lo puede regalar.')
    .build();
  hoja.getRange(2, col.posible_regalo + 1, filas, 1).setDataValidation(regalo);

  // Resalta en amarillo las filas cuyo "repetido" aparece más de una vez
  const letra = letraColumna(col.repetido + 1);
  const marca = 'COUNTIF($' + letra + '$2:$' + letra;
  const formula = '=AND($' + letra + '2<>"",' + marca + ',$' + letra + '2)>1)';
  const reglas = hoja.getConditionalFormatRules().filter(function (r) {
    const c = r.getBooleanCondition();
    return !(c && String((c.getCriteriaValues() || [])[0] || '').indexOf(marca) !== -1);
  });
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground('#FCEFC7')
    .setRanges([hoja.getRange(2, 1, filas, ancho)])
    .build());
  hoja.setConditionalFormatRules(reglas);
}

// Pestañas de solo lectura: se arman con fórmulas sobre Items y se actualizan solas
function crearVistas(libro, col) {
  const rango = function (clave) {
    const l = letraColumna(col[clave] + 1);
    return 'Items!$' + l + '$2:$' + l;
  };
  const nombre = rango('nombre');
  const falta = rango('conseguido_tipo') + '="",' + rango('no_necesario') + '=""';
  const pendientes = function (condicion) {
    return '=IFERROR(SORT(FILTER(' + nombre + ',' + condicion + ',' + falta + ')),"")';
  };

  const porDonde = hojaDeVista(libro, 'Por dónde', ['Argentina', 'EE.UU. online', 'EE.UU. en local', 'Sin definir']);
  porDonde.getRange(2, 1, 1, 4).setFormulas([[
    pendientes(rango('comprar_en') + '="Argentina"'),
    pendientes(rango('comprar_en') + '="EEUU online"'),
    pendientes(rango('comprar_en') + '="EEUU local"'),
    pendientes(rango('comprar_en') + '="",' + nombre + '<>""')
  ]]);

  // Sin SORT en las de a pares, para que cada nombre quede al lado de su ítem
  const ideas = rango('posible_regalo') + '="sí",' + falta;
  const llegaron = rango('conseguido_tipo') + '="regalo"';
  const regalos = hojaDeVista(libro, 'Regalos', ['Ideas de regalo (falta conseguir)', 'Quién lo regala', 'Ya nos regalaron', 'De quién']);
  regalos.getRange(2, 1, 1, 4).setFormulas([[
    '=IFERROR(FILTER(' + nombre + ',' + ideas + '),"")',
    '=IFERROR(FILTER(' + rango('regala') + ',' + ideas + '),"")',
    '=IFERROR(FILTER(' + nombre + ',' + llegaron + '),"")',
    '=IFERROR(FILTER(' + rango('de_quien') + ',' + llegaron + '),"")'
  ]]);
}

function hojaDeVista(libro, nombre, titulos) {
  const hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
  hoja.clear();
  hoja.getRange(1, 1, 1, titulos.length).setValues([titulos]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  hoja.setColumnWidths(1, titulos.length, 240);
  return hoja;
}

function letraColumna(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ───────────── Datos ───────────── */

// Ítems del registro de Amazon que se cruzan con la lista escrita: id → grupo de repetidos
function repetidosRegistroAmazon() {
  return {
    amz02: 'Espejo para el auto',
    amz03: 'Mosquitero',
    amz08: 'Muselinas',
    amz09: 'Ruido blanco',
    amz13: 'Mamaderas',
    amz17: 'Baberos',
    amz18: 'Baberos de silicona',
    amz19: 'Vasos',
    amz20: 'Vajilla para comer',
    amz21: 'Vajilla para comer',
    amz22: 'Sacaleches',
    amz23: 'Protectores mamarios',
    amz25: 'Gel frío para el pecho',
    amz27: 'Corpiño de lactancia',
    amz28: 'Toallas',
    amz30: 'Termómetro de baño',
    amz32: 'Corta uñas',
    amz35: 'Toallitas húmedas',
    amz36: 'Organizador de pañales',
    amz37: 'Crema para la cola',
    amz38: 'Cambiador portátil',
    amz42: 'Termómetro para la fiebre',
    amz43: 'Aspirador nasal',
    amz44: 'Chupetes',
    amz45: 'Portachupetes',
    amz46: 'Portachupetes',
    amz47: 'Cámara para el bebé',
    amz49: 'Organizadores de ropa',
    amz50: 'Quitamanchas',
    amz51: 'Protectores de esquinas',
    amz52: 'Cubre enchufes',
    amz53: 'Gimnasio',
    amz62: 'Sonajero',
    amz66: 'Peluches',
    amz67: 'Kit posparto',
    amz70: 'Toallitas posparto',
    amz72: 'Faja',
    amz73: 'Ropa interior posparto'
  };
}

// [id, nombre, categoría, urgencia, cantidad, comprar_en, repetido, notas]
// comprar_en solo viene cargado cuando la lista misma lo deja claro (muebles, una tienda argentina, una marca argentina).
function listaEscrita() {
  const P = 'Paseo y auto', D = 'Dormir', A = 'Alimentación', L = 'Lactancia', B = 'Baño e higiene';
  const C = 'Pañales y cambiado', S = 'Salud y cuidado', H = 'Habitación y casa', J = 'Juguetes y estimulación';
  const M = 'Para mamá', R = 'Ropa', BH = 'Bolso del hospital', O = 'Otros';
  const U1 = 'Antes de que nazca', U2 = 'Primer mes', U3 = 'Puede esperar';
  const AR = 'Argentina';
  const LLEVAR = 'Es para llevar a la clínica, no hay que comprarlo.';
  return [
    ['lst001', 'Cochecito con huevito, moisés y silla', P, U1, 1, '', 'Cochecito y moisés', ''],
    ['lst002', 'Fundas para traer todo', P, U1, 1, '', '', ''],
    ['lst003', 'Bases para el auto para las sillas', P, U1, 2, '', 'Sillas para el auto', ''],
    ['lst004', 'Cochecito de viaje Yoyo', P, U2, 1, '', 'Cochecito de viaje Yoyo', ''],
    ['lst005', 'Espejos para los dos autos', P, U1, 2, '', 'Espejo para el auto', ''],
    ['lst006', '¿Cámara para el auto?', P, U3, 1, '', '', ''],
    ['lst007', 'Sillas para los dos autos con base que gire 360°', P, U1, 2, '', 'Sillas para el auto', ''],
    ['lst008', 'Chupetes y mamaderas Suavinex línea Zero', A, U1, 1, '', 'Mamaderas', 'También incluye los chupetes.'],
    ['lst009', 'Aros', O, '', 1, '', 'Aritos', ''],
    ['lst010', 'Muebles: ¿comprar hechos o encargar?', H, U1, 1, AR, '', ''],
    ['lst011', 'Cuna colecho con colchón', D, U1, 1, '', '', 'Ver la altura.'],
    ['lst012', 'Sábanas', D, U1, 1, '', '', ''],
    ['lst013', 'Toallas', B, U1, 1, '', 'Toallas', ''],
    ['lst014', 'Nidito de contención y chichonera (¿Pillow Home Collection?)', D, U2, 1, '', '', 'Nidito reductor para la cuna o el cochecito y protectores para los costados.'],
    ['lst015', 'Aparato que hace vibrar y mover la cuna', D, U2, 1, '', '', ''],
    ['lst016', 'Luz tenue', H, U2, 1, '', '', ''],
    ['lst017', 'Cuna normal', D, U3, 1, AR, '', ''],
    ['lst018', 'Practicuna colecho con funda (para Marinas y CDC)', D, U2, 1, '', '', ''],
    ['lst019', 'Sillón para amamantar', H, U1, 1, AR, '', ''],
    ['lst020', 'Mueble cambiador con cajonera', C, U1, 1, AR, 'Cambiador para la casa', ''],
    ['lst021', 'Cambiador', C, U1, 1, '', 'Cambiador para la casa', ''],
    ['lst022', 'Organizador de pañales para el cambiador', C, U1, 1, '', 'Organizador de pañales', ''],
    ['lst023', 'Mueble para la ropa', H, U1, 1, AR, '', ''],
    ['lst024', 'Organizadores o separadores de ropa por edad', H, U1, 1, '', 'Organizadores de ropa', ''],
    ['lst025', 'Cambiador para la cuna', C, U1, 1, '', 'Cambiador para la casa', ''],
    ['lst026', 'Cambiador para el cochecito o el bolso maternal', C, U1, 1, '', 'Cambiador portátil', ''],
    ['lst027', '¿Aritos?', O, '', 1, '', 'Aritos', ''],
    ['lst028', 'Baby call (cámara con app)', H, U2, 1, '', 'Cámara para el bebé', 'Que funcione en Argentina.'],
    ['lst029', 'Ruido blanco', D, U2, 1, '', 'Ruido blanco', ''],
    ['lst030', 'Silla mecedora', H, U2, 1, '', 'Silla mecedora', ''],
    ['lst031', 'Alfombra de goma EVA para que juegue', J, U3, 1, '', '', ''],
    ['lst032', 'Gimnasio para que juegue (¿Amazon, Shein o La Blanchérie?)', J, U2, 1, '', 'Gimnasio', ''],
    ['lst033', 'Pañales', C, U1, 1, '', '', ''],
    ['lst034', 'Pañales de agua', C, U3, 1, '', '', ''],
    ['lst035', 'Jabón para bebé', B, U1, 1, '', '', ''],
    ['lst036', 'Shampoo para bebé', B, U1, 1, '', '', ''],
    ['lst037', 'Jabón para lavar la ropa del bebé', H, U1, 1, '', 'Jabón para la ropa', ''],
    ['lst038', 'Tacho para pañales', C, U1, 1, '', 'Tacho para pañales', ''],
    ['lst039', 'Sacaleches', L, U1, 1, '', 'Sacaleches', ''],
    ['lst040', 'Pads térmicos de gel frío para dar la teta', L, U1, 1, '', 'Gel frío para el pecho', ''],
    ['lst041', 'Bañadera portátil y jabón de bebé', B, U1, 1, '', '', ''],
    ['lst042', 'Banquito para la bañera para bañarlo', B, U2, 1, '', '', ''],
    ['lst043', 'Chupetes', S, U1, 1, '', 'Chupetes', ''],
    ['lst044', 'Portachupetes para el cochecito', S, U2, 1, '', 'Portachupetes', ''],
    ['lst045', 'Portachupetes para atar a la ropa', S, U2, 1, '', 'Portachupetes', ''],
    ['lst046', 'Cambiador', C, U1, 1, '', 'Cambiador para la casa', ''],
    ['lst047', 'Bolso cambiador', C, U1, 1, '', 'Bolso maternal', ''],
    ['lst048', 'Bolso maternal para el cochecito (Nare)', C, U1, 1, '', 'Bolso maternal', ''],
    ['lst049', 'Mamaderas', A, U1, 1, '', 'Mamaderas', ''],
    ['lst050', 'Algodón para limpiarlos', C, U1, 1, '', '', ''],
    ['lst051', 'Toallitas de bebé', C, U1, 1, '', 'Toallitas húmedas', ''],
    ['lst052', 'Óleo para limpiarlos', C, U1, 1, '', '', ''],
    ['lst053', 'Remedios para el bebé', S, U1, 1, '', '', ''],
    ['lst054', 'Portachupetes', S, U2, 1, '', 'Portachupetes', ''],
    ['lst055', 'Esterilizador de mamaderas', A, U1, 1, '', 'Esterilizador', ''],
    ['lst056', 'Esterilizador de chupetes', A, U1, 1, '', 'Esterilizador', ''],
    ['lst057', 'Sacaleches y bolsas para guardar y freezar', L, U1, 1, '', 'Sacaleches', ''],
    ['lst058', 'Almohada para amamantar', L, U1, 1, '', 'Almohada para amamantar', ''],
    ['lst059', 'Pezoneras', L, U1, 1, '', 'Pezoneras', ''],
    ['lst060', 'Gel frío para las tetas', L, U1, 1, '', 'Gel frío para el pecho', ''],
    ['lst061', 'Faja lumbar', M, U1, 1, '', 'Faja', ''],
    ['lst062', 'Toallitas posparto o pañales de adulto', M, U1, 1, '', 'Toallitas posparto', ''],
    ['lst063', 'Fular', P, U2, 1, '', '', ''],
    ['lst064', 'Mantas para el bebé, abrigadas y de gasa', D, U1, 1, '', 'Mantas', ''],
    ['lst065', 'Pelota de yoga', M, U1, 1, '', '', ''],
    ['lst066', 'Sacaleches teta', L, U1, 1, '', 'Sacaleches', ''],
    ['lst067', 'Aparato para cortarle las uñas', B, U2, 1, '', 'Corta uñas', ''],
    ['lst068', 'Tacho para pañales', C, U1, 1, '', 'Tacho para pañales', ''],
    ['lst069', 'Cochecito', P, U1, 1, '', 'Cochecito y moisés', ''],
    ['lst070', 'Braja para cochecito en Ojitos y Manitos', P, U3, 1, '', '', 'Así estaba escrito en la lista: revisar el nombre.'],
    ['lst071', 'Sillita cama', H, U2, 1, '', '', ''],
    ['lst072', 'Silla para comer (Helen)', A, U3, 1, '', '', ''],
    ['lst073', 'Sillita portátil de goma para comer', A, U3, 1, '', '', ''],
    ['lst074', 'Platos, vasos y cubiertos de silicona con babero', A, U3, 1, '', 'Vajilla para comer', ''],
    ['lst075', 'Vasos térmicos', A, U3, 1, '', 'Vasos', ''],
    ['lst076', 'Mamaderas', A, U1, 1, '', 'Mamaderas', ''],
    ['lst077', 'Baberos', A, U2, 1, '', 'Baberos', ''],
    ['lst078', 'Sillita mecedora', H, U2, 1, '', 'Silla mecedora', ''],
    ['lst079', 'Moisés', P, U1, 1, '', 'Cochecito y moisés', ''],
    ['lst080', 'Muselinas', D, U1, 1, '', 'Muselinas', ''],
    ['lst081', 'Babitas de toalla (Baby Cottons)', A, U2, 1, '', 'Baberos', ''],
    ['lst082', 'Baberos de silicona', A, U3, 1, '', 'Baberos de silicona', ''],
    ['lst083', 'Mantas de algodón pima peruano', D, U1, 1, '', 'Mantas', ''],
    ['lst084', 'Baberos', A, U2, 1, '', 'Baberos', ''],
    ['lst085', 'Mantas', D, U1, 1, '', 'Mantas', ''],
    ['lst086', 'Abrigos', R, U1, 1, '', '', ''],
    ['lst087', 'Gorritas', R, U1, 1, '', '', ''],
    ['lst088', 'Medias', R, U1, 1, '', '', ''],
    ['lst089', 'Toallas', B, U1, 1, '', 'Toallas', ''],
    ['lst090', 'Peluches y muñecas', J, U3, 1, '', 'Peluches', ''],
    ['lst091', 'Sonajeros', J, U3, 1, '', 'Sonajero', ''],
    ['lst092', 'Mordillo', J, U3, 1, '', '', 'En lo que vino de Amazon ya hay cuatro mordillos.'],
    ['lst093', 'Bolso maternal cambiador para el cochecito', C, U1, 1, '', 'Bolso maternal', ''],
    ['lst094', 'Mosquitero para el cochecito', P, U2, 1, '', 'Mosquitero', ''],
    ['lst095', 'Vestido de la beba para el casamiento de Ila', R, '', 1, '', 'Vestido de la beba para el casamiento', ''],
    ['lst096', 'Tapitas de plástico para los enchufes', H, U3, 1, '', 'Cubre enchufes', ''],
    ['lst097', 'Protectores para bordes filosos (mesas, etc.)', H, U3, 1, '', 'Protectores de esquinas', ''],
    ['lst098', 'Red para el balcón', H, U3, 1, AR, '', ''],
    ['lst099', "Quitamanchas Miss Mouth's", H, U2, 1, '', 'Quitamanchas', ''],
    ['lst100', 'Jabón para lavar la ropa del bebé en el lavarropas', H, U1, 1, '', 'Jabón para la ropa', ''],
    ['lst101', 'Cicaplast', C, U1, 1, '', 'Crema para la cola', ''],
    ['lst102', 'Termofren', S, U1, 1, AR, 'Paracetamol', ''],
    ['lst103', 'Termómetro para el agua del baño', B, U1, 1, '', 'Termómetro de baño', ''],
    ['lst104', 'Termómetro para la fiebre', S, U1, 1, '', 'Termómetro para la fiebre', ''],
    ['lst105', 'Paracetamol para bebés', S, U1, 1, '', 'Paracetamol', ''],
    ['lst106', 'Colchoneta de goma con gimnasio para que juegue acostada', J, U2, 1, '', 'Gimnasio', ''],
    ['lst107', 'Juguetes', J, U3, 1, '', '', ''],
    ['lst108', 'Juego de agua para estar boca abajo', J, U3, 1, '', '', ''],
    ['lst109', 'Aspirador nasal manual', S, U1, 1, '', 'Aspirador nasal', ''],
    ['lst110', 'Cochecito de viaje Yoyo', P, U2, 1, '', 'Cochecito de viaje Yoyo', ''],
    ['lst111', 'Jeans', R, U3, 1, '', '', ''],
    ['lst112', 'Bodys', R, U1, 1, '', '', ''],
    ['lst113', 'Calzas', R, U3, 1, '', 'Calzas', ''],
    ['lst114', 'Pijamas para mamá para la clínica', M, U1, 1, '', 'Pijama y camisón', ''],
    ['lst115', 'Camisones maternales', M, U1, 1, '', 'Pijama y camisón', ''],
    ['lst116', 'Corpiños maternales', L, U1, 1, '', 'Corpiño de lactancia', ''],
    ['lst117', 'Shorts maternales', M, U2, 1, '', '', ''],
    ['lst118', 'Almohada para dormir', M, U1, 1, '', '', ''],
    ['lst119', 'Almohada para amamantar', L, U1, 1, '', 'Almohada para amamantar', ''],
    ['lst120', 'Pantuflas', M, U1, 1, '', '', ''],
    ['lst121', 'Faja lumbar', M, U1, 1, '', 'Faja', ''],
    ['lst122', 'Vestidos cómodos y ropa de verano para mamá', M, U2, 1, '', '', ''],
    ['lst123', 'Calzas', M, U2, 1, '', 'Calzas', ''],
    ['lst124', '¿Fórmula?', A, U2, 1, '', '', ''],
    ['lst125', '¿Vestido de la beba para el casamiento de Ila?', R, '', 1, '', 'Vestido de la beba para el casamiento', ''],
    ['lst126', 'Vestidos para mamá para los casamientos de Maru e Ila (civil y fiesta)', M, '', 1, '', '', ''],
    ['lst127', 'Regalo de cumple para papá', O, '', 1, '', '', ''],
    ['lst128', 'Kit posparto', M, U1, 1, AR, 'Kit posparto', 'Comprarlo en Alice in Momland o en Somos Importaditos (Instagram).'],
    ['lst129', 'Bombachas descartables', M, U1, 1, '', 'Ropa interior posparto', ''],
    ['lst130', 'Protectores mamarios', L, U1, 1, '', 'Protectores mamarios', ''],
    ['lst131', 'Buenos pijamas camisón', M, U1, 1, '', 'Pijama y camisón', ''],
    ['lst132', 'Pezoneras', L, U1, 1, '', 'Pezoneras', ''],
    ['lst133', 'Bombachas anchas', M, U1, 1, '', 'Ropa interior posparto', ''],
    ['lst134', 'Pañales de adulto o toallitas posparto', M, U1, 1, '', 'Toallitas posparto', ''],
    ['lst135', 'Protectores mamarios (porque largás leche)', L, U1, 1, '', 'Protectores mamarios', ''],
    ['lst136', 'Botella para la higiene íntima posparto', M, U1, 1, '', '', ''],
    ['lst137', 'Geles fríos para las tetas', L, U1, 1, '', 'Gel frío para el pecho', ''],
    ['lst138', 'Estudios y ecografías (¿llevarlos?)', BH, U1, 1, '', '', LLEVAR],
    ['lst139', 'DNI', BH, U1, 1, '', '', LLEVAR],
    ['lst140', 'Libreta de casamiento', BH, U1, 1, '', '', LLEVAR],
    ['lst141', 'Gel frío para la cabeza', BH, U1, 1, '', '', ''],
    ['lst142', 'Cargador del celular', BH, U1, 1, '', '', LLEVAR],
    ['lst143', 'Armar el bolso para la clínica (carry y huevito para el auto)', BH, U1, 1, '', '', 'Es una tarea, no una compra.']
  ];
}
