import { geminiClient } from '../llm/geminiClient.js';
import { userService } from '../services/userService.js';
import { conversationService } from '../services/conversationService.js';
import { memoryService } from '../services/memoryService.js';
import { INTENT_CLASSIFICATION_PROMPT, EXCUSE_EVALUATION_PROMPT } from '../constants/trainerRules.js';
import { User } from '../models/User.js';
import { reminderScheduler } from '../schedulers/reminderScheduler.js';
import { logger } from '../utils/logger.js';

export class MessageRouter {
  async handleMessage(phoneNumber, messageText) {
    try {
      await conversationService.saveMessage(phoneNumber, messageText, 'user');

      const user = await userService.findOrCreateUser(phoneNumber);

      // --- Onboarding ---
      const profileComplete = await memoryService.checkProfileComplete(user);
      if (!profileComplete) {
        return await this._handleOnboarding(phoneNumber, messageText, user);
      }

      // --- Context & memory ---
      const context = await memoryService.getConversationContext(phoneNumber);
      await memoryService.manageConversationMemory(phoneNumber);
      await memoryService.autoUpdateProfileFromConversation(phoneNumber, messageText, user);
      const freshUser = await userService.getUserProfile(phoneNumber);

      // --- Stateful gym check flow (8:35 PM check) ---
      if (freshUser.gymCheckState === 'awaiting_gym_status') {
        return await this._handleGymStatusReply(phoneNumber, messageText, freshUser, context);
      }
      if (freshUser.gymCheckState === 'awaiting_excuse') {
        return await this._handleExcuseReply(phoneNumber, messageText, freshUser, context);
      }

      // --- Intent routing ---
      const intent = await this.detectIntent(messageText);
      let response;

      switch (intent) {
        case 'GYM_CONFIRMATION':
          response = await this.handleGymConfirmation(freshUser, context, messageText);
          break;
        case 'GYM_DENIAL':
        case 'GYM_MISSED':
          response = await this.handleGymMissed(freshUser, context, phoneNumber);
          break;
        case 'WORKOUT_REQUEST':
          response = await this.handleWorkoutRequest(freshUser, context);
          break;
        case 'BODY_PART':
          response = await this.handleBodyPartWorkout(freshUser, context, messageText);
          break;
        case 'PROTEIN_DONE':
          response = await this.handleProteinDone(freshUser, context);
          break;
        case 'PROTEIN_QUESTION':
        case 'FOOD_NUTRITION':
          response = await this.handleNutritionQuestion(messageText, context, freshUser);
          break;
        case 'HELP':
          response = this.getHelpMessage();
          break;
        default:
          response = await this.handleGeneralConversation(messageText, context, freshUser);
      }

      await conversationService.saveMessage(phoneNumber, response, 'assistant');
      return response;
    } catch (error) {
      logger.error('Error handling message:', error);
      return 'Error processing your message. Try again!';
    }
  }

  // ─── Onboarding ────────────────────────────────────────────────────────────

  async _handleOnboarding(phoneNumber, messageText, user) {
    const profileUpdate = await memoryService.updateProfileFromMessage(phoneNumber, messageText, user);

    let response;
    if (profileUpdate.updated) {
      if (profileUpdate.complete) {
        response = profileUpdate.message;
        // Schedule the dynamic gym reminder now that we have gymTime
        const updatedUser = await userService.getUserProfile(phoneNumber);
        if (updatedUser.gymTime) {
          reminderScheduler.scheduleGymReminderForUser(phoneNumber, updatedUser.gymTime);
        }
      } else {
        const updatedUser = await userService.getUserProfile(phoneNumber);
        response = memoryService.getNextProfileQuestion(updatedUser);
      }
    } else {
      const errorType = profileUpdate.isGreeting ? 'isGreeting'
        : profileUpdate.invalidNickname ? 'invalidNickname'
        : profileUpdate.invalidAge ? 'invalidAge'
        : profileUpdate.invalidHeight ? 'invalidHeight'
        : profileUpdate.invalidWeight ? 'invalidWeight'
        : profileUpdate.invalidGymTime ? 'invalidGymTime'
        : null;
      response = errorType
        ? memoryService.getInvalidInputMessage(user, errorType)
        : memoryService.getNextProfileQuestion(user);
    }

    await conversationService.saveMessage(phoneNumber, response, 'assistant');
    return response;
  }

  // ─── Stateful gym check: step 1 — are you in gym? ─────────────────────────

