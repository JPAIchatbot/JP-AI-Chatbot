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

let conversationHistory = [
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

      4. **Compatibility and FAQs**:
         - Create fallback answers for incompatible setups with suggestions for alternative stock options, configurations, or JP Rifles accessories that meet customer requirements.
      
      Ask questions tailored to the user’s initial request and respond with specificity. Use these guidelines as a foundation for all responses to ensure highly detailed and useful support.
    `
  },
  {
    role: "assistant",
    content: `
      Welcome to JP Rifles' Support Chatbot! I'm here to help you find the perfect JP Rifles products for your setup, answer questions, and guide you through compatibility and options.

      **How to Ask a Question**:
      - **Describe Your Setup**: Mention your caliber, rifle model, stock type, and intended use (e.g., suppressed, subsonic).
      - **Ask About Compatibility**: I can provide specific advice on which JP products work with your configuration.
      - **Seek Recommendations**: Not sure which product is best? Tell me your needs, and I'll guide you!

      Feel free to ask any question, and I'll do my best to assist you like any JP Rifles expert would!
    `
  }
];


// **Function to Retrieve All Products from the Database**
async function getAllProducts() {
  try {
    const [rows] = await db.query('SELECT name, description FROM products');
    return rows.map(product => `${product.name}: ${product.description}`).join("\n");
  } catch (error) {
    console.error("Database query error:", error);
    return "We encountered an issue retrieving product information. Please try again later, or reach out to support for assistance.";
  }
}

// **Define SCS Product Recommendation Logic**
function getSCSRecommendation({ frame, config, suppressed, subsonic, lawFolder, lowMass }) {
  const products = {
    "JPSCS2-15": { name: "AR-15 Standard SCS", description: "Standard for AR-15" },
    "JPSCS2-15H2": { name: "AR-15 H2 SCS", description: "Heavier buffer for AR-15" },
    "JPSCS2-15-LAW": { name: "AR-15 Standard for Law Tactical Folder", description: "Compatible with Law Tactical Folder" },
    "JPSCS2-10": { name: "AR-10 Standard SCS", description: "Standard for AR-10" },
    "JPSCS2-10H2": { name: "AR-10 H2 SCS", description: "Heavier buffer for AR-10" },
    "JPSCS2-10-LAW": { name: "AR-10 Standard for Law Tactical Folder", description: "Compatible with Law Tactical Folder" }
  };

  if (frame === "AR-15") {
    if (lawFolder) return products["JPSCS2-15-LAW"];
    if (config && suppressed && subsonic) return products["JPSCS2-15"];
    if (config && suppressed) return products["JPSCS2-15H2"];
    return products["JPSCS2-15"];
  } else if (frame === "AR-10") {
    if (lawFolder) return products["JPSCS2-10-LAW"];
    if (config && suppressed && lowMass) return products["JPSCS2-10H2"];
    if (config && suppressed) return products["JPSCS2-10"];
    return products["JPSCS2-10"];
  }
  return { name: "No specific recommendation", description: "Please consult additional details" };
}

// **Gather Information for Product Recommendation**
async function gatherInfoAndRecommend(message) {
  const questions = [];
  if (!message.frame) questions.push("What is the frame size (AR-15 or AR-10)?");
  if (!message.config) questions.push("Are you using any special configurations?");
  if (!message.suppressed) questions.push("Will you be using a suppressor?");
  if (!message.subsonic) questions.push("Do you need to use subsonic ammunition?");
  if (!message.lawFolder) questions.push("Will you be using a Law Tactical Folder?");
  if (!message.lowMass) questions.push("Are you using a low mass setup?");

  if (questions.length > 0) {
    return questions.join(" ");
  }

  const recommendation = getSCSRecommendation(message);
  return `Based on your setup, we recommend the ${recommendation.name}: ${recommendation.description}`;
}

// **Function to Log Chat Interactions**
function logChatInteraction(question, answer) {
  const logEntry = {
    messages: [
      { role: "user", content: question },
      { role: "assistant", content: answer }
    ]
  };

  fs.appendFile("chat_log.jsonl", JSON.stringify(logEntry) + "\n", (err) => {
    if (err) console.error("Error logging chat interaction:", err);
  });
}

// **Chat Endpoint**
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  conversationHistory.push({ role: "user", content: message });

  try {
    if (message.toLowerCase().includes("recommend") || message.toLowerCase().includes("product")) {
      const allProducts = await getAllProducts();
      let productResponse = allProducts ? `Here are our products:\n${allProducts}` : "No products found.";
      conversationHistory.push({ role: "assistant", content: productResponse });
      
      // Log the interaction
      logChatInteraction(message, productResponse);

      res.json(productResponse);
      return;
    }

    // Call the OpenAI API for response generation
    const completion = await openai.chat.completions.create({
      model: "ft:gpt-4o-2024-08-06:jp-enterprises:fine-tuning-v7:ASpn1UHr",
      messages: conversationHistory,
      max_tokens: 256,
    });

    let botResponse = completion.choices[0].message.content.trim();
    botResponse = cleanFormatting(botResponse); // Clean formatting symbols
    conversationHistory.push({ role: "assistant", content: botResponse });

    // Log the interaction
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
  return text.replace(/\*\*|##/g, "");  // Removes ** and ## symbols
}

// **Adjust AI Responses to Use 'We' and 'Us'**
function adjustResponse(text) {
  text = text.replace(/\b(JP Rifles|JP Enterprises)\b(?!\s+(is|are))/gi, "we");
  text = text.replace(/\b(JP Rifles|JP Enterprises)\s+is\b/gi, "We are");
  text = text.replace(/\b(JP Rifles|JP Enterprises)\s+are\b/gi, "We are");
  text = text.replace(/\btheir\b/gi, "our").replace(/\btheirs\b/gi, "ours");
  text = text.replace(/\bthem\b/gi, "us");
  text = text.replace(/\bthey are\b/gi, "we are").replace(/\bthey're\b/gi, "we're");

  return text.replace(/(^|\.\s+)(we|our)/gi, (match) => match.toUpperCase());
}

// **Clear Conversation History Endpoint**
app.post('/clear', (req, res) => {
  conversationHistory = [
    { role: "system", content: "You are a helpful assistant for JP Rifles. Write as if you are JP Rifles." }
  ];
  res.send("Conversation history cleared.");
});

// **Start the Server**
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
