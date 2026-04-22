// ============================================
// EduGamePlay - Admin Panel Logic
// ============================================
// Panel completo con:
// - CRUD de usuarios (crear, listar, editar, desactivar, eliminar)
// - Crear usuarios SIN perder tu sesión de admin (Opción C: doble instancia Firebase)
// - Filtros, búsqueda
// - Estadísticas básicas
// ============================================

import { requireRole, logout, getDisplayName } from './auth.js';
import { app, auth, db } from './firebase-config.js';
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as authSignOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, setDoc, getDocs, getDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============================================
// 1. VERIFICAR QUE ES ADMIN
// ============================================
let currentAdmin;
try {
  currentAdmin = await requireRole('admin');
} catch(err){
  throw err; // requireRole ya redirigió
}

// Llenar nav
document.getElementById('adminName').textContent = getDisplayName(currentAdmin);

// Ocultar loading
document.getElementById('auth-loading').style.display = 'none';

// Logout button
document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  if(confirm('¿Cerrar sesión?')){
    await logout('index.html');
  }
});

// ============================================
// 2. OPCIÓN C: INSTANCIA SECUNDARIA DE FIREBASE
// ============================================
// Esta segunda instancia se usa SOLO para crear nuevos usuarios
// sin afectar nuestra sesión de admin en la instancia principal.
// Clave: mismo firebaseConfig, nombre distinto para la app.
// ============================================
import { app as mainApp } from './firebase-config.js';
// Extraemos la config de la app principal
const firebaseConfig = mainApp.options;
const secondaryApp = initializeApp(firebaseConfig, 'AdminCreator_' + Date.now());
const secondaryAuth = getAuth(secondaryApp);

// ============================================
// 3. TABS
// ============================================
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t===tab));
    document.querySelectorAll('.tab-content').forEach(c=>{
      c.classList.toggle('active', c.id === `tab-${target}`);
    });

    if(target === 'stats'){
      loadStatsTab();
    }
  });
});

// ============================================
// 4. ESTADO DE LA APP
// ============================================
let allUsers = []; // caché de todos los usuarios
let currentFilter = 'all';
let currentSearch = '';

// ============================================
// 5. CARGAR USUARIOS
// ============================================
async function loadUsers(){
  try{
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    allUsers = [];
    snapshot.forEach(d => {
      allUsers.push({ id: d.id, ...d.data() });
    });
    // Ordenar: admins primero, luego docentes, luego alumnos; y por fecha de creación desc
    allUsers.sort((a,b)=>{
      const rolOrder = {admin:0, docente:1, alumno:2};
      const oa = rolOrder[a.rol] ?? 99;
      const ob = rolOrder[b.rol] ?? 99;
      if(oa !== ob) return oa - ob;
      const ta = a.creadoEn?.seconds || 0;
      const tb = b.creadoEn?.seconds || 0;
      return tb - ta;
    });

    renderUsers();
    renderQuickStats();
  } catch(err){
    console.error('Error cargando usuarios:', err);
    document.getElementById('usersList').innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠️</div>
        <div>Error cargando usuarios: ${err.message}</div>
      </div>`;
  }
}

function renderQuickStats(){
  const total = allUsers.length;
  const admins = allUsers.filter(u=>u.rol==='admin').length;
  const docentes = allUsers.filter(u=>u.rol==='docente').length;
  const alumnos = allUsers.filter(u=>u.rol==='alumno').length;
  document.getElementById('stTotal').textContent = total;
  document.getElementById('stAdmins').textContent = admins;
  document.getElementById('stDocentes').textContent = docentes;
  document.getElementById('stAlumnos').textContent = alumnos;
}

function renderUsers(){
  const list = document.getElementById('usersList');
  // Aplicar filtro
  let filtered = allUsers;
  if(currentFilter === 'admin') filtered = filtered.filter(u=>u.rol==='admin');
  else if(currentFilter === 'docente') filtered = filtered.filter(u=>u.rol==='docente');
  else if(currentFilter === 'alumno') filtered = filtered.filter(u=>u.rol==='alumno');
  else if(currentFilter === 'inactive') filtered = filtered.filter(u=>u.activo === false);

  // Aplicar búsqueda
  if(currentSearch){
    const q = currentSearch.toLowerCase();
    filtered = filtered.filter(u=>
      (u.nombre||'').toLowerCase().includes(q) ||
      (u.email||'').toLowerCase().includes(q)
    );
  }

  if(filtered.length === 0){
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <div>No se encontraron usuarios${currentSearch ? ` para "${currentSearch}"` : ''}.</div>
      </div>`;
    return;
  }

  list.innerHTML = filtered.map(u => renderUserRow(u)).join('');

  // Adjuntar eventos a botones de acción
  list.querySelectorAll('[data-action]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const action = btn.dataset.action;
      const uid = btn.dataset.uid;
      const user = allUsers.find(u => u.id === uid);
      if(!user) return;
      if(action === 'edit') openEditModal(user);
      else if(action === 'toggle') toggleActive(user);
      else if(action === 'delete') openDeleteModal(user);
    });
  });
}

