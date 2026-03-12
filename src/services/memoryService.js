import { Conversation } from '../models/Conversation.js';
import { User } from '../models/User.js';
import { geminiClient } from '../llm/geminiClient.js';
import { logger } from '../utils/logger.js';

export const memoryService = {
  /**
   * Get conversation context with smart memory management
   * - Returns last 20 messages
   * - Includes conversation summary if exists
   */
  async getConversationContext(phoneNumber) {
    try {
      const user = await User.findOne({ phoneNumber });
      
      // Get last 20 messages
      const recentMessages = await Conversation.find({ phoneNumber })
        .sort({ timestamp: -1 })
        .limit(20);
      
      const messages = recentMessages.reverse();
      
      // Build context with summary
      let context = [];
      
      if (user?.conversationSummary) {
        context.push({
          role: 'assistant',
          message: `[Previous conversation summary: ${user.conversationSummary}]`,
        });
      }
      
      context = [...context, ...messages];
      
      return context;
    } catch (error) {
      logger.error('Error getting conversation context:', error);
      return [];
    }
  },

  /**
   * Manage conversation memory
   * - When total messages > 100, summarize oldest 20 and delete them
   * - Keep last 80 messages
   */
  async manageConversationMemory(phoneNumber) {
    try {
      const totalMessages = await Conversation.countDocuments({ phoneNumber });
      
      if (totalMessages > 100) {
        logger.info(`Managing memory for ${phoneNumber}. Total messages: ${totalMessages}`);
        
        // Get oldest 20 messages
        const oldMessages = await Conversation.find({ phoneNumber })
          .sort({ timestamp: 1 })
          .limit(20);
        
        if (oldMessages.length > 0) {
          // Create summary of old messages
          const summary = await this.summarizeConversations(oldMessages);
          
          // Update user's conversation summary
          const user = await User.findOne({ phoneNumber });
          const existingSummary = user?.conversationSummary || '';
          const newSummary = existingSummary 
            ? `${existingSummary}\n\n[Additional context]: ${summary}`
            : summary;
          
          await User.findOneAndUpdate(
            { phoneNumber },
            { $set: { conversationSummary: newSummary } }
          );
          
          // Delete oldest 20 messages
          const oldestMessageIds = oldMessages.map(msg => msg._id);
          await Conversation.deleteMany({ _id: { $in: oldestMessageIds } });
          
          logger.info(`Summarized and removed 20 old messages for ${phoneNumber}`);
        }
      }
    } catch (error) {
      logger.error('Error managing conversation memory:', error);
    }
  },

  /**
   * Summarize a batch of conversations using LLM
   */
  async summarizeConversations(messages) {
    try {
      const conversationText = messages
        .map(msg => `${msg.role === 'user' ? 'User' : 'Arnold'}: ${msg.message}`)
        .join('\n');
      
      const summaryPrompt = `Summarize this fitness conversation in 2-3 sentences. Focus on:
- User's fitness progress and achievements
- Body parts worked
- Any important user details mentioned
- Workout patterns

Conversation:
${conversationText}

Summary:`;
      
      const summary = await geminiClient.generateResponse(summaryPrompt, [], '');
      return summary;
    } catch (error) {
      logger.error('Error summarizing conversations:', error);
      return 'Previous conversation context available.';
    }
  },

  /**
   * Check if user profile is complete
   */
  async checkProfileComplete(user) {
    return !!(
      user.nickname &&
      user.age &&
      user.height &&
      user.weight
    );
  },

  /**
   * Get next profile question to ask
   */
  getNextProfileQuestion(user) {
    if (!user.nickname) {
      return "First things first - what should I call you? Give me a nickname! 💪";
    }
    if (!user.age) {
      return "How old are you? Age matters for workout planning!";
    }
    if (!user.height) {
      return "What's your height in centimeters? (e.g., 175)";
    }
    if (!user.weight) {
      return "Current weight in kilograms? (e.g., 70)";
    }
    return null;
  },

  /**
   * Update user profile based on conversation
   */
  async updateProfileFromMessage(phoneNumber, message, user) {
    try {
      const updates = {};
      
      if (!user.nickname && message.length < 30) {
        updates.nickname = message.trim();
      } else if (!user.age) {
        const age = parseInt(message);
        if (age > 10 && age < 100) {
          updates.age = age;
        }
      } else if (!user.height) {
        const height = parseInt(message);
        if (height > 100 && height < 250) {
          updates.height = height;
        }
      } else if (!user.weight) {
        const weight = parseInt(message);
        if (weight > 30 && weight < 300) {
          updates.weight = weight;
        }
      }
      
      if (Object.keys(updates).length > 0) {
        await User.findOneAndUpdate(
          { phoneNumber },
          { $set: updates }
        );
        
        // Check if profile is now complete
        const updatedUser = await User.findOne({ phoneNumber });
        const isComplete = await this.checkProfileComplete(updatedUser);
        
        if (isComplete && !updatedUser.profileComplete) {
          await User.findOneAndUpdate(
            { phoneNumber },
            { $set: { profileComplete: true } }
          );
          return {
            updated: true,
            complete: true,
            message: `Perfect! Profile complete! 🔥\n\nNickname: ${updatedUser.nickname}\nAge: ${updatedUser.age}\nHeight: ${updatedUser.height}cm\nWeight: ${updatedUser.weight}kg\n\nNow let's get to work! Did you go to the gym today?`
          };
        }
        
        return { updated: true, complete: false };
      }
      
      return { updated: false, complete: false };
    } catch (error) {
      logger.error('Error updating profile:', error);
      return { updated: false, complete: false };
    }
  },
};
