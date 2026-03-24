import { generateImage } from './services/geminiService.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch'; // need fetch globally in case it is node 16 

dotenv.config();

// MOCK the global buildApiUrl or fetch if needed
global.fetch = fetch;

async function test() {
    try {
        const urls = await generateImage({
            prompt: "A very nice sunset.",
            model: "gemini-3.1-flash-image-preview",
            aspectRatio: "16:9",
            quality: "1K",
            baseImages: [],
            userId: "testId",
            saveToGallery: false,
            autoDownload: false
        });
        console.log("SUCCESS:", urls.length > 0 ? "Got images" : "Empty");
    } catch (err) {
        console.error("FAILED:", err.message);
    }
}

test();
