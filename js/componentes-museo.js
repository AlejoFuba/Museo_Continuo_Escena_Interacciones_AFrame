/* =====================================================================
   MUSEO CONTINUO · componentes del ejemplo (A-Frame 1.8.0)
   Taller de Diseño Interactivo IV — Bloque 3, RV web
   VERSIÓN 2 · INTERACCIÓN POR MIRADA (a-cursor con fuse)
   Pensada para visores de celular sin mandos (tipo Cardboard): todo se
   activa MIRANDO un punto durante 1,5 s. No hay clics de mouse ni mandos.

   Índice
     0. Utilidades (mostrar/ocultar sin que el rayo choque con lo oculto)
     1. Sistema "museo": traslados con fundido, niveles, sonidos de UI y
        la espera de mirada sobre el piso (teletransporte)
     2. teleport-al-piso ......... Teletransporte al piso (mirada sostenida)
     3. punto-recorrido .......... Puntos fijos de recorrido
     4. portal ................... Portales entre salas
     5. ascensor + boton-ascensor  Plataforma/ascensor al mezzanine
     6. resaltar ................. Resaltar al pasar la mirada
     7. sonido-al-seleccionar .... Sonido corto al seleccionar
     8. panel-texto .............. Texto en canvas (tildes y ñ sin fuentes externas)
     9. cartela .................. Cartela emergente al mirar la obra (+ botón X)
    10. audioguia ................ Audioguía por obra (sonido posicional)
    11. hotspot .................. Hotspots sobre un objeto
    12. carrusel + carrusel-boton  Panel "siguiente/anterior" (se repite si sigue mirando)
    13. pantalla-video ........... Video play()/pause() con botones
    14. zona-sonido .............. Sonido ambiente por zonas
    15. mirar-camara / pulso ..... Auxiliares (cartel que mira al visitante, latido)
    16. mira-cursor .............. La mira visible y su anillo de carga
    17. visor-estereo ............ Pantalla dividida para celulares sin WebXR (iPhone)

   CÓMO FUNCIONA LA MIRADA
   El <a-cursor fuse="true"> va dentro de la cámara. Su raycaster apunta al
   centro de la vista. Cuando el rayo entra en un objeto, A-Frame emite
   "mouseenter" y "fusing"; si la mirada sigue ahí fuseTimeout ms, emite
   "click". Por eso TODOS los componentes siguen escuchando "click": el
   cursor de mirada lo genera sin que nadie pulse nada.
   OJO 1: el fuse dispara UNA vez por cada vez que la mirada entra en el
   objeto. Para repetir hay que apartar la vista y volver.
   OJO 2: con la mirada, mirar ES seleccionar. Nada que el visitante deba
   mirar con calma (una pantalla, un texto) puede ser un botón.

   Regla del ejemplo: lo que se selecciona lleva la clase .clicable; los
   pisos llevan .piso y los muros .bloquea. Los tres están en "objects".
   El raycaster prueba solo la geometría PROPIA de cada elemento de
   "objects", no la de sus hijos: lo .clicable debe tener su propia malla.
   En los textos de los atributos no use punto y coma ( ; ): A-Frame lo
   usa para separar propiedades.
   ===================================================================== */

/* ---------- 0. Utilidades ---------- */
window.MUSEO = window.MUSEO || {};

/* Ocultar con visible="false" NO basta: el raycaster sigue chocando con
   objetos invisibles. Por eso cambiamos la clase .clicable por .clicable-off
   en el elemento y en todos sus descendientes. */
MUSEO.mostrar = function (el, visible) {
  el.setAttribute('visible', visible);
  var lista = [el].concat(Array.prototype.slice.call(el.querySelectorAll('.clicable, .clicable-off')));
  lista.forEach(function (n) {
    if (!n.classList) { return; }
    if (visible && n.classList.contains('clicable-off')) { n.classList.replace('clicable-off', 'clicable'); }
    if (!visible && n.classList.contains('clicable')) { n.classList.replace('clicable', 'clicable-off'); }
  });
};

/* Ejecuta fn cuando toda la escena terminó de cargar (posiciones ya aplicadas). */
MUSEO.alCargar = function (el, fn) {
  var esc = el.sceneEl;
  if (esc.hasLoaded) { setTimeout(fn, 0); } else { esc.addEventListener('loaded', fn, {once: true}); }
};

/* Posición local declarada en el HTML (aunque el componente position aún no se haya aplicado). */
MUSEO.posicion = function (el) {
  var c = AFRAME.utils.coordinates.parse(el.getAttribute('position') || '0 0 0');
  return {x: c.x || 0, y: c.y || 0, z: c.z || 0};
};

MUSEO.suave = function (t) { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };

MUSEO.vec = function (txt) {          // "1 2 3" -> THREE.Vector3
  var p = String(txt).trim().split(/\s+/).map(Number);
  return new THREE.Vector3(p[0] || 0, p[1] || 0, p[2] || 0);
};

/* iPhone/iPad: los sensores de movimiento necesitan permiso, pedido dentro
   de un gesto del usuario (el botón de entrada). En Android no hace falta. */
MUSEO.pedirSensores = function (escena) {
  var D = window.DeviceOrientationEvent;
  if (!D || typeof D.requestPermission !== 'function') { return; }
  D.requestPermission().then(function (r) {
    if (r !== 'granted') { return; }
    var c = escena.components['device-orientation-permission-ui'];
    if (c) { c.permissionGranted = true; }
    escena.emit('deviceorientationpermissiongranted');   // look-controls lo escucha
  }).catch(function (e) { console.warn('Sin permiso de sensores:', e); });
};

