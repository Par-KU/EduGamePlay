// ============================================
// EduGames Platform - Firebase Config
// ============================================
// Proyecto: edugames-platform
// Servicios: Auth + Firestore + Realtime Database
// ============================================

// Importamos los módulos de Firebase vía CDN (ES Modules)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// Tu configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAo1GE9RlsEEVZ3DPK8i62I5Clg2qvJbCE",
  authDomain: "edugames-platform.firebaseapp.com",
  databaseURL: "https://edugames-platform-default-rtdb.firebaseio.com",
  projectId: "edugames-platform",
  storageBucket: "edugames-platform.firebasestorage.app",
  messagingSenderId: "669784124537",
  appId: "1:669784124537:web:10ef6278a1ea18ac3e78a8",
  measurementId: "G-DHSTB3J175"
};

// Inicializamos Firebase y exportamos los servicios
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const rtdb = getDatabase(app);

export { app, auth, db, rtdb };
