import { Workout } from '../models/Workout.js';
import { logger } from '../utils/logger.js';

export const workoutService = {
  async saveWorkout(phoneNumber, userId, workoutData) {
    try {
      const workout = await Workout.create({
        userId,
        phoneNumber,
        ...workoutData,
      });
      logger.info(`Workout saved for: ${phoneNumber}`);
      return workout;
    } catch (error) {
      logger.error('Error saving workout:', error);
      throw error;
    }
  },

  async getLastWorkout(phoneNumber) {
    try {
      return await Workout.findOne({ phoneNumber }).sort({ date: -1 });
    } catch (error) {
      logger.error('Error getting last workout:', error);
      throw error;
    }
  },

  async getWorkoutHistory(phoneNumber, limit = 10) {
    try {
      return await Workout.find({ phoneNumber }).sort({ date: -1 }).limit(limit);
    } catch (error) {
      logger.error('Error getting workout history:', error);
      throw error;
    }
  },

  async markWorkoutComplete(workoutId) {
    try {
      return await Workout.findByIdAndUpdate(
        workoutId,
        { $set: { completed: true } },
        { new: true }
      );
    } catch (error) {
      logger.error('Error marking workout complete:', error);
      throw error;
    }
  },
};