/* ---------- 1. Sistema "museo" ---------- */
AFRAME.registerSystem('museo', {
  schema: {
    rig: {default: '#rig'}, camara: {default: '#camara'},
    fundido: {default: '#fundido'}, sonidos: {default: '#sonidos-ui'},
    reticula: {default: '#reticula'},
    niveles: {type: 'array', default: ['0', '3']},    // altura (y) de cada planta
    // Teletransporte por mirada
    esperaPiso: {default: 1600},      // ms mirando el mismo punto del piso
    distMin: {default: 0.8},          // m: mirarse los pies no teletransporta
    distMax: {default: 9},            // m: más lejos se marca como no válido
    rearmar: {default: 10}            // grados que debe girar la cabeza tras un salto
  },

  // Los elementos se buscan al usarlos (la escena puede iniciar antes que sus hijos).
  rig: function () { return this._rig || (this._rig = document.querySelector(this.data.rig)); },
  camara: function () { return this._cam || (this._cam = document.querySelector(this.data.camara)); },
  fundidoEl: function () { return this._fun || (this._fun = document.querySelector(this.data.fundido)); },

  init: function () {
    this.ocupado = false;           // true mientras hay un traslado o el ascensor se mueve
    this.activo = false;            // false hasta pulsar "Entrar": antes, la mirada no activa nada
    this.opacidad = 0; this.opacidadMeta = 0; this.velFundido = 5;
    this.niveles = this.data.niveles.map(Number);
    // Estado de la mirada sobre el piso (lo llenan los pisos en cada cuadro)
    this.piso = {
      visto: false, punto: new THREE.Vector3(), estado: '',   // 'ok' | 'lejos' | 'otraPlanta' | 'cerca'
      ancla: new THREE.Vector3(), t: 0, progreso: 0,
      armado: true, dirAlLlegar: null
    };
    this.pies = new THREE.Vector3();
    this.dir = new THREE.Vector3();
  },

  /* Un "click" (de la mirada) solo cuenta si ya se entró y no hay un traslado en curso. */
  clicValido: function () { return this.activo && !this.ocupado; },

  sonar: function (nombre) {
    var el = document.querySelector(this.data.sonidos), s = el && el.components['sound__' + nombre];
    if (s) { s.stopSound(); s.playSound(); }
  },

  /* Índice de la planta en la que está el visitante (0 = galería, 1 = mezzanine). */
  nivelActual: function () {
    var y = this.rig().object3D.position.y, mejor = 0;
    this.niveles.forEach(function (n, i, arr) { if (Math.abs(n - y) < Math.abs(arr[mejor] - y)) { mejor = i; } });
    return mejor;
  },

  mismoNivel: function (y) { return Math.abs(y - this.rig().object3D.position.y) < 0.5; },

  /* Coloca al visitante (sus pies) en "destino".
     Se mueve el RIG, no la cámara, y se descuenta el desplazamiento de la
     cámara dentro del rig (en VR la cabeza no está en el centro del rig). */
  colocar: function (destino) {
    var rig = this.rig().object3D, cam = this.camara().object3D.position;
    rig.position.set(destino.x - cam.x, destino.y, destino.z - cam.z);
    this.desarmarPiso();
    this.el.emit('museo-movido', {nivel: this.nivelActual()});
  },

  /* Después de CUALQUIER traslado (piso, parada, portal, ascensor) el piso
     queda desarmado: al llegar, la mirada suele caer sobre el piso y no debe
     provocar otro salto sin que el visitante lo decida. */
  desarmarPiso: function () {
    this.piso.armado = false; this.piso.dirAlLlegar = null;
    this.piso.t = 0; this.piso.progreso = 0;
  },

  /* Orienta la mirada hacia un punto. SOLO en computador: en el celular y en
     el visor la cabeza la gira el visitante, nunca el programa (girar la vista
     sin mover la cabeza marea y desalinea el visor del cuerpo). */
  orientar: function (punto) {
    if (!punto || this.el.is('vr-mode') || this.el.is('modo-visor') || AFRAME.utils.device.isMobile()) { return; }
    var lc = this.camara().components['look-controls'];
    if (!lc) { return; }
    var cam = new THREE.Vector3(); this.camara().object3D.getWorldPosition(cam);
    lc.yawObject.rotation.y = Math.atan2(-(punto.x - cam.x), -(punto.z - cam.z));
    lc.pitchObject.rotation.x = 0;
  },

  fundir: function (meta, vel) {
    var self = this;
    this.opacidadMeta = meta; this.velFundido = vel || 5;
    if (meta > 0) { this.fundidoEl().setAttribute('visible', true); }
    return new Promise(function (ok) { self._finFundido = ok; });
  },

  /* Traslado completo: oscurece, mueve, orienta y aclara. Devuelve una promesa. */
  irA: function (destino, opciones) {
    var self = this; opciones = opciones || {};
    if (this.ocupado && !opciones.forzar) { return Promise.resolve(false); }
    this.ocupado = true;
    if (opciones.sonido !== false) { this.sonar(opciones.sonido || 'teletransporte'); }
    var vel = opciones.lento ? 2.5 : 6;
    return this.fundir(1, vel).then(function () {
      self.colocar(destino);
      self.orientar(opciones.mirar);
      return self.fundir(0, vel);
    }).then(function () {
      if (!opciones.mantenerOcupado) { self.ocupado = false; }
      return true;
    });
  },

  /* Los pisos llaman a esto en cada cuadro en que la mirada cae sobre ellos. */
  mirarPiso: function (punto, normal) {
    var p = this.piso;
    p.visto = true;
    p.punto.copy(punto);
    this.camara().object3D.getWorldPosition(this.pies);
    var dist = Math.hypot(punto.x - this.pies.x, punto.z - this.pies.z);
    p.dist = dist;
    if (!this.mismoNivel(punto.y)) { p.estado = 'otraPlanta'; }
    else if (dist < this.data.distMin) { p.estado = 'cerca'; }
    else if (dist > this.data.distMax) { p.estado = 'lejos'; }
    else { p.estado = 'ok'; }
  },

  /* TELETRANSPORTE POR MIRADA (se evalúa una vez por cuadro, después de los ticks)
     1. La retícula sigue a la mirada sobre el piso.
     2. Si la mirada se queda quieta (dentro de un radio pequeño) durante
        esperaPiso ms, el visitante salta allí.
     3. Después de un salto queda DESARMADO (retícula gris): no vuelve a saltar
        hasta que la mirada salga del piso o la cabeza gire "rearmar" grados.
        Así, quedarse mirando al frente no hace "caminar" al visitante sin
        querer. (Se mide el giro de la cabeza y no el movimiento del punto en
        el piso porque, al llegar, el punto cambia aunque la cabeza no se mueva.) */
  tock: function (t, dt) {
    var p = this.piso, d = this.data, ret = document.querySelector(d.reticula);
    if (!ret) { return; }
    var visto = p.visto; p.visto = false;

    if (this.ocupado || !visto || !this.activo) {
      ret.object3D.visible = false;
      p.t = 0; p.progreso = 0;
      if (!visto && !this.ocupado && this.activo) { p.armado = true; p.dirAlLlegar = null; }
      return;
    }

    // Re-armado después de un salto: ¿giró la cabeza lo suficiente?
    if (!p.armado) {
      this.camara().object3D.getWorldDirection(this.dir);
      if (!p.dirAlLlegar) { p.dirAlLlegar = this.dir.clone(); }
      else if (THREE.MathUtils.radToDeg(this.dir.angleTo(p.dirAlLlegar)) > d.rearmar) { p.armado = true; p.dirAlLlegar = null; }
    }

    // Retícula: cian = puede saltar · gris = desarmada · magenta = no válido
    ret.object3D.visible = p.estado !== 'cerca';
    ret.object3D.position.copy(p.punto); ret.object3D.position.y += 0.01;   // un poco sobre el piso
    var color = p.estado !== 'ok' ? '#F472B6' : (p.armado ? '#22D3EE' : '#94A3B8');
    if (ret._color !== color) { ret._color = color; ret.setAttribute('material', 'color', color); }

    if (p.estado !== 'ok' || !p.armado) { p.t = 0; p.progreso = 0; return; }

    // Mirada quieta: el radio crece con la distancia (lejos, la cabeza "tiembla" más en metros)
    var radio = Math.max(0.25, 0.08 * p.dist);
    if (p.t === 0 || p.punto.distanceTo(p.ancla) > radio) { p.ancla.copy(p.punto); p.t = 0.0001; }
    else { p.t += dt; }
    p.progreso = Math.min(p.t / d.esperaPiso, 1);

    if (p.t >= d.esperaPiso) {
      this.irA(p.punto.clone());     // colocar() lo deja desarmado
    }
  },

  tick: function (t, dt) {
    if (this.opacidad !== this.opacidadMeta) {
      var paso = this.velFundido * dt / 1000;
      this.opacidad = this.opacidad < this.opacidadMeta ? Math.min(this.opacidad + paso, this.opacidadMeta)
                                                        : Math.max(this.opacidad - paso, this.opacidadMeta);
      var m = this.fundidoEl().getObject3D('mesh');
      if (m) { m.material.opacity = this.opacidad; m.renderOrder = 9999; }
      if (this.opacidad === this.opacidadMeta) {
        if (this.opacidad === 0) { this.fundidoEl().setAttribute('visible', false); }
        if (this._finFundido) { var f = this._finFundido; this._finFundido = null; f(); }
      }
    }
  },

  /* Se llama desde los botones de entrada: los navegadores exigen un gesto
     del usuario antes de reproducir audio o video con sonido. También
     "enciende" la mirada (antes de entrar, nada se activa). */
  iniciarAudio: function () {
    this.activo = true;
    var ctx = THREE.AudioContext.getContext();
    if (ctx.state === 'suspended') { ctx.resume(); }
    this.el.emit('museo-audio-listo');
    // "Cebar" los videos: reproducir y pausar en silencio dentro del gesto (iOS/Safari).
    document.querySelectorAll('a-assets video').forEach(function (v) {
      v.muted = true;
      var p = v.play();
      if (p && p.then) { p.then(function () { v.pause(); v.currentTime = 0; v.muted = false; }).catch(function () { v.muted = false; }); }
    });
  }
});

