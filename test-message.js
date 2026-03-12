import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './whatsapp-session',
  }),
  puppeteer: {
    headless: true,
    executablePath: '/Users/abhirajk/.cache/puppeteer/chrome/mac_arm-146.0.7680.72/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
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

client.on('ready', async () => {
  console.log('Client is ready!');
  
  const phoneNumber = '918943936250@c.us'; // Your personal number
  const message = `🏋️ *Welcome to Coach Max - Your AI Gym Trainer!*

Hey there! I'm Coach Max, your personal AI gym trainer. I'm here to help you stay consistent with your fitness journey! 💪

*What I can do for you:*
✅ Track your gym attendance
✅ Generate personalized workout plans
✅ Monitor your protein intake
✅ Keep you motivated and accountable
✅ Send daily reminders

*How to interact with me:*
- Reply "yes" when you go to the gym
- Ask for "workout" to get today's plan
- Tell me "protein done" when you hit your goal
- Ask me anything fitness-related
- Type "help" to see all commands

Let's get started! Are you ready to crush your fitness goals? 🔥

Reply to this message and let's begin your transformation!`;

  try {
    await client.sendMessage(phoneNumber, message);
    console.log('✅ Test message sent successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error sending message:', error);
    process.exit(1);
  }
});

client.on('authenticated', () => {
  console.log('Authenticated successfully');
});

client.on('auth_failure', (msg) => {
  console.error('Authentication failure:', msg);
  process.exit(1);
});

client.initialize();
