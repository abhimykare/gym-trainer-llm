import { Workout } from '../models/Workout.js';
import { logger } from '../utils/logger.js';

export const workoutService = {
  async createWorkout(userId, phoneNumber, exercises, workoutType = 'strength') {
    try {
      const workout = await Workout.create({
        userId,
        phoneNumber,
        exercises,
        workoutType,
        date: new Date(),
      });
      
      logger.info(`Workout created for user: ${phoneNumber}`);
      return workout;
    } catch (error) {
      logger.error('Error creating workout:', error);
      throw error;
    }
  },

  async getRecentWorkouts(phoneNumber, limit = 5) {
    try {
      const workouts = await Workout.find({ phoneNumber })
        .sort({ date: -1 })
        .limit(limit);
      
      return workouts;
    } catch (error) {
      logger.error('Error fetching recent workouts:', error);
      throw error;
    }
  },

  async markWorkoutCompleted(workoutId) {
    try {
      const workout = await Workout.findByIdAndUpdate(
        workoutId,
        { $set: { completed: true } },
        { new: true }
      );
      
      logger.info(`Workout marked as completed: ${workoutId}`);
      return workout;
    } catch (error) {
      logger.error('Error marking workout completed:', error);
      throw error;
    }
  },
};
