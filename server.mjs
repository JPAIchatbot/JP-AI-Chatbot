import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import fs from 'fs';
import { Pool } from 'pg';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// OpenAI API setup using environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://feedback_db_kfh5_user:W1EeNw4nyMV5IX3Ra5tYCQoEmpFozffv@dpg-cstm22lds78s73cku7mg-a/feedback_db_kfh5',
  ssl: {
    rejectUnauthorized: false, // Required for Render-hosted PostgreSQL
  },
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
    },
  ];
}

// When a new session is created, initialize the conversation history
let conversationHistory = initializeConversationHistory();

// Feedback Table Creation
async function createFeedbackTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS feedback (
      id SERIAL PRIMARY KEY,
      response_id TEXT NOT NULL,
      original_response TEXT NOT NULL,
      corrected_response TEXT NOT NULL,
      context TEXT,
      save_globally BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(query);
    console.log("Feedback table created or already exists.");
  } catch (error) {
    console.error("Error creating feedback table:", error);
  }
}
createFeedbackTable();

// Function to handle new messages and maintain conversation
function handleMessage(userMessage) {
  conversationHistory.push({ role: "user", content: userMessage });

  const response = generateResponse(conversationHistory);

  conversationHistory.push({ role: "assistant", content: response });

  return response;
}

// Example function to simulate response generation (replace with your actual chatbot logic)
function generateResponse(history) {
  return "This is where the assistant's response would go.";
}

// Log Chat Interactions
function logChatInteraction(question, answer) {
  const logEntry = {
    messages: [
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ],
  };

  fs.appendFile("chat_log.jsonl", JSON.stringify(logEntry) + "\n", (err) => {
    if (err) console.error("Error logging chat interaction:", err);
  });
}

// Feedback Endpoint
app.post('/feedback', async (req, res) => {
  const { responseId, originalResponse, correctedResponse, context, saveGlobally } = req.body;

  try {
    const query = `
      INSERT INTO feedback (response_id, original_response, corrected_response, context, save_globally)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const values = [responseId, originalResponse, correctedResponse, context, saveGlobally];

    const result = await pool.query(query, values);
    res.status(200).json({ message: "Feedback recorded", data: result.rows[0] });
  } catch (error) {
    console.error("Error saving feedback:", error);
    res.status(500).json({ message: "Error saving feedback" });
  }
});

// Chat Endpoint
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  conversationHistory.push({ role: "user", content: message });

  try {
    const completion = await openai.chat.completions.create({
      model: "ft:gpt-4o-2024-08-06:jp-enterprises:product-fine-tuning-v8:ASsmyJys",
      messages: conversationHistory,
      max_tokens: 256,
    });

    let botResponse = completion.choices[0].message.content.trim();
    botResponse = cleanFormatting(botResponse); // Clean formatting symbols
    conversationHistory.push({ role: "assistant", content: botResponse });

    logChatInteraction(message, botResponse);

    res.json(botResponse);

  } catch (error) {
    console.error("Unexpected error:", error);
    fs.appendFile("error_log.txt", `Error: ${error}\n`, (err) => {
      if (err) console.error("Error logging to error_log.txt:", err);
    });
    res.status(500).send("An unexpected error occurred.");
  }
});

function cleanFormatting(text) {
  return text.replace(/\*\*|##/g, ""); // Removes ** and ## symbols
}

// Clear Conversation History Endpoint
app.post('/clear', (req, res) => {
  conversationHistory = initializeConversationHistory();
  res.send("Conversation history cleared.");
});

// Start the Server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
