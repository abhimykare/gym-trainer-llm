import Groq from 'groq-sdk';
import { config } from '../config/env.js';
import { TRAINER_SYSTEM_PROMPT } from '../constants/trainerRules.js';
import { logger } from '../utils/logger.js';

// Groq free tier: 30 req/min, 14,400 req/day — throttle to 1 req/2s to be safe
const MIN_INTERVAL_MS = 2000;
const MODEL = 'llama-3.3-70b-versatile';

class GeminiClient {
  constructor() {
    this.groq = new Groq({ apiKey: config.groq.apiKey });
    this._queue = [];
    this._processing = false;
    this._lastRequestTime = 0;
  }

  _enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject });
      if (!this._processing) this._processQueue();
    });
  }

  // Low-priority: waits until queue is idle before enqueuing (for background tasks)
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

  async _callGroq(systemPrompt, userMessage) {
    logger.debug('Sending prompt to Groq:', userMessage.substring(0, 200) + '...');
    const completion = await this.groq.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt || TRAINER_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 512,
      temperature: 0.7,
    });
    const text = completion.choices[0]?.message?.content || '';
    logger.info('Groq response received');
    return text;
  }

  async generateResponse(userMessage, conversationHistory = [], systemPrompt = TRAINER_SYSTEM_PROMPT) {
    const context = conversationHistory
      .slice(-10)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.message}`)
      .join('\n');

    const fullMessage = context ? `Conversation History:\n${context}\n\nUser: ${userMessage}` : userMessage;

    return this._enqueue(() => this._callGroq(systemPrompt, fullMessage)).catch(error => {
      logger.error('Error generating Groq response:', error);
      return 'Sorry, I had trouble processing that. Try again!';
    });
  }

  // Same but waits for queue to be idle first (background/low-priority tasks)
  async generateResponseLowPriority(userMessage, conversationHistory = [], systemPrompt = TRAINER_SYSTEM_PROMPT) {
    const context = conversationHistory
      .slice(-10)
      .map(msg => `${msg.role === 'user' ? 'User' : 'Coach'}: ${msg.message}`)
      .join('\n');

    const fullMessage = context ? `Conversation History:\n${context}\n\nUser: ${userMessage}` : userMessage;

    return this._enqueueLow(() => this._callGroq(systemPrompt, fullMessage)).catch(error => {
      logger.error('Error generating low-priority Groq response:', error);
      return '';
    });
  }
}

export const geminiClient = new GeminiClient();
