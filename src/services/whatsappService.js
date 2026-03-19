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
    this.initAttempt = 0;
  }

  async initialize() {
    this.initAttempt++;
    logger.info(`WhatsApp init attempt #${this.initAttempt}`);

    try {
      let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

      if (!executablePath) {
        const { default: fs } = await import('fs');
        const candidates = [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ];
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            executablePath = p;
            logger.info(`Chrome found at: ${p}`);
            break;
          }
        }
      }

      if (!executablePath) {
        throw new Error('No Chrome executable found. Set PUPPETEER_EXECUTABLE_PATH in env.');
      }

      const puppeteerConfig = {
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--safebrowsing-disable-auto-update',
        ],
      };

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: config.whatsapp.sessionPath,
        }),
        puppeteer: puppeteerConfig,
        authTimeoutMs: 0,   // no timeout - wait as long as needed
        qrMaxRetries: 20,   // keep generating QRs
        restartOnAuthFail: true,
      });

      this.setupEventHandlers();

      // client.initialize() resolves when the browser launches,
      // NOT when WhatsApp is ready. We wrap it and wait for 'ready'.
      await new Promise((resolve, reject) => {
        // Resolve when WhatsApp is fully ready
        this.client.once('ready', () => resolve());

        // Also resolve if already authenticated (session restore path)
        this.client.once('authenticated', () => {
          logger.info('✅ Session authenticated - waiting for ready...');
        });

        // Reject on auth failure
        this.client.once('auth_failure', (msg) => {
          reject(new Error(`Auth failure: ${msg}`));
        });

        // Start the browser + WhatsApp
        this.client.initialize().catch(reject);
      });

      logger.info('🚀 WhatsApp fully initialized and READY!');

    } catch (error) {
      logger.error(`WhatsApp init failed (attempt #${this.initAttempt}):`, error.message);
      this.isReady = false;

      // Auto-retry after delay
      const delay = Math.min(15000 * this.initAttempt, 60000);
      logger.info(`Retrying in ${delay / 1000}s...`);
      setTimeout(() => this.initialize(), delay);
    }
  }

  setupEventHandlers() {
    this.client.on('loading_screen', (percent, message) => {
      logger.info(`WhatsApp loading: ${percent}% - ${message}`);
    });

    this.client.on('qr', async (qr) => {
      this.qrCount++;
      this.qrCodeData = qr;

      const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;

      // Use stdout directly - bypasses any logger buffering
      process.stdout.write(`\n${'='.repeat(60)}\n`);
      process.stdout.write(`QR CODE #${this.qrCount} - SCAN WITH WHATSAPP NOW\n`);
      process.stdout.write(`${'='.repeat(60)}\n`);
      process.stdout.write(`OPEN THIS URL IN BROWSER TO SEE QR:\n`);
      process.stdout.write(`${url}\n`);
      process.stdout.write(`${'='.repeat(60)}\n\n`);

      logger.info(`QR #${this.qrCount} ready. URL logged above.`);

      try {
        await QRCode.toFile(`/tmp/whatsapp-qr-${this.qrCount}.png`, qr);
      } catch (_) {}
    });

    this.client.on('authenticated', () => {
      logger.info('✅ WhatsApp AUTHENTICATED!');
    });

    this.client.on('auth_failure', (msg) => {
      logger.error(`❌ Auth FAILED: ${msg}`);
      this.isReady = false;
      this.clearSession().then(() => {
        setTimeout(() => this.initialize(), 5000);
      });
    });

    this.client.on('ready', () => {
      this.isReady = true;
      this.initAttempt = 0; // reset backoff on success
      logger.info('🚀 WhatsApp is READY! Bot is active.');
    });

    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });

    this.client.on('disconnected', (reason) => {
      logger.warn(`WhatsApp disconnected: ${reason}`);
      this.isReady = false;
      setTimeout(() => this.reconnect(), 10000);
    });
  }

  async handleIncomingMessage(message) {
    try {
      if (message.from.includes('@g.us') || message.isStatus) return;

      const phoneNumber = message.from;
      const messageText = message.body;

      logger.info(`📨 From ${phoneNumber}: ${messageText}`);

      const response = await messageRouter.handleMessage(phoneNumber, messageText);
      await this.sendMessage(phoneNumber, response);
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  async sendMessage(phoneNumber, message) {
    if (!this.isReady) {
      logger.warn(`Cannot send - not ready. isReady=${this.isReady}`);
      return false;
    }
    try {
      await this.client.sendMessage(phoneNumber, message);
      logger.info(`✉️ Sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error('Send error:', error);
      return false;
    }
  }

  async clearSession() {
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
  }

  async reconnect() {
    logger.info('Reconnecting...');
    try {
      if (this.client) {
        try { await this.client.destroy(); } catch (_) {}
        this.client = null;
      }
      this.isReady = false;
      this.qrCount = 0;
      await this.initialize();
    } catch (error) {
      logger.error('Reconnect failed:', error);
      setTimeout(() => this.reconnect(), 15000);
    }
  }

  getClient() { return this.client; }
  getQRCode() { return this.qrCodeData; }
  isClientReady() { return this.isReady; }
}

export const whatsappService = new WhatsAppService();
