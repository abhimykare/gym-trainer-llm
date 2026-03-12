import dotenv from 'dotenv';

dotenv.config();

export const config = {
  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/gym-trainer',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  bot: {
    phoneNumber: process.env.BOT_PHONE_NUMBER || '',
  },
};

// Validate required environment variables
const requiredEnvVars = ['GEMINI_API_KEY', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}
