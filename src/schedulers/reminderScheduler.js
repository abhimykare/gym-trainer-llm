import cron from 'node-cron';
import { whatsappService } from '../services/whatsappService.js';
import { User } from '../models/User.js';
import { geminiClient } from '../llm/geminiClient.js';
import { conversationService } from '../services/conversationService.js';
import { logger } from '../utils/logger.js';

class ReminderScheduler {
  constructor() {
    this.jobs = [];
    // Map of phoneNumber → cron job for per-user gym reminders
    this.gymReminderJobs = new Map();
  }

  start() {
    logger.info('Starting reminder scheduler...');

    // 7:30 AM - Good morning + today's workout + water goal
    this.jobs.push(cron.schedule('30 7 * * *', () => this.sendMorningGreeting(), { timezone: 'Asia/Kolkata' }));

    // 8:00 AM - Protein reminder
    this.jobs.push(cron.schedule('0 8 * * *', () => this.sendProteinReminder(), { timezone: 'Asia/Kolkata' }));

    // 9:30 AM - Morning gym reminder (pending workout callout)
    this.jobs.push(cron.schedule('30 9 * * *', () => this.sendMorningGymReminder(), { timezone: 'Asia/Kolkata' }));

    // 12:00 PM - Noon water + nutrition check
    this.jobs.push(cron.schedule('0 12 * * *', () => this.sendNoonGreeting(), { timezone: 'Asia/Kolkata' }));

    // 8:45 PM - Body part check (only for users who visited gym today)
    this.jobs.push(cron.schedule('45 20 * * *', () => this.sendBodyPartCheck(), { timezone: 'Asia/Kolkata' }));

    // 10:00 PM - Night water completion check
    this.jobs.push(cron.schedule('0 22 * * *', () => this.sendNightWaterCheck(), { timezone: 'Asia/Kolkata' }));

    // Load dynamic gym reminder for every existing user who has a gymTime set
    this._loadAllGymReminders();

    logger.info('Reminder scheduler started successfully');
  }

  // ─── Dynamic per-user gym reminder ────────────────────────────────────────

  /**
   * Called once on startup — registers gym reminder crons for all users who have gymTime.
   */
  async _loadAllGymReminders() {
    try {
      const users = await User.find({ profileComplete: true, gymTime: { $exists: true, $ne: null } });
      for (const user of users) {
        this.scheduleGymReminderForUser(user.phoneNumber, user.gymTime);
      }
      logger.info(`Loaded gym reminders for ${users.length} users`);
    } catch (error) {
      logger.error('Error loading gym reminders:', error);
    }
  }

  /**
   * Schedule (or reschedule) a 15-min-before-gym reminder for a single user.
   * gymTime format: "HH:MM" (24h), e.g. "19:30"
   */
  scheduleGymReminderForUser(phoneNumber, gymTime) {
    // Cancel existing job for this user if any
    if (this.gymReminderJobs.has(phoneNumber)) {
      this.gymReminderJobs.get(phoneNumber).stop();
      this.gymReminderJobs.delete(phoneNumber);
    }

    const [hStr, mStr] = gymTime.split(':');
    let h = parseInt(hStr);
    let m = parseInt(mStr) - 15;

    if (m < 0) {
      m += 60;
      h -= 1;
    }
    if (h < 0) h += 24;

    const cronExpr = `${m} ${h} * * *`;
    logger.info(`Scheduling gym reminder for ${phoneNumber} at ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} (15 min before ${gymTime})`);

    const job = cron.schedule(cronExpr, async () => {
      await this._sendGymReminder(phoneNumber, gymTime);
    }, { timezone: 'Asia/Kolkata' });

    this.gymReminderJobs.set(phoneNumber, job);
  }

