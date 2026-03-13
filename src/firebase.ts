import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import type { CalendarEvent } from "./types.js";

const COLLECTION = "calendar_events";
const META_COLLECTION = "scrape_meta";
const META_DOC = "latest";

let app: FirebaseApp;
let db: Firestore;

function init() {
  if (db) return;

  const {
    FIREBASE_API_KEY,
    FIREBASE_AUTH_DOMAIN,
    FIREBASE_PROJECT_ID,
    FIREBASE_STORAGE_BUCKET,
    FIREBASE_MESSAGING_SENDER_ID,
    FIREBASE_APP_ID,
  } = process.env;

  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) {
    throw new Error(
      "Firebase env vars not set. Check your .env file."
    );
  }

  app = initializeApp({
    apiKey: FIREBASE_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN,
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET,
    messagingSenderId: FIREBASE_MESSAGING_SENDER_ID,
    appId: FIREBASE_APP_ID,
  });

  db = getFirestore(app);
}

function eventToFirestore(event: CalendarEvent) {
  return {
    title: event.title,
    country: event.country,
    date: event.date,
    impact: event.impact,
    actual: event.actual,
    forecast: event.forecast,
    previous: event.previous,
    detail: event.detail ?? null,
  };
}

function docToEvent(data: Record<string, any>): CalendarEvent {
  return {
    title: data.title ?? "",
    country: data.country ?? "",
    date: data.date ?? "",
    impact: data.impact ?? "",
    actual: data.actual ?? "",
    forecast: data.forecast ?? "",
    previous: data.previous ?? "",
    detail: data.detail ?? null,
  };
}

export async function saveEvents(events: CalendarEvent[]): Promise<void> {
  init();

  const col = collection(db, COLLECTION);
  const existing = await getDocs(col);
  const BATCH_LIMIT = 400;

  const docsToDelete = existing.docs;
  for (let i = 0; i < docsToDelete.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    docsToDelete.slice(i, i + BATCH_LIMIT).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  for (let i = 0; i < events.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    events.slice(i, i + BATCH_LIMIT).forEach((event, idx) => {
      const docRef = doc(col, `event_${String(i + idx).padStart(4, "0")}`);
      batch.set(docRef, eventToFirestore(event));
    });
    await batch.commit();
  }

  await setDoc(doc(db, META_COLLECTION, META_DOC), {
    lastScrapeAt: new Date().toISOString(),
    eventCount: events.length,
  });
}

export async function loadEvents(): Promise<CalendarEvent[]> {
  init();
  const snap = await getDocs(
    query(collection(db, COLLECTION), orderBy("__name__"))
  );
  return snap.docs.map((d) => docToEvent(d.data()));
}

export async function loadEventsByImpact(
  impact: string
): Promise<CalendarEvent[]> {
  init();
  const snap = await getDocs(
    query(collection(db, COLLECTION), where("impact", "==", impact))
  );
  return snap.docs.map((d) => docToEvent(d.data()));
}

export async function loadEventsByCountry(
  country: string
): Promise<CalendarEvent[]> {
  init();
  const snap = await getDocs(
    query(collection(db, COLLECTION), where("country", "==", country))
  );
  return snap.docs.map((d) => docToEvent(d.data()));
}

export async function getScrapeStatus(): Promise<{
  lastScrapeAt: string | null;
  eventCount: number;
}> {
  init();
  const snap = await getDocs(collection(db, META_COLLECTION));
  const metaDoc = snap.docs.find((d) => d.id === META_DOC);
  if (!metaDoc) return { lastScrapeAt: null, eventCount: 0 };

  const data = metaDoc.data();
  return {
    lastScrapeAt: data.lastScrapeAt ?? null,
    eventCount: data.eventCount ?? 0,
  };
}
