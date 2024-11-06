import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import mysql from 'mysql2/promise';

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

// In-memory cache for scraped website content
let websiteCache = {};
let conversationHistory = [
  { role: "system", content: "You are a helpful assistant for JP Rifles. Refer to JP Rifles as 'we' or 'us' in all responses. Your goal is to help the user get the correct information as fast as possible without saying a lot. Keep things simple." }
];

// URLs to be scraped
const predefinedUrls = [
  'https://jprifles.com',
  'https://jprifles.com/2.1.php',
  'https://jprifles.com/1.4.7.2_os.php',
  'https://jprifles.com/1.4.6_gs.php',
];

// **Function to Retrieve Active Products from the Database**
async function getActiveProducts() {
  try {
    const [rows] = await db.query('SELECT name, description FROM products WHERE is_active = 1');
    return rows.map(product => `${product.name}: ${product.description}`).join("\n");
  } catch (error) {
    console.error("Database query error:", error);
    return "Sorry, I couldn't retrieve the product information.";
  }
}

// **Function to Scrape Website Content**
async function scrapeWebsite(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    let content = $('body').text().replace(/\s+/g, ' ').trim();
    return content;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return `Could not retrieve information from ${url}.`;
  }
}

// **Cache Website Content from Predefined URLs**
async function cacheWebsiteContent() {
  for (const url of predefinedUrls) {
    const content = await scrapeWebsite(url);
    websiteCache[url] = content;
  }
  console.log("Website content cached.");
}

// Refresh the cache every 24 hours
cacheWebsiteContent();
setInterval(cacheWebsiteContent, 24 * 60 * 60 * 1000);

// **Search Cached Website Content**
function searchWebsiteCache(query) {
  for (const [url, content] of Object.entries(websiteCache)) {
    if (content.toLowerCase().includes(query.toLowerCase())) {
      return `Found relevant information on ${url}:\n${content.substring(0, 300)}...`;
    }
  }
  return "No relevant information found on the website.";
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

// **Chat Endpoint**
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  conversationHistory.push({ role: "user", content: message });

  try {
    if (message.toLowerCase().includes("recommend") || message.toLowerCase().includes("product")) {
      const activeProducts = await getActiveProducts();
      let productResponse = activeProducts ? `Here are our active products:\n${activeProducts}` : "No active products found.";
      conversationHistory.push({ role: "assistant", content: productResponse });
      res.json(productResponse);
      return;
    }

    let botResponse = searchWebsiteCache(message);
    if (botResponse.includes("No relevant information")) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: conversationHistory,
        max_tokens: 512,
      });

      botResponse = completion.choices[0].message.content.trim();
    }

    botResponse = adjustResponse(botResponse);
    conversationHistory.push({ role: "assistant", content: botResponse });
    res.json(botResponse);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Something went wrong.");
  }
});

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
    { role: "system", content: "You are a helpful assistant for JP Rifles. Refer to JP Rifles as 'we' or 'us' in all responses." }
  ];
  res.send("Conversation history cleared.");
});

// **Start the Server**
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