  async _sendGymReminder(phoneNumber, gymTime) {
    try {
      const user = await User.findOne({ phoneNumber });
      if (!user) return;

      const planned = user.pendingWorkout?.bodyPart || this.getNextBodyParts(user.lastBodyPartWorked)[0];
      const waterGoal = user.dailyWaterGoalLiters || 2.5;
      const eveningTarget = Math.round(waterGoal * 0.85 * 10) / 10;

      const message = `⏰ GYM TIME IN 15 MINUTES!\n\nToday: *${planned.toUpperCase()}* day. ${user.gymTime} is YOUR time. No backing out NOW! 😤\n\nGet your bag. Get your water. GO! 💪\n\n💧 Water check: ${eveningTarget}L by now out of ${waterGoal}L.`;

      // Set gymCheckState — their next reply will be treated as gym status (within 2h window)
      await User.findOneAndUpdate({ phoneNumber }, {
        $set: { gymCheckState: 'awaiting_gym_status', gymCheckStateSetAt: new Date() }
      });

      await whatsappService.sendMessage(phoneNumber, message);
      await conversationService.saveMessage(phoneNumber, message, 'assistant');

      logger.info(`Gym reminder sent to ${phoneNumber}`);
    } catch (error) {
      logger.error(`Error sending gym reminder to ${phoneNumber}:`, error);
    }
  }

  // ─── Scheduled broadcasts ─────────────────────────────────────────────────

  async sendMorningGreeting() {
    try {
      const users = await User.find({ profileComplete: true });
      for (const user of users) {
        const nextBodyParts = this.getNextBodyParts(user.lastBodyPartWorked);
        const waterGoal = user.dailyWaterGoalLiters || 2.5;
        const morningWater = Math.round(waterGoal * 0.4 * 10) / 10;
        const gymTimeDisplay = user.gymTime || 'your gym time';

        // Don't ask "did you go?" in the morning — just hype them up for their scheduled time
        const msgs = [
          `🌅 Morning ${user.nickname}! Today is *${nextBodyParts[0].toUpperCase()}* day. I'll remind you 15 min before ${gymTimeDisplay} — be ready. 💪\n\n💧 Start your day with water. Target ${morningWater}L before noon, ${waterGoal}L total.`,
          `☀️ Good morning ${user.nickname}! *${nextBodyParts[0].toUpperCase()}* is on the menu today. Gym at ${gymTimeDisplay} — no last-minute excuses. 🔥\n\n💧 ${morningWater}L by noon, ${waterGoal}L by end of day. Get drinking.`,
          `🌄 Up and at it ${user.nickname}! *${nextBodyParts[0].toUpperCase()}* day. I've got ${gymTimeDisplay} locked in for you. Tomorrow: ${nextBodyParts[1].toUpperCase()}. Stay on track. 💪\n\n💧 Water goal: ${waterGoal}L today. First ${morningWater}L before noon.`,
        ];

        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        await whatsappService.sendMessage(user.phoneNumber, msg);
        await conversationService.saveMessage(user.phoneNumber, msg, 'assistant');
        await this.delay(1000);
      }
      logger.info(`Morning greetings sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending morning greetings:', error);
    }
  }

  async sendMorningGymReminder() {
    try {
      const users = await User.find({ profileComplete: true });
      for (const user of users) {
        const planned = user.pendingWorkout?.bodyPart || this.getNextBodyParts(user.lastBodyPartWorked)[0];
        const isPending = !!user.pendingWorkout?.bodyPart;
        const proteinGoal = Math.round((user.weight || 70) * 1.8);
        const gymTimeDisplay = user.gymTime || 'your gym time';

        // Only nag about missed workout if they had a pending one — otherwise just remind about today
        const msg = isPending
          ? `Hey ${user.nickname}, you still owe me *${planned.toUpperCase()}* from yesterday. That repeats today at ${gymTimeDisplay}. Don't even think about skipping again. 💪\n\n🥩 Protein goal: ${proteinGoal}g. Start tracking now.`
          : `${user.nickname} — *${planned.toUpperCase()}* is on for today at ${gymTimeDisplay}. I'll ping you 15 min before. Just be ready. 🔥\n\n🥩 Protein goal: ${proteinGoal}g. Get it in throughout the day.`;

        await whatsappService.sendMessage(user.phoneNumber, msg);
        await conversationService.saveMessage(user.phoneNumber, msg, 'assistant');
        await this.delay(1000);
      }
      logger.info(`Morning reminders sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending morning gym reminders:', error);
    }
  }

  async sendNoonGreeting() {
    try {
      const users = await User.find({ profileComplete: true });
      for (const user of users) {
        const waterGoal = user.dailyWaterGoalLiters || 2.5;
        const afternoonTarget = Math.round(waterGoal * 0.7 * 10) / 10;
        const proteinGoal = Math.round((user.weight || 70) * 1.8);

        const msgs = [
          `🌤️ NOON CHECK ${user.nickname}! Protein on track? You should be at ${afternoonTarget}L water by now. ${waterGoal}L total today! 💧`,
          `☀️ Midday ${user.nickname}! Eating clean? 🥗\n\n💧 Water: ${afternoonTarget}L by now out of ${waterGoal}L. 🥩 Protein: hit ${proteinGoal}g today!`,
          `🌞 Afternoon! Water: ${afternoonTarget}L by now. Protein: ${proteinGoal}g goal. Don't make me ask twice! 💪`,
        ];

        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        await whatsappService.sendMessage(user.phoneNumber, msg);
        await conversationService.saveMessage(user.phoneNumber, msg, 'assistant');
        await this.delay(1000);
      }
      logger.info(`Noon greetings sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending noon greetings:', error);
    }
  }

  async sendBodyPartCheck() {
    try {
      const users = await User.find({ profileComplete: true });
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const user of users) {
        if (user.lastGymVisit && user.lastGymVisit >= today) {
          const msg = `💪 REPORT ${user.nickname}! What body part did you destroy today? Chest? Back? Legs? Arms? Shoulders? Tell me NOW!`;
          await whatsappService.sendMessage(user.phoneNumber, msg);
          await conversationService.saveMessage(user.phoneNumber, msg, 'assistant');
        }
        await this.delay(1000);
      }
      logger.info('Body part checks sent');
    } catch (error) {
      logger.error('Error sending body part checks:', error);
    }
  }

  async sendProteinReminder() {
    try {
      const users = await User.find({ profileComplete: true });
      for (const user of users) {
        const proteinGoal = Math.round((user.weight || 70) * 1.8);
        const history = await conversationService.getConversationHistory(user.phoneNumber, 5);
        const prompt = `User's daily protein goal is ${proteinGoal}g (weight ${user.weight || 70}kg × 1.8). Ask them STRICTLY if they've hit their ${proteinGoal}g protein goal today. Be direct and commanding. No protein = no muscle recovery. Under 3 lines.`;
        const msg = await geminiClient.generateResponse(prompt, history);
        await whatsappService.sendMessage(user.phoneNumber, msg);
        await conversationService.saveMessage(user.phoneNumber, msg, 'assistant');
        await this.delay(1000);
      }
      logger.info(`Protein reminders sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending protein reminders:', error);
    }
  }