  async _handleGymStatusReply(phoneNumber, messageText, user, context) {
    const lower = messageText.toLowerCase().trim();
    const isYes = ['yes', 'yeah', 'yep', 'i am', 'in gym', 'at gym', 'going', 'on my way'].some(k => lower.includes(k));
    const isNo  = ['no', 'nope', 'nah', 'not going', 'can\'t', 'cannot', 'won\'t', 'will not', 'not today'].some(k => lower.includes(k));

    await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: null } });

    if (isYes) {
      await userService.recordGymVisit(phoneNumber);
      const planned = user.pendingWorkout?.bodyPart || this.getNextBodyParts(user.lastBodyPartWorked)[0];
      const prompt = `User confirmed they are in the gym RIGHT NOW. Today's workout is ${planned.toUpperCase()}. Generate the full workout plan immediately. Be energetic and commanding. Format with sets, reps, rest.`;
      const response = await geminiClient.generateResponse(prompt, context);
      await conversationService.saveMessage(phoneNumber, response, 'assistant');
      return response;
    }

    if (isNo) {
      // Move to excuse collection
      await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: 'awaiting_excuse' } });
      const response = `😤 NOT IN GYM?! WHY NOT?! Give me ONE good reason. And it better be REAL.`;
      await conversationService.saveMessage(phoneNumber, response, 'assistant');
      return response;
    }

    // Unclear — ask again
    const response = `Simple question. Are you IN THE GYM right now? YES or NO!`;
    await conversationService.saveMessage(phoneNumber, response, 'assistant');
    await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: 'awaiting_gym_status' } });
    return response;
  }

  // ─── Stateful gym check: step 2 — evaluate excuse ─────────────────────────

  async _handleExcuseReply(phoneNumber, messageText, user, context) {
    await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: null } });

    const planned = user.pendingWorkout?.bodyPart || this.getNextBodyParts(user.lastBodyPartWorked)[0];
    const prompt = EXCUSE_EVALUATION_PROMPT.replace('{EXCUSE}', messageText)
      + `\n\nContext: Today's planned workout was ${planned.toUpperCase()}.`
      + (this._isValidExcuse(messageText)
          ? `\nThis is a VALID excuse. Accept it. Tell them ${planned.toUpperCase()} repeats tomorrow. No mercy after this.`
          : `\nThis is an INVALID excuse. DESTROY it. Give specific solution. Command them to go NOW or first thing tomorrow. Remind them the workout repeats until they do it.`);

    // If valid, keep pendingWorkout so it repeats tomorrow
    if (!this._isValidExcuse(messageText)) {
      // Keep pending workout — repeats tomorrow
      await User.findOneAndUpdate({ phoneNumber }, {
        $set: { 'pendingWorkout.assignedDate': new Date() }
      });
    }

    const response = await geminiClient.generateResponse(prompt, context);
    await conversationService.saveMessage(phoneNumber, response, 'assistant');
    return response;
  }

  // Quick heuristic — LLM does the real evaluation, this just helps with flow
  _isValidExcuse(excuse) {
    const validKeywords = ['fever', 'vomit', 'hospital', 'surgery', 'injury', 'accident', 'death', 'funeral', 'emergency', 'fracture', 'broke', 'sprain'];
    const lower = excuse.toLowerCase();
    return validKeywords.some(k => lower.includes(k));
  }

  // ─── Intent detection ──────────────────────────────────────────────────────

  async detectIntent(message) {
    const validIntents = [
      'GYM_CONFIRMATION', 'GYM_DENIAL', 'GYM_MISSED', 'WORKOUT_REQUEST',
      'BODY_PART', 'PROTEIN_DONE', 'PROTEIN_QUESTION', 'FOOD_NUTRITION',
      'HELP', 'GENERAL',
    ];

    try {
      const prompt = INTENT_CLASSIFICATION_PROMPT.replace('{MESSAGE}', message);
      const raw = await geminiClient.generateResponse(prompt, [], '');
      const intent = raw.trim().toUpperCase().replace(/[^A-Z_]/g, '');
      return validIntents.includes(intent) ? intent : 'GENERAL';
    } catch (error) {
      logger.error('Intent classification failed, defaulting to GENERAL:', error);
      return 'GENERAL';
    }
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  async handleGymConfirmation(user, context, message) {
    await userService.recordGymVisit(user.phoneNumber);

    const bodyParts = ['chest', 'back', 'legs', 'shoulders', 'arms', 'biceps', 'triceps', 'core', 'abs'];
    const mentioned = bodyParts.find(p => message.toLowerCase().includes(p));

    if (mentioned) {
      await userService.updateUserProfile(user.phoneNumber, {
        lastBodyPartWorked: mentioned,
        lastWorkoutDate: new Date(),
        pendingWorkout: null,
      });
      return `GOOD! ${mentioned.toUpperCase()} day DONE! 💪 That's what I like to see!\n\nREST that muscle. Tomorrow we hit ${this.getNextBodyParts(mentioned)[0].toUpperCase()}. I'll remind you in the morning! 🔥`;
    }

    // They confirmed gym but didn't say body part — give today's planned workout
    const planned = user.pendingWorkout?.bodyPart || this.getNextBodyParts(user.lastBodyPartWorked)[0];
    const prompt = `User is at the gym. Today's workout: ${planned.toUpperCase()}. Generate full workout plan now. Be commanding and direct. Sets, reps, rest time.`;
    const response = await geminiClient.generateResponse(prompt, context);
    return response;
  }

  async handleGymMissed(user, context, phoneNumber) {
    // Set state to collect excuse
    await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: 'awaiting_excuse' } });
    const planned = user.pendingWorkout?.bodyPart || this.getNextBodyParts(user.lastBodyPartWorked)[0];
    // Store as pending so it repeats
    await User.findOneAndUpdate({ phoneNumber }, {
      $set: { pendingWorkout: { bodyPart: planned, assignedDate: new Date() } }
    });
    return `😤 MISSED GYM?! Today was ${planned.toUpperCase()} day!\n\nWHY didn't you go? Give me a REAL reason. NOW.`;
  }

  async handleWorkoutRequest(user, context) {
    // If there's a pending (missed) workout, repeat it
    const bodyPart = user.pendingWorkout?.bodyPart || this.getNextBodyParts(user.lastBodyPartWorked)[0];
    const isPending = !!user.pendingWorkout?.bodyPart;

    const prompt = `${isPending ? `User missed this workout before. It REPEATS today. Be strict about it. ` : ''}Generate workout plan for ${bodyPart.toUpperCase()}. 4-5 exercises. Sets, reps, rest. Be COMMANDING.`;
    const response = await geminiClient.generateResponse(prompt, context);
    return response;
  }

  async handleBodyPartWorkout(user, context, message) {
    const bodyParts = ['chest', 'back', 'legs', 'shoulders', 'arms', 'biceps', 'triceps', 'core', 'abs'];
    const mentioned = bodyParts.find(p => message.toLowerCase().includes(p));

    if (mentioned) {
      await userService.updateUserProfile(user.phoneNumber, {
        lastBodyPartWorked: mentioned,
        lastWorkoutDate: new Date(),
        pendingWorkout: null,
      });
      const prompt = `Generate STRICT workout plan for ${mentioned.toUpperCase()}. 4-5 exercises with sets, reps, rest. Be DIRECT and COMMANDING.`;
      return await geminiClient.generateResponse(prompt, context);
    }

    return `Which body part? Be SPECIFIC! Chest? Back? Legs? Arms? Shoulders?`;
  }

  async handleProteinDone(user, context) {
    const proteinGoal = Math.round((user.weight || 70) * 1.8);
    const prompt = `User says they completed their protein goal of ${proteinGoal}g. Acknowledge it briefly and strictly. Remind them to stay consistent. Keep it under 3 lines.`;
    return await geminiClient.generateResponse(prompt, context);
  }

  async handleNutritionQuestion(message, context, user) {
    const proteinGoal = Math.round((user.weight || 70) * 1.8);
    const prompt = `User profile: ${user.nickname}, ${user.age}y, ${user.height}cm, ${user.weight}kg. Daily protein goal: ${proteinGoal}g.\n\nUser question: ${message}\n\nAnswer this nutrition/food question accurately and helpfully. After answering, briefly remind them about their ${proteinGoal}g protein goal if relevant.`;
    return await geminiClient.generateResponse(prompt, context);
  }

  async handleGeneralConversation(message, context, user) {
    const proteinGoal = Math.round((user.weight || 70) * 1.8);
    const profileContext = `User: ${user.nickname}, ${user.age}y, ${user.height}cm, ${user.weight}kg. Last body part: ${user.lastBodyPartWorked || 'none'}. Daily protein goal: ${proteinGoal}g.`;

    const prompt = `${profileContext}\n\nUser message: "${message}"\n\nIf this is off-topic (not fitness/gym/nutrition/workout/protein/water), SHUT IT DOWN hard and redirect to fitness. If it's fitness-related, respond strictly and helpfully. Always end with a fitness-related question or reminder about their ${proteinGoal}g protein goal or today's workout.`;
    return await geminiClient.generateResponse(prompt, context);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  getNextBodyParts(lastBodyPart) {
    const schedule = {
      'chest':    ['back', 'legs'],
      'back':     ['legs', 'shoulders'],
      'legs':     ['chest', 'arms'],
      'shoulders':['arms', 'chest'],
      'arms':     ['back', 'legs'],
      'biceps':   ['triceps', 'legs'],
      'triceps':  ['chest', 'back'],
      'core':     ['legs', 'chest'],
      'abs':      ['back', 'shoulders'],
    };
    return schedule[lastBodyPart] || ['chest', 'back'];
  }

  getHelpMessage() {
    return `🏋️ *Arnold — Your 24/7 STRICT Trainer*

I'm here for ONE thing: YOUR FITNESS. 💪

*I handle:*
- Gym attendance tracking
- Workout plans (body part rotation)
- Nutrition & food questions
- Protein goal reminders
- Water intake tracking
- Holding you ACCOUNTABLE

*Rules:*
- NO off-topic talk
- Food/nutrition questions → ALLOWED
- Everything else → REDIRECTED to fitness
- NO EXCUSES for skipping gym

*Quick replies:*
- "yes" → Confirm gym visit
- "no" / "missed gym" → Prepare to explain yourself
- "workout" → Get today's plan
- "protein done" → Log protein goal

Stay FOCUSED. 🔥`;
  }
}

export const messageRouter = new MessageRouter();