/* ---------- 2. Teletransporte al piso (por mirada sostenida) ----------
   <a-plane class="piso" teleport-al-piso ...>
   ¿Por qué no usa el "click" del fuse? Porque el piso es un solo objeto
   enorme: el fuse dispararía 1,5 s después de mirar hacia abajo, aunque la
   mirada estuviera recorriendo la sala. Aquí el piso solo INFORMA al sistema
   dónde cae la mirada; el sistema decide (ver "tock" en el sistema museo).
   - Solo cuentan superficies que miran hacia arriba (no la cara inferior del mezzanine).
   - Solo dentro de la misma planta: para subir hay que usar el ascensor.        */
AFRAME.registerComponent('teleport-al-piso', {
  init: function () {
    var self = this;
    this.sistema = this.el.sceneEl.systems.museo;
    this.rayos = [];
    this.normal = new THREE.Vector3();

    this.el.addEventListener('raycaster-intersected', function (e) {
      if (self.rayos.indexOf(e.detail.el) === -1) { self.rayos.push(e.detail.el); }
    });
    this.el.addEventListener('raycaster-intersected-cleared', function (e) {
      var i = self.rayos.indexOf(e.detail.el); if (i > -1) { self.rayos.splice(i, 1); }
    });
  },

  tick: function () {
    for (var i = 0; i < this.rayos.length; i++) {
      var rc = this.rayos[i].components.raycaster;
      if (!rc || !rc.data.enabled || !rc.intersections.length) { continue; }
      // Solo si el piso es lo PRIMERO que toca el rayo (si hay un muro o una obra delante, no).
      var primero = rc.intersections[0];
      if (primero.object.el !== this.el || !primero.face) { continue; }
      this.normal.copy(primero.face.normal).transformDirection(primero.object.matrixWorld);
      if (this.normal.y > 0.9) { this.sistema.mirarPiso(primero.point, this.normal); }
    }
  }
});

/* ---------- 3. Puntos fijos de recorrido ----------
   <a-entity punto-recorrido="mirar: -7 1.8 -1" position="-4.5 0 -1">
   Mirar el marcador 1,5 s lleva al visitante a su centro. En computador
   además orienta la vista hacia "mirar" (en celular/visor no: ver orientar).
   Los marcadores de otras plantas se ocultan.                               */
AFRAME.registerComponent('punto-recorrido', {
  schema: {mirar: {type: 'string', default: ''}},
  init: function () {
    var self = this, s = this.sistema = this.el.sceneEl.systems.museo;
    this.el.classList.add('clicable');
    this.el.addEventListener('click', function (evt) {
      if (!s.clicValido(evt)) { return; }
      var p = new THREE.Vector3(); self.el.object3D.getWorldPosition(p);
      s.irA(p, {mirar: self.data.mirar ? MUSEO.vec(self.data.mirar) : null});
    });
    this.actualizar = function () {
      var p = new THREE.Vector3(); self.el.object3D.getWorldPosition(p);
      MUSEO.mostrar(self.el, s.mismoNivel(p.y));
    };
    this.el.sceneEl.addEventListener('museo-movido', this.actualizar);
    this.el.sceneEl.addEventListener('loaded', this.actualizar);
  }
});

/* ---------- 4. Portal entre salas ----------
   <a-entity portal="destino: 40 0 3.6; mirar: 40 2.5 -6">                     */
AFRAME.registerComponent('portal', {
  schema: {destino: {type: 'vec3'}, mirar: {type: 'string', default: ''}},
  init: function () {
    var self = this, s = this.el.sceneEl.systems.museo;
    this.el.addEventListener('click', function (evt) {
      if (!s.clicValido(evt)) { return; }
      s.irA(new THREE.Vector3().copy(self.data.destino),
        {lento: true, sonido: 'portal', mirar: self.data.mirar ? MUSEO.vec(self.data.mirar) : null});
    });
  }
});

/* ---------- 5. Ascensor ----------
   <a-box id="ascensor" ascensor="niveles: 0, 3; duracion: 3">   (la plataforma)
   <a-entity boton-ascensor="ascensor: #ascensor; destino: 1">  (botón "subir")
   Secuencia: si la plataforma no está en la planta del visitante, primero
   viene vacía; luego el visitante se coloca encima (fundido) y ambos viajan.
   Nunca se mueve la cámara sin que el visitante lo haya pedido.             */
