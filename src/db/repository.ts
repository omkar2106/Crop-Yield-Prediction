import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { fieldVoiceNotes, users, yieldPredictions } from './schema.ts';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName = ''
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        displayName,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          displayName,
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Unable to synchronize user account.', { cause: error });
  }
}

export interface SavePredictionInput {
  locationName: string;
  country: string;
  latitude: number;
  longitude: number;
  crop: string;
  algorithm: string;
  predictedYield: number;
  suitabilityScore: number;
  areaHa: number;
  totalProductionTons: number;
  soilTexture: string;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  ph: number;
  organicCarbon: number;
  soilMoisture: number;
  temperature: number;
  humidity: number;
  rainfall: number;
  solarRadiation: number;
  notes?: string;
}

export async function listUserPredictions(uid: string) {
  try {
    return await db
      .select({
        id: yieldPredictions.id,
        locationName: yieldPredictions.locationName,
        country: yieldPredictions.country,
        latitude: yieldPredictions.latitude,
        longitude: yieldPredictions.longitude,
        crop: yieldPredictions.crop,
        algorithm: yieldPredictions.algorithm,
        predictedYield: yieldPredictions.predictedYield,
        suitabilityScore: yieldPredictions.suitabilityScore,
        areaHa: yieldPredictions.areaHa,
        totalProductionTons: yieldPredictions.totalProductionTons,
        soilTexture: yieldPredictions.soilTexture,
        nitrogen: yieldPredictions.nitrogen,
        phosphorus: yieldPredictions.phosphorus,
        potassium: yieldPredictions.potassium,
        ph: yieldPredictions.ph,
        organicCarbon: yieldPredictions.organicCarbon,
        soilMoisture: yieldPredictions.soilMoisture,
        temperature: yieldPredictions.temperature,
        humidity: yieldPredictions.humidity,
        rainfall: yieldPredictions.rainfall,
        solarRadiation: yieldPredictions.solarRadiation,
        notes: yieldPredictions.notes,
        createdAt: yieldPredictions.createdAt,
      })
      .from(yieldPredictions)
      .innerJoin(users, eq(yieldPredictions.userId, users.id))
      .where(eq(users.uid, uid))
      .orderBy(desc(yieldPredictions.createdAt))
      .limit(50);
  } catch (error) {
    console.error('Database query failed (listUserPredictions):', error);
    throw new Error('Failed to load saved yield predictions.', { cause: error });
  }
}

export async function savePredictionRecord(
  uid: string,
  email: string,
  displayName: string,
  input: SavePredictionInput
) {
  try {
    const user = await getOrCreateUser(uid, email, displayName);
    const inserted = await db
      .insert(yieldPredictions)
      .values({
        userId: user.id,
        locationName: input.locationName.slice(0, 140),
        country: input.country.slice(0, 80),
        latitude: input.latitude,
        longitude: input.longitude,
        crop: input.crop.slice(0, 60),
        algorithm: input.algorithm.slice(0, 80),
        predictedYield: input.predictedYield,
        suitabilityScore: Math.round(input.suitabilityScore),
        areaHa: input.areaHa,
        totalProductionTons: input.totalProductionTons,
        soilTexture: input.soilTexture.slice(0, 60),
        nitrogen: input.nitrogen,
        phosphorus: input.phosphorus,
        potassium: input.potassium,
        ph: input.ph,
        organicCarbon: input.organicCarbon,
        soilMoisture: input.soilMoisture,
        temperature: input.temperature,
        humidity: input.humidity,
        rainfall: input.rainfall,
        solarRadiation: input.solarRadiation,
        notes: (input.notes ?? '').slice(0, 500),
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database insert failed (savePredictionRecord):', error);
    throw new Error('Failed to save prediction record.', { cause: error });
  }
}

export async function deletePredictionRecord(uid: string, id: number) {
  try {
    const userRows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    if (userRows.length === 0) return false;
    const deleted = await db
      .delete(yieldPredictions)
      .where(and(eq(yieldPredictions.id, id), eq(yieldPredictions.userId, userRows[0].id)))
      .returning({ id: yieldPredictions.id });
    return deleted.length > 0;
  } catch (error) {
    console.error('Database delete failed (deletePredictionRecord):', error);
    throw new Error('Failed to delete prediction record.', { cause: error });
  }
}

export async function listUserVoiceNotes(uid: string) {
  try {
    return await db
      .select({
        id: fieldVoiceNotes.id,
        locationName: fieldVoiceNotes.locationName,
        crop: fieldVoiceNotes.crop,
        transcript: fieldVoiceNotes.transcript,
        createdAt: fieldVoiceNotes.createdAt,
      })
      .from(fieldVoiceNotes)
      .innerJoin(users, eq(fieldVoiceNotes.userId, users.id))
      .where(eq(users.uid, uid))
      .orderBy(desc(fieldVoiceNotes.createdAt))
      .limit(30);
  } catch (error) {
    console.error('Database query failed (listUserVoiceNotes):', error);
    throw new Error('Failed to load voice notes.', { cause: error });
  }
}

export async function saveVoiceNote(
  uid: string,
  email: string,
  displayName: string,
  input: { locationName: string; crop: string; transcript: string }
) {
  try {
    const user = await getOrCreateUser(uid, email, displayName);
    const inserted = await db
      .insert(fieldVoiceNotes)
      .values({
        userId: user.id,
        locationName: input.locationName.slice(0, 140),
        crop: input.crop.slice(0, 60),
        transcript: input.transcript.slice(0, 4000),
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database insert failed (saveVoiceNote):', error);
    throw new Error('Failed to save transcribed voice note.', { cause: error });
  }
}
