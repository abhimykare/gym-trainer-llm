import { geminiClient } from '../llm/geminiClient.js';
import { userService } from '../services/userService.js';
import { workoutService } from '../services/workoutService.js';
import { conversationService } from '../services/conversationService.js';
import { memoryService } from '../services/memoryService.js';
import { INTENT_KEYWORDS } from '../constants/trainerRules.js';
import { logger } from '../utils/logger.js';

export class MessageRouter {
  async handleMessage(phoneNumber, messageText) {
    try {
      // Save user message
      await conversationService.saveMessage(phoneNumber, messageText, 'user');
      
      // Ensure user exists
      const user = await userService.findOrCreateUser(phoneNumber);
      
      // Check if profile is complete
      const profileComplete = await memoryService.checkProfileComplete(user);
      
      // If profile incomplete, collect profile info first
      if (!profileComplete) {
        const profileUpdate = await memoryService.updateProfileFromMessage(phoneNumber, messageText, user);
        
        if (profileUpdate.updated) {
          if (profileUpdate.complete) {
            const response = profileUpdate.message;
            await conversationService.saveMessage(phoneNumber, response, 'assistant');
            return response;
          } else {
            // Ask next profile question
            const updatedUser = await userService.getUserProfile(phoneNumber);
            const nextQuestion = memoryService.getNextProfileQuestion(updatedUser);
            await conversationService.saveMessage(phoneNumber, nextQuestion, 'assistant');
            return nextQuestion;
          }
        } else {
          // Invalid input, ask again
          const nextQuestion = memoryService.getNextProfileQuestion(user);
          const response = `Invalid input! ${nextQuestion}`;
          await conversationService.saveMessage(phoneNumber, response, 'assistant');
          return response;
        }
      }
      
      // Get conversation context with smart memory
      const context = await memoryService.getConversationContext(phoneNumber);
      
      // Manage memory (summarize if > 100 messages)
      await memoryService.manageConversationMemory(phoneNumber);
      
      // Detect intent
      const intent = this.detectIntent(messageText);
      
      let response;
      
      switch (intent) {
        case 'GYM_CONFIRMATION':
          response = await this.handleGymConfirmation(user, context, messageText);
          break;
          
        case 'GYM_DENIAL':
          response = await this.handleGymDenial(user, context);
          break;
          
        case 'WORKOUT_REQUEST':
          response = await this.handleWorkoutRequest(user, context);
          break;
          
        case 'BODY_PART':
          response = await this.handleBodyPartWorkout(user, context, messageText);
          break;
          
        case 'HELP':
          response = this.getHelpMessage();
          break;
          
        default:
          response = await this.handleGeneralConversation(messageText, context, user);
      }
      
      // Save assistant response
      await conversationService.saveMessage(phoneNumber, response, 'assistant');
      
      return response;
    } catch (error) {
      logger.error('Error handling message:', error);
      return 'Error processing your message. Try again!';
    }
  }

  detectIntent(message) {
    const lowerMessage = message.toLowerCase().trim();
    
    for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
      if (keywords.some(keyword => lowerMessage.includes(keyword))) {
        return intent;
      }
    }
    
    return 'GENERAL';
  }

  async handleGymConfirmation(user, context, message) {
    await userService.recordGymVisit(user.phoneNumber);
    
    // Check if they mentioned body part
    const bodyParts = ['chest', 'back', 'legs', 'shoulders', 'arms', 'biceps', 'triceps', 'core', 'abs'];
    const mentionedBodyPart = bodyParts.find(part => message.toLowerCase().includes(part));
    
    if (mentionedBodyPart) {
      await userService.updateUserProfile(user.phoneNumber, {
        lastBodyPartWorked: mentionedBodyPart,
        lastWorkoutDate: new Date(),
      });
      
      return `GOOD! ${mentionedBodyPart.toUpperCase()} day done! 💪 That's what I like to see!\n\nNow REST that muscle group. Tomorrow we hit something else. I'll tell you the plan tomorrow morning! 🔥`;
    }
    
    return `Good! You went to gym! But WHAT BODY PART did you work on? Tell me NOW! Chest? Back? Legs? Arms? Shoulders?`;
  }

  async handleGymDenial(user, context) {
    const response = await geminiClient.generateResponse(
      "User skipped gym today. Be ANGRY and STRICT. Show disappointment. Tell them excuses don't build muscles. Be tough but remind them tomorrow is a new chance. Keep it SHORT and DIRECT.",
      context
    );
    return response;
  }

  async handleWorkoutRequest(user, context) {
    const nextBodyParts = this.getNextBodyParts(user.lastBodyPartWorked);
    
    const prompt = `User wants workout plan. Their last workout was: ${user.lastBodyPartWorked || 'none'}.
    
Next 2 body parts to work: ${nextBodyParts.join(', ')}

Generate workout plan for ${nextBodyParts[0]} with 4-5 exercises. Be STRICT and DIRECT. Format properly with sets, reps, rest time.`;
    
    const response = await geminiClient.generateResponse(prompt, context);
    return response;
  }

  async handleBodyPartWorkout(user, context, message) {
    const bodyParts = ['chest', 'back', 'legs', 'shoulders', 'arms', 'biceps', 'triceps', 'core', 'abs'];
    const mentionedBodyPart = bodyParts.find(part => message.toLowerCase().includes(part));
    
    if (mentionedBodyPart) {
      await userService.updateUserProfile(user.phoneNumber, {
        lastBodyPartWorked: mentionedBodyPart,
        lastWorkoutDate: new Date(),
      });
      
      const prompt = `Generate STRICT workout plan for ${mentionedBodyPart}. 4-5 exercises with sets, reps, rest. Be DIRECT and COMMANDING.`;
      const response = await geminiClient.generateResponse(prompt, context);
      return response;
    }
    
    return "Which body part? Be SPECIFIC! Chest? Back? Legs? Arms? Shoulders?";
  }

  async handleGeneralConversation(message, context, user) {
    // Add user profile to context
    const profileContext = `User profile: Nickname: ${user.nickname}, Age: ${user.age}, Height: ${user.height}cm, Weight: ${user.weight}kg, Last body part worked: ${user.lastBodyPartWorked || 'none'}`;
    
    const response = await geminiClient.generateResponse(
      `${profileContext}\n\nUser message: ${message}\n\nRespond according to STRICT rules. If off-topic, REDIRECT to fitness. Be TOUGH and DIRECT.`,
      context
    );
    return response;
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

  getHelpMessage() {
    return `🏋️ *Arnold - Your STRICT Gym Trainer*

I'm Arnold. I'm here for ONE thing: YOUR FITNESS! 💪

*What I do:*
- Track your gym attendance
- Plan your workouts (body part rotation)
- Monitor your nutrition
- Keep you ACCOUNTABLE

*Rules:*
- NO casual talk
- NO off-topic questions  
- ONLY fitness, gym, nutrition
- Be HONEST about your workouts
- NO EXCUSES

*Commands:*
- "yes" + body part → Log workout
- "workout" → Get next workout plan
- "protein done" → Log protein

Stay FOCUSED! 🔥`;
  }
}

export const messageRouter = new MessageRouter();
