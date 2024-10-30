import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import pdfParse from 'pdf-parse';
import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio'; // Correct Cheerio import

const app = express();
const PORT = process.env.PORT || 3000; // Use dynamic port for Render

// OpenAI API setup using environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // API key from .env
});

// In-memory cache for scraped website content
let websiteCache = {};

// Store conversation history in memory
let conversationHistory = [
  { role: "system", content: "You are a helpful assistant for JP Rifles. Refer to JP Rifles as 'we' or 'us' in all responses." }
];

// URLs to be scraped
const predefinedUrls = [
  'https://jprifles.com',
  'https://jprifles.com/2.1.php',
  'https://jprifles.com/1.4.7.2_os.php',
  'https://jprifles.com/1.4.6_gs.php',
];

// Middleware
app.use(cors());
app.use(express.json());

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
setInterval(cacheWebsiteContent, 24 * 60 * 60 * 1000); // 24 hours

// **Search Cached Website Content**
function searchWebsiteCache(query) {
  for (const [url, content] of Object.entries(websiteCache)) {
    if (content.toLowerCase().includes(query.toLowerCase())) {
      return `Found relevant information on ${url}:\n${content.substring(0, 300)}...`;
    }
  }
  return "No relevant information found on the website.";
}

// **Chat Endpoint**
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  conversationHistory.push({ role: "user", content: message });

  try {
    let botResponse = searchWebsiteCache(message);

    if (botResponse.includes("No relevant information")) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: conversationHistory,
        max_tokens: 512,
      });

      botResponse = completion.choices[0].message.content.trim();
    }

    botResponse = adjustResponse(botResponse); // Adjust responses for JP Rifles

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