AFRAME.registerComponent('ascensor', {
  schema: {niveles: {type: 'array', default: ['0', '3']}, duracion: {default: 3}},
  init: function () {
    this.sistema = this.el.sceneEl.systems.museo;
    this.niveles = this.data.niveles.map(Number);
    this.idx = 0;            // planta en la que está la plataforma
    this.viaje = null;       // {desde, hasta, t, conVisitante, fin}
    this.alto = 0.1;         // grosor de la plataforma: en el HTML, position y = nivel + 0.02 - 0.05
  },
  superficie: function () { return this.el.object3D.position.y + this.alto / 2; },

  mover: function (destIdx, conVisitante) {
    var self = this;
    return new Promise(function (fin) {
      self.viaje = {desde: self.superficie(), hasta: self.niveles[destIdx] + 0.02, t: 0, conVisitante: conVisitante, fin: function () { self.idx = destIdx; fin(); }};
    });
  },

  llamar: async function (destIdx) {
    var s = this.sistema;
    if (s.ocupado || this.viaje) { return; }
    var mio = s.nivelActual();
    if (mio === destIdx) { return; }
    s.ocupado = true;
    this.el.emit('ascensor-inicio');
    if (this.idx !== mio) { await this.mover(mio, false); }          // 1. viene vacía
    var p = new THREE.Vector3(); this.el.object3D.getWorldPosition(p);
    p.y = this.superficie();
    await s.irA(p, {forzar: true, mantenerOcupado: true, sonido: 'clic'}); // 2. subirse
    await this.mover(destIdx, true);                                 // 3. viajar
    s.sonar('ding');
    s.desarmarPiso();
    s.ocupado = false;
    this.el.sceneEl.emit('museo-movido', {nivel: s.nivelActual()});
    this.el.emit('ascensor-fin');
  },

  tick: function (t, dt) {
    var v = this.viaje; if (!v) { return; }
    v.t = Math.min(v.t + dt / 1000 / this.data.duracion, 1);
    var y = v.desde + (v.hasta - v.desde) * MUSEO.suave(v.t);
    this.el.object3D.position.y = y - this.alto / 2;
    if (v.conVisitante) { this.sistema.rig().object3D.position.y = y; }
    if (v.t === 1) { this.viaje = null; v.fin(); }
  }
});

AFRAME.registerComponent('boton-ascensor', {
  schema: {ascensor: {type: 'selector'}, destino: {type: 'int', default: 1}},
  init: function () {
    var self = this, s = this.el.sceneEl.systems.museo;
    this.el.classList.add('clicable');
    this.el.addEventListener('click', function (evt) {
      if (!s.clicValido(evt) || !self.data.ascensor) { return; }
      self.data.ascensor.components.ascensor.llamar(self.data.destino);
    });
  }
});

/* ---------- 6. Resaltar al pasar ----------
   resaltar="escala: 1.06; color: #22D3EE"
   Cambia la escala con suavidad y, si el material es "standard", lo ilumina.
   Con la mirada es la primera señal de "esto se puede activar": aparece en
   cuanto el rayo entra, antes de que el anillo de carga termine.           */
AFRAME.registerComponent('resaltar', {
  schema: {escala: {default: 1.06}, color: {type: 'color', default: '#22D3EE'}, intensidad: {default: 0.35}},
  init: function () {
    var self = this;
    this.encima = 0; this.base = this.el.object3D.scale.clone(); this.f = 1;
    // mouseenter/mouseleave burbujean desde los hijos: se cuentan en pares.
    this.el.addEventListener('mouseenter', function () { self.encima++; });
    this.el.addEventListener('mouseleave', function () { self.encima = Math.max(0, self.encima - 1); });
  },
  tick: function (t, dt) {
    var meta = this.encima > 0 && this.el.classList.contains('clicable') ? this.data.escala : 1;
    if (Math.abs(this.f - meta) < 0.0005) { return; }
    this.f += (meta - this.f) * Math.min(1, dt / 70);
    this.el.object3D.scale.copy(this.base).multiplyScalar(this.f);
    var k = (this.f - 1) / (this.data.escala - 1 || 1), color = this.data.color, inten = this.data.intensidad;
    this.el.object3D.traverse(function (o) {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material.emissive.set(color); o.material.emissiveIntensity = inten * k;
      }
    });
  }
});

/* ---------- 7. Sonido al seleccionar ----------
   En <a-scene>: cualquier clic sobre algo .clicable suena "clic".
   Los eventos de A-Frame burbujean, así que basta un solo oyente.            */
AFRAME.registerComponent('sonido-al-seleccionar', {
  schema: {sonido: {default: 'clic'}},
  init: function () {
    var self = this, s = this.el.systems.museo;
    this.el.addEventListener('click', function (evt) {
      var t = evt.target;
      while (t && t !== self.el) { if (t.classList && t.classList.contains('clicable')) { break; } t = t.parentNode; }
      if (t && t !== self.el && !s.ocupado && s.clicValido(evt)) { s.sonar(self.data.sonido); }
    });
  }
});

/* ---------- 8. Panel de texto ----------
   panel-texto="titulo: Umbral; subtitulo: Lucía Arango · 2024; cuerpo: ...; ancho: 1.2; alto: 0.9"
   Dibuja en un <canvas>: soporta tildes, ñ y salto de línea con \n.          */
var FUENTE = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
AFRAME.registerComponent('panel-texto', {
  schema: {
    titulo: {default: ''}, subtitulo: {default: ''}, cuerpo: {default: ''},
    ancho: {default: 1.2}, alto: {default: 0.8},
    fondo: {type: 'color', default: '#141A33'}, opacidadFondo: {default: 0.94},
    borde: {type: 'color', default: '#2A3566'},
    colorTitulo: {type: 'color', default: '#FFFFFF'}, colorSubtitulo: {type: 'color', default: '#22D3EE'},
    colorTexto: {type: 'color', default: '#CBD5E1'},
    tamTitulo: {default: 0.075}, tamSubtitulo: {default: 0.042}, tamTexto: {default: 0.042},
    margen: {default: 0.07}, alinear: {default: 'left', oneOf: ['left', 'center']},
    centrarVertical: {default: false}, redondeo: {default: 0.04}, resolucion: {default: 700}
  },
  init: function () {
    this.canvas = document.createElement('canvas');
    this.textura = new THREE.CanvasTexture(this.canvas);
    this.textura.colorSpace = THREE.SRGBColorSpace;
    this.textura.anisotropy = 4;
    this.aplicar = this.aplicar.bind(this);
    this.el.addEventListener('object3dset', this.aplicar);
  },
  update: function () {
    var d = this.data;
    this.el.setAttribute('geometry', {primitive: 'plane', width: d.ancho, height: d.alto});
    if (!this.el.getAttribute('material')) { this.el.setAttribute('material', {shader: 'flat', transparent: true, side: 'double'}); }
    this.dibujar(); this.aplicar();
  },
  aplicar: function () {
    var m = this.el.getObject3D('mesh'); if (!m) { return; }
    m.material.map = this.textura; m.material.color.set('#FFFFFF'); m.material.transparent = true; m.material.needsUpdate = true;
  },
  lineas: function (ctx, texto, anchoMax) {
    var out = [];
    String(texto).replace(/\\n/g, '\n').split('\n').forEach(function (parrafo) {
      var palabras = parrafo.split(' '), linea = '';
      palabras.forEach(function (p) {
        var prueba = linea ? linea + ' ' + p : p;
        if (ctx.measureText(prueba).width > anchoMax && linea) { out.push(linea); linea = p; } else { linea = prueba; }
      });
      out.push(linea);
    });
    return out;
  },
  dibujar: function () {
    var d = this.data, k = d.resolucion;
    var W = Math.round(d.ancho * k), H = Math.round(d.alto * k);
    var c = this.canvas; c.width = W; c.height = H;
    var ctx = c.getContext('2d'), m = d.margen * k, r = d.redondeo * k;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = d.opacidadFondo; ctx.fillStyle = d.fondo;
    ctx.beginPath(); ctx.roundRect(2, 2, W - 4, H - 4, r); ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = 3; ctx.strokeStyle = d.borde; ctx.stroke();

    var bloques = [];
    var self = this, anchoUtil = W - 2 * m;
    function agregar (texto, tam, peso, color, espacio) {
      if (!texto) { return; }
      ctx.font = peso + ' ' + Math.round(tam * k) + 'px ' + FUENTE;
      self.lineas(ctx, texto, anchoUtil).forEach(function (l) { bloques.push({l: l, tam: tam * k, peso: peso, color: color}); });
      bloques.push({espacio: espacio * k});
    }
    agregar(d.titulo, d.tamTitulo, 700, d.colorTitulo, 0.022);
    agregar(d.subtitulo, d.tamSubtitulo, 600, d.colorSubtitulo, 0.03);
    agregar(d.cuerpo, d.tamTexto, 400, d.colorTexto, 0);

    var altoTotal = bloques.reduce(function (a, b) { return a + (b.espacio !== undefined ? b.espacio : b.tam * 1.32); }, 0);
    var y = d.centrarVertical ? (H - altoTotal) / 2 : m;
    ctx.textBaseline = 'top'; ctx.textAlign = d.alinear;
    var x = d.alinear === 'center' ? W / 2 : m;
    bloques.forEach(function (b) {
      if (b.espacio !== undefined) { y += b.espacio; return; }
      ctx.font = b.peso + ' ' + Math.round(b.tam) + 'px ' + FUENTE; ctx.fillStyle = b.color;
      ctx.fillText(b.l, x, y); y += b.tam * 1.32;
    });
    this.textura.needsUpdate = true;
  }
});