function renderUserRow(u){
  const rolLabel = {admin:'👑 Admin', docente:'🎓 Docente', alumno:'📚 Alumno'}[u.rol] || '👤';
  const rolClass = `role-${u.rol || 'alumno'}`;
  const activo = u.activo !== false;
  const created = u.creadoEn ? formatDate(u.creadoEn) : '—';
  const isSelf = u.id === currentAdmin.uid;

  return `
    <div class="user-row">
      <div class="user-cell-name">
        <div class="name">${escapeHtml(u.nombre || 'Sin nombre')}${isSelf ? ' <span style="color:var(--purple);font-size:10px;">(tú)</span>' : ''}</div>
        <div class="email">${escapeHtml(u.email || '—')}</div>
      </div>
      <div class="user-cell-role">
        <span class="role-pill ${rolClass}">${rolLabel}</span>
      </div>
      <div class="user-cell-status">
        <span class="status-pill ${activo ? 'status-active' : 'status-inactive'}">
          ${activo ? '● Activo' : '○ Inactivo'}
        </span>
      </div>
      <div class="user-cell-created" style="color:var(--muted);font-size:11px;">${created}</div>
      <div class="row-actions">
        <button class="row-btn" data-action="edit" data-uid="${u.id}" title="Editar">✏️</button>
        <button class="row-btn" data-action="toggle" data-uid="${u.id}" title="${activo?'Desactivar':'Activar'}">${activo?'💤':'🟢'}</button>
        ${isSelf ? '' : `<button class="row-btn danger" data-action="delete" data-uid="${u.id}" title="Eliminar">🗑️</button>`}
      </div>
    </div>
  `;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

function formatDate(ts){
  if(!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
  return d.toLocaleDateString('es-MX', {day:'2-digit', month:'2-digit', year:'2-digit'});
}

// ============================================
// 6. FILTROS Y BÚSQUEDA
// ============================================
document.querySelectorAll('.chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    document.querySelectorAll('.chip').forEach(c=>c.classList.toggle('active', c===chip));
    currentFilter = chip.dataset.filter;
    renderUsers();
  });
});

let searchDebounce;
document.getElementById('searchInput').addEventListener('input', (e)=>{
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(()=>{
    currentSearch = e.target.value.trim();
    renderUsers();
  }, 200);
});

// ============================================
// 7. CREAR USUARIO
// ============================================
const modalCreate = document.getElementById('modalCreate');
const modalCreds = document.getElementById('modalCreds');
const createForm = document.getElementById('createForm');
const createAlert = document.getElementById('createAlert');

function showAlert(el, msg, type='error'){
  el.textContent = msg;
  el.className = `alert show ${type}`;
}
function hideAlert(el){ el.className = 'alert'; }

function generatePassword(){
  const words = ['gato','sol','luna','mar','rio','arbol','flor','estrella','nube','pez'];
  const w = words[Math.floor(Math.random()*words.length)];
  const n = Math.floor(Math.random()*900)+100;
  return w + n;
}

