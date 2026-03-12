import cron from 'node-cron';
import { whatsappService } from '../services/whatsappService.js';
import { User } from '../models/User.js';
import { geminiClient } from '../llm/geminiClient.js';
import { conversationService } from '../services/conversationService.js';
import { logger } from '../utils/logger.js';

class ReminderScheduler {
  constructor() {
    this.jobs = [];
  }

  start() {
    logger.info('Starting reminder scheduler...');

    // 7:30 AM - Good morning message
    const morningGreeting = cron.schedule('30 7 * * *', async () => {
      await this.sendMorningGreeting();
    }, {
      timezone: 'Asia/Kolkata',
    });

    // 9:30 AM - Morning gym reminder
    const morningReminder = cron.schedule('30 9 * * *', async () => {
      await this.sendMorningGymReminder();
    }, {
      timezone: 'Asia/Kolkata',
    });

    // 12:00 PM - Noon greeting
    const noonGreeting = cron.schedule('0 12 * * *', async () => {
      await this.sendNoonGreeting();
    }, {
      timezone: 'Asia/Kolkata',
    });

    // 8:30 PM - Evening gym check
    const eveningCheck = cron.schedule('30 20 * * *', async () => {
      await this.sendEveningGymCheck();
    }, {
      timezone: 'Asia/Kolkata',
    });

    // 8:00 AM - Morning protein reminder
    const proteinReminder = cron.schedule('0 8 * * *', async () => {
      await this.sendProteinReminder();
    }, {
      timezone: 'Asia/Kolkata',
    });

    // 8:45 PM - Ask what body part they worked
    const bodyPartCheck = cron.schedule('45 20 * * *', async () => {
      await this.sendBodyPartCheck();
    }, {
      timezone: 'Asia/Kolkata',
    });

    this.jobs.push(morningGreeting, morningReminder, noonGreeting, eveningCheck, bodyPartCheck, proteinReminder);
    
    logger.info('Reminder scheduler started successfully');
  }

  async sendMorningGreeting() {
    try {
      logger.info('Sending morning greetings with workout plans...');
      
      const users = await User.find({});
      
      for (const user of users) {
        // Get next body parts based on last workout
        const nextBodyParts = this.getNextBodyParts(user.lastBodyPartWorked);
        
        const morningMessages = [
          `🌅 WAKE UP! It's ${nextBodyParts[0].toUpperCase()} day today! No excuses! Get ready to work! 💪`,
          `☀️ Morning! Today we're hitting ${nextBodyParts[0].toUpperCase()}! Last time you did ${user.lastBodyPartWorked || 'nothing'}, so it's time for ${nextBodyParts[0]}! Let's GO! 🔥`,
          `🌄 UP! NOW! Today is ${nextBodyParts[0].toUpperCase()} day! You rested enough. Time to WORK! 💪`,
          `🌞 Good morning! ${nextBodyParts[0].toUpperCase()} workout today! After that, tomorrow is ${nextBodyParts[1]}! Stay focused! 🔥`,
        ];
        
        const randomMessage = morningMessages[Math.floor(Math.random() * morningMessages.length)];
        
        await whatsappService.sendMessage(user.phoneNumber, randomMessage);
        await conversationService.saveMessage(user.phoneNumber, randomMessage, 'assistant');
        
        await this.delay(1000);
      }
      
      logger.info(`Morning greetings with workout plans sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending morning greetings:', error);
    }
  }

  getNextBodyParts(lastBodyPart) {
    const schedule = {
      'chest': ['back', 'legs'],
      'back': ['legs', 'shoulders'],
      'legs': ['chest', 'arms'],
      'shoulders': ['arms', 'chest'],
      'arms': ['back', 'legs'],
      'biceps': ['triceps', 'legs'],
      'triceps': ['chest', 'back'],
      'core': ['legs', 'chest'],
      'abs': ['back', 'shoulders'],
    };
    
    return schedule[lastBodyPart] || ['chest', 'back'];
  }

  async sendNoonGreeting() {
    try {
      logger.info('Sending noon greetings...');
      
      const users = await User.find({});
      
      const noonMessages = [
        '🌤️ NOON CHECK! Did you eat protein? Stay hydrated! No slacking! 💧',
        '☀️ Midday! How\'s your nutrition? Better be eating right! 🥗',
        '🌞 Afternoon! Water intake? Protein? Don\'t make me ask twice! 💪',
        '🌤️ LUNCH TIME! Better be eating clean! No junk food! 🍎',
      ];
      
      for (const user of users) {
        const randomMessage = noonMessages[Math.floor(Math.random() * noonMessages.length)];
        
        await whatsappService.sendMessage(user.phoneNumber, randomMessage);
        await conversationService.saveMessage(user.phoneNumber, randomMessage, 'assistant');
        
        await this.delay(1000);
      }
      
      logger.info(`Noon greetings sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending noon greetings:', error);
    }
  }

  async sendMorningGymReminder() {
    try {
      logger.info('Sending morning gym reminders...');
      
      const users = await User.find({});
      
      for (const user of users) {
        const message = '💪 Hey! Just a friendly reminder - have you planned your gym session for today? Let\'s keep that momentum going! You got this! 🔥';
        
        await whatsappService.sendMessage(user.phoneNumber, message);
        await conversationService.saveMessage(user.phoneNumber, message, 'assistant');
        
        // Small delay to avoid rate limiting
        await this.delay(1000);
      }
      
      logger.info(`Morning reminders sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending morning gym reminders:', error);
    }
  }

  async sendEveningGymCheck() {
    try {
      logger.info('Sending evening gym checks...');
      
      const users = await User.find({});
      
      for (const user of users) {
        const message = '🌆 Evening check-in! So, did you make it to the gym today? Reply YES if you crushed it, or NO if you need some motivation! 😊';
        
        await whatsappService.sendMessage(user.phoneNumber, message);
        await conversationService.saveMessage(user.phoneNumber, message, 'assistant');
        
        await this.delay(1000);
      }
      
      logger.info(`Evening checks sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending evening gym checks:', error);
    }
  }

  async sendBodyPartCheck() {
    try {
      logger.info('Sending body part checks...');
      
      const users = await User.find({});
      
      for (const user of users) {
        // Check if they went to gym today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (user.lastGymVisit && user.lastGymVisit >= today) {
          const message = '💪 REPORT! What body part did you destroy today? Chest? Back? Legs? Arms? Shoulders? Tell me NOW!';
          
          await whatsappService.sendMessage(user.phoneNumber, message);
          await conversationService.saveMessage(user.phoneNumber, message, 'assistant');
        }
        
        await this.delay(1000);
      }
      
      logger.info(`Body part checks sent`);
    } catch (error) {
      logger.error('Error sending body part checks:', error);
    }
  }

  async sendProteinReminder() {
    try {
      logger.info('Sending protein reminders...');
      
      const users = await User.find({});
      
      for (const user of users) {
        const history = await conversationService.getConversationHistory(user.phoneNumber, 5);
        
        const message = await geminiClient.generateResponse(
          'Ask the user in a friendly, humanistic way if they completed their protein goal yesterday. Be warm and encouraging like a friend checking in.',
          history
        );
        
        await whatsappService.sendMessage(user.phoneNumber, message);
        await conversationService.saveMessage(user.phoneNumber, message, 'assistant');
        
        await this.delay(1000);
      }
      
      logger.info(`Protein reminders sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending protein reminders:', error);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    logger.info('Stopping reminder scheduler...');
    this.jobs.forEach(job => job.stop());
    logger.info('Reminder scheduler stopped');
  }
}

export const reminderScheduler = new ReminderScheduler();