/* ---------- 9. Cartela emergente al mirar la obra ----------
   <a-image class="clicable" cartela="titulo: ...; subtitulo: ...; cuerpo: ...; lado: derecha">
   Con la mirada, la cartela NO puede cerrarse "al mirarla": el visitante la
   mira para leerla y se cerraría a los 1,5 s. Por eso:
   - Mirar la obra la ABRE (si ya está abierta, no hace nada).
   - Se cierra con su botón X (esquina superior), al abrir otra cartela o
     al trasladarse a otro lugar.
   La cartela se crea como HERMANA de la obra (no como hija) para que no
   herede el resalte (escala) de la obra. El panel no es .clicable: solo el X. */
AFRAME.registerComponent('cartela', {
  schema: {
    titulo: {default: ''}, subtitulo: {default: ''}, cuerpo: {default: ''},
    lado: {default: 'derecha', oneOf: ['derecha', 'izquierda']},
    ancho: {default: 1.2}, alto: {default: 1.1}, separacion: {default: 0.18}
  },
  init: function () {
    var self = this, d = this.data, s = this.el.sceneEl.systems.museo;
    var anchoObra = Number(this.el.getAttribute('width')) || 1;
    var p = MUSEO.posicion(this.el);
    var signo = d.lado === 'derecha' ? 1 : -1;

    var panel = this.panel = document.createElement('a-entity');
    panel.setAttribute('panel-texto', {titulo: d.titulo, subtitulo: d.subtitulo, cuerpo: d.cuerpo, ancho: d.ancho, alto: d.alto, tamTexto: 0.052, tamSubtitulo: 0.046, tamTitulo: 0.085});
    panel.setAttribute('position', {x: p.x + signo * (anchoObra / 2 + d.separacion + d.ancho / 2), y: p.y, z: p.z + 0.05});
    panel.setAttribute('scale', '0.001 0.001 0.001');
    // Botón X: círculo con geometría propia (el rayo solo prueba la malla del .clicable)
    panel.innerHTML =
      '<a-entity class="clicable cerrar-cartela" position="' + (d.ancho / 2 - 0.11) + ' ' + (d.alto / 2 - 0.11) + ' 0.01"' +
      ' geometry="primitive: circle; radius: 0.085" material="shader: flat; color: #F472B6" resaltar="escala: 1.2">' +
      '<a-entity geometry="primitive: plane; width: 0.1; height: 0.1" position="0 0 0.005"' +
      ' material="shader: flat; src: #icono-cerrar; transparent: true; alphaTest: 0.2"></a-entity></a-entity>';
    this.el.parentNode.appendChild(panel);
    panel.addEventListener('loaded', function () { MUSEO.mostrar(panel, false); });
    this.abierta = false;

    this.el.addEventListener('click', function (evt) {
      if (s.clicValido(evt) && !self.abierta) { self.alternar(true); }   // abrir, nunca cerrar
    });
    panel.querySelector('.cerrar-cartela').addEventListener('click', function (evt) {
      if (s.clicValido(evt) && self.abierta) { self.alternar(false); }
    });

    // Solo una cartela abierta a la vez, y ninguna después de un traslado
    this.el.sceneEl.addEventListener('cartela-abierta', function (e) {
      if (e.detail.el !== self.el && self.abierta) { self.alternar(false, true); }
    });
    this.el.sceneEl.addEventListener('museo-movido', function () { if (self.abierta) { self.alternar(false, true); } });
  },
  alternar: function (abrir, silencio) {
    var panel = this.panel, s = this.el.sceneEl.systems.museo;
    this.abierta = abrir;
    if (!silencio) { s.sonar(abrir ? 'abrir' : 'cerrar'); }
    if (abrir) {
      MUSEO.mostrar(panel, true);
      this.el.sceneEl.emit('cartela-abierta', {el: this.el});
      panel.setAttribute('animation__pop', {property: 'scale', from: '0.001 0.001 0.001', to: '1 1 1', dur: 260, easing: 'easeOutBack'});
    } else {
      panel.setAttribute('animation__pop', {property: 'scale', to: '0.001 0.001 0.001', dur: 160, easing: 'easeInQuad'});
      setTimeout(function () { if (!this.abierta) { MUSEO.mostrar(panel, false); } }.bind(this), 170);
    }
  }
});

/* ---------- 10. Audioguía ----------
   <a-entity class="clicable" audioguia="src: #guia-umbral; fuente: #obra1">
   El sonido es POSICIONAL y sale de la obra: si el visitante se aleja, baja
   el volumen. Solo suena una audioguía a la vez.                             */
