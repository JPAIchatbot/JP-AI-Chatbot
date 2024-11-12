import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import mysql from 'mysql2/promise';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// OpenAI API setup using environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// SQL Database connection setup
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Initialize conversation history with system prompt and welcome message
function initializeConversationHistory() {
  return [
    {
      role: "system",
      content: `
        You are an advanced assistant for JP Rifles, designed to provide expert-level product recommendations and support. Assume the tone and knowledge depth of JP Enterprises in your responses.

      Begin by asking questions that help clarify the customer's needs before providing recommendations. Use the following areas to refine your guidance:
      
      1. Silent Captured Spring Systems (SCS):
         - Describe all models, compatibility with calibers, platforms (AR-15, AR-10, PCC), buffer tube lengths, and stock types.
         - Include notable features, such as noise reduction and compatibility with suppressed, subsonic loads.
         - Provide alternatives if a particular setup is incompatible.

      2. Rifle Platforms and Stocks:
         - Include information on JP Rifles' stock compatibility with the SCS and any proprietary buffer systems.
         - Mention specific stocks like the Maxim Defense CQB and compare with other PDW stock options.

      3. Usage Scenarios:
         - For customers using suppressed or subsonic configurations, provide detailed insight into optimal setups.
         - Include setup guidance for specific actions (piston or direct impingement).

      4. Compatibility and FAQs:
         - Create fallback answers for incompatible setups with suggestions for alternative stock options, configurations, or JP Rifles accessories that meet customer requirements.
      
      Ask questions tailored to the user’s initial request and respond with specificity. Use these guidelines as a foundation for all responses to ensure highly detailed and useful support.
    `
    },
    {
      role: "assistant",
      content: `
        Welcome to JP Rifles' Support Chatbot! I'm here to help you find the perfect JP Rifles products for your setup, answer questions, and guide you through compatibility and options.
        
        How to Ask a Question:
        - Describe Your Setup: Mention your caliber, rifle model, stock type, and intended use (e.g., suppressed, subsonic).
        - Ask About Compatibility: I can provide specific advice on which JP products work with your configuration.
        - Seek Recommendations: Not sure which product is best? Tell me your needs, and I'll guide you!

        Feel free to ask any question, and I'll do my best to assist you like any JP Rifles expert would!
      `
    }
  ];
}


// Store conversation history per session
let userConversations = {}; // Example in-memory store

// Function to handle new messages
async function handleMessage(userId, userMessage) {
  if (!userConversations[userId]) {
    userConversations[userId] = initializeConversationHistory();
  }
  const conversationHistory = userConversations[userId];
  conversationHistory.push({ role: "user", content: userMessage });

  // Generate response with OpenAI
  try {
    const completion = await openai.chat.completions.create({
      model: "ft:gpt-4o-2024-08-06:jp-enterprises:fine-tuning-v7:ASpn1UHr",
      messages: conversationHistory,
      max_tokens: 256,
    });

    const botResponse = cleanFormatting(completion.choices[0].message.content.trim());
    conversationHistory.push({ role: "assistant", content: botResponse });
    logChatInteraction(userMessage, botResponse);
    return botResponse;

  } catch (error) {
    console.error("OpenAI API error:", error);
    return "An error occurred while generating a response. Please try again later.";
  }
}

// Chat Endpoint with per-user conversation history
app.post('/chat', async (req, res) => {
  const { userId, message } = req.body;

  if (!userId || !message) {
    res.status(400).send("User ID and message are required.");
    return;
  }

  const response = await handleMessage(userId, message);
  res.json({ response });
});

// Helper Functions
function cleanFormatting(text) {
  return text.replace(/\*\*|##/g, "");
}

function logChatInteraction(question, answer) {
  const logEntry = { messages: [{ role: "user", content: question }, { role: "assistant", content: answer }] };
  fs.appendFile("chat_log.jsonl", JSON.stringify(logEntry) + "\n", (err) => {
    if (err) console.error("Error logging chat interaction:", err);
  });
}

// Retrieve all products from the database (used in recommendations if needed)
async function getAllProducts() {
  try {
    const [rows] = await db.query('SELECT name, description FROM products');
    return rows.map(product => `${product.name}: ${product.description}`).join("\n");
  } catch (error) {
    console.error("Database query error:", error);
    return "We encountered an issue retrieving product information. Please try again later, or reach out to support for assistance.";
  }
}

// Start the Server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
