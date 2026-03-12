import { config } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { whatsappService } from './services/whatsappService.js';
import { reminderScheduler } from './schedulers/reminderScheduler.js';
import { logger } from './utils/logger.js';

async function startBot() {
  try {
    logger.info('🤖 Starting WhatsApp AI Gym Trainer Bot...');
    
    // Connect to MongoDB
    await connectDatabase();
    
    // Initialize WhatsApp client
    await whatsappService.initialize();
    
    // Start reminder scheduler
    reminderScheduler.start();
    
    logger.info('✅ Bot is running successfully!');
    logger.info('📱 Scan the QR code with WhatsApp to connect');
    
  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  reminderScheduler.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  reminderScheduler.stop();
  process.exit(0);
});

// Start the bot
startBot();
