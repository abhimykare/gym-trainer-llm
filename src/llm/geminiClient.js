import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/env.js';
import { TRAINER_SYSTEM_PROMPT } from '../constants/trainerRules.js';
import { logger } from '../utils/logger.js';

// Free tier gemini-1.5-flash: 15 req/min, 1500 req/day → one request every 4s to stay safe
const MIN_INTERVAL_MS = 4000;
const MAX_RETRIES = 3;

class GeminiClient {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    this._queue = [];
    this._processing = false;
    this._lastRequestTime = 0;
  }

  // Enqueue a request and process serially with rate limiting
  _enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._processing) this._processQueue();
    });
  }

  // Low-priority enqueue — waits until the current queue drains before adding
  _enqueueLow(fn) {
    return new Promise((resolve, reject) => {
      const tryEnqueue = () => {
        if (this._queue.length === 0 && !this._processing) {
          this._queue.push({ fn, resolve, reject });
          this._processQueue();
        } else {
          setTimeout(tryEnqueue, 2000);
        }
      };
      setTimeout(tryEnqueue, 2000);
    });
  }

  async _processQueue() {
    this._processing = true;
    while (this._queue.length > 0) {
      const now = Date.now();
      const wait = MIN_INTERVAL_MS - (now - this._lastRequestTime);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const { fn, resolve, reject } = this._queue.shift();
      try {
        this._lastRequestTime = Date.now();
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
    }
    this._processing = false;
  }

  async _callWithRetry(fullPrompt) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.model.generateContent(fullPrompt);
        const text = result.response.text();
        logger.info('Gemini response received');
        return text;
      } catch (error) {
        const is429 = error?.message?.includes('429');
        const retryMs = this._parseRetryDelay(error?.message);
        if (is429 && attempt < MAX_RETRIES) {
          const delay = retryMs || attempt * 15000;
          logger.warn(`Gemini 429 on attempt ${attempt}, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw error;
        }
      }
    }
  }

  _parseRetryDelay(message) {
    const match = message?.match(/retry.*?(\d+(?:\.\d+)?)s/i);
    return match ? Math.ceil(parseFloat(match[1])) * 1000 + 1000 : null;
  }

  async generateResponse(userMessage, conversationHistory = [], systemPrompt = TRAINER_SYSTEM_PROMPT) {
    const context = conversationHistory
      .slice(-10)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.message}`)
      .join('\n');

    const fullPrompt = `${systemPrompt}\n\nConversation History:\n${context}\n\nUser: ${userMessage}\n\nCoach:`;
    logger.debug('Sending prompt to Gemini:', fullPrompt.substring(0, 200) + '...');

    return this._enqueue(() => this._callWithRetry(fullPrompt)).catch(error => {
      logger.error('Error generating Gemini response:', error);
      return 'Sorry, I had trouble processing that. Can you try again?';
    });
  }

  // Same as generateResponse but waits for queue to be idle first (for background tasks)
  async generateResponseLowPriority(userMessage, conversationHistory = [], systemPrompt = TRAINER_SYSTEM_PROMPT) {
    const context = conversationHistory
      .slice(-10)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.message}`)
      .join('\n');

    const fullPrompt = `${systemPrompt}\n\nConversation History:\n${context}\n\nUser: ${userMessage}\n\nCoach:`;

    return this._enqueueLow(() => this._callWithRetry(fullPrompt)).catch(error => {
      logger.error('Error generating low-priority Gemini response:', error);
      return '';
    });
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
