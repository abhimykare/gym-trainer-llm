import { config } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { whatsappService } from './services/whatsappService.js';
import { reminderScheduler } from './schedulers/reminderScheduler.js';
import { logger } from './utils/logger.js';
import http from 'http';
import fs from 'fs';
import path from 'path';

// Clear cache on first startup
function clearCache() {
  try {
    const sessionPath = config.whatsapp.sessionPath;
    
    // Check if this is first run (no session exists)
    if (fs.existsSync(sessionPath)) {
      const files = fs.readdirSync(sessionPath);
      if (files.length === 0) {
        logger.info('Session folder is empty, this is first run');
      } else {
        logger.info('Existing session found, will reuse it');
      }
    } else {
      logger.info('No session folder found, creating fresh session');
      fs.mkdirSync(sessionPath, { recursive: true });
    }
    
    // Clear any temporary cache files
    const tempPaths = ['/tmp/whatsapp-qr*.png'];
    tempPaths.forEach(pattern => {
      try {
        const dir = path.dirname(pattern);
        const files = fs.readdirSync(dir);
        files.forEach(file => {
          if (file.startsWith('whatsapp-qr')) {
            fs.unlinkSync(path.join(dir, file));
            logger.info(`Cleared temp file: ${file}`);
          }
        });
      } catch (err) {
        // Ignore errors for temp files
      }
    });
    
  } catch (error) {
    logger.warn('Error during cache cleanup:', error.message);
  }
}

async function startBot() {
  try {
    logger.info('🤖 Starting WhatsApp AI Gym Trainer Bot...');
    
    // Clear cache first
    clearCache();
    
    // Connect to MongoDB
    await connectDatabase();
    
    // Initialize WhatsApp client
    await whatsappService.initialize();
    
    // Start reminder scheduler
    reminderScheduler.start();
    
    logger.info('✅ Bot is running successfully!');
    logger.info('📱 Scan the QR code with WhatsApp to connect');
    
    // Create a simple HTTP server for Render health checks
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('WhatsApp Bot is running');
    });
    
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      logger.info(`Health check server running on port ${PORT}`);
    });
    
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
