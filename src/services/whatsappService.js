import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { messageRouter } from '../controllers/messageRouter.js';
import QRCode from 'qrcode';

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.qrCodeData = null;
    this.qrCount = 0;
  }

  async initialize() {
    try {
      logger.info('Initializing WhatsApp client...');

      let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

      if (!executablePath) {
        // Docker / Linux (Render)
        const linuxChrome = '/usr/bin/google-chrome-stable';
        const { default: fs } = await import('fs');
        if (fs.existsSync(linuxChrome)) {
          executablePath = linuxChrome;
          logger.info('Using google-chrome-stable (Linux/Docker)');
        } else {
          // Mac fallback
          const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
          if (fs.existsSync(macChrome)) {
            executablePath = macChrome;
            logger.info('Using system Chrome (Mac)');
          }
        }
      }

      const puppeteerConfig = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
      };

      if (executablePath) {
        puppeteerConfig.executablePath = executablePath;
        logger.info(`Chrome path: ${executablePath}`);
      }

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: config.whatsapp.sessionPath,
        }),
        puppeteer: puppeteerConfig,
        // Increase timeouts for slow environments like Render
        authTimeoutMs: 120000,
        qrMaxRetries: 10,
      });

      // Register ALL event handlers BEFORE calling initialize()
      this.setupEventHandlers();

      logger.info('Starting WhatsApp client initialization (waiting for QR or auth)...');
      await this.client.initialize();

    } catch (error) {
      logger.error('Error initializing WhatsApp client:', error);
      throw error;
    }
  }

  setupEventHandlers() {
    // QR Code
    this.client.on('qr', async (qr) => {
      this.qrCount++;
      this.qrCodeData = qr;

      const url = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr);

      process.stdout.write('\n');
      process.stdout.write('============================================================\n');
      process.stdout.write(`QR CODE #${this.qrCount} - SCAN WITH WHATSAPP\n`);
      process.stdout.write('============================================================\n');
      process.stdout.write('QR DATA:\n');
      process.stdout.write(qr + '\n');
      process.stdout.write('\n');
      process.stdout.write('QR URL (open in browser):\n');
      process.stdout.write(url + '\n');
      process.stdout.write('============================================================\n');
      process.stdout.write('\n');

      // Also log via logger for Render log stream
      logger.info(`QR #${this.qrCount} DATA: ${qr}`);
      logger.info(`QR #${this.qrCount} URL: ${url}`);

      try {
        await QRCode.toFile(`/tmp/whatsapp-qr-${this.qrCount}.png`, qr);
        logger.info(`QR image saved: /tmp/whatsapp-qr-${this.qrCount}.png`);
      } catch (err) {
        // non-fatal
      }
    });

    // Loading screen (fires during initialization)
    this.client.on('loading_screen', (percent, message) => {
      logger.info(`WhatsApp loading: ${percent}% - ${message}`);
    });

    // Authenticated
    this.client.on('authenticated', (session) => {
      logger.info('✅ WhatsApp AUTHENTICATED successfully!');
      logger.info('Session saved. Waiting for ready event...');
    });

    // Auth failure
    this.client.on('auth_failure', (msg) => {
      logger.error(`❌ WhatsApp auth FAILED: ${msg}`);
      logger.error('Clearing session and restarting...');
      this.clearSessionAndRestart();
    });

    // Ready
    this.client.on('ready', () => {
      this.isReady = true;
      logger.info('🚀 WhatsApp client is READY! Bot is now active and listening for messages.');
    });

    // Incoming messages
    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });

    // Disconnected
    this.client.on('disconnected', (reason) => {
      logger.warn(`WhatsApp disconnected: ${reason}`);
      this.isReady = false;
      // Delay reconnect to avoid rapid loops
      setTimeout(() => this.reconnect(), 10000);
    });

    // Remote session saved
    this.client.on('remote_session_saved', () => {
      logger.info('Remote session saved successfully');
    });
  }

  async handleIncomingMessage(message) {
    try {
      if (message.from.includes('@g.us') || message.isStatus) return;

      const phoneNumber = message.from;
      const messageText = message.body;

      logger.info(`📨 Message from ${phoneNumber}: ${messageText}`);

      const response = await messageRouter.handleMessage(phoneNumber, messageText);
      await this.sendMessage(phoneNumber, response);
    } catch (error) {
      logger.error('Error handling incoming message:', error);
    }
  }

  async sendMessage(phoneNumber, message) {
    try {
      if (!this.isReady) {
        logger.warn(`Cannot send message - client not ready. isReady=${this.isReady}`);
        return false;
      }
      await this.client.sendMessage(phoneNumber, message);
      logger.info(`✉️ Message sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error('Error sending message:', error);
      return false;
    }
  }

  async clearSessionAndRestart() {
    try {
      const { default: fs } = await import('fs');
      const sessionPath = config.whatsapp.sessionPath;
      if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        logger.info('Session cleared');
      }
    } catch (err) {
      logger.error('Error clearing session:', err.message);
    }
    setTimeout(() => this.reconnect(), 5000);
  }

  async reconnect() {
    logger.info('Attempting to reconnect WhatsApp client...');
    try {
      if (this.client) {
        try { await this.client.destroy(); } catch (_) {}
        this.client = null;
      }
      this.isReady = false;
      this.qrCount = 0;
      await this.initialize();
    } catch (error) {
      logger.error('Reconnection failed:', error);
      setTimeout(() => this.reconnect(), 15000);
    }
  }

  getClient() { return this.client; }
  getQRCode() { return this.qrCodeData; }
  isClientReady() { return this.isReady; }
}

export const whatsappService = new WhatsAppService();
