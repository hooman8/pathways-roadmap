import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function firebaseApp() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT is not configured.");
  if (process.env.NODE_ENV === "production" && (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)) throw new Error("Emulators are disabled in production.");
  return getApps()[0] ?? initializeApp({ projectId, ...(process.env.FIREBASE_AUTH_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
}
export const firebaseAuth = () => getAuth(firebaseApp());
export const firestore = () => getFirestore(firebaseApp());
