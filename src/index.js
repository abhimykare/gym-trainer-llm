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
      }
    });
  } catch (_) {}
}

async function startBot() {
  try {
    logger.info('🤖 Starting WhatsApp AI Gym Trainer Bot...');

    clearOldQRFiles();

    // 1. Start HTTP server FIRST so Render sees the port immediately
    const PORT = process.env.PORT || 3000;
    const server = http.createServer((req, res) => {
      const ready = whatsappService.isClientReady();
      const qr = whatsappService.getQRCode();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'running',
        whatsappReady: ready,
        hasQR: !!qr,
        qrUrl: qr
          ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`
          : null,
      }));
    });

    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`✅ HTTP server listening on 0.0.0.0:${PORT}`);
    });

    // 2. Connect MongoDB
    await connectDatabase();
    logger.info('✅ MongoDB connected');

    // 3. Start WhatsApp init in background - do NOT await it
    //    initialize() blocks until QR is scanned or session is restored
    //    which can take minutes on Render
    logger.info('🔄 Starting WhatsApp init in background...');
    whatsappService.initialize().catch(err => {
      logger.error('WhatsApp init error:', err);
    });

    // 4. Start scheduler
    reminderScheduler.start();

    // 5. Heartbeat every 20s
    setInterval(() => {
      logger.info(`[HEARTBEAT] whatsappReady=${whatsappService.isClientReady()}`);
    }, 20000);

  } catch (error) {
    logger.error('Failed to start bot:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  reminderScheduler.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  reminderScheduler.stop();
  process.exit(0);
});

startBot();
