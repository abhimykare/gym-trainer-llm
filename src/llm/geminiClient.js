import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env.js';
import { TRAINER_SYSTEM_PROMPT } from '../constants/trainerRules.js';
import { logger } from '../utils/logger.js';

class GeminiClient {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  }

  async generateResponse(userMessage, conversationHistory = [], systemPrompt = TRAINER_SYSTEM_PROMPT) {
    try {
      // Build conversation context
      const context = conversationHistory
        .slice(-10) // Last 10 messages for context
        .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.message}`)
        .join('\n');

      const fullPrompt = `${systemPrompt}\n\nConversation History:\n${context}\n\nUser: ${userMessage}\n\nCoach:`;

      logger.debug('Sending prompt to Gemini:', fullPrompt.substring(0, 200) + '...');

      const result = await this.model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();

      logger.info('Gemini response received');
      return text;
    } catch (error) {
      logger.error('Error generating Gemini response:', error);
      return 'Sorry, I had trouble processing that. Can you try again?';
    }
  }

  async generateWorkoutPlan(userProfile, recentWorkouts = []) {
    try {
      const workoutContext = `
User Profile:
- Fitness Goal: ${userProfile.fitnessGoal}
- Weight: ${userProfile.weight}kg
- Height: ${userProfile.height}cm

Recent Workouts: ${recentWorkouts.length > 0 ? recentWorkouts.map(w => w.workoutType).join(', ') : 'None'}

Generate a personalized workout plan for today.`;

      return await this.generateResponse(workoutContext, [], TRAINER_SYSTEM_PROMPT);
    } catch (error) {
      logger.error('Error generating workout plan:', error);
      return 'Unable to generate workout plan right now. Try again later.';
    }
  }
}

export const geminiClient = new GeminiClient();
