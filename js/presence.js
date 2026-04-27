// ============================================
// EduGames Platform - Presence System
// ============================================
// Sistema de presencia en vivo:
// - Marca usuario como online al entrar a cualquier página
// - Latido cada 60 seg (solo si pestaña visible)
// - Auto-offline cuando cierra navegador / pierde conexión
// - Registra rol en RTDB para que reglas funcionen
// - Guarda historial de sesiones en Firestore al desconectar
//
// USO en cada página:
//   import { initPresence } from './js/presence.js';
//   initPresence(user, 'multiplica-kart', '🏎️ Multiplica Kart');
//
// El parámetro `user` es el objeto que devuelve requireAuth()
// ============================================

import { rtdb, db } from './firebase-config.js';
import {
  ref, set, onDisconnect, serverTimestamp as rtdbTimestamp,
  onValue, off
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  collection, addDoc, doc, updateDoc, increment,
  serverTimestamp as fsTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Estado interno del módulo ──
let _user = null;
let _ubicacion = null;
let _ubicacionLabel = null;
let _heartbeatInterval = null;
let _sessionStart = null;
let _ubicacionStart = null;
let _ubicacionesHistory = [];
let _isInitialized = false;

const HEARTBEAT_MS = 60_000; // 60 segundos

// ============================================
// FUNCIÓN PRINCIPAL: initPresence()
// ============================================
export async function initPresence(user, ubicacionKey, ubicacionLabel){
  if(!user || !user.uid){
    console.warn('[presence] No hay usuario autenticado, abortando');
    return;
  }

  _user = user;
  _ubicacion = ubicacionKey;
  _ubicacionLabel = ubicacionLabel;

  // Si ya está inicializado en esta página, solo actualizar ubicación
  if(_isInitialized){
    return updateUbicacion(ubicacionKey, ubicacionLabel);
  }

  _isInitialized = true;
  _sessionStart = Date.now();
  _ubicacionStart = Date.now();
  _ubicacionesHistory = [];

  try {
    // 1. Registrar el ROL del usuario en RTDB (necesario para reglas)
    //    Solo se escribe en cada login, es ~10 bytes
    await set(ref(rtdb, `roles/${user.uid}`), user.rol || 'alumno');

    // 2. Configurar onDisconnect ANTES de marcar como online
    //    Esto se ejecuta automáticamente cuando se cierra navegador
    const presenceRef = ref(rtdb, `presence/${user.uid}`);
    await onDisconnect(presenceRef).set({
      online: false,
      ultimoLatido: rtdbTimestamp(),
      nombre: getDisplayName(user),
      rol: user.rol || 'alumno',
      ubicacion: 'offline',
      ubicacionLabel: 'Desconectado'
    });

    // 3. Marcar como online + escribir ubicación inicial
    await set(presenceRef, {
      online: true,
      ultimoLatido: rtdbTimestamp(),
      conectadoDesde: rtdbTimestamp(),
      nombre: getDisplayName(user),
      rol: user.rol || 'alumno',
      ubicacion: ubicacionKey,
      ubicacionLabel: ubicacionLabel
    });

    // 4. Iniciar heartbeat (solo si pestaña visible)
    startHeartbeat();

    // 5. Listener de visibilidad (pausa heartbeat si minimiza)
    document.addEventListener('visibilitychange', onVisibilityChange);

    // 6. Antes de cerrar página, guardar sesión en Firestore
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);

    console.log('[presence] ✅ Inicializado:', user.uid, '→', ubicacionLabel);
  } catch(err){
    console.error('[presence] Error inicializando:', err);
  }
}

// ============================================
// CAMBIAR DE UBICACIÓN (ej. de menu a juego)
// ============================================
async function updateUbicacion(newKey, newLabel){
  if(!_user) return;

  // Cerrar la ubicación anterior y agregarla al historial
  const now = Date.now();
  if(_ubicacionStart && _ubicacion){
    _ubicacionesHistory.push({
      pagina: _ubicacion,
      label: _ubicacionLabel,
      desde: _ubicacionStart,
      hasta: now,
      segundos: Math.round((now - _ubicacionStart) / 1000)
    });
  }

  _ubicacion = newKey;
  _ubicacionLabel = newLabel;
  _ubicacionStart = now;

  try {
    await set(ref(rtdb, `presence/${_user.uid}`), {
      online: true,
      ultimoLatido: rtdbTimestamp(),
      conectadoDesde: _sessionStart,
      nombre: getDisplayName(_user),
      rol: _user.rol || 'alumno',
      ubicacion: newKey,
      ubicacionLabel: newLabel
    });
  } catch(err){
    console.warn('[presence] Error actualizando ubicación:', err);
  }
}