  async sendNightWaterCheck() {
    try {
      const users = await User.find({ profileComplete: true });
      for (const user of users) {
        const waterGoal = user.dailyWaterGoalLiters || 2.5;
        const msgs = [
          `🌙 Good night ${user.nickname}! Did you complete your ${waterGoal}L water goal today? Hydration = recovery. Answer honestly! 💧`,
          `🌛 Night check! ${waterGoal}L water — done or not? Muscles recover while you sleep. Hydrate NOW! 💧`,
          `🌜 Bedtime soon ${user.nickname}! Hit your ${waterGoal}L water goal? If not, drink a glass NOW. Recovery starts tonight! 💪`,
        ];
        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        await whatsappService.sendMessage(user.phoneNumber, msg);
        await conversationService.saveMessage(user.phoneNumber, msg, 'assistant');
        await this.delay(1000);
      }
      logger.info(`Night water checks sent to ${users.length} users`);
    } catch (error) {
      logger.error('Error sending night water checks:', error);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  getNextBodyParts(lastBodyPart) {
    // Simple fallback rotation for reminder messages (LLM handles actual workout planning)
    const schedule = {
      'chest':     ['back', 'legs'],
      'back':      ['legs', 'shoulders'],
      'legs':      ['chest', 'arms'],
      'shoulders': ['arms', 'chest'],
      'arms':      ['back', 'legs'],
      'biceps':    ['triceps', 'legs'],
      'triceps':   ['chest', 'back'],
      'core':      ['legs', 'chest'],
      'abs':       ['back', 'shoulders'],
    };
    return schedule[lastBodyPart] || ['chest', 'back'];
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    logger.info('Stopping reminder scheduler...');
    this.jobs.forEach(job => job.stop());
    this.gymReminderJobs.forEach(job => job.stop());
    logger.info('Reminder scheduler stopped');
  }
}

export const reminderScheduler = new ReminderScheduler();
