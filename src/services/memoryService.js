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
   * Check if user profile is complete (including gymTime)
   */
  async checkProfileComplete(user) {
    return !!(
      user.nickname &&
      user.age &&
      user.height &&
      user.weight &&
      user.gymTime
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
      return `Perfect! Almost done — what's your current weight in kilograms? (For example: 70)`;
    }
    if (!user.gymTime) {
      return `Last question ${user.nickname}! What time do you usually go to the gym? Give me the time in HH:MM format (e.g. 07:30 for morning, 19:30 for evening). I'll remind you 15 minutes before! ⏰`;
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
    if (errorType === 'invalidGymTime') {
      return "I didn't get that time. Give me your gym time like this: 07:30 or 19:30 (24-hour format). When do you usually hit the gym?";
    }
    if (errorType === 'isGreeting') {
      const nextQuestion = this.getNextProfileQuestion(user);
      return nextQuestion;
    }
    return "I didn't get that. Try again!";
  },

  /**
   * Update user profile based on conversation (onboarding stage-by-stage)
   */
  async updateProfileFromMessage(phoneNumber, message, user) {
    try {
      const updates = {};
      const lowerMessage = message.toLowerCase().trim();
      const stage = user.stage || 'nickname';

      // Skip greetings and common phrases
      const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'sup', 'yo', 'hola'];
      const isGreeting = greetings.some(g => lowerMessage === g || lowerMessage.startsWith(g + ' '));

      if (stage === 'nickname') {
        if (isGreeting) return { updated: false, complete: false, isGreeting: true };
        if (message.length >= 2 && message.length < 30 && !/^\d+$/.test(message)) {
          updates.nickname = message.trim();
          updates.stage = 'age';
        } else {
          return { updated: false, complete: false, invalidNickname: true };
        }
      } else if (stage === 'age') {
        const age = parseInt(message);
        if (age >= 15 && age <= 80) {
          updates.age = age;
          updates.stage = 'height';
        } else {
          return { updated: false, complete: false, invalidAge: true };
        }
      } else if (stage === 'height') {
        const height = parseInt(message);
        if (height >= 140 && height <= 220) {
          updates.height = height;
          updates.stage = 'weight';
        } else {
          return { updated: false, complete: false, invalidHeight: true };
        }
      } else if (stage === 'weight') {
        const weight = parseInt(message);
        if (weight >= 40 && weight <= 200) {
          updates.weight = weight;
          updates.stage = 'gymTime';
        } else {
          return { updated: false, complete: false, invalidWeight: true };
        }
      } else if (stage === 'gymTime') {
        const parsed = this.parseGymTime(message);
        if (parsed) {
          updates.gymTime = parsed;
          updates.stage = 'complete';
        } else {
          return { updated: false, complete: false, invalidGymTime: true };
        }
      }

      if (Object.keys(updates).length > 0) {
        await User.findOneAndUpdate({ phoneNumber }, { $set: updates });

        const updatedUser = await User.findOne({ phoneNumber });
        const isComplete = await this.checkProfileComplete(updatedUser);

        if (isComplete && !updatedUser.profileComplete) {
          const waterGoal = this.calculateDailyWater(updatedUser);
          await User.findOneAndUpdate(
            { phoneNumber },
            { $set: { profileComplete: true, stage: 'complete', dailyWaterGoalLiters: waterGoal } }
          );
          return {
            updated: true,
            complete: true,
            message: `Perfect, ${updatedUser.nickname}! 💪\n\nYour Profile:\n👤 ${updatedUser.nickname}\n🎂 ${updatedUser.age} years old\n📏 ${updatedUser.height}cm\n⚖️ ${updatedUser.weight}kg\n⏰ Gym time: ${updatedUser.gymTime}\n💧 Daily water goal: ${waterGoal}L\n\nI'll remind you 15 minutes before your gym time every day. NO EXCUSES! 🔥\n\nDid you hit the gym today? Reply YES or NO!`
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

  /**
   * Parse gym time from user input. Accepts formats like:
   * "7:30", "07:30", "7.30", "730", "7 30", "7:30 pm", "19:30"
   * Returns "HH:MM" 24h string or null if invalid.
   */
  parseGymTime(input) {
    const s = input.trim().toLowerCase();

    // Match patterns like 7:30, 07:30, 7.30, 7 30
    const match = s.match(/(\d{1,2})[:.\s](\d{2})\s*(am|pm)?/);
    if (match) {
      let h = parseInt(match[1]);
      const m = parseInt(match[2]);
      const meridiem = match[3];
      if (m < 0 || m > 59) return null;
      if (meridiem === 'pm' && h < 12) h += 12;
      if (meridiem === 'am' && h === 12) h = 0;
      if (h < 0 || h > 23) return null;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // Match bare numbers like "730" or "1930"
    const bare = s.match(/^(\d{3,4})$/);
    if (bare) {
      const n = bare[1].padStart(4, '0');
      const h = parseInt(n.slice(0, 2));
      const m = parseInt(n.slice(2));
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
    }

    return null;
  },

  /**
   * Calculate daily water intake goal in liters based on user profile
   */
  calculateDailyWater(user) {
    if (!user.weight) return 2.5;
    let liters = (user.weight * 35) / 1000;
    // Slightly reduce for older users
    if (user.age && user.age > 55) liters -= 0.2;
    return Math.round(liters * 10) / 10;
  },

  /**
   * Use LLM to detect and auto-update profile fields from any conversation message.
   * Handles natural language like "I'm 72kg now", "my name is Abhi", "I turned 25 today"
   */
  async autoUpdateProfileFromConversation(phoneNumber, message, user) {
    try {
      const prompt = `You are a data extractor. From the user message below, extract any of these fitness profile fields if explicitly mentioned:
- name/nickname (string)
- age (number, 15-80)
- height (number in cm, 140-220)
- weight (number in kg, 40-200)

User message: "${message}"

Respond ONLY with a valid JSON object with only the fields found. If nothing found, respond with {}.
Examples:
- "my name is Abhi" → {"nickname": "Abhi"}
- "I'm 72kg now" → {"weight": 72}
- "I turned 25 today" → {"age": 25}
- "I'm 5'10" → {} (can't convert reliably, skip)
- "call me Raj" → {"nickname": "Raj"}
- "I grew to 178cm" → {"height": 178}

JSON:`;

      const raw = await geminiClient.generateResponse(prompt, [], '');

      // Extract JSON from response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const extracted = JSON.parse(jsonMatch[0]);
      const updates = {};

      if (extracted.nickname && typeof extracted.nickname === 'string' && extracted.nickname.length >= 2) {
        updates.nickname = extracted.nickname.trim();
      }
      if (extracted.age && extracted.age >= 15 && extracted.age <= 80) {
        updates.age = extracted.age;
      }
      if (extracted.height && extracted.height >= 140 && extracted.height <= 220) {
        updates.height = extracted.height;
      }
      if (extracted.weight && extracted.weight >= 40 && extracted.weight <= 200) {
        updates.weight = extracted.weight;
        // Recalculate water goal when weight changes
        const newWater = this.calculateDailyWater({ ...user, weight: extracted.weight });
        updates.dailyWaterGoalLiters = newWater;
      }

      if (Object.keys(updates).length > 0) {
        await User.findOneAndUpdate({ phoneNumber }, { $set: updates });
        logger.info(`Auto-updated profile for ${phoneNumber}:`, updates);
      }
    } catch (error) {
      logger.error('Error in autoUpdateProfileFromConversation:', error);
    }
  },
};
