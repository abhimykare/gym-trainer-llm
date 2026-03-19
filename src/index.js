import { config } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { whatsappService } from './services/whatsappService.js';
import { reminderScheduler } from './schedulers/reminderScheduler.js';
import { logger } from './utils/logger.js';
import http from 'http';
import fs from 'fs';

function clearOldQRFiles() {
  try {
    const files = fs.readdirSync('/tmp');
    files.forEach(file => {
      if (file.startsWith('whatsapp-qr')) {
        fs.unlinkSync(`/tmp/${file}`);
        logger.info(`Cleared old QR file: ${file}`);
      }
    });
  } catch (_) {}
}

async function startBot() {
  try {
    logger.info('🤖 Starting WhatsApp AI Gym Trainer Bot...');

    clearOldQRFiles();

    // Connect to MongoDB
    await connectDatabase();
    logger.info('✅ MongoDB connected');

    // Initialize WhatsApp (this registers events + calls client.initialize())
    await whatsappService.initialize();

    // Start reminder scheduler
    reminderScheduler.start();

    logger.info('✅ Bot startup complete. Waiting for WhatsApp ready event...');

    // Health check HTTP server (required by Render)
    const PORT = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
      const ready = whatsappService.isClientReady();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'running', whatsappReady: ready }));
    });

    server.listen(PORT, () => {
      logger.info(`Health check server running on port ${PORT}`);
    });

    // Log ready status every 30 seconds so we can see it in Render logs
    setInterval(() => {
      const ready = whatsappService.isClientReady();
      logger.info(`[HEARTBEAT] WhatsApp isReady=${ready}`);
    }, 30000);

  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

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

startBot();
