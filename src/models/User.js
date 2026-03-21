import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
  },
  name: {
    type: String,
    default: 'User',
  },
  nickname: {
    type: String,
  },
  age: {
    type: Number,
  },
  height: {
    type: Number, // in cm
  },
  weight: {
    type: Number, // in kg
  },
  fitnessGoal: {
    type: String,
    enum: ['weight_loss', 'muscle_gain', 'maintenance', 'endurance'],
    default: 'maintenance',
  },
  proteinGoal: {
    type: Number, // in grams
    default: 100,
  },
  lastWorkoutDate: {
    type: Date,
  },
  lastGymVisit: {
    type: Date,
  },
  lastBodyPartWorked: {
    type: String, // e.g., "chest", "back", "legs"
  },
  workoutSchedule: [{
    bodyPart: String,
    date: Date,
  }],
  // Tracks last 14 workout sessions: [{bodyParts: ['chest','triceps'], date: Date}]
  workoutHistory: [{
    bodyParts: [String],
    date: { type: Date, default: Date.now },
  }],
  conversationSummary: {
    type: String,
    default: '',
  },
  profileComplete: {
    type: Boolean,
    default: false,
  },
  // Onboarding stage: 'nickname' | 'age' | 'height' | 'weight' | 'gymTime' | 'complete'
  stage: {
    type: String,
    default: 'nickname',
  },
  dailyWaterGoalLiters: {
    type: Number,
  },
  // User's preferred gym time in "HH:MM" 24h format e.g. "19:30"
  gymTime: {
    type: String,
  },
  // Stores the workout that must repeat if gym was missed
  pendingWorkout: {
    bodyPart: String,
    assignedDate: Date,
  },
  // Tracks state of the 8:35 PM gym check flow: null | 'awaiting_gym_status' | 'awaiting_excuse'
  gymCheckState: {
    type: String,
    default: null,
  },
  gymCheckStateSetAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export const User = mongoose.model('User', userSchema);
