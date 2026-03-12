import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

// Index for efficient querying
conversationSchema.index({ phoneNumber: 1, timestamp: -1 });

export const Conversation = mongoose.model('Conversation', conversationSchema);
