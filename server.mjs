import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import pdfParse from 'pdf-parse';
import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio'; // Correct Cheerio import
import xml2js from 'xml2js'; // Optional XML parsing library

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// OpenAI API configuration
const openai = new OpenAI({
  apiKey: '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',
});

// Store conversation history in memory
let conversationHistory = [
  { role: "system", content: "You are a helpful assistant for JP Rifles. Refer to JP Rifles as 'we' or 'us' in all responses." }
];

let websiteCache = {}; // Cache for website content

// **Manually Define Key URLs to Scrape**
const predefinedUrls = [
  'https://jprifles.com',
  'https://jprifles.com/2.1.php',
  'https://jprifles.com/1.4.7.2_os.php',
  'https://jprifles.com/1.4.6_gs.php',
  // Add more URLs as needed
];

// **Function to Scrape Individual Webpages**
async function scrapeWebsite(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // Extract relevant text from the webpage
    let content = $('body').text().replace(/\s+/g, ' ').trim();
    return content;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    return `Could not retrieve information from ${url}.`;
  }
}

// **Cache Website Content from Key URLs**
async function cacheWebsiteContent() {
  for (const url of predefinedUrls) {
    const content = await scrapeWebsite(url);
    websiteCache[url] = content;
  }
  console.log("Website content cached.");
}

// Cache content initially and refresh every 24 hours
cacheWebsiteContent();
setInterval(cacheWebsiteContent, 24 * 60 * 60 * 1000); // Refresh every 24 hours

// **Function to Search Cached Website Data**
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

    // Adjust response to refer to JP Rifles as 'we' or 'us'
    botResponse = adjustResponse(botResponse);

    conversationHistory.push({ role: "assistant", content: botResponse });

    res.json(botResponse);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Something went wrong.");
  }
});

function adjustResponse(text) {
  // Replace "JP Rifles" or "JP Enterprises" with "we", but only in appropriate contexts
  text = text.replace(/\b(JP Rifles|JP Enterprises)\b(?!\s+(is|are))/gi, "we");

  // Handle cases where "JP Rifles is" or "JP Enterprises are" need replacement
  text = text.replace(/\b(JP Rifles|JP Enterprises)\s+is\b/gi, "We are");
  text = text.replace(/\b(JP Rifles|JP Enterprises)\s+are\b/gi, "We are");

  // Replace plural pronouns like "their" with "our" and "them" with "us"
  text = text.replace(/\btheir\b/gi, "our").replace(/\btheirs\b/gi, "ours");
  text = text.replace(/\bthem\b/gi, "us");

  // Replace "they are" and "they're" with "we are" and "we're"
  text = text.replace(/\bthey are\b/gi, "we are").replace(/\bthey're\b/gi, "we're");

  // Ensure proper capitalization at the start of sentences or after periods
  text = text.replace(/(^|\.\s+)(we|our)/gi, (match) => match.toUpperCase());

  return text;
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
