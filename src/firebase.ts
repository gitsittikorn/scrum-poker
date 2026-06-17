// Firebase Configuration
// Replace with your Firebase project config — see SETUP.md

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  setPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import {
  get,
  getDatabase,
  off,
  onChildAdded,
  onChildChanged,
  onDisconnect,
  onValue,
  push,
  query,
  limitToLast,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
} from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCk9-AWQqCm5lIVeyhojhD5wZYq8Ie2yaQ",
  authDomain: "scrum-poker-5fbac.firebaseapp.com",
  databaseURL: "https://scrum-poker-5fbac-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "scrum-poker-5fbac",
  storageBucket: "scrum-poker-5fbac.firebasestorage.app",
  messagingSenderId: "500438075030",
  appId: "1:500438075030:web:f8e8fd3df92a49bc8ce4b7",
  measurementId: "G-5BHRC0Z0H1",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export {
  auth,
  db,
  get,
  off,
  onChildAdded,
  onChildChanged,
  onDisconnect,
  onValue,
  push,
  query,
  limitToLast,
  ref,
  remove,
  serverTimestamp,
  set,
  setPersistence,
  browserSessionPersistence,
  signInAnonymously,
  update,
};
