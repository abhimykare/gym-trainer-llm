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
  conversationSummary: {
    type: String,
    default: '',
  },
  profileComplete: {
    type: Boolean,
    default: false,
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