AFRAME.registerComponent('audioguia', {
  schema: {src: {type: 'audio'}, fuente: {type: 'selector'}, distancia: {default: 2.5}},
  init: function () {
    var self = this, s = this.el.sceneEl.systems.museo;
    this.icono = this.el.querySelector('.icono');
    this.sonando = false;
    var fuente = this.data.fuente || this.el;
    fuente.setAttribute('sound__guia', {src: this.data.src, positional: true, refDistance: this.data.distancia, rolloffFactor: 1.6, distanceModel: 'inverse'});
    this.sonido = function () { return fuente.components.sound__guia; };
    fuente.addEventListener('sound-ended', function () { self.estado(false); });

    this.el.addEventListener('click', function (evt) {
      if (!s.clicValido(evt)) { return; }
      self.sonando ? self.detener() : self.reproducir();
    });
    this.el.sceneEl.addEventListener('audioguia-inicia', function (e) { if (e.detail.el !== self.el && self.sonando) { self.detener(); } });
  },
  reproducir: function () {
    this.el.sceneEl.emit('audioguia-inicia', {el: this.el});
    this.sonido().playSound(); this.estado(true);
  },
  detener: function () { this.sonido().stopSound(); this.estado(false); },
  estado: function (on) {
    this.sonando = on;
    if (this.icono) { this.icono.setAttribute('material', 'src', on ? '#icono-detener' : '#icono-audio'); }
    this.el.setAttribute('material', 'color', on ? '#8B5CF6' : '#1A2140');
    this.el.emit(on ? 'audioguia-on' : 'audioguia-off');
  }
});

/* ---------- 11. Hotspot sobre un objeto ----------
   <a-sphere class="clicable" hotspot="titulo: ...; cuerpo: ...; lado: derecha">
   Mirar el punto abre una etiqueta unida a él con una línea. Mirarlo de nuevo
   (después de apartar la vista) la cierra. La etiqueta no es .clicable, así
   que se puede leer con calma. Con la mirada los blancos deben ser grandes:
   un punto de 7 cm a 2 m ocupa unos 4°, lo mínimo cómodo en un visor.        */
AFRAME.registerComponent('hotspot', {
  schema: {titulo: {default: ''}, cuerpo: {default: ''}, lado: {default: 'derecha'}, ancho: {default: 0.85}, alto: {default: 0.42}},
  init: function () {
    var self = this, d = this.data, s = this.el.sceneEl.systems.museo;
    var p = MUSEO.posicion(this.el), signo = d.lado === 'derecha' ? 1 : -1;
    var dx = signo * (0.25 + d.ancho / 2), dy = 0.18;

    var grupo = this.grupo = document.createElement('a-entity');
    grupo.setAttribute('position', {x: p.x, y: p.y, z: p.z});
    grupo.innerHTML =
      '<a-entity line="start: 0 0 0; end: ' + (dx - signo * d.ancho / 2) + ' ' + dy + ' 0; color: #22D3EE"></a-entity>' +
      '<a-entity class="etiqueta" position="' + dx + ' ' + dy + ' 0"></a-entity>';
    this.el.parentNode.appendChild(grupo);
    grupo.querySelector('.etiqueta').setAttribute('panel-texto', {titulo: d.titulo, cuerpo: d.cuerpo, ancho: d.ancho, alto: d.alto, tamTitulo: 0.052, tamTexto: 0.04, margen: 0.04});
    grupo.addEventListener('loaded', function () { MUSEO.mostrar(grupo, false); });
    this.abierto = false;

    this.el.addEventListener('click', function (evt) {
      if (!s.clicValido(evt)) { return; }
      self.abrir(!self.abierto);
    });
    this.el.sceneEl.addEventListener('hotspot-abierto', function (e) { if (e.detail.el !== self.el && self.abierto) { self.abrir(false, true); } });
    this.el.sceneEl.addEventListener('museo-movido', function () { if (self.abierto) { self.abrir(false, true); } });
  },
  abrir: function (on, silencio) {
    this.abierto = on;
    MUSEO.mostrar(this.grupo, on);
    this.el.setAttribute('material', 'color', on ? '#F472B6' : '#22D3EE');
    if (on) { this.el.sceneEl.emit('hotspot-abierto', {el: this.el}); }
    if (!silencio) { this.el.sceneEl.systems.museo.sonar(on ? 'abrir' : 'cerrar'); }
  }
});

/* ---------- 12. Carrusel "siguiente / anterior" ----------
   <a-entity carrusel="imagenes: #a1, #a2, #a3; textos: Texto 1 | Texto 2 | Texto 3">
      <a-image class="carrusel-imagen"> <a-entity class="carrusel-texto"> <a-entity class="carrusel-contador">
      <a-entity carrusel-boton="dir: -1">  <a-entity carrusel-boton="dir: 1">
   La imagen se funde a negro, cambia y vuelve (0,35 s).                       */
AFRAME.registerComponent('carrusel', {
  schema: {imagenes: {type: 'array'}, textos: {default: ''}},
  init: function () {
    this.i = 0; this.textos = this.data.textos.split('|').map(function (t) { return t.trim(); });
    this.img = this.el.querySelector('.carrusel-imagen');
    this.txt = this.el.querySelector('.carrusel-texto');
    this.cont = this.el.querySelector('.carrusel-contador');
    this.trans = null;
    this.el.addEventListener('loaded', this.pintar.bind(this));
  },
  cambiar: function (dir) {
    if (this.trans) { return; }
    var n = this.data.imagenes.length;
    this.siguiente = (this.i + dir + n) % n;
    this.trans = {t: 0, cambiado: false};
  },
  pintar: function () {
    var n = this.data.imagenes.length;
    this.img.setAttribute('src', this.data.imagenes[this.i]);
    if (this.txt) { this.txt.setAttribute('panel-texto', 'cuerpo', this.textos[this.i] || ''); }
    if (this.cont) { this.cont.setAttribute('panel-texto', 'titulo', (this.i + 1) + ' / ' + n); }
  },
  tick: function (t, dt) {
    var tr = this.trans; if (!tr) { return; }
    tr.t += dt / 350;
    var op = tr.t < 0.5 ? 1 - tr.t * 2 : (tr.t - 0.5) * 2;
    if (tr.t >= 0.5 && !tr.cambiado) { tr.cambiado = true; this.i = this.siguiente; this.pintar(); }
    var m = this.img.getObject3D('mesh'); if (m) { m.material.opacity = Math.min(Math.max(op, 0), 1); }
    if (tr.t >= 1) { this.trans = null; if (m) { m.material.opacity = 1; } }
  }
});

/* El fuse dispara una sola vez por mirada. Para hojear sin apartar la vista,
   el botón REPITE cada "repetir" ms mientras la mirada siga sobre él
   (A-Frame le pone el estado "cursor-hovered" al objeto que el cursor toca). */
AFRAME.registerComponent('carrusel-boton', {
  schema: {dir: {type: 'int', default: 1}, repetir: {default: 1300}},
  init: function () {
    var self = this, s = this.sistema = this.el.sceneEl.systems.museo;
    this.el.classList.add('clicable');
    this.el.addEventListener('click', function (evt) {
      if (!s.clicValido(evt)) { return; }
      self.avanzar(); self.programar();
    });
    this.el.addEventListener('mouseleave', function () { clearTimeout(self.temporizador); });
  },
  avanzar: function () {
    var c = this.el.closest('[carrusel]');
    if (c) { c.components.carrusel.cambiar(this.data.dir); }
  },
  programar: function () {
    var self = this;
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(function () {
      if (self.el.is('cursor-hovered') && self.el.classList.contains('clicable') && !self.sistema.ocupado) {
        self.avanzar(); self.sistema.sonar('clic'); self.programar();
      }
    }, this.data.repetir);
  },
  remove: function () { clearTimeout(this.temporizador); }
});

