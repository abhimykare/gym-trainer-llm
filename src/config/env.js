import dotenv from 'dotenv';

dotenv.config();

export const config = {
  whatsapp: {
    sessionPath: process.env.WHATSAPP_SESSION_PATH || './whatsapp-session',
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/gym-trainer',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
  },
  bot: {
    phoneNumber: process.env.BOT_PHONE_NUMBER || '',
  },
  port: process.env.PORT || 3000,
};

// Validate required environment variables
const requiredEnvVars = ['GROQ_API_KEY', 'MONGODB_URI'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}
