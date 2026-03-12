import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { messageRouter } from '../controllers/messageRouter.js';

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
  }

  async initialize() {
    try {
      logger.info('Initializing WhatsApp client...');
      
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: config.whatsapp.sessionPath,
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
          ],
        },
      });

      this.setupEventHandlers();
      
      await this.client.initialize();
      
      logger.info('WhatsApp client initialized successfully');
    } catch (error) {
      logger.error('Error initializing WhatsApp client:', error);
      throw error;
    }
  }

  setupEventHandlers() {
    // QR Code generation
    this.client.on('qr', (qr) => {
      logger.info('QR Code received. Scan with WhatsApp:');
      qrcode.generate(qr, { small: true });
    });

    // Authentication success
    this.client.on('authenticated', () => {
      logger.info('WhatsApp authenticated successfully');
    });

    // Client ready
    this.client.on('ready', () => {
      this.isReady = true;
      logger.info('WhatsApp client is ready!');
    });

    // Handle incoming messages
    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });

    // Handle disconnection
    this.client.on('disconnected', (reason) => {
      logger.warn('WhatsApp client disconnected:', reason);
      this.isReady = false;
      this.reconnect();
    });

    // Handle authentication failure
    this.client.on('auth_failure', (msg) => {
      logger.error('Authentication failure:', msg);
    });
  }

  async handleIncomingMessage(message) {
    try {
      // Ignore group messages and status updates
      if (message.from.includes('@g.us') || message.isStatus) {
        return;
      }

      const phoneNumber = message.from;
      const messageText = message.body;

      logger.info(`Message from ${phoneNumber}: ${messageText}`);

      // Route message and get response
      const response = await messageRouter.handleMessage(phoneNumber, messageText);

      // Send response
      await this.sendMessage(phoneNumber, response);
    } catch (error) {
      logger.error('Error handling incoming message:', error);
    }
  }

  async sendMessage(phoneNumber, message) {
    try {
      if (!this.isReady) {
        logger.warn('Client not ready. Message queued.');
        return false;
      }

      await this.client.sendMessage(phoneNumber, message);
      logger.info(`Message sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error('Error sending message:', error);
      return false;
    }
  }

  async reconnect() {
    logger.info('Attempting to reconnect WhatsApp client...');
    setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        logger.error('Reconnection failed:', error);
        this.reconnect();
      }
    }, 5000);
  }

  getClient() {
    return this.client;
  }
}

export const whatsappService = new WhatsAppService();