/* ---------- 13. Pantalla de video ----------
   <a-video src="#video-continuo" class="bloquea" pantalla-video="zona: proyeccion">
   play()/pause() sobre el <video> de <a-assets>.
   Con la mirada, la PANTALLA NO ES UN BOTÓN: el visitante la mira para ver el
   video y la pausaría sin querer. Se controla con:
   - el botón de play al centro (.overlay-play), visible solo en pausa,
   - los botones .control-video (debajo de la pantalla y junto a la butaca).
   Muestra una barra de progreso y se pausa sola al salir de la zona.        */
AFRAME.registerComponent('pantalla-video', {
  schema: {zona: {default: ''}, barra: {type: 'selector'}, botones: {default: '.control-video'}},
  init: function () {
    var self = this, s = this.el.sceneEl.systems.museo;
    this.video = document.querySelector(this.el.getAttribute('src'));
    this.overlay = this.el.querySelector('.overlay-play');
    this.alternar = function (evt) { if (s.clicValido(evt)) { self.video.paused ? self.reproducir() : self.pausar(); } };
    document.querySelectorAll(this.data.botones).forEach(function (b) { b.addEventListener('click', self.alternar); });
    this.video.addEventListener('play', function () { self.estado(); });
    this.video.addEventListener('pause', function () { self.estado(); });
    this.el.sceneEl.addEventListener('zona-salir', function (e) { if (e.detail.nombre === self.data.zona) { self.pausar(); } });
  },
  reproducir: function () {
    var p = this.video.play();
    if (p && p.catch) { p.catch(function (err) { console.warn('El navegador bloqueó el video:', err.message); }); }
  },
  pausar: function () { this.video.pause(); },
  estado: function () {
    var pausa = this.video.paused;
    if (this.overlay) { MUSEO.mostrar(this.overlay, pausa); }   // oculto también deja de ser .clicable
    document.querySelectorAll('.icono-control-video').forEach(function (i) { i.setAttribute('material', 'src', pausa ? '#icono-play' : '#icono-pausa'); });
  },
  tick: function () {
    var b = this.data.barra, v = this.video;
    if (!b || !v.duration) { return; }
    var p = Math.max(v.currentTime / v.duration, 0.001), w = Number(this.el.getAttribute('width')) || 1;
    b.object3D.scale.x = p; b.object3D.position.x = -w / 2 + (w * p) / 2;
  }
});

/* ---------- 14. Sonido ambiente por zonas ----------
   <a-entity zona-sonido="nombre: galeria; src: #amb-galeria; min: -7 -1 -7; max: 7 2.9 7; volumen: 0.5">
   Si la cabeza del visitante está dentro de la caja [min, max] el ambiente
   sube; si no, baja. Los cambios son fundidos de ~1 s.
   Emite "zona-entrar" / "zona-salir" en la escena con {nombre}.             */
AFRAME.registerComponent('zona-sonido', {
  schema: {nombre: {default: ''}, src: {type: 'audio'}, min: {type: 'vec3'}, max: {type: 'vec3'}, volumen: {default: 0.5}, fundido: {default: 1.2}},
  init: function () {
    var self = this;
    this.v = 0; this.dentro = false; this.listo = false;
    this.caja = new THREE.Box3(); this.pos = new THREE.Vector3();
    this.el.setAttribute('sound', {src: this.data.src, loop: true, positional: false, volume: 0});
    this.el.sceneEl.addEventListener('museo-audio-listo', function () {
      var snd = self.el.components.sound;
      if (snd.loaded) { snd.playSound(); } else { self.el.addEventListener('sound-loaded', function () { snd.playSound(); }, {once: true}); }
      self.listo = true;
    });
  },
  update: function () { this.caja.set(this.data.min, this.data.max); },
  tick: function (t, dt) {
    var cam = this.el.sceneEl.systems.museo.camara();
    cam.object3D.getWorldPosition(this.pos);
    var dentro = this.caja.containsPoint(this.pos);
    if (dentro !== this.dentro) {
      this.dentro = dentro;
      this.el.sceneEl.emit(dentro ? 'zona-entrar' : 'zona-salir', {nombre: this.data.nombre});
    }
    if (!this.listo) { return; }
    var meta = dentro ? this.data.volumen : 0, paso = this.data.volumen * dt / 1000 / this.data.fundido;
    if (this.v === meta) { return; }
    this.v = this.v < meta ? Math.min(this.v + paso, meta) : Math.max(this.v - paso, meta);
    var pool = this.el.components.sound.pool.children;
    for (var i = 0; i < pool.length; i++) { pool[i].setVolume(this.v); }
  }
});

/* ---------- 15. Auxiliares ---------- */
// Gira la entidad (solo en Y) para que siempre mire al visitante.
AFRAME.registerComponent('mirar-camara', {
  init: function () { this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); },
  tick: function () {
    var cam = this.el.sceneEl.camera; if (!cam) { return; }
    cam.getWorldPosition(this.a); this.el.object3D.getWorldPosition(this.b);
    this.el.object3D.rotation.y = Math.atan2(this.a.x - this.b.x, this.a.z - this.b.z);
  }
});

// Latido suave para señalar que algo es interactivo (hotspots, marcadores).
AFRAME.registerComponent('pulso', {
  schema: {amplitud: {default: 0.15}, velocidad: {default: 2.5}},
  init: function () { this.base = this.el.object3D.scale.clone(); this.fase = Math.random() * 6; },
  tick: function (t) {
    var f = 1 + this.data.amplitud * Math.sin(t / 1000 * this.data.velocidad + this.fase);
    this.el.object3D.scale.copy(this.base).multiplyScalar(f);
  }
});

/* ---------- 16. Mira del cursor de mirada ----------
   <a-cursor fuse="true" ... mira-cursor>   (dentro de la cámara)
   El <a-cursor> trae un anillo fijo a 1 m. En un visor eso falla: si la obra
   está a 3 m y la mira a 1 m, los ojos no pueden enfocar ambas y la mira se
   ve DOBLE. Esta mira se coloca a la distancia de lo que se está mirando y
   se escala con esa distancia, así siempre ocupa el mismo ángulo.
   Además dibuja el ANILLO DE CARGA:
   - sobre algo .clicable: avanza durante el fuseTimeout del cursor,
   - sobre el piso: avanza con la espera de teletransporte del sistema.
   IMPORTANTE: el <a-cursor> debe estar en position="0 0 0" (centro de la
   cámara), porque el rayo sale de la posición del cursor. Su propio anillo
   se oculta con material="visible: false".                                  */
