import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

export const userService = {
  async findOrCreateUser(phoneNumber) {
    try {
      let user = await User.findOne({ phoneNumber });
      
      if (!user) {
        try {
          user = await User.create({
            phoneNumber,
            name: 'User',
          });
          logger.info(`New user created: ${phoneNumber}`);
        } catch (createError) {
          // Handle duplicate key error - user was created by another request
          if (createError.code === 11000) {
            user = await User.findOne({ phoneNumber });
          } else {
            throw createError;
          }
        }
      }
      
      return user;
    } catch (error) {
      logger.error('Error finding/creating user:', error);
      throw error;
    }
  },

  async updateUserProfile(phoneNumber, updates) {
    try {
      const user = await User.findOneAndUpdate(
        { phoneNumber },
        { $set: updates },
        { new: true, upsert: true }
      );
      
      logger.info(`User profile updated: ${phoneNumber}`);
      return user;
    } catch (error) {
      logger.error('Error updating user profile:', error);
      throw error;
    }
  },

  async recordGymVisit(phoneNumber) {
    try {
      const user = await User.findOneAndUpdate(
        { phoneNumber },
        { $set: { lastGymVisit: new Date() } },
        { new: true }
      );
      
      logger.info(`Gym visit recorded for: ${phoneNumber}`);
      return user;
    } catch (error) {
      logger.error('Error recording gym visit:', error);
      throw error;
    }
  },

  async getUserProfile(phoneNumber) {
    try {
      return await User.findOne({ phoneNumber });
    } catch (error) {
      logger.error('Error getting user profile:', error);
      throw error;
    }
  },
};
