import { Conversation } from '../models/Conversation.js';
import { logger } from '../utils/logger.js';

export const conversationService = {
  async saveMessage(phoneNumber, message, role) {
    try {
      const conversation = await Conversation.create({
        phoneNumber,
        message,
        role,
        timestamp: new Date(),
      });
      
      return conversation;
    } catch (error) {
      logger.error('Error saving conversation:', error);
      throw error;
    }
  },

  async getConversationHistory(phoneNumber, limit = 20) {
    try {
      const history = await Conversation.find({ phoneNumber })
        .sort({ timestamp: -1 })
        .limit(limit);
      
      return history.reverse(); // Return in chronological order
    } catch (error) {
      logger.error('Error fetching conversation history:', error);
      throw error;
    }
  },

  async clearOldConversations(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      const result = await Conversation.deleteMany({
        timestamp: { $lt: cutoffDate },
      });
      
      logger.info(`Cleared ${result.deletedCount} old conversations`);
      return result;
    } catch (error) {
      logger.error('Error clearing old conversations:', error);
      throw error;
    }
  },
};