AFRAME.registerComponent('mira-cursor', {
  schema: {
    radio: {default: 0.014},              // radio de la mira a 1 m (≈ 1,6° de diámetro)
    color: {type: 'color', default: '#FFFFFF'},
    colorActivo: {type: 'color', default: '#22D3EE'},
    min: {default: 0.5}, max: {default: 12}
  },
  init: function () {
    var d = this.data, self = this;
    this.sistema = this.el.sceneEl.systems.museo;
    this.inicioFuse = 0;
    function material (color, opacidad) {
      return new THREE.MeshBasicMaterial({color: color, transparent: true, opacity: opacidad, depthTest: false, depthWrite: false});
    }
    var g = this.grupo = new THREE.Group();
    // Contorno oscuro + punto claro: se ve sobre fondos claros y oscuros
    this.contorno = new THREE.Mesh(new THREE.RingGeometry(d.radio * 0.45, d.radio * 1.25, 32), material('#0A0E1A', 0.55));
    this.punto = new THREE.Mesh(new THREE.RingGeometry(d.radio * 0.6, d.radio, 32), material(d.color, 0.95));
    // Anillo de carga: se dibuja solo una parte (drawRange) según el progreso
    this.segmentos = 48;
    var geo = new THREE.RingGeometry(d.radio * 1.7, d.radio * 2.4, this.segmentos, 1, Math.PI / 2, Math.PI * 2);
    this.carga = new THREE.Mesh(geo, material(d.colorActivo, 1));
    this.carga.scale.x = -1;                      // avanza en sentido horario
    this.fondoCarga = new THREE.Mesh(new THREE.RingGeometry(d.radio * 1.7, d.radio * 2.4, 48), material('#0A0E1A', 0.45));
    [this.contorno, this.punto, this.fondoCarga, this.carga].forEach(function (m, i) { m.renderOrder = 9990 + i; g.add(m); });
    // Va dentro de la cámara (padre del cursor), no del cursor: así no la toca el raycaster
    this.el.addEventListener('loaded', function () { self.el.parentNode.object3D.add(g); }, {once: true});

    this.el.addEventListener('fusing', function () { self.inicioFuse = performance.now(); });
    this.el.addEventListener('mouseleave', function () { self.inicioFuse = 0; });
    this.el.addEventListener('click', function () { self.inicioFuse = 0; });
  },
  remove: function () { if (this.grupo.parent) { this.grupo.parent.remove(this.grupo); } },
  tick: function () {
    var d = this.data, rc = this.el.components.raycaster, cursor = this.el.components.cursor;
    if (!rc || !cursor) { return; }
    // 1. Distancia: la del primer objeto que toca el rayo
    var dist = rc.intersections.length ? rc.intersections[0].distance : 4;
    dist = Math.min(Math.max(dist * 0.97, d.min), d.max);
    this.grupo.position.set(0, 0, -dist);
    this.grupo.scale.setScalar(dist);

    // 2. Progreso: fuse sobre .clicable o espera sobre el piso
    var objetivo = cursor.intersectedEl, progreso = 0, sobreClicable = false;
    if (!this.sistema.ocupado) {
      if (objetivo && objetivo.classList.contains('clicable')) {
        sobreClicable = true;
        if (this.inicioFuse && this.el.is('cursor-fusing')) {
          progreso = (performance.now() - this.inicioFuse) / cursor.data.fuseTimeout;
        }
      } else if (this.sistema.piso.progreso > 0) {
        progreso = this.sistema.piso.progreso;
      }
    }
    progreso = Math.min(Math.max(progreso, 0), 1);
    var n = Math.round(progreso * this.segmentos);
    this.carga.geometry.setDrawRange(0, n * 6);   // 6 índices (2 triángulos) por segmento
    this.carga.visible = n > 0;
    this.fondoCarga.visible = n > 0;
    this.punto.material.color.set(sobreClicable ? d.colorActivo : d.color);
  }
});

/* ---------- 17. Visor estéreo de respaldo ----------
   <a-scene visor-estereo>
   Para un visor de celular hay dos caminos:
   a) WebXR (Chrome en Android, y también Meta Quest): scene.enterVR() abre
      la sesión inmersiva. Es la mejor opción y la usa si existe.
   b) Sin WebXR (todos los iPhone: Safari y Chrome usan el motor de Safari):
      A-Frame ni siquiera muestra el botón VR. Este componente divide la
      pantalla en dos vistas (ojo izquierdo/derecho) con THREE.StereoCamera,
      y la cabeza se sigue con los sensores del teléfono (look-controls).
      No corrige la distorsión de las lentes: es un respaldo, no un sustituto. */
AFRAME.registerComponent('visor-estereo', {
  schema: {separacion: {default: 0.064}},     // distancia entre ojos (m)
  init: function () {
    this.activo = false;
    this.stereo = new THREE.StereoCamera();
    this.stereo.aspect = 0.5;                   // cada ojo usa media pantalla
    this.tam = new THREE.Vector2();
    this.parcheado = false;
  },
  /* Reemplaza renderer.render por una versión que dibuja dos vistas.
     Si no está activo o hay una sesión WebXR, dibuja normal. */
  parchear: function () {
    if (this.parcheado) { return; }
    var self = this, r = this.el.renderer, original = r.render;
    r.render = function (escena, camara) {
      if (!self.activo || r.xr.isPresenting) { return original.call(r, escena, camara); }
      camara.updateMatrixWorld();
      self.stereo.eyeSep = self.data.separacion;
      self.stereo.update(camara);
      r.getSize(self.tam);
      var w = self.tam.x / 2, h = self.tam.y;
      r.setScissorTest(true);
      r.setScissor(0, 0, w, h); r.setViewport(0, 0, w, h);
      original.call(r, escena, self.stereo.cameraL);
      r.setScissor(w, 0, w, h); r.setViewport(w, 0, w, h);
      original.call(r, escena, self.stereo.cameraR);
      r.setScissorTest(false);
      r.setViewport(0, 0, self.tam.x, self.tam.y);
    };
    this.parcheado = true;
  },
  /* Llamar dentro de un gesto del usuario (clic en un botón). */
  entrar: function () {
    var esc = this.el;
    if (AFRAME.utils.device.checkVRSupport()) {
      esc.enterVR().catch(function (e) { console.warn('No se pudo entrar en VR:', e); });
      return 'webxr';
    }
    this.parchear();
    this.activo = true;
    esc.addState('modo-visor');
    document.body.classList.add('modo-visor');
    var doc = document.documentElement;
    if (doc.requestFullscreen) {
      doc.requestFullscreen({navigationUI: 'hide'}).then(function () {
        if (screen.orientation && screen.orientation.lock) { screen.orientation.lock('landscape').catch(function () {}); }
      }).catch(function () {});
    }
    // Que la pantalla no se apague mientras está en el visor
    if (navigator.wakeLock) { navigator.wakeLock.request('screen').then(function (l) { esc._wakeLock = l; }).catch(function () {}); }
    esc.emit('modo-visor', {activo: true});
    return 'estereo';
  },
  salir: function () {
    var esc = this.el;
    if (esc.is('vr-mode')) { esc.exitVR(); }
    this.activo = false;
    esc.removeState('modo-visor');
    document.body.classList.remove('modo-visor');
    if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); }
    if (esc._wakeLock) { esc._wakeLock.release(); esc._wakeLock = null; }
    esc.emit('modo-visor', {activo: false});
  }
});
