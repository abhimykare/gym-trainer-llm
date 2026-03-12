# WhatsApp AI Gym Trainer Bot

A personalized AI gym trainer bot that connects via WhatsApp using Google's Gemini LLM. The bot monitors user habits, sends gym reminders, tracks workouts, monitors protein intake, and provides continuous motivation.

## Features

- 🏋️ **Personalized AI Trainer**: Strict but supportive gym coach powered by Google Gemini
- 📅 **Daily Reminders**: Automated gym reminders at 9:30 AM and check-ins at 8:30 PM
- 💪 **Workout Generation**: AI-generated personalized workout plans
- 🥚 **Protein Monitoring**: Daily protein intake tracking and recommendations
- 💬 **Continuous Conversation**: Natural conversation flow with memory
- 📊 **Progress Tracking**: MongoDB-based workout and user data storage
- 🔄 **Auto-Recovery**: Persistent WhatsApp session with auto-reconnection

## Tech Stack

- **Runtime**: Node.js (ES6 modules)
- **Database**: MongoDB with Mongoose
- **Messaging**: whatsapp-web.js
- **LLM**: Google Gemini API
- **Scheduling**: node-cron
- **QR Display**: qrcode-terminal

## Project Structure

```
project-root/
├── src/
│   ├── config/
│   │   ├── database.js
│   │   └── env.js
│   ├── constants/
│   │   └── trainerRules.js
│   ├── controllers/
│   │   └── messageRouter.js
│   ├── services/
│   │   ├── whatsappService.js
│   │   ├── userService.js
│   │   ├── workoutService.js
│   │   └── conversationService.js
│   ├── llm/
│   │   └── geminiClient.js
│   ├── models/
│   │   ├── User.js
│   │   ├── Workout.js
│   │   └── Conversation.js
│   ├── schedulers/
│   │   └── reminderScheduler.js
│   ├── utils/
│   │   └── logger.js
│   └── index.js
├── package.json
├── .env.example
└── README.md
```

## Installation

### Prerequisites

- Node.js (v18 or higher)
- MongoDB (local or cloud instance)
- Google Gemini API key

### Steps

1. Clone the repository:
```bash
git clone <repository-url>
cd whatsapp-ai-gym-trainer
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
WHATSAPP_SESSION_PATH=./whatsapp-session
MONGODB_URI=mongodb://localhost:27017/gym-trainer
GEMINI_API_KEY=your_gemini_api_key_here
BOT_PHONE_NUMBER=your_whatsapp_number_here
```

5. Get your Gemini API key:
   - Visit https://makersuite.google.com/app/apikey
   - Create a new API key
   - Add it to your `.env` file

## Running Locally

Start the bot:
```bash
npm start
```

The bot will:
1. Connect to MongoDB
2. Initialize WhatsApp client
3. Display a QR code in the terminal
4. Wait for you to scan the QR code with WhatsApp
5. Start listening for messages and sending scheduled reminders

## Deploying to Render

### Step 1: Prepare for Deployment

1. Push your code to GitHub
2. Ensure `.gitignore` includes:
   - `node_modules/`
   - `.env`
   - `whatsapp-session/`

### Step 2: Create Render Service

1. Go to https://render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Configure:
   - **Name**: whatsapp-gym-trainer
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free or Starter

### Step 3: Add Environment Variables

In Render dashboard, add:
- `MONGODB_URI`: Your MongoDB connection string (use MongoDB Atlas)
- `GEMINI_API_KEY`: Your Google Gemini API key
- `WHATSAPP_SESSION_PATH`: `/opt/render/project/src/whatsapp-session`

### Step 4: MongoDB Atlas Setup

1. Create free cluster at https://cloud.mongodb.com
2. Create database user
3. Whitelist all IPs (0.0.0.0/0) for Render
4. Get connection string and add to Render env vars

### Step 5: First Deployment

1. Deploy the service
2. Check logs for QR code
3. Scan QR code with WhatsApp
4. Session will persist in Render's disk storage

### Important Notes for Render

- Use persistent disk storage for `whatsapp-session/`
- Monitor logs for QR code on first deployment
- Session persists across deployments
- Auto-reconnection handles disconnections

## Usage

### User Commands

- **"yes"** / **"went"**: Confirm gym visit → Get workout plan
- **"no"** / **"didn't"**: Admit skipping → Get motivational push
- **"workout"** / **"plan"**: Request workout plan
- **"protein done"**: Log protein intake
- **"help"**: Show available commands

### Scheduled Messages

- **9:30 AM**: Morning gym reminder
- **8:30 PM**: Evening gym check-in
- **8:00 AM**: Protein intake reminder

### Conversation Examples

```
Bot: 🌅 Good morning! Reminder: Go to the gym today.
User: yes
Bot: Great! 💪 Let's crush it today!

🏋️ TODAY'S WORKOUT PLAN
...
```

## Architecture

### Clean Architecture Layers

1. **Config**: Environment and database configuration
2. **Constants**: System prompts and trainer rules
3. **Models**: MongoDB schemas (User, Workout, Conversation)
4. **Services**: Business logic (WhatsApp, User, Workout, Conversation)
5. **Controllers**: Message routing and intent detection
6. **LLM**: Gemini client for AI responses
7. **Schedulers**: Cron jobs for reminders
8. **Utils**: Logging utilities

### Message Flow

```
WhatsApp Message
    ↓
whatsappService
    ↓
messageRouter (intent detection)
    ↓
geminiClient (AI response)
    ↓
conversationService (save to DB)
    ↓
WhatsApp Response
```

## Customization

### Modify Trainer Personality

Edit `src/constants/trainerRules.js`:
```javascript
export const TRAINER_SYSTEM_PROMPT = `Your custom trainer personality...`;
```

### Change Reminder Times

Edit `src/schedulers/reminderScheduler.js`:
```javascript
// Change cron schedule
const morningReminder = cron.schedule('30 9 * * *', ...);
```

### Add New Intents

Edit `src/constants/trainerRules.js`:
```javascript
export const INTENT_KEYWORDS = {
  NEW_INTENT: ['keyword1', 'keyword2'],
};
```

Then handle in `src/controllers/messageRouter.js`.

## Troubleshooting

### QR Code Not Showing
- Check if port 3000 is available
- Ensure Puppeteer dependencies are installed
- Check logs for errors

### WhatsApp Disconnects
- Bot auto-reconnects every 5 seconds
- Check internet connection
- Verify session files exist

### Gemini API Errors
- Verify API key is correct
- Check API quota limits
- Review error logs

### MongoDB Connection Issues
- Verify connection string
- Check network access in MongoDB Atlas
- Ensure database user has correct permissions

## License

ISC

## Support

For issues and questions, check the logs:
```bash
# View logs on Render
render logs -f
```

---

Built with ❤️ for fitness enthusiasts
