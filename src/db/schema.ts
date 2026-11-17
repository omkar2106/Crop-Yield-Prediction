import { relations } from 'drizzle-orm';
import {
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const yieldPredictions = pgTable('yield_predictions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  locationName: text('location_name').notNull(),
  country: text('country').notNull().default(''),
  latitude: doublePrecision('latitude').notNull(),
  longitude: doublePrecision('longitude').notNull(),
  crop: text('crop').notNull(),
  algorithm: text('algorithm').notNull(),
  predictedYield: doublePrecision('predicted_yield').notNull(),
  suitabilityScore: integer('suitability_score').notNull(),
  areaHa: doublePrecision('area_ha').notNull(),
  totalProductionTons: doublePrecision('total_production_tons').notNull(),
  soilTexture: text('soil_texture').notNull().default('Loam'),
  nitrogen: doublePrecision('nitrogen').notNull(),
  phosphorus: doublePrecision('phosphorus').notNull(),
  potassium: doublePrecision('potassium').notNull(),
  ph: doublePrecision('ph').notNull(),
  organicCarbon: doublePrecision('organic_carbon').notNull(),
  soilMoisture: doublePrecision('soil_moisture').notNull(),
  temperature: doublePrecision('temperature').notNull(),
  humidity: doublePrecision('humidity').notNull(),
  rainfall: doublePrecision('rainfall').notNull(),
  solarRadiation: doublePrecision('solar_radiation').notNull(),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const fieldVoiceNotes = pgTable('field_voice_notes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  locationName: text('location_name').notNull(),
  crop: text('crop').notNull(),
  transcript: text('transcript').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  yieldPredictions: many(yieldPredictions),
  fieldVoiceNotes: many(fieldVoiceNotes),
}));

export const yieldPredictionsRelations = relations(yieldPredictions, ({ one }) => ({
  author: one(users, {
    fields: [yieldPredictions.userId],
    references: [users.id],
  }),
}));

export const fieldVoiceNotesRelations = relations(fieldVoiceNotes, ({ one }) => ({
  author: one(users, {
    fields: [fieldVoiceNotes.userId],
    references: [users.id],
  }),
}));
