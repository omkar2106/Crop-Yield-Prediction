import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase.ts';
import type {
  FirestoreSavedField,
  SavedSqlPrediction,
  SavedSqlVoiceNote,
} from '../shared/agronomyTypes.ts';

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  savedFields: FirestoreSavedField[];
  bookmarkField: (field: {
    name: string;
    country: string;
    latitude: number;
    longitude: number;
    recommendedCrop: string;
    predictedYield: number;
  }) => Promise<void>;
  removeBookmarkedField: (fieldId: string) => Promise<void>;
  sqlPredictions: SavedSqlPrediction[];
  sqlVoiceNotes: SavedSqlVoiceNote[];
  sqlLoading: boolean;
  sqlError: string | null;
  refreshSqlHistory: () => Promise<void>;
  savePredictionToSql: (payload: Record<string, unknown>) => Promise<void>;
  deletePredictionFromSql: (id: number) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [savedFields, setSavedFields] = useState<FirestoreSavedField[]>([]);
  const [sqlPredictions, setSqlPredictions] = useState<SavedSqlPrediction[]>([]);
  const [sqlVoiceNotes, setSqlVoiceNotes] = useState<SavedSqlVoiceNote[]>([]);
  const [sqlLoading, setSqlLoading] = useState<boolean>(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  const getIdToken = useCallback(async (): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  }, []);

  const refreshSqlHistory = useCallback(async () => {
    if (!auth.currentUser) {
      setSqlPredictions([]);
      setSqlVoiceNotes([]);
      return;
    }
    setSqlLoading(true);
    setSqlError(null);
    try {
      const token = await auth.currentUser.getIdToken();
      const headers = { Authorization: `Bearer ${token}` };
      const [predRes, noteRes] = await Promise.all([
        fetch('/api/sql/predictions', { headers }),
        fetch('/api/sql/voice-notes', { headers }),
      ]);
      const predData = await predRes.json();
      const noteData = await noteRes.json();
      if (!predRes.ok) {
        throw new Error(predData.error || 'Failed to load SQL prediction history.');
      }
      if (!noteRes.ok) {
        throw new Error(noteData.error || 'Failed to load SQL voice notes.');
      }
      setSqlPredictions(predData.predictions ?? []);
      setSqlVoiceNotes(noteData.notes ?? []);
    } catch (err) {
      setSqlError(
        err instanceof Error ? err.message : 'Unable to fetch saved records.'
      );
    } finally {
      setSqlLoading(false);
    }
  }, []);

  // Sync user profile to Firestore & subscribe to user's savedFields + SQL history
  useEffect(() => {
    if (!authReady || !user) {
      setSavedFields([]);
      setSqlPredictions([]);
      setSqlVoiceNotes([]);
      return;
    }

    const userDocRef = doc(db, 'users', user.uid);
    void (async () => {
      try {
        const snap = await getDoc(userDocRef);
        const safeName = (user.displayName || 'Agronomist').slice(0, 120);
        if (!snap.exists()) {
          await setDoc(userDocRef, {
            uid: user.uid,
            displayName: safeName,
            preferredCrop: 'Wheat',
            defaultAlgorithm: 'random_forest',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(userDocRef, {
            displayName: safeName,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn('User profile sync note:', err);
      }
    })();

    const fieldsQuery = query(
      collection(db, 'savedFields'),
      where('ownerId', '==', user.uid)
    );

    const unsubFields = onSnapshot(
      fieldsQuery,
      (snapshot) => {
        const items: FirestoreSavedField[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: String(data.ownerId ?? ''),
            name: String(data.name ?? ''),
            country: String(data.country ?? ''),
            latitude: Number(data.latitude ?? 0),
            longitude: Number(data.longitude ?? 0),
            recommendedCrop: String(data.recommendedCrop ?? ''),
            predictedYield: Number(data.predictedYield ?? 0),
          };
        });
        setSavedFields(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'savedFields');
      }
    );

    void refreshSqlHistory();

    return () => unsubFields();
  }, [authReady, user, refreshSqlHistory]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google Sign-In failed.'
      );
    }
  };

  const signOutUser = async () => {
    setAuthError(null);
    await signOut(auth);
  };

  const bookmarkField = async (field: {
    name: string;
    country: string;
    latitude: number;
    longitude: number;
    recommendedCrop: string;
    predictedYield: number;
  }) => {
    if (!auth.currentUser) {
      throw new Error('Sign in with Google to bookmark fields.');
    }
    const safeId = `fld_${auth.currentUser.uid.slice(0, 10)}_${Date.now()}`;
    const path = `savedFields/${safeId}`;
    try {
      await setDoc(doc(db, 'savedFields', safeId), {
        ownerId: auth.currentUser.uid,
        name: field.name.slice(0, 120) || 'Field Plot',
        country: field.country.slice(0, 80) || 'Global',
        latitude: Number(field.latitude.toFixed(5)),
        longitude: Number(field.longitude.toFixed(5)),
        recommendedCrop: field.recommendedCrop.slice(0, 40),
        predictedYield: Number(field.predictedYield.toFixed(2)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const removeBookmarkedField = async (fieldId: string) => {
    const path = `savedFields/${fieldId}`;
    try {
      await deleteDoc(doc(db, 'savedFields', fieldId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const savePredictionToSql = async (payload: Record<string, unknown>) => {
    if (!auth.currentUser) {
      throw new Error('Sign in with Google to save predictions.');
    }
    setSqlError(null);
    const token = await auth.currentUser.getIdToken();
    const resp = await fetch('/api/sql/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || 'Failed to save prediction.');
    }
    await refreshSqlHistory();
  };

  const deletePredictionFromSql = async (id: number) => {
    if (!auth.currentUser) return;
    const token = await auth.currentUser.getIdToken();
    const resp = await fetch(`/api/sql/predictions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const data = await resp.json();
      throw new Error(data.error || 'Failed to delete prediction.');
    }
    await refreshSqlHistory();
  };

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        authError,
        signInWithGoogle,
        signOutUser,
        getIdToken,
        savedFields,
        bookmarkField,
        removeBookmarkedField,
        sqlPredictions,
        sqlVoiceNotes,
        sqlLoading,
        sqlError,
        refreshSqlHistory,
        savePredictionToSql,
        deletePredictionFromSql,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return ctx;
}
