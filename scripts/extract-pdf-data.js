/**
 * Helper script to extract prompts and image data from PDF
 * 
 * To use this:
 * 1. Install pdf-parse: npm install pdf-parse
 * 2. Run: node scripts/extract-pdf-data.js
 * 
 * Or manually copy the prompts and image URLs from your PDF
 * into public/data/klint-community-gallery.json
 */

const fs = require('fs');
const path = require('path');

// Example structure - replace with your actual data
const galleryData = [
  {
    "id": "1",
    "prompt": "A hyper-realistic cinematic shot of two Formula 1 cars colliding at high speed, captured at the exact moment of impact. Carbon fiber pieces and metal fragments are flying through the air, tires lifting slightly, sparks bursting from the collision point",
    "imageUrl": "https://your-image-url-here.com/image1.jpg",
    "model": "Nano Banana Pro",
    "aspectRatio": "16:9",
    "author": "hockney_cloud_bruh"
  }
  // Add more entries here...
];

const outputPath = path.join(__dirname, '../public/data/klint-community-gallery.json');
fs.writeFileSync(outputPath, JSON.stringify(galleryData, null, 2));
console.log(`✅ Gallery data written to ${outputPath}`);
console.log(`📝 Please add your prompts and image URLs to this file`);

