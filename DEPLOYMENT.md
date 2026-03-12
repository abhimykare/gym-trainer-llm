# Deployment Guide for Render

## Prerequisites

1. GitHub account with your code pushed
2. Render account (https://render.com)
3. MongoDB Atlas account (https://cloud.mongodb.com)
4. Google Gemini API key (https://makersuite.google.com/app/apikey)

## Step-by-Step Deployment

### 1. Setup MongoDB Atlas

1. Create a free account at https://cloud.mongodb.com
2. Create a new cluster (free tier M0)
3. Create a database user:
   - Database Access → Add New Database User
   - Username: `gymtrainer`
   - Password: Generate secure password
   - Database User Privileges: Read and write to any database

4. Configure Network Access:
   - Network Access → Add IP Address
   - Allow Access from Anywhere: `0.0.0.0/0`
   - (Required for Render to connect)

5. Get Connection String:
   - Clusters → Connect → Connect your application
   - Copy connection string
   - Replace `<password>` with your database user password
   - Example: `mongodb+srv://gymtrainer:<password>@cluster0.xxxxx.mongodb.net/gym-trainer?retryWrites=true&w=majority`

### 2. Get Google Gemini API Key

1. Visit https://makersuite.google.com/app/apikey
2. Click "Create API Key"
3. Select or create a Google Cloud project
4. Copy the API key

### 3. Push Code to GitHub

```bash
git init
git add .
git commit -m "Initial commit: WhatsApp AI Gym Trainer"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 4. Deploy on Render

1. **Create New Web Service**
   - Go to https://dashboard.render.com
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository

2. **Configure Service**
   - **Name**: `whatsapp-gym-trainer` (or your choice)
   - **Region**: Choose closest to you
   - **Branch**: `main`
   - **Root Directory**: Leave empty
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: 
     - Free (for testing, may sleep after inactivity)
     - Starter ($7/month, recommended for production)

3. **Add Environment Variables**
   
   Click "Advanced" → "Add Environment Variable"
   
   Add these variables:
   
   ```
   MONGODB_URI=mongodb+srv://gymtrainer:<password>@cluster0.xxxxx.mongodb.net/gym-trainer?retryWrites=true&w=majority
   
   GEMINI_API_KEY=your_gemini_api_key_here
   
   WHATSAPP_SESSION_PATH=/opt/render/project/src/whatsapp-session
   
   NODE_ENV=production
   ```

4. **Add Persistent Disk (Important!)**
   
   - Scroll to "Disk"
   - Click "Add Disk"
   - **Name**: `whatsapp-session`
   - **Mount Path**: `/opt/render/project/src/whatsapp-session`
   - **Size**: 1 GB (minimum)
   
   This ensures WhatsApp session persists across deployments.

5. **Deploy**
   - Click "Create Web Service"
   - Wait for deployment to complete (3-5 minutes)

### 5. Connect WhatsApp

1. **View Logs**
   - In Render dashboard, click on your service
   - Go to "Logs" tab
   - Wait for QR code to appear in logs

2. **Scan QR Code**
   - Open WhatsApp on your phone
   - Go to Settings → Linked Devices
   - Tap "Link a Device"
   - Scan the QR code from Render logs

3. **Verify Connection**
   - Check logs for "WhatsApp client is ready!"
   - Send a test message to the bot
   - Bot should respond

### 6. Monitor and Maintain

**Check Logs:**
```bash
# Install Render CLI (optional)
npm install -g render-cli

# View logs
render logs -f
```

**Common Issues:**

1. **QR Code Not Appearing**
   - Check if Puppeteer dependencies are installed
   - Render should auto-install them
   - Check build logs for errors

2. **Session Lost After Deployment**
   - Verify persistent disk is mounted correctly
   - Check WHATSAPP_SESSION_PATH matches mount path

3. **MongoDB Connection Failed**
   - Verify connection string is correct
   - Check MongoDB Atlas network access (0.0.0.0/0)
   - Ensure database user has correct permissions

4. **Gemini API Errors**
   - Verify API key is valid
   - Check API quota limits
   - Review error logs

**Auto-Reconnection:**
The bot automatically reconnects if WhatsApp disconnects. No manual intervention needed.

**Scaling:**
- Free tier: May sleep after 15 minutes of inactivity
- Starter tier: Always on, recommended for production
- Professional tier: For high-volume usage

### 7. Update Deployment

When you push changes to GitHub:

```bash
git add .
git commit -m "Update feature"
git push origin main
```

Render will automatically:
1. Detect the push
2. Rebuild the service
3. Deploy new version
4. Maintain WhatsApp session (thanks to persistent disk)

### 8. Environment-Specific Configuration

**Development (.env):**
```env
MONGODB_URI=mongodb://localhost:27017/gym-trainer
GEMINI_API_KEY=your_key
WHATSAPP_SESSION_PATH=./whatsapp-session
```

**Production (Render):**
```env
MONGODB_URI=mongodb+srv://...
GEMINI_API_KEY=your_key
WHATSAPP_SESSION_PATH=/opt/render/project/src/whatsapp-session
NODE_ENV=production
```

### 9. Cost Estimation

**Free Tier:**
- Render: Free (with limitations)
- MongoDB Atlas: Free (M0 cluster, 512MB)
- Google Gemini: Free tier available
- **Total: $0/month**

**Production Tier:**
- Render Starter: $7/month
- MongoDB Atlas: Free (M0 sufficient for small scale)
- Google Gemini: Pay-as-you-go (very affordable)
- **Total: ~$7-10/month**

### 10. Backup and Recovery

**Backup MongoDB:**
```bash
# Using mongodump
mongodump --uri="mongodb+srv://..." --out=./backup
```

**Backup WhatsApp Session:**
- Download persistent disk from Render dashboard
- Store securely

**Recovery:**
- Restore MongoDB from backup
- Upload session files to persistent disk
- Redeploy service

## Support

For issues:
1. Check Render logs
2. Verify environment variables
3. Test MongoDB connection
4. Verify Gemini API key
5. Check WhatsApp session files

## Security Best Practices

1. Never commit `.env` file
2. Use strong MongoDB passwords
3. Rotate API keys periodically
4. Monitor usage and logs
5. Enable 2FA on all accounts

---

Your WhatsApp AI Gym Trainer is now live! 🎉