// ============================================
// HEARTBEAT (latido cada 60s si visible)
// ============================================
function startHeartbeat(){
  if(_heartbeatInterval) clearInterval(_heartbeatInterval);
  _heartbeatInterval = setInterval(()=>{
    if(document.visibilityState === 'visible'){
      sendHeartbeat();
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat(){
  if(_heartbeatInterval){
    clearInterval(_heartbeatInterval);
    _heartbeatInterval = null;
  }
}

async function sendHeartbeat(){
  if(!_user) return;
  try {
    await set(ref(rtdb, `presence/${_user.uid}/ultimoLatido`), rtdbTimestamp());
  } catch(err){
    console.warn('[presence] Error en heartbeat:', err);
  }
}

// ============================================
// VISIBILITY CHANGE (pestaña activa/inactiva)
// ============================================
function onVisibilityChange(){
  if(document.visibilityState === 'visible'){
    // Volvió a primer plano → enviar latido inmediato
    sendHeartbeat();
  }
  // Si está oculta, el interval simplemente no envía (ahorra recursos)
}

// ============================================
// BEFORE UNLOAD (cerrar pestaña/navegar)
// ============================================
function onBeforeUnload(){
  // Marcar offline manualmente (más confiable que onDisconnect en algunas conexiones)
  if(_user){
    try {
      // Cerrar última ubicación
      const now = Date.now();
      if(_ubicacionStart && _ubicacion){
        _ubicacionesHistory.push({
          pagina: _ubicacion,
          label: _ubicacionLabel,
          desde: _ubicacionStart,
          hasta: now,
          segundos: Math.round((now - _ubicacionStart) / 1000)
        });
      }
      // Marcar offline (sync, no espera)
      set(ref(rtdb, `presence/${_user.uid}`), {
        online: false,
        ultimoLatido: rtdbTimestamp(),
        nombre: getDisplayName(_user),
        rol: _user.rol || 'alumno',
        ubicacion: 'offline',
        ubicacionLabel: 'Desconectado'
      });
    } catch(e){}
  }
}

// pagehide es más confiable en mobile/Safari que beforeunload
function onPageHide(){
  saveSesionToFirestore();
}

// ============================================
// GUARDAR SESIÓN EN FIRESTORE (al cerrar)
// ============================================
async function saveSesionToFirestore(){
  if(!_user || !_sessionStart) return;
  const now = Date.now();
  const duracionSegundos = Math.round((now - _sessionStart) / 1000);

  // Solo guardar sesiones > 30 segundos (filtra clicks accidentales)
  if(duracionSegundos < 30) return;

  try {
    const sesionData = {
      inicio: new Date(_sessionStart),
      fin: new Date(now),
      duracionSegundos,
      ubicaciones: _ubicacionesHistory,
      ubicacionFinal: _ubicacion,
      ubicacionFinalLabel: _ubicacionLabel,
      creadoEn: fsTimestamp()
    };
    // Usar sendBeacon-style (no esperamos respuesta, página se está cerrando)
    addDoc(collection(db, 'users', _user.uid, 'sesiones'), sesionData);
    // Incrementar tiempo total acumulado
    updateDoc(doc(db, 'users', _user.uid), {
      'stats.tiempoTotalSegundos': increment(duracionSegundos),
      'stats.ultimoAcceso': fsTimestamp()
    });
  } catch(err){
    console.warn('[presence] Error guardando sesión:', err);
  }
}

// ============================================
// HELPERS
// ============================================
function getDisplayName(user){
  if(user.nombre) return user.nombre;
  if(user.email) return user.email.split('@')[0];
  return 'Usuario';
}

// ============================================
// FUNCIONES PARA EL PANEL ADMIN
// ============================================

// Escuchar TODA la presencia en vivo (solo admins)
// Devuelve función para detener el listener
export function watchAllPresence(callback){
  const presenceRef = ref(rtdb, 'presence');
  const listener = onValue(presenceRef, (snapshot)=>{
    const data = snapshot.val() || {};
    callback(data);
  }, (err)=>{
    console.error('[presence] Error escuchando presencia:', err);
    callback({});
  });
  return () => off(presenceRef, 'value', listener);
}

// Calcular estado de presencia basado en ultimoLatido
// Returns: 'online' | 'inactive' | 'offline'
export function computeStatus(presenceData){
  if(!presenceData) return 'offline';
  if(!presenceData.online) return 'offline';
  const now = Date.now();
  const last = presenceData.ultimoLatido;
  if(!last) return 'offline';
  const diff = now - last;
  if(diff < 90_000) return 'online';        // < 1.5 min
  if(diff < 180_000) return 'inactive';     // < 3 min
  return 'offline';                          // >= 3 min
}

// Formatear "hace X tiempo"
export function formatTimeAgo(timestamp){
  if(!timestamp) return '—';
  const now = Date.now();
  const diff = now - timestamp;
  const sec = Math.floor(diff / 1000);
  if(sec < 60) return 'ahora mismo';
  const min = Math.floor(sec / 60);
  if(min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if(hr < 24) return `hace ${hr}h`;
  const days = Math.floor(hr / 24);
  return `hace ${days}d`;
}

// Formatear duración en segundos a "Xh Ym Zs"
export function formatDuration(seconds){
  if(!seconds || seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if(h > 0) return `${h}h ${m}m`;
  if(m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
