import mongoose from 'mongoose';

const exerciseSchema = new mongoose.Schema({
  name: String,
  sets: Number,
  reps: Number,
  restTime: Number, // in seconds
  notes: String,
});

const workoutSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  exercises: [exerciseSchema],
  workoutType: {
    type: String,
    enum: ['strength', 'cardio', 'mixed', 'flexibility'],
    default: 'strength',
  },
  completed: {
    type: Boolean,
    default: false,
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const Workout = mongoose.model('Workout', workoutSchema);