function translateError(code){
  const errors = {
    'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
    'auth/invalid-email': 'El correo no tiene un formato válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/network-request-failed': 'Sin conexión a internet.',
    'permission-denied': 'Sin permisos. Revisa las reglas de Firestore.'
  };
  return errors[code] || `Error: ${code || 'desconocido'}`;
}

document.getElementById('openCreateBtn').addEventListener('click', ()=>{
  createForm.reset();
  document.getElementById('cRol').value = 'alumno';
  hideAlert(createAlert);
  modalCreate.classList.add('show');
});

document.getElementById('cCancel').addEventListener('click', ()=>{
  modalCreate.classList.remove('show');
});
modalCreate.addEventListener('click', (e)=>{
  if(e.target === modalCreate) modalCreate.classList.remove('show');
});

document.getElementById('cPwToggle').addEventListener('click', ()=>{
  const el = document.getElementById('cPassword');
  if(el.type === 'password'){ el.type='text'; } else { el.type='password'; }
});

document.getElementById('cGenPw').addEventListener('click', ()=>{
  document.getElementById('cPassword').value = generatePassword();
  document.getElementById('cPassword').type = 'text';
});

createForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  hideAlert(createAlert);

  const nombre = document.getElementById('cNombre').value.trim();
  const email = document.getElementById('cEmail').value.trim();
  const rol = document.getElementById('cRol').value;
  const password = document.getElementById('cPassword').value;

  if(!nombre || !email || !password || password.length < 6){
    showAlert(createAlert, 'Completa todos los campos correctamente (contraseña mínima 6 caracteres).');
    return;
  }

  const btn = document.getElementById('cSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Creando...';

  try{
    // 1. Crear usuario en la INSTANCIA SECUNDARIA (no afecta sesión admin)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = cred.user.uid;

    // 2. Crear documento en Firestore
    await setDoc(doc(db, 'users', newUid), {
      email: email,
      nombre: nombre,
      rol: rol,
      activo: true,
      primerLogin: true,  // Forzar completar perfil en primer login
      creadoEn: serverTimestamp(),
      creadoPor: currentAdmin.uid,
      stats: {
        totalPartidas: 0,
        tiempoTotalSegundos: 0,
        juegosJugados: {}
      }
    });

    // 3. Cerrar sesión de la instancia secundaria (limpieza)
    await authSignOut(secondaryAuth);

    // 4. Mostrar credenciales
    document.getElementById('credEmail').textContent = email;
    document.getElementById('credPassword').textContent = password;
    modalCreate.classList.remove('show');
    modalCreds.classList.add('show');

    // 5. Recargar lista
    await loadUsers();

  } catch(err){
    console.error('Error creando usuario:', err);
    showAlert(createAlert, translateError(err.code || err.message));
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Crear';
  }
});

// ============================================
// 8. MODAL CREDENCIALES
// ============================================
document.getElementById('credsClose').addEventListener('click', ()=>{
  modalCreds.classList.remove('show');
});
modalCreds.addEventListener('click', (e)=>{
  if(e.target === modalCreds) modalCreds.classList.remove('show');
});

document.querySelectorAll('[data-copy]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const text = document.getElementById(btn.dataset.copy).textContent;
    navigator.clipboard.writeText(text).then(()=>{
      const old = btn.textContent;
      btn.textContent = '✓ Copiado';
      setTimeout(()=>{ btn.textContent = old; }, 1500);
    }).catch(()=>alert('No se pudo copiar. Selecciónalo manualmente.'));
  });
});

document.getElementById('copyBothBtn').addEventListener('click', ()=>{
  const email = document.getElementById('credEmail').textContent;
  const pw = document.getElementById('credPassword').textContent;
  const text = `Correo: ${email}\nContraseña: ${pw}\n\nEntra en: ${window.location.origin}${window.location.pathname.replace(/admin\.html.*$/, 'login.html')}`;
  navigator.clipboard.writeText(text).then(()=>{
    const btn = document.getElementById('copyBothBtn');
    const old = btn.textContent;
    btn.textContent = '✓ Copiado con enlace';
    setTimeout(()=>{ btn.textContent = old; }, 1800);
  });
});

