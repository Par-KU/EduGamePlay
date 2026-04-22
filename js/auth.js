// ============================================
// EduGamePlay - Auth Helpers
// ============================================
// Funciones compartidas para autenticación:
// - requireAuth: protege páginas que requieren login
// - requireRole: protege páginas por rol específico
// - getCurrentUser: obtiene usuario + datos de Firestore
// - logout: cierra sesión y redirige
// ============================================

import { auth, db } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ============================================
// requireAuth(options)
// ============================================
// Protege una página verificando que haya sesión activa.
// Si NO hay sesión → redirige a login.html
// Si hay sesión pero primerLogin=true → redirige a completar-perfil.html
//   (excepto si estamos en completar-perfil.html)
// Retorna el usuario + datos de Firestore cuando todo está bien.
//
// Uso en una página:
//   const user = await requireAuth();
//   console.log(user.nombre, user.rol);
// ============================================
export function requireAuth(options = {}){
  const {
    allowIncompleteProfile = false, // true solo en completar-perfil.html
    redirectTo = 'login.html'
  } = options;

  return new Promise((resolve, reject)=>{
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser)=>{
      unsubscribe(); // Solo lo queremos escuchar una vez

      // 1. No hay sesión → redirigir a login
      if(!firebaseUser){
        window.location.href = redirectTo;
        reject(new Error('No autenticado'));
        return;
      }

      // 2. Obtener datos del usuario desde Firestore
      try{
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);

        if(!userDoc.exists()){
          // Sesión existe en Auth pero no hay documento en Firestore
          // → primer login, hay que crear perfil
          if(!allowIncompleteProfile){
            window.location.href = 'completar-perfil.html';
            reject(new Error('Perfil incompleto'));
            return;
          }
          resolve({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            authUser: firebaseUser,
            docExists: false,
            primerLogin: true
          });
          return;
        }

        const userData = userDoc.data();

        // 3. Perfil incompleto (primerLogin === true)
        if(userData.primerLogin === true && !allowIncompleteProfile){
          window.location.href = 'completar-perfil.html';
          reject(new Error('Perfil incompleto'));
          return;
        }

        // 4. Todo OK
        resolve({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          authUser: firebaseUser,
          docExists: true,
          ...userData
        });

      } catch(err){
        console.error('Error en requireAuth:', err);
        reject(err);
      }
    });
  });
}

// ============================================
// requireRole(allowedRoles)
// ============================================
// Como requireAuth pero también verifica rol.
// allowedRoles: string o array de strings ('admin', 'docente', 'alumno')
//
// Uso:
//   const user = await requireRole('admin');
//   const user = await requireRole(['admin', 'docente']);
// ============================================
export async function requireRole(allowedRoles){
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  const user = await requireAuth();

  if(!user.rol || !roles.includes(user.rol)){
    // Usuario no tiene el rol permitido
    alert('No tienes permiso para acceder a esta página.');
    window.location.href = 'dashboard.html';
    throw new Error(`Rol no permitido: ${user.rol}. Se requiere: ${roles.join(', ')}`);
  }

  return user;
}

// ============================================
// getCurrentUser()
// ============================================
// Obtiene el usuario actual sin redirigir (retorna null si no hay sesión).
// Útil en páginas públicas que muestran contenido diferente según login.
// ============================================
export function getCurrentUser(){
  return new Promise((resolve)=>{
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser)=>{
      unsubscribe();

      if(!firebaseUser){
        resolve(null);
        return;
      }

      try{
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if(!userDoc.exists()){
          resolve({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            authUser: firebaseUser,
            docExists: false
          });
          return;
        }
        resolve({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          authUser: firebaseUser,
          docExists: true,
          ...userDoc.data()
        });
      } catch(err){
        console.error('Error en getCurrentUser:', err);
        resolve(null);
      }
    });
  });
}

// ============================================
// logout(redirectTo)
// ============================================
// Cierra la sesión y redirige al landing (o donde indiques).
// ============================================
export async function logout(redirectTo = 'index.html'){
  try{
    await signOut(auth);
    window.location.href = redirectTo;
  } catch(err){
    console.error('Error al cerrar sesión:', err);
    alert('Error al cerrar sesión. Intenta de nuevo.');
  }
}

// ============================================
// Helpers de display
// ============================================

// Formatea el nombre para mostrar (usa nombre completo o email si no hay)
export function getDisplayName(user){
  if(!user) return 'Invitado';
  return user.nombre || user.email?.split('@')[0] || 'Usuario';
}

// Traduce el rol a label amigable
export function getRoleLabel(rol){
  const labels = {
    admin: '👑 Administrador',
    docente: '🎓 Docente',
    alumno: '📚 Alumno'
  };
  return labels[rol] || '👤 Usuario';
}
