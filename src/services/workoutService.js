import pkg from 'whatsapp-web.js';
const { Client, RemoteAuth } = pkg;

import { MongoStore } from 'wwebjs-mongo';
import mongoose from 'mongoose';

import { logger } from '../utils/logger.js';
import { messageRouter } from '../controllers/messageRouter.js';

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.qrCodeData = null;
    this.qrCount = 0;
  }

  async initialize() {
    try {
      logger.info('🚀 Initializing WhatsApp...');

      // ✅ Mongo store for session persistence
      const store = new MongoStore({ mongoose });

      this.client = new Client({
        authStrategy: new RemoteAuth({
          store,
          backupSyncIntervalMs: 300000,
        }),

        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
          ],
        },

        qrMaxRetries: 20,
        restartOnAuthFail: true,
      });

      this.setupEventHandlers();

      // ❗ DO NOT BLOCK HERE
      this.client.initialize();

    } catch (error) {
      logger.error('❌ WhatsApp init failed:', error.message);
      setTimeout(() => this.initialize(), 15000);
    }
  }

  setupEventHandlers() {
    this.client.on('qr', (qr) => {
      this.qrCount++;
      this.qrCodeData = qr;

      const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;

      console.log('\n' + '='.repeat(60));
      console.log(`QR CODE #${this.qrCount}`);
      console.log(url);
      console.log('='.repeat(60) + '\n');

      logger.info(`📲 QR generated (#${this.qrCount})`);
    });

    this.client.on('authenticated', () => {
      logger.info('🔥 AUTHENTICATED');
    });

    this.client.on('ready', () => {
      this.isReady = true;
      logger.info('🚀 WhatsApp READY');
    });

    this.client.on('change_state', (state) => {
      logger.info(`🔄 STATE: ${state}`);
    });

    this.client.on('loading_screen', (percent, message) => {
      logger.info(`⏳ Loading: ${percent}% - ${message}`);
    });

    this.client.on('auth_failure', (msg) => {
      logger.error(`❌ AUTH FAILURE: ${msg}`);
      this.isReady = false;
    });

    this.client.on('disconnected', (reason) => {
      logger.warn(`⚠️ Disconnected: ${reason}`);
      this.isReady = false;
      setTimeout(() => this.initialize(), 10000);
    });

    this.client.on('message', async (message) => {
      await this.handleIncomingMessage(message);
    });
  }

  async handleIncomingMessage(message) {
    try {
      if (message.from.includes('@g.us') || message.isStatus) return;

      const phoneNumber = message.from;
      const messageText = message.body;

      logger.info(`📨 ${phoneNumber}: ${messageText}`);

      const response = await messageRouter.handleMessage(phoneNumber, messageText);

      await this.sendMessage(phoneNumber, response);
    } catch (error) {
      logger.error('❌ Message handling error:', error);
    }
  }

  async sendMessage(phoneNumber, message) {
    if (!this.isReady) {
      logger.warn('⚠️ Cannot send — WhatsApp not ready');
      return false;
    }

    try {
      await this.client.sendMessage(phoneNumber, message);
      logger.info(`✉️ Sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error('❌ Send error:', error);
      return false;
    }
  }

  getQRCode() {
    return this.qrCodeData;
  }

  isClientReady() {
    return this.isReady;
  }
}

export const whatsappService = new WhatsAppService();