// ============================================
// 9. EDITAR USUARIO
// ============================================
const modalEdit = document.getElementById('modalEdit');
const editForm = document.getElementById('editForm');
const editAlert = document.getElementById('editAlert');

function openEditModal(user){
  document.getElementById('eUid').value = user.id;
  document.getElementById('eNombre').value = user.nombre || '';
  document.getElementById('eEmail').value = user.email || '';
  document.getElementById('eRol').value = user.rol || 'alumno';
  document.getElementById('eActivo').value = (user.activo !== false) ? 'true' : 'false';
  hideAlert(editAlert);
  modalEdit.classList.add('show');
}

document.getElementById('eCancel').addEventListener('click', ()=>modalEdit.classList.remove('show'));
modalEdit.addEventListener('click', (e)=>{
  if(e.target === modalEdit) modalEdit.classList.remove('show');
});

editForm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  hideAlert(editAlert);
  const uid = document.getElementById('eUid').value;
  const nombre = document.getElementById('eNombre').value.trim();
  const rol = document.getElementById('eRol').value;
  const activo = document.getElementById('eActivo').value === 'true';

  if(!nombre){
    showAlert(editAlert, 'El nombre es obligatorio.');
    return;
  }

  // Proteger: no dejar que el admin se quite a sí mismo el rol de admin
  if(uid === currentAdmin.uid && rol !== 'admin'){
    showAlert(editAlert, 'No puedes cambiar tu propio rol de admin.');
    return;
  }
  if(uid === currentAdmin.uid && !activo){
    showAlert(editAlert, 'No puedes desactivarte a ti mismo.');
    return;
  }

  const btn = document.getElementById('eSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Guardando...';

  try{
    await updateDoc(doc(db, 'users', uid), {
      nombre: nombre,
      rol: rol,
      activo: activo,
      actualizadoEn: serverTimestamp(),
      actualizadoPor: currentAdmin.uid
    });
    modalEdit.classList.remove('show');
    await loadUsers();
  } catch(err){
    console.error('Error editando:', err);
    showAlert(editAlert, translateError(err.code || err.message));
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Guardar';
  }
});

// ============================================
// 10. TOGGLE ACTIVO (desactivar/activar)
// ============================================
async function toggleActive(user){
  if(user.id === currentAdmin.uid){
    alert('No puedes desactivarte a ti mismo.');
    return;
  }
  const nuevoEstado = user.activo === false ? true : false;
  const accion = nuevoEstado ? 'activar' : 'desactivar';
  if(!confirm(`¿Seguro que quieres ${accion} a "${user.nombre}"?`)) return;

  try{
    await updateDoc(doc(db, 'users', user.id), {
      activo: nuevoEstado,
      actualizadoEn: serverTimestamp(),
      actualizadoPor: currentAdmin.uid
    });
    await loadUsers();
  } catch(err){
    console.error('Error toggle:', err);
    alert('Error: ' + translateError(err.code || err.message));
  }
}

// ============================================
// 11. ELIMINAR USUARIO
// ============================================
const modalDelete = document.getElementById('modalDelete');
const delAlert = document.getElementById('delAlert');
let userToDelete = null;

function openDeleteModal(user){
  if(user.id === currentAdmin.uid){
    alert('No puedes eliminarte a ti mismo.');
    return;
  }
  userToDelete = user;
  document.getElementById('delSub').textContent =
    `¿Seguro que quieres eliminar a "${user.nombre}" (${user.email})? Esta acción no se puede deshacer.`;
  hideAlert(delAlert);
  modalDelete.classList.add('show');
}

document.getElementById('dCancel').addEventListener('click', ()=>{
  modalDelete.classList.remove('show');
  userToDelete = null;
});
modalDelete.addEventListener('click', (e)=>{
  if(e.target === modalDelete){ modalDelete.classList.remove('show'); userToDelete = null; }
});

