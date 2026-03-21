import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  isJidGroup,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcodeTerminal from 'qrcode-terminal';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { messageRouter } from '../controllers/messageRouter.js';

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.isReady = false;
    this.qrCodeData = null;
    this.initAttempt = 0;
  }

  async initialize() {
    this.initAttempt++;
    logger.info(`WhatsApp init attempt #${this.initAttempt}`);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.sessionPath);
      const { version } = await fetchLatestBaileysVersion();

      logger.info(`Using Baileys v${version.join('.')}`);

      // Baileys requires a pino-compatible logger with .child(); we silence it
      const silentLogger = {
        level: 'silent',
        trace: () => {}, debug: () => {}, info: () => {},
        warn: () => {}, error: () => {}, fatal: () => {},
        child: () => silentLogger,
      };

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        printQRInTerminal: false,
        logger: silentLogger,
        browser: ['Arnold Gym Bot', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCodeData = qr;
          const url = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`;
          process.stdout.write(`\n${'='.repeat(60)}\n`);
          process.stdout.write(`QR CODE - SCAN WITH WHATSAPP NOW\n`);
          process.stdout.write(`${'='.repeat(60)}\n`);
          process.stdout.write(`OPEN THIS URL IN BROWSER TO SEE QR:\n${url}\n`);
          process.stdout.write(`${'='.repeat(60)}\n\n`);
          qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'open') {
          this.isReady = true;
          this.initAttempt = 0;
          this.qrCodeData = null;
          logger.info('🚀 WhatsApp is READY! Bot is active.');
          this._startKeepAlive();
        }

        if (connection === 'close') {
          this.isReady = false;
          this._stopKeepAlive();
          const statusCode = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode
            : 0;

          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          logger.warn(`Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

          if (shouldReconnect) {
            const delay = Math.min(15000 * this.initAttempt, 60000);
            logger.info(`Reconnecting in ${delay / 1000}s...`);
            setTimeout(() => this.initialize(), delay);
          } else {
            logger.error('Logged out. Clear session and restart.');
          }
        }
      });

      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          await this.handleIncomingMessage(msg);
        }
      });

    } catch (error) {
      logger.error(`WhatsApp init failed (attempt #${this.initAttempt}):`, error.message);
      this.isReady = false;
      const delay = Math.min(15000 * this.initAttempt, 60000);
      logger.info(`Retrying in ${delay / 1000}s...`);
      setTimeout(() => this.initialize(), delay);
    }
  }

  async handleIncomingMessage(msg) {
    try {
      // Ignore own messages, group messages, status updates
      if (msg.key.fromMe) return;
      if (isJidGroup(msg.key.remoteJid)) return;
      if (msg.key.remoteJid === 'status@broadcast') return;

      const phoneNumber = msg.key.remoteJid; // e.g. "919876543210@s.whatsapp.net"
      const messageText =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!messageText.trim()) return;

      logger.info(`📨 From ${phoneNumber}: ${messageText}`);

      const response = await messageRouter.handleMessage(phoneNumber, messageText);
      await this.sendMessage(phoneNumber, response);
    } catch (error) {
      logger.error('Error handling message:', error);
    }
  }

  async sendMessage(phoneNumber, message) {
    if (!this.isReady || !this.sock) {
      logger.warn(`Cannot send - not ready. isReady=${this.isReady}`);
      return false;
    }
    try {
      await this.sock.sendMessage(phoneNumber, { text: message });
      logger.info(`✉️ Sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      logger.error('Send error:', error);
      return false;
    }
  }

  getClient() { return this.sock; }
  getQRCode() { return this.qrCodeData; }
  isClientReady() { return this.isReady; }

  _startKeepAlive() {
    this._stopKeepAlive();
    // Send a presence update every 25s to keep the WA connection alive
    this._keepAliveInterval = setInterval(async () => {
      try {
        if (this.sock && this.isReady) {
          await this.sock.sendPresenceUpdate('available');
        }
      } catch (e) {
        logger.warn('Keep-alive ping failed:', e.message);
      }
    }, 25000);
  }

  _stopKeepAlive() {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval);
      this._keepAliveInterval = null;
    }
  }
}

export const whatsappService = new WhatsAppService();
