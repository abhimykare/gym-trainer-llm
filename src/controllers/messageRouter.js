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
      // Fire-and-forget: profile auto-update runs after response to avoid competing for rate limit
      memoryService.autoUpdateProfileFromConversation(phoneNumber, messageText, user).catch(e =>
        logger.error('autoUpdateProfile error:', e)
      );
      const freshUser = await userService.getUserProfile(phoneNumber);

      // --- Stateful gym check flow ---
      // Only honor gymCheckState if it was set recently (within 2 hours of the reminder)
      const gymCheckActive = freshUser.gymCheckState &&
        freshUser.gymCheckStateSetAt &&
        (Date.now() - new Date(freshUser.gymCheckStateSetAt).getTime()) < 2 * 60 * 60 * 1000;

      if (gymCheckActive && freshUser.gymCheckState === 'awaiting_gym_status') {
        return await this._handleGymStatusReply(phoneNumber, messageText, freshUser, context);
      }
      if (gymCheckActive && freshUser.gymCheckState === 'awaiting_excuse') {
        return await this._handleExcuseReply(phoneNumber, messageText, freshUser, context);
      }

      // Clear stale gymCheckState if window expired
      if (freshUser.gymCheckState && !gymCheckActive) {
        await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: null, gymCheckStateSetAt: null } });
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
      const plan = await this._getSmartWorkoutPlan(user, context, 'User confirmed they are in the gym RIGHT NOW. Give the plan immediately, energetically.');
      await conversationService.saveMessage(phoneNumber, plan, 'assistant');
      return plan;
    }

    if (isNo) {
      // Move to excuse collection
      await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: 'awaiting_excuse', gymCheckStateSetAt: new Date() } });
      const response = `Alright, what happened? Give me a real reason — I'm listening. 😤`;
      await conversationService.saveMessage(phoneNumber, response, 'assistant');
      return response;
    }

    // Unclear — ask again
    const response = `Simple question — are you in the gym right now? Yes or no.`;
    await conversationService.saveMessage(phoneNumber, response, 'assistant');
    await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: 'awaiting_gym_status', gymCheckStateSetAt: new Date() } });
    return response;
  }

  // ─── Stateful gym check: step 2 — evaluate excuse ─────────────────────────

  async _handleExcuseReply(phoneNumber, messageText, user, context) {
    await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: null } });

    const historySummary = this._buildWorkoutHistorySummary(user);
    const pendingPart = user.pendingWorkout?.bodyPart || 'today\'s session';
    const prompt = EXCUSE_EVALUATION_PROMPT.replace('{EXCUSE}', messageText)
      + `\n\nContext: Missed workout was ${pendingPart}. History: ${historySummary}.`
      + (this._isValidExcuse(messageText)
          ? `\nThis is a VALID excuse. Accept it. Tell them the same session repeats tomorrow.`
          : `\nThis is an INVALID excuse. Push back firmly but humanly. Give a specific solution. Tell them to go tonight or first thing tomorrow.`);

    if (!this._isValidExcuse(messageText)) {
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

  // Build a workout history summary string for the LLM
  _buildWorkoutHistorySummary(user) {
    const history = user.workoutHistory || [];
    if (history.length === 0) return 'No workout history. This is their first session.';

    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const twoWeeks = 14 * 24 * 60 * 60 * 1000;

    const thisWeek = history.filter(w => now - new Date(w.date).getTime() < oneWeek);
    const lastWeek = history.filter(w => {
      const age = now - new Date(w.date).getTime();
      return age >= oneWeek && age < twoWeeks;
    });
    const older = history.filter(w => now - new Date(w.date).getTime() >= twoWeeks);

    const fmt = sessions => sessions.map(w =>
      `${new Date(w.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}: ${w.bodyParts.join('+')}`
    ).join(', ');

    let summary = '';
    if (thisWeek.length) summary += `This week: ${fmt(thisWeek)}. `;
    if (lastWeek.length) summary += `Last week: ${fmt(lastWeek)}. `;
    if (older.length) summary += `Earlier: ${fmt(older.slice(-4))}. `;
    return summary.trim() || 'No recent history.';
  }

  async _getSmartWorkoutPlan(user, context, extraInstruction = '') {
    const historySummary = this._buildWorkoutHistorySummary(user);
    const isPending = !!user.pendingWorkout?.bodyPart;
    const pendingNote = isPending
      ? `IMPORTANT: User missed their last workout (${user.pendingWorkout.bodyPart}). That session must repeat today.`
      : '';

    const prompt = `You are a professional gym trainer planning today's workout.

User: ${user.nickname}, ${user.age}y, ${user.height}cm, ${user.weight}kg.
Workout history: ${historySummary}
${pendingNote}
${extraInstruction}

RULES:
- Always pair 2 complementary muscle groups per session (e.g. Chest+Triceps, Back+Biceps, Legs+Shoulders, etc.)
- Default first session (no history) = Chest + Triceps
- Never repeat the same muscle group from the previous session
- Look at the full history to ensure proper weekly rotation — avoid repeating what was done this week if possible
- A full week should ideally cover: Chest+Triceps, Back+Biceps, Legs+Shoulders, Arms+Core (4 days)
- Generate exactly 6 exercises total (3 per muscle group)
- Format each exercise: name, sets x reps, rest time
- Start with the muscle combo decision, then list exercises
- Be direct and motivating, not robotic`;

    return geminiClient.generateResponse(prompt, context);
  }

  async handleGymConfirmation(user, context, message) {
    await userService.recordGymVisit(user.phoneNumber);

    // Check if they mentioned a specific body part they already did
    const bodyParts = ['chest', 'back', 'legs', 'shoulders', 'arms', 'biceps', 'triceps', 'core', 'abs'];
    const mentioned = bodyParts.find(p => message.toLowerCase().includes(p));

    if (mentioned) {
      // They told us what they did — record it and acknowledge
      await userService.recordWorkoutDone(user.phoneNumber, [mentioned]);
      const historySummary = this._buildWorkoutHistorySummary(await userService.getUserProfile(user.phoneNumber));
      const prompt = `User just finished ${mentioned.toUpperCase()} at the gym. Acknowledge it with genuine energy. Then tell them what their next session should be based on this history: ${historySummary}. Keep it short.`;
      return geminiClient.generateResponse(prompt, context);
    }

    // They're at the gym — give them today's smart plan
    const plan = await this._getSmartWorkoutPlan(user, context, 'User just confirmed they are at the gym right now. Give them the plan immediately.');
    return plan;
  }

  async handleGymMissed(user, context, phoneNumber) {
    await User.findOneAndUpdate({ phoneNumber }, { $set: { gymCheckState: 'awaiting_excuse', gymCheckStateSetAt: new Date() } });
    const historySummary = this._buildWorkoutHistorySummary(user);
    // Figure out what they should have done
    const pendingPart = user.pendingWorkout?.bodyPart;
    const missedNote = pendingPart ? `They missed: ${pendingPart}` : `Based on history (${historySummary}), determine what they should have done today.`;
    await User.findOneAndUpdate({ phoneNumber }, {
      $set: { 'pendingWorkout.assignedDate': new Date() }
    });
    return `Missed gym today?\n\n${missedNote.includes('determine') ? "I know what you skipped." : `Today was *${pendingPart?.toUpperCase()}* day.`}\n\nWhat happened? Give me a real reason.`;
  }

  async handleWorkoutRequest(user, context) {
    const isPending = !!user.pendingWorkout?.bodyPart;
    const extra = isPending ? `User missed their previous workout (${user.pendingWorkout.bodyPart}). Repeat it today, be firm about it.` : '';
    return this._getSmartWorkoutPlan(user, context, extra);
  }

  async handleBodyPartWorkout(user, context, message) {
    const bodyParts = ['chest', 'back', 'legs', 'shoulders', 'arms', 'biceps', 'triceps', 'core', 'abs'];
    const mentioned = bodyParts.find(p => message.toLowerCase().includes(p));

    if (mentioned) {
      const historySummary = this._buildWorkoutHistorySummary(user);
      const prompt = `User wants to train ${mentioned.toUpperCase()} today.
History: ${historySummary}
Pick the best complementary muscle to pair with ${mentioned.toUpperCase()} based on the history (avoid repeating recent combos).
Generate 6 exercises total (3 per muscle group). Sets, reps, rest. Be direct.`;
      const response = await geminiClient.generateResponse(prompt, context);
      // Record the workout
      await userService.recordWorkoutDone(user.phoneNumber, [mentioned]);
      return response;
    }

    return `Which body part? Chest? Back? Legs? Arms? Shoulders? Be specific.`;
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