document.getElementById('dConfirm').addEventListener('click', async ()=>{
  if(!userToDelete) return;
  const btn = document.getElementById('dConfirm');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Eliminando...';

  try{
    // Borrar subcolección partidas (batch)
    const partidasRef = collection(db, 'users', userToDelete.id, 'partidas');
    const partidasSnap = await getDocs(partidasRef);
    if(!partidasSnap.empty){
      const batch = writeBatch(db);
      partidasSnap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // Borrar documento principal
    await deleteDoc(doc(db, 'users', userToDelete.id));

    modalDelete.classList.remove('show');
    userToDelete = null;
    await loadUsers();
  } catch(err){
    console.error('Error eliminando:', err);
    showAlert(delAlert, translateError(err.code || err.message));
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Eliminar';
  }
});

// ============================================
// 12. TAB ESTADÍSTICAS
// ============================================
async function loadStatsTab(){
  // Agregar datos de todos los usuarios
  let totalPartidas = 0;
  let totalSegundos = 0;
  let usuariosActivos = 0;
  const juegosCount = {};
  const topUsers = [];

  allUsers.forEach(u => {
    const s = u.stats || {};
    const p = s.totalPartidas || 0;
    totalPartidas += p;
    totalSegundos += s.tiempoTotalSegundos || 0;
    if(p > 0) usuariosActivos++;
    const juegos = s.juegosJugados || {};
    Object.entries(juegos).forEach(([juego, count])=>{
      juegosCount[juego] = (juegosCount[juego] || 0) + count;
    });
    topUsers.push({ nombre: u.nombre || u.email, rol: u.rol, partidas: p, tiempo: s.tiempoTotalSegundos || 0 });
  });

  document.getElementById('stPartidas').textContent = totalPartidas;
  document.getElementById('stTiempo').textContent = (totalSegundos/3600).toFixed(1) + 'h';
  document.getElementById('stActivos').textContent = usuariosActivos;

  // Juego más popular
  const juegosArr = Object.entries(juegosCount).sort((a,b)=>b[1]-a[1]);
  if(juegosArr.length > 0){
    document.getElementById('stTopGame').textContent = formatGameName(juegosArr[0][0]);
  } else {
    document.getElementById('stTopGame').textContent = '—';
  }

  // Top users
  const top = topUsers.filter(u=>u.partidas>0).sort((a,b)=>b.partidas-a.partidas).slice(0,10);
  const topList = document.getElementById('topUsersList');
  if(top.length === 0){
    topList.innerHTML = `<div class="empty-state"><div class="icon">📊</div><div>Aún no hay partidas registradas.</div></div>`;
  } else {
    topList.innerHTML = top.map((u,i)=>`
      <div class="user-row" style="grid-template-columns:40px 1fr 80px 100px;">
        <div style="font-family:'Fredoka One',cursive;color:var(--accent);font-size:16px;">${i+1}</div>
        <div class="user-cell-name">
          <div class="name">${escapeHtml(u.nombre)}</div>
          <div class="email">${{admin:'👑 Admin',docente:'🎓 Docente',alumno:'📚 Alumno'}[u.rol] || '👤'}</div>
        </div>
        <div style="font-size:12px;color:var(--muted);">${u.partidas} partidas</div>
        <div style="font-size:12px;color:var(--muted);text-align:right;">${(u.tiempo/60).toFixed(0)} min</div>
      </div>
    `).join('');
  }

  // Games popularity
  const gamesList = document.getElementById('topGamesList');
  if(juegosArr.length === 0){
    gamesList.innerHTML = `<div class="empty-state"><div class="icon">🎮</div><div>Aún no hay juegos registrados.</div></div>`;
  } else {
    const max = juegosArr[0][1];
    gamesList.innerHTML = juegosArr.map(([juego, count])=>{
      const pct = Math.round((count/max)*100);
      return `
        <div style="padding:12px 14px;border-bottom:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="font-weight:700;">${formatGameName(juego)}</div>
            <div style="font-size:12px;color:var(--muted);">${count} partidas</div>
          </div>
          <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;">
            <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,var(--accent),var(--pink));border-radius:3px;"></div>
          </div>
        </div>`;
    }).join('');
  }
}

function formatGameName(slug){
  const names = {
    'multiplica-kart': '🏎️ Multiplica Kart',
    'escape-fracciones': '🗝️ Escape de Fracciones'
  };
  return names[slug] || slug;
}

// ============================================
// 13. INIT
// ============================================
loadUsers();
