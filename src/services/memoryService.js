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
      return "Hey! I'm Arnold, your new gym trainer! 💪\n\nBefore we start crushing goals together, I need to know you better.\n\nWhat should I call you? Give me your name or nickname!";
    }
    if (!user.age) {
      return `Alright ${user.nickname}! How old are you? I need to know to plan your workouts properly!`;
    }
    if (!user.height) {
      return `Got it! Now, what's your height in centimeters? (For example: 175)`;
    }
    if (!user.weight) {
      return `Perfect! Last one - what's your current weight in kilograms? (For example: 70)`;
    }
    return null;
  },

  /**
   * Get humanistic error message for invalid input
   */
  getInvalidInputMessage(user, errorType) {
    if (errorType === 'invalidNickname') {
      return "Come on, give me a proper name! What do your friends call you? Just your name, nothing fancy!";
    }
    if (errorType === 'invalidAge') {
      return "That doesn't look right! How old are you really? Give me a number between 15 and 80!";
    }
    if (errorType === 'invalidHeight') {
      return "That height doesn't make sense! Give me your height in centimeters. Like 170, 180, 175... you know what I mean!";
    }
    if (errorType === 'invalidWeight') {
      return "That weight seems off! Give me your actual weight in kilograms. Be honest, I'm here to help!";
    }
    if (errorType === 'isGreeting') {
      const nextQuestion = this.getNextProfileQuestion(user);
      return nextQuestion;
    }
    return "I didn't get that. Try again!";
  },

  /**
   * Update user profile based on conversation
   */
  async updateProfileFromMessage(phoneNumber, message, user) {
    try {
      const updates = {};
      const lowerMessage = message.toLowerCase().trim();
      
      // Skip greetings and common phrases
      const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'sup', 'yo', 'hola'];
      const isGreeting = greetings.some(greeting => lowerMessage === greeting || lowerMessage.startsWith(greeting + ' '));
      
      if (!user.nickname) {
        // Don't accept greetings, single letters, or very short responses as nickname
        if (!isGreeting && message.length >= 2 && message.length < 30 && !/^\d+$/.test(message)) {
          updates.nickname = message.trim();
        } else if (isGreeting) {
          // User sent greeting, don't treat as nickname
          return { updated: false, complete: false, isGreeting: true };
        } else {
          return { updated: false, complete: false, invalidNickname: true };
        }
      } else if (!user.age) {
        const age = parseInt(message);
        if (age >= 15 && age <= 80) {
          updates.age = age;
        } else {
          return { updated: false, complete: false, invalidAge: true };
        }
      } else if (!user.height) {
        const height = parseInt(message);
        if (height >= 140 && height <= 220) {
          updates.height = height;
        } else {
          return { updated: false, complete: false, invalidHeight: true };
        }
      } else if (!user.weight) {
        const weight = parseInt(message);
        if (weight >= 40 && weight <= 200) {
          updates.weight = weight;
        } else {
          return { updated: false, complete: false, invalidWeight: true };
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
            message: `Perfect, ${updatedUser.nickname}! 💪\n\nYour Profile:\n👤 ${updatedUser.nickname}\n🎂 ${updatedUser.age} years old\n📏 ${updatedUser.height}cm\n⚖️ ${updatedUser.weight}kg\n\nAlright! Now let's get to WORK! Did you hit the gym today? Reply YES or NO!`
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
