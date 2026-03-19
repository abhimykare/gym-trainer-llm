import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { messageRouter } from '../controllers/messageRouter.js';
import fs from 'fs';
import QRCode from 'qrcode';
import puppeteer from 'puppeteer';

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
      
      // Try to find Chrome executable
      let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      
      if (!executablePath) {
        // Try system Chrome on Mac
        const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        const fs = await import('fs');
        if (fs.existsSync(macChrome)) {
          executablePath = macChrome;
          logger.info('Using system Chrome from Applications');
        } else {
          try {
            executablePath = puppeteer.executablePath();
            logger.info('Using Puppeteer Chrome');
          } catch (e) {
            logger.warn('Could not find Chrome, will try without executablePath');
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
          '--disable-gpu',
        ],
      };
      
      if (executablePath) {
        puppeteerConfig.executablePath = executablePath;
      }
      
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: config.whatsapp.sessionPath,
        }),
        puppeteer: puppeteerConfig,
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
    this.client.on('qr', async (qr) => {
      this.qrCount++;
      this.qrCodeData = qr;
      
      logger.info('='.repeat(60));
      logger.info(`QR CODE #${this.qrCount} RECEIVED - SCAN WITH WHATSAPP`);
      logger.info('='.repeat(60));
      
      // Print to terminal (may break in Render UI)
      qrcode.generate(qr, { small: true });
      
      // Save QR as text
      logger.info(`\n📱 QR CODE #${this.qrCount} DATA (copy this to generate QR):`);
      logger.info(qr);
      logger.info(`\n🔗 QR CODE #${this.qrCount} URL - CLICK TO OPEN:`);
      logger.info('https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr));
      logger.info('='.repeat(60));
      logger.info(`⏰ QR Code #${this.qrCount} will expire in ~20 seconds. Wait for QR #${this.qrCount + 1} if this doesn't work!`);
      logger.info('='.repeat(60));
      
      try {
        await QRCode.toFile(`/tmp/whatsapp-qr-${this.qrCount}.png`, qr);
        logger.info(`✅ QR code #${this.qrCount} saved to /tmp/whatsapp-qr-${this.qrCount}.png`);
      } catch (err) {
        logger.error('Could not save QR image:', err.message);
      }
    });

    this.client.on('authenticated', () => {
      logger.info('WhatsApp authenticated successfully');
    });

    this.client.on('ready', () => {
      this.isReady = true;
      logger.info('WhatsApp client is ready!');
    });

    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });

    this.client.on('disconnected', (reason) => {
      logger.warn('WhatsApp client disconnected:', reason);
      this.isReady = false;
      this.reconnect();
    });

    this.client.on('auth_failure', (msg) => {
      logger.error('Authentication failure:', msg);
    });
  }

  async handleIncomingMessage(message) {
    try {
      if (message.from.includes('@g.us') || message.isStatus) {
        return;
      }

      const phoneNumber = message.from;
      const messageText = message.body;

      logger.info(`Message from ${phoneNumber}: ${messageText}`);
      const response = await messageRouter.handleMessage(phoneNumber, messageText);
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

  getQRCode() {
    return this.qrCodeData;
  }
}

export const whatsappService = new WhatsAppService();